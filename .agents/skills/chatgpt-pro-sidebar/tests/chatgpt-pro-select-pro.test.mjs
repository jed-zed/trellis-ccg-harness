import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

// Pure local DOM-interface fixtures. No browser, credentials, network, or model.
const source = fs.readFileSync(new URL('../scripts/chatgpt-pro-agent-browser-select-pro.js', import.meta.url), 'utf8');

function environment({composerCount = 1, label = 'Pro', otherForm = false, transcriptMenu = false} = {}) {
  const reads = {conversation: 0, credential: 0, allowedUiLabels: 0};
  const queries = [];
  const tags = [];
  const form = {};
  function element({text = '', rect = {left: 0, right: 200, top: 100, bottom: 140, width: 200, height: 40}, ownerForm = form, conversation = false, attributes = {}} = {}) {
    return {
      hidden: false, form: ownerForm,
      getAttribute(name) { return attributes[name] ?? null; },
      hasAttribute(name) { return name in attributes; },
      removeAttribute(name) { delete attributes[name]; },
      setAttribute(name, value) { attributes[name] = value; tags.push(name); },
      getBoundingClientRect() { return rect; },
      closest(selector) {
        if (selector === 'form') return ownerForm;
        if (selector === '[role="menu"]') return null;
        if (selector.includes('data-message-author-role') || selector.includes('conversation-turn-')) return conversation ? transcript : null;
        throw new Error('Unexpected ancestry query: ' + selector);
      },
      get innerText() {
        if (conversation) { reads.conversation++; throw new Error('Conversation content read'); }
        reads.allowedUiLabels++; return text;
      },
      get textContent() {
        if (conversation) { reads.conversation++; throw new Error('Conversation content read'); }
        reads.allowedUiLabels++; return text;
      },
    };
  }
  const transcript = element({text: 'PRIVATE_CONVERSATION_CANARY', conversation: true});
  const composers = Array.from({length: composerCount}, () => element());
  const control = element({text: label, ownerForm: otherForm ? {} : form, attributes: {'aria-label': '\u9009\u62e9 ChatGPT \u6a21\u578b'}});
  // This node really matches the global button[aria-haspopup="menu"] query.
  // It is outside the composer area and inside a conversation turn.
  const historyMenu = element({text: 'PRIVATE_CONVERSATION_CANARY', conversation: true, rect: {left: 0, right: 200, top: -500, bottom: -460, width: 200, height: 40}});
  const document = {
    querySelectorAll(selector) {
      queries.push(selector);
      if (selector === '[data-message-author-role]') return [transcript];
      if (selector === '[data-codex-gptpro-mode-control]' || selector === '[data-codex-gptpro-pro-option]') return [];
      if (selector.startsWith('#prompt-textarea, ')) {
        if (!selector.includes(':not([data-message-author-role], [data-message-author-role] *, article[data-testid^="conversation-turn-"] *)')) throw new Error('Composer history exclusion lost');
        return composers;
      }
      if (selector === 'button[aria-haspopup="menu"]') return transcriptMenu ? [historyMenu, control] : [control];
      if (selector === '[role="menuitemradio"]' || selector === '[role="menuitem"][aria-haspopup="menu"]') return [];
      throw new Error('Unexpected DOM query: ' + selector);
    },
    get cookie() { reads.credential++; throw new Error('Credential read'); },
  };
  const context = {document, getComputedStyle: () => ({display: 'block', visibility: 'visible'})};
  for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(context, key, {get() { reads.credential++; throw new Error('Credential read'); }});
  for (const key of ['fetch', 'XMLHttpRequest']) context[key] = () => { reads.credential++; throw new Error('Network/credential API used'); };
  return {context, reads, queries, tags};
}

function execute(js, fixture) {
  return new vm.Script('(function(){\n' + js + '\n})()').runInNewContext(fixture.context, {timeout: 1000});
}
function check(name, options, expected) {
  test(name, () => {
    const fixture = environment(options);
    const returned = execute(source, fixture);
    for (const [key, value] of Object.entries(expected)) assert.strictEqual(returned[key], value);
    assert.strictEqual(fixture.reads.conversation, 0, 'No conversation content may be read');
    assert.strictEqual(fixture.reads.credential, 0, 'No credential or network API may be read');
  });
}

check('Fallback composer excludes transcript DOM without reading turn content', {}, {ok: true, phase: 'already-pro', selectedLabel: 'Pro'});
check('Transcript-only composer is not selected', {composerCount: 0}, {ok: false, reason: 'composer-count', count: 0});
check('Two real composers fail closed before labels', {composerCount: 2}, {ok: false, reason: 'composer-count', count: 2});
check('Medium requires same composer form', {label: 'Medium'}, {ok: true, phase: 'open-menu', selectedLabel: 'Medium'});
check('Medium in another form is rejected', {label: 'Medium', otherForm: true}, {ok: false, reason: 'mode-control-count', count: 0});
check('Conversation descendant menu is excluded before reading any text', {transcriptMenu: true}, {ok: true, phase: 'already-pro', selectedLabel: 'Pro'});

for (const [name, injected, field] of [
  ['Conversation getter canary catches a real content read', "document.querySelectorAll('[data-message-author-role]')[0].innerText;", 'conversation'],
  ['Cookie getter canary catches a real credential read', 'document.cookie;', 'credential'],
]) {
  test(name, () => {
    const fixture = environment();
    const anchor = 'const composerRect =';
    assert.strictEqual(source.split(anchor).length - 1, 1, 'Canary insertion anchor must be unique');
    assert.throws(() => execute(source.replace(anchor, injected + '\n  ' + anchor), fixture), /Conversation content read|Credential read/);
    assert.strictEqual(fixture.reads[field], 1);
  });
}
