# Provider planning evidence

## Local evidence

- Codex verified the concrete call chain and state transitions in the watcher script and Pester tests.
- Three read-only local investigators independently mapped the capacity call chain, claim schema/release proof, and test/spec gaps. Their results agreed that `submissionAttempted=true` is persisted before the actual adapter boundary.

## CCG routing

- Installed CCG: `3.4.14`.
- `backend=grok`, `search=grok`, `product-manager=claude`.
- Search/intelligence route was attempted twice through `ccg route`.
- Both attempts ended `invocation_failed` with: `ACP session model grok-4.6 does not match requested model grok-4.5`.
- No Grok intelligence result was accepted.
- On the authorized retry, a task-local configuration pinned both intelligence models to `grok-4.6` and the real `CODEX_HOME=G:\CodexData\.codex` removed the earlier model/Junction preflight failures.
- The intelligence route then failed closed with `policy_violation` because its bounded snapshot excludes `.agents/skills/...`; this path still produced no accepted search evidence.

## Selected backend Provider

- The authorized review used `ccg wrapper --backend grok --grok-model grok-4.6 --progress - <workdir>` with process-local `CODEX_HOME=G:\CodexData\.codex` and no global configuration change.
- Wrapper evidence reported `model_id="grok-4.6"` and returned a nonempty completed planning report.
- Verdict: `Go, with required plan adjustments`.
- Required adjustments accepted into the plan: a mutex-held compare-and-swap at the shared send boundary; `never-invoked` ordered after durable evidence; batch live-parent `OwnerCompletionObserved`; explicit contradictory-evidence and mock-boundary regressions.

## Product manager

- `ccg product-manager status --json` reported contract version `2`, effective status `ready`, and selected provider `claude`.
- The user explicitly authorized a live Claude planning review in the current turn.
- Claude `opus` through Claude Code `2.1.220` completed checkpoint `PLAN-GROK46-CLAUDE` against `planRevision=2` with verdict `accepted`.
- Accepted clarifications: do not add a second owner-dead requirement to `never-invoked`; upgrade only the capacity claim schema while watcher/batch schemas stay `1`; rebaseline existing Pester fixtures that use the old `run-starting/true` pre-send meaning.
- Claude reported that its generated snapshot omitted `.agents/` and `.codex/`; this is retained as a process evidence gap and does not expand the current product-change scope.

## Final-route binding note

- The final plan changed the route input digest after the two permitted Grok intelligence attempts were already exhausted.
- The route was not invoked a third time merely to attach the plan path. The persisted route evidence therefore binds the intake task, while this tracked file records the final plan path and the attempt-cap decision.

## Evidence boundary

The plan relies on locally verified repository evidence, a completed Grok 4.6 backend planning report, and an accepted Claude product-manager review. Provider recommendations were translated/synthesized into the Chinese Trellis/CCG artifacts. No live GPT Pro or browser test is claimed.
