---
name: trellis-check
description: "Verify changed behavior and risks with proportionate checks, required project/CI gates and evidence-backed findings."
---

# Code Quality Check

Check acceptance, changed behavior and actual risks. Reuse existing task, Git, PR and CI evidence.

Follow Request Triage in `.trellis/workflow.md`. Fast-lane edits still use the applicable quality checklist but require no task artifacts. For structured work, read the task artifacts below; complex tasks require all three documents.

---

## Step 1: Identify What Changed

```bash
git diff --name-only HEAD
git status
```

## Step 2: Read Task Artifacts and Applicable Specs

Read the current task artifacts in order:

- `prd.md`
- `design.md` (required for complex tasks)
- `implement.md` (required for complex tasks)

```bash
python ./.trellis/scripts/get_context.py --mode packages
```

For each changed package/layer, read the spec index and follow its **Quality Check** section:

```bash
cat .trellis/spec/<package>/<layer>/index.md
```

Read the specific guideline files referenced — the index is a pointer, not the goal.

## Step 3: Run Project Checks

Choose checks proportionate to the changed behavior and risk, including required project/CI checks. Use the smallest meaningful check that can catch the actual regression; rule/documentation wording needs relevant content/context checks. Do not run unrelated builds or require every new function to have its own unit test.

Account for all affected task behavior, reusing passing checks for unchanged work. Report each check as passed, failed or unrun. After a fix, rerun the affected check; repeat or broaden only for a new change, failure, unresolved concrete concern or required gate. Stop once acceptance and required checks are satisfied; an unresolved required check keeps the work incomplete.

## Step 4: Review Against Checklist

### Code Quality

- [ ] Required and risk-relevant checks have actual results?
- [ ] No accidental debug output, suppressed errors or type-safety bypasses?
- [ ] Errors reach the caller without false success; retries stay bounded in one layer?
- [ ] Idempotency is considered where repeated calls can duplicate side effects; an uncertain result is checked before repeating the operation?

### Test Coverage

- [ ] Changed nontrivial behavior or a reproduced bug has a meaningful check that fails if it breaks?
- [ ] Existing tests are updated where the supported behavior changed?
- [ ] No tests added solely to mirror implementation details or hypothetical future cases?

### Spec Sync

- [ ] Update the relevant existing spec only if a durable contract changed or a recurring pitfall is established.

### Scope Discipline

- [ ] Any tidying of code the task did not require?
- [ ] Any abstraction, config or extension point added for a case that does not exist yet?
- [ ] Any speculative fallback for a state that cannot occur?
- [ ] Each change serves the request, a reproduced fault, an existing contract or a necessary safety boundary?
- [ ] Any workaround added at the caller instead of a fix where the behavior actually lives?
- [ ] Defensive checks serve a real boundary, supported input range, concrete failure model or business invariant, without mechanically repeating internal guarantees?
- [ ] Independent security controls and data protections remain intact?

## Step 5: Cross-Layer Dimensions (if applicable)

Check only dimensions touched by the change; do not infer risk from layer count alone.

### A. Data Flow (changed boundaries)

- [ ] Read flow traces correctly: Storage → Service → API → UI
- [ ] Write flow traces correctly: UI → API → Service → Storage
- [ ] Types/schemas correctly passed between layers?
- [ ] Errors properly propagated to caller?

### B. Code Reuse (modifying constants, creating utilities)

- [ ] Searched for existing similar code before creating new?
  ```bash
  rg -n "pattern" src/
  ```
- [ ] If the same value repeats, does it represent one stable concept whose callers must change together? Extract only then — two literals that merely happen to match today should stay separate.
- [ ] After batch modification, all occurrences updated?

### C. Import/Dependency (creating new files)

- [ ] Correct import paths (relative vs absolute)?
- [ ] No circular dependencies?

### D. Same-Layer Consistency

- [ ] Other places using the same concept are consistent?

---

## Step 6: Report and Fix

Verify each finding's location, triggering condition, consequence and supporting evidence. Zero findings is valid; keep optional suggestions separate from required fixes. Address credible security or data-loss risks within authorized scope.

- Mechanical and local issues within owned paths: fix the root cause and rerun the affected check.
- Design decisions, public interfaces, module boundaries or out-of-scope changes: report evidence and a recommendation; stop the affected work without silently widening scope. Continue independent authorized work.
- A user-requested GPT Pro independent PR review remains independent. Default to one full round plus one targeted re-review as a soft budget; focus on fixes and changed risks. Keep real blockers incomplete and converge on the missing fix, evidence or decision. Never loop indefinitely or force a pass because the round budget is reached.

Report naturally in concise Chinese: stage, result, checks and limits, next action and any decision needed. Reuse existing records; do not invent scores, completion percentages or a separate evidence system.
