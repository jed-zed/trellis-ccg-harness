import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pageSource = readFileSync(new URL('../scripts/chatgpt-pro-agent-browser-v2.js', import.meta.url), 'utf8');
const helpers = pageSource.slice(pageSource.indexOf('  const MAX_TURNS'), pageSource.indexOf('  let turnExtractionIssue'));
const { boundedText, composerPlainText } = new Function('document', helpers + '\nreturn { boundedText, composerPlainText };')({});
const textNode = text => ({ nodeType: 3, nodeValue: text });
const elementNode = (tagName, ...children) => ({
  nodeType: 1, tagName, childNodes: children, children: children.filter(node => node.nodeType === 1),
  cloneNode() { return this; }, querySelectorAll: () => [],
});

// Execute the checked-in helpers, not a copied implementation. These fixtures
// model the sanitized detached tree, whose innerText has no layout boundaries.
test('reply extraction keeps adjacent paragraphs, headings and list items distinct', () => {
  for (const [root, expected] of [
    [elementNode('DIV', elementNode('P', textNode('first')), elementNode('P', textNode('second'))), 'first\n\nsecond'],
    [elementNode('DIV', elementNode('H2', textNode('Heading')), elementNode('P', textNode('body')), elementNode('H3', textNode('Next'))), 'Heading\n\nbody\n\nNext'],
    [elementNode('UL', elementNode('LI', textNode('one')), elementNode('LI', textNode('two'))), 'one\ntwo'],
    [elementNode('OL', elementNode('LI', textNode('one')), elementNode('LI', textNode('two'))), 'one\ntwo'],
    [elementNode('DIV', elementNode('DIV', elementNode('P', textNode('first'))), elementNode('DIV', elementNode('P', textNode('second')))), 'first\n\nsecond'],
  ]) {
    assert.deepEqual(boundedText(root), { text: expected, truncated: false });
  }
});

test('reply boundaries preserve inline adjacency, BR and verbatim code whitespace', () => {
  const code = 'if (ready) {\n  run();\n\n\n  finish();\n}';
  const root = elementNode('DIV',
    elementNode('P', textNode('Use '), elementNode('STRONG', textNode('Pro')), textNode(' now.'), elementNode('BR'), textNode('line two')),
    elementNode('PRE', elementNode('CODE', textNode(code))),
    elementNode('P', textNode('done')),
  );
  assert.deepEqual(boundedText(root), { text: 'Use Pro now.\nline two\n\n' + code + '\n\ndone', truncated: false });
  // Reply formatting must not change composer text or its pre-click hash.
  assert.equal(composerPlainText(elementNode('DIV', elementNode('P', textNode('first')), elementNode('P', textNode('second')))), 'first\nsecond');
});

test('reply extraction retains its text limit', () => {
  const root = elementNode('DIV', elementNode('P', textNode('x'.repeat(200001))));
  const result = boundedText(root);
  assert.equal(result.text.length, 200000);
  assert.equal(result.truncated, true);
});

test('reply extraction ignores HTML indentation at block boundaries and keeps inline spaces', () => {
  const root = elementNode('DIV', textNode('\n  '),
    elementNode('P', textNode('first')), textNode('\n'), textNode('  '),
    elementNode('P', textNode('second')), textNode('\n  '),
    elementNode('UL', textNode('\n    '), elementNode('LI', textNode('one')), textNode('\n    '), elementNode('LI', textNode('two')), textNode('\n  ')),
    textNode('\n'),
  );
  assert.equal(boundedText(root).text, 'first\n\nsecond\n\none\ntwo');
  assert.equal(boundedText(elementNode('P', elementNode('SPAN', textNode('one')), textNode(' '), elementNode('EM', textNode('two')))).text, 'one two');
});

test('reply extraction propagates block edges through transparent wrappers without splitting inline edges', () => {
  assert.equal(boundedText(elementNode('DIV',
    elementNode('A', elementNode('H2', textNode('Heading'))), textNode('\n'),
    elementNode('A', elementNode('P', textNode('Body'))),
  )).text, 'Heading\n\nBody');
  assert.equal(boundedText(elementNode('DIV', textNode('a'),
    elementNode('SPAN', textNode('x'), elementNode('P', textNode('y')), textNode('z')),
    textNode('b'),
  )).text, 'ax\n\ny\n\nzb');
});

test('user text keeps leading inline whitespace independently of wrapper shape', () => {
  // Pre-wrap bubbles can expose indentation as a separate text node. The root
  // DIV boundary is external metadata and must not erase that inline prefix.
  assert.equal(boundedText(elementNode('DIV', textNode('  '), elementNode('CODE', textNode('quoted')), textNode(' tail')), true).text, '  quoted tail');
  assert.equal(boundedText(elementNode('DIV', textNode('\n'), elementNode('A', textNode('line'))), true).text, '\nline');
});

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

test('both model matchers recognize localized controls and retain strict mode proof', () => {
  const pageSource = readFileSync(new URL('../scripts/chatgpt-pro-agent-browser-v2.js', import.meta.url), 'utf8');
  const modeSource = readFileSync(new URL('../scripts/chatgpt-pro-agent-browser-select-pro.js', import.meta.url), 'utf8');
  const matcher = pageSource.slice(pageSource.indexOf('  const composerRect ='), pageSource.indexOf('  // Read-only bounded structural'));
  const inspect = new Function('composers', 'composerForm', 'visibleAll', 'compactText', matcher + '\nreturn { count: modeControls.length, label: selectedModeLabel };');
  for (const ariaLabel of ['选择 ChatGPT 模型', 'Choose ChatGPT model', 'Select ChatGPT model']) {
  for (const { text, expanded, duplicate, count, phase, foreignForm, wrongLabel, inMenu, far } of [
    { text: 'Medium', expanded: false, count: 1, phase: 'open-menu' },
    { text: '思考强度', expanded: true, count: 1, phase: 'select-pro' },
    { text: 'Thinking effort', expanded: true, count: 1, phase: 'select-pro' },
    { text: '思考强度', expanded: false, count: 0, phase: undefined },
    { text: 'Thinking effort', expanded: false, count: 0, phase: undefined },
    { text: '思考强度', expanded: true, duplicate: true, count: 2, phase: undefined },
    { text: 'Medium', expanded: false, duplicate: true, count: 2 },
    { text: 'Medium', expanded: false, foreignForm: true, count: 0 },
    { text: 'Medium', expanded: false, wrongLabel: true, count: 0 },
    { text: 'Medium', expanded: false, inMenu: true, count: 0 },
    { text: 'Medium', expanded: false, far: true, count: 0 },
    { text: 'GPT-5 Pro', expanded: false, count: 0 },
    { text: 'Pro', expanded: false, count: 1, phase: 'already-pro' },
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
      'aria-label': wrongLabel ? 'Unrelated menu' : ariaLabel, 'aria-expanded': String(expanded),
    }));
    for (const control of controls) {
      if (foreignForm) control.form = {};
      if (inMenu) control.closest = selector => selector === 'form' ? form : {};
      if (far) control.getBoundingClientRect = () => ({ ...rect, top: 500, bottom: 540 });
    }
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
    // The script only tags the exact control/option for the adapter. It neither
    // clicks Send nor treats an open model menu as selected Pro evidence.
    assert.equal(option.getAttribute('data-codex-gptpro-pro-option'), phase === 'select-pro' ? 'true' : null);
    assert.equal(controls.filter(control => control.getAttribute('data-codex-gptpro-mode-control') === 'true').length, phase === 'open-menu' ? 1 : 0);
  }
  }
});
