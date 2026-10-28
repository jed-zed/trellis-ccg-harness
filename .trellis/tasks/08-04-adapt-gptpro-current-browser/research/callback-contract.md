# Watcher and Stop Hook contract

## Required chain

1. `send` persists a post-send state bound to one canonical exact conversation URL, one window runtime ID, prompt hash, and idempotency hash.
2. Watcher `start` binds the same evidence directory and exact `CODEX_THREAD_ID`, writes a unique watcher registration, and launches one hidden local worker.
3. The worker probes the bound window and URL without model tokens, requires stable stopped observations, and calls adapter `wait` to finalize evidence.
4. Only a successful finalize becomes terminal status `completed`; other outcomes remain explicit failure or uncertainty states and never trigger resend.
5. The trusted Codex Desktop Stop Hook claims terminal registrations atomically, writes `watch-callback.json`, and returns one `decision=block` continuation for the same task.
6. Codex reviews the event/evidence and writes `watch-continuation-ack.json` with the exact task, watcher, and terminal status.

## Proof levels

- Parser/Pester tests can prove deterministic state, replay, fan-in, acknowledgement, crash/timeout, and no-wake rules.
- Directly running the Python hook proves only local callback files and the decision payload.
- Only a real Codex Desktop turn-stop lifecycle proves that the registered Stop Hook resumes this same task.

## Non-negotiable fields

Exact conversation URL, window runtime ID, Codex thread UUID, watcher UUID, prompt/idempotency hashes, terminal event, callback claim, continuation acknowledgement, `requiresCodexReview=true`, and `automaticResendAllowed=false`.
