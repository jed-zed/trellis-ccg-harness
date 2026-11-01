import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('../scripts/chatgpt-pro-focus-observer.js', import.meta.url), 'utf8');
const key = '__codexChatGptFocusObserverV1';
function fixture() {
  let now = 0, serial = 0;
  const timers = new Map(), listeners = new Map();
  const target = name => ({
    addEventListener(type, fn, capture) { assert.equal(capture, true); listeners.set(name + type, fn); },
    removeEventListener(type, fn, capture) { assert.equal(capture, true); assert.equal(listeners.get(name + type), fn); listeners.delete(name + type); },
    focus() { throw Error('Forbidden focus'); }, blur() { throw Error('Forbidden blur'); },
    click() { throw Error('Forbidden click'); }
  });
  const window = target('window:'), document = Object.assign(target('document:'), {hasFocus: () => false, visibilityState: 'hidden'});
  const location = {origin: 'https://chatgpt.com'};
  for (const [object, names] of [[document, ['title', 'cookie', 'body', 'querySelectorAll']], [location, ['href', 'pathname']], [window, ['localStorage', 'sessionStorage']]]) {
    for (const name of names) Object.defineProperty(object, name, {get() { throw Error('Forbidden read ' + name); }});
  }
  const context = vm.createContext({window, document, location, performance: {timeOrigin: 123, now: () => now},
    crypto: {randomUUID: () => (++serial).toString(16).padStart(32, '0')},
    setTimeout(fn, ms) { assert.equal(ms, 1200000); timers.set(1, fn); return 1; }, clearTimeout(id) { timers.delete(id); }});
  return {window, document, location, timers, listeners,
    advance(ms) { now += ms; }, fireTimer() { for (const fn of [...timers.values()]) fn(); },
    emit(type, eventTarget = type === 'visibilitychange' ? document : window) { listeners.get((type === 'visibilitychange' ? 'document:' : 'window:') + type)?.({target: eventTarget}); },
    run(action = 0, token = '') { return new vm.Script('(function(){' + source
      .replace('const action = 0; // CCG_FOCUS_ACTION', `const action = ${action}; // CCG_FOCUS_ACTION`)
      .replace("const expectedStartToken = ''; // CCG_FOCUS_TOKEN", `const expectedStartToken = '${token}'; // CCG_FOCUS_TOKEN`) + '})()').runInContext(context, {timeout: 1000}); }
  };
}
test('records window and visibility events in order without focusing or reading page content', () => {
  const f = fixture(), start = f.run();
  assert.equal(start.status, 'running'); assert.equal(start.initialSnapshot.hasFocus, false);
  assert.equal(start.initialSnapshot.visibilityState, 'hidden'); assert.equal(start.events.length, 0);
  assert.ok(Date.parse(start.initialSnapshot.utc)); assert.equal(start.timeOriginMs, 123);
  f.advance(5); f.emit('focus'); f.advance(2); f.emit('visibilitychange'); f.emit('blur');
  f.emit('focus', {}); // Captured element focus is not a window transition.
  const read = f.run(1, start.startToken);
  assert.equal(read.documentId, start.documentId); assert.equal(read.focusRequested, false);
  assert.deepEqual(Array.from(read.events, e => e.eventType), ['focus', 'visibilitychange', 'blur']);
  assert.deepEqual(Array.from(read.events, e => e.sequence), [1, 2, 3]);
  assert.deepEqual(Array.from(read.events, e => e.monotonicMs), [5, 7, 7]);
  assert.equal(read.finalSnapshot, null);
});
test('duplicate start and incorrect tokens do not replace or clean another observation', () => {
  const f = fixture(), start = f.run();
  assert.equal(f.run().reason, 'already-started');
  assert.equal(f.run(2, 'f'.repeat(32)).reason, 'start-token-mismatch');
  assert.equal(f.run(1, start.startToken).startToken, start.startToken);
  assert.equal(f.listeners.size, 3);
});
test('read/stop missing after navigation never silently start', () => {
  const f = fixture(), start = f.run(); delete f.window[key];
  assert.equal(f.run(1, start.startToken).reason, 'missing');
  assert.equal(f.run(2, start.startToken).reason, 'missing');
  assert.equal(f.window[key], undefined);
});
test('stop returns complete final evidence then removes its listeners, timer and key', () => {
  const f = fixture(), start = f.run(); f.emit('blur'); f.advance(9);
  const stop = f.run(2, start.startToken);
  assert.equal(stop.status, 'stopped'); assert.equal(stop.events.length, 1);
  assert.equal(stop.finalSnapshot.monotonicMs, 9); assert.equal(stop.finalSnapshot.eventType, 'stopped');
  assert.equal(f.listeners.size, 0); assert.equal(f.timers.size, 0); assert.equal(f.window[key], undefined);
});
test('expiry stops automatically and preserves evidence until explicit stop', () => {
  const f = fixture(), start = f.run(); f.advance(1200000); f.fireTimer();
  assert.equal(f.listeners.size, 0); assert.equal(f.timers.size, 0);
  assert.equal(f.run(1, start.startToken).status, 'expired');
  assert.equal(f.run().reason, 'already-started');
  const stop = f.run(2, start.startToken); assert.equal(stop.status, 'expired');
  assert.equal(stop.finalSnapshot.eventType, 'expired'); assert.equal(f.window[key], undefined);
});
test('read enforces expiry even when a background timer has been throttled', () => {
  const f = fixture(), start = f.run(); f.advance(1200001);
  assert.equal(f.run(1, start.startToken).status, 'expired'); assert.equal(f.listeners.size, 0);
});
test('buffer has a fixed bound and explicitly reports every dropped event', () => {
  const f = fixture(), start = f.run(); for (let i = 0; i < 2051; i++) f.emit('focus');
  const read = f.run(1, start.startToken);
  assert.equal(read.events.length, 2048); assert.equal(read.sequence, 2051);
  assert.equal(read.overflow, true); assert.equal(read.droppedEvents, 3);
});
test('rejects unsupported operations, tokens and origins without installing listeners', () => {
  const f = fixture(); assert.equal(f.run(3).reason, 'invalid-operation');
  assert.equal(f.run(1).reason, 'invalid-token');
  f.location.origin = 'https://example.com'; assert.equal(f.run().reason, 'origin-mismatch');
  assert.equal(f.listeners.size, 0);
});
