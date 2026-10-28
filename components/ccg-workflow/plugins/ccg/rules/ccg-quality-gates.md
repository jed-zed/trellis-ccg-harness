# CCG Quality Gate Rule

## Implementation boundary

- Implement the minimum accepted outcome using existing code, standard libraries
  and native capabilities. Do not add abstractions, compatibility, configuration,
  persistence or gates for hypothetical future needs.
- Each added defense needs a real trust/data boundary, supported contract,
  concrete failure model or business invariant. Reuse established internal
  guarantees; preserve independent security controls and data protection.
- Fail explicitly. Any justified retry is bounded and owned by one layer.
  Account for idempotency where repeated calls could duplicate side effects,
  reusing existing guarantees. Query the original operation when its outcome
  is uncertain; do not add persistence or deduplication to every side effect.

## Proportional verification

- Run checks that directly prove the changed behavior and all mandatory
  repository, CI and acceptance checks. Scope optional checks to affected paths.
- New module: generate documentation only where needed, then use
  `/ccg:verify-module <module-path>` for the required structure.
- Changes over roughly 30 lines or substantive refactors: check quality, impact
  and documentation sync on the main changed paths with `/ccg:verify-change`
  and `/ccg:verify-quality <changed-path>`. For ordinary text/rule edits,
  inspect the relevant diff and applicable rule tests; do not scan the repository.
- Actual changes to authentication, authorization, crypto, input validation,
  secrets, permissions, uploads, command execution or network boundaries require
  `/ccg:verify-security <changed-path>`. Merely running a command, reading files
  or querying the network does not trigger a security audit.
- Stop once sufficient evidence and required checks pass. Repeat or broaden
  only for a new change, failed check, unresolved concrete concern or mandatory
  project gate. Report blocked or unrun checks as such; never infer a pass.

## Findings and delivery

- Verify a finding's location, trigger, actual consequence and supporting
  contract/evidence. Zero findings is valid. Optional suggestions do not become
  requirements; unsupported platforms and hypothetical compatibility need no tests.
- Do not dismiss real security, data-loss or correctness risks. Fix Critical/High
  blockers before delivery unless the user explicitly accepts the applicable risk;
  a required project/CI gate remains required.
- Preserve a requested independent GPT Pro PR review. Default to one complete
  review plus one focused re-review after fixes as a soft budget. More rounds
  need a concrete unresolved blocker or changed risk; the budget never implies
  approval. Report unresolved blockers as incomplete and narrow the remaining work.
- Reuse task/Git/PR/CI records; add no parallel evidence system or reviewer-count
  gate. Usually report phase/result, verification limits, next action and any
  user decision in one screen of natural Chinese. Evidence may be linked;
  completion percentages and numerical scorecards are not required.
