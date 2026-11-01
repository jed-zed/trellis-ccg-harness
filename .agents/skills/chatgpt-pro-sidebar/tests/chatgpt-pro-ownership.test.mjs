import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../scripts/chatgpt-pro-agent-browser-v2.js', import.meta.url), 'utf8');
const start = source.indexOf('  const failTurn =');
const end = source.indexOf('  const collectTurns =', start);
const makeReporter = new Function('let turnExtractionIssue = "";\n' + source.slice(start, end) + '\nreturn { failTurn, issue: () => turnExtractionIssue };');

test('temporary missing owner cannot mask a real ownership conflict in either DOM order', () => {
  for (const conflict of ['MessageRoleConflict', 'AssistantContextAmbiguous', 'AssistantBodyAmbiguous', 'AssistantMessageIdAmbiguous', 'AssistantOwnerInvalid']) {
    for (const issues of [['AssistantOwnerMissing', conflict], [conflict, 'AssistantOwnerMissing']]) {
      const reporter = makeReporter();
      issues.forEach(reporter.failTurn);
      assert.equal(reporter.issue(), conflict);
    }
  }
});

test('pure missing owner stays pending, and the first real conflict stays authoritative', () => {
  const reporter = makeReporter();
  reporter.failTurn('AssistantOwnerMissing');
  reporter.failTurn('AssistantOwnerMissing');
  assert.equal(reporter.issue(), 'AssistantOwnerMissing');
  reporter.failTurn('MessageRoleConflict');
  reporter.failTurn('AssistantContextAmbiguous');
  assert.equal(reporter.issue(), 'MessageRoleConflict');
});
