import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('reply extraction preserves a BR newline on the sanitized detached clone', () => {
  const source = readFileSync(new URL('../scripts/chatgpt-pro-agent-browser-v2.js', import.meta.url), 'utf8');
  const helpers = source.slice(source.indexOf('  const MAX_TURNS'), source.indexOf('  let turnExtractionIssue'));
  const { boundedText } = new Function('document', helpers + '\nreturn { boundedText };')({});
  const clone = {
    nodeType: 1,
    tagName: 'P',
    childNodes: [
      { nodeType: 3, nodeValue: 'line one' },
      { nodeType: 1, tagName: 'BR' },
      { nodeType: 3, nodeValue: 'line two' },
    ],
    // Chrome returns flattened text for innerText on this detached clone.
    innerText: 'line oneline two',
    textContent: 'line oneline two',
    querySelectorAll: () => [],
  };
  assert.deepEqual(boundedText({ cloneNode: () => clone }), {
    text: 'line one\nline two',
    truncated: false,
  });
});

test('both model matchers retain the unique form control while its expanded label changes', () => {
  const pageSource = readFileSync(new URL('../scripts/chatgpt-pro-agent-browser-v2.js', import.meta.url), 'utf8');
  const modeSource = readFileSync(new URL('../scripts/chatgpt-pro-agent-browser-select-pro.js', import.meta.url), 'utf8');
  const matcher = pageSource.slice(pageSource.indexOf('  const composerRect ='), pageSource.indexOf('  // Read-only bounded structural'));
  const inspect = new Function('composers', 'composerForm', 'visibleAll', 'compactText', matcher + '\nreturn { count: modeControls.length, label: selectedModeLabel };');
  for (const { text, expanded, duplicate, count, phase } of [
    { text: 'Medium', expanded: false, count: 1, phase: 'open-menu' },
    { text: '思考强度', expanded: true, count: 1, phase: 'select-pro' },
    { text: '思考强度', expanded: false, count: 0, phase: undefined },
    { text: '思考强度', expanded: true, duplicate: true, count: 2, phase: undefined },
  ]) {
    const form = {};
    const rect = { left: 0, right: 500, top: 0, bottom: 40, width: 500, height: 40 };
    const element = (label, attributes = {}) => ({
      innerText: label, form, hidden: false,
      getAttribute: name => attributes[name] ?? null,
      hasAttribute: name => Object.hasOwn(attributes, name),
      setAttribute: (name, value) => { attributes[name] = value; },
      removeAttribute: name => { delete attributes[name]; },
      closest: selector => selector === 'form' ? form : null,
      getBoundingClientRect: () => rect,
    });
    const composer = element('');
    const controls = Array.from({ length: duplicate ? 2 : 1 }, () => element(text, {
      'aria-label': '选择 ChatGPT 模型', 'aria-expanded': String(expanded),
    }));
    const option = element('Pro');
    const query = selector => selector.startsWith('#prompt-textarea') ? [composer]
      : selector === 'button[aria-haspopup="menu"]' ? controls
      : selector === '[role="menuitemradio"]' ? [option] : [];
    assert.deepEqual(inspect([composer], form, query, node => node.innerText), {
      count, label: count === 1 ? text : '',
    });
    const action = new Function('document', 'getComputedStyle', modeSource)(
      { querySelectorAll: query }, () => ({ display: 'block', visibility: 'visible' }),
    );
    assert.equal(action.phase, phase);
    assert.equal(action.ok, count === 1);
    if (count !== 1) assert.equal(action.reason, 'mode-control-count');
  }
});
