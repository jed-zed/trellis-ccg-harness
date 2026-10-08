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
