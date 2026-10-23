return (() => {
  'use strict';
  // Only these finite parameters are replaced by the helper, never caller JavaScript.
  const action = 0; // CCG_FOCUS_ACTION
  const expectedStartToken = ''; // CCG_FOCUS_TOKEN
  const key = '__codexChatGptFocusObserverV1';
  const limit = 2048, lifetimeMs = 20 * 60 * 1000;
  const fail = reason => ({schemaVersion: 1, ok: false, reason, focusRequested: false});
  if (![0, 1, 2].includes(action)) return fail('invalid-operation');
  if (location.origin !== 'https://chatgpt.com') return fail('origin-mismatch');
  if (action === 0 ? expectedStartToken !== '' : !/^[0-9a-f]{32}$/.test(expectedStartToken)) return fail('invalid-token');
  let state = window[key];
  if (action === 0) {
    if (state !== undefined) return fail('already-started');
    state = {
      documentRef: document,
      documentId: crypto.randomUUID(),
      startToken: crypto.randomUUID().replace(/-/g, ''),
      timeOriginMs: performance.timeOrigin,
      status: 'running', sequence: 0, droppedEvents: 0, events: [], finalSnapshot: null
    };
    const snapshot = eventType => ({sequence: state.sequence, eventType,
      utc: new Date().toISOString(), monotonicMs: performance.now(),
      hasFocus: document.hasFocus(), visibilityState: document.visibilityState});
    state.snapshot = snapshot;
    state.initialSnapshot = snapshot('start');
    state.finish = reason => {
      if (state.status !== 'running') return;
      document.removeEventListener('visibilitychange', state.onVisibility, true);
      window.removeEventListener('focus', state.onFocus, true);
      window.removeEventListener('blur', state.onBlur, true);
      clearTimeout(state.timer);
      state.status = reason;
      state.finalSnapshot = snapshot(reason);
    };
    const record = eventType => {
      if (state.status !== 'running') return;
      if (performance.now() - state.initialSnapshot.monotonicMs >= lifetimeMs) { state.finish('expired'); return; }
      state.sequence++;
      // ponytail: keep the first 2048 events; any loss explicitly invalidates continuity.
      if (state.events.length < limit) state.events.push(snapshot(eventType));
      else state.droppedEvents++;
    };
    state.onVisibility = () => record('visibilitychange');
    state.onFocus = event => { if (event.target === window) record('focus'); };
    state.onBlur = event => { if (event.target === window) record('blur'); };
    window[key] = state;
    document.addEventListener('visibilitychange', state.onVisibility, true);
    window.addEventListener('focus', state.onFocus, true);
    window.addEventListener('blur', state.onBlur, true);
    state.timer = setTimeout(() => state.finish('expired'), lifetimeMs);
  } else {
    if (state === undefined) return fail('missing');
    if (state.documentRef !== document) return fail('document-mismatch');
    if (state.startToken !== expectedStartToken) return fail('start-token-mismatch');
    if (state.status === 'running' && performance.now() - state.initialSnapshot.monotonicMs >= lifetimeMs) state.finish('expired');
    if (action === 2) state.finish('stopped');
  }
  const evidence = {schemaVersion: 1, ok: true, focusRequested: false,
    operation: ['start', 'read', 'stop'][action], status: state.status,
    documentId: state.documentId, startToken: state.startToken, timeOriginMs: state.timeOriginMs,
    lifetimeMs, maxEvents: limit, sequence: state.sequence,
    overflow: state.droppedEvents > 0, droppedEvents: state.droppedEvents,
    initialSnapshot: state.initialSnapshot, finalSnapshot: state.finalSnapshot,
    currentSnapshot: state.snapshot('snapshot'), events: state.events.slice()};
  if (action === 2) delete window[key];
  return evidence;
})();
