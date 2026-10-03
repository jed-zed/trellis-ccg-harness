---
name: trellis-finish-work
description: "Record acceptance and verification for the current structured task, archive it without automatic commits, and add a journal only when a handoff needs it."
---

# Finish Work

Follow the completion contract in `.trellis/workflow.md`.

Fast-lane requests finish with their answer/change and applicable quality checks; do not create a task, archive or journal for them.

For the current structured task:

1. Check its acceptance criteria and verification evidence for the full affected task scope, including project lint/type-check/tests and the coverage checklist. A pending product-manager hard gate must be resolved through its presentation/response flow before completion.
2. Inspect the diff and dirty paths. Preserve unrelated work. Uncommitted current-task changes are deliverable; a commit is required only when the user requested/authorized one or an accepted release gate requires it.
3. Write a concise completion record in the existing plan/PRD: outcome, checks, remaining limitations. Do not duplicate that record in another report by default.
4. Archive only this completed task through the supported CLI:

   ```bash
   python ./.trellis/scripts/task.py archive <task-name> --no-commit
   ```

   Keep branch validation, path ownership and data protections. If archive reports a real error, report it and fix the cause; do not claim archival succeeded. Do not scan or archive other tasks without their own explicit scope.
5. Add a journal only if a cross-session handoff needs context absent from the task record. Use `add_session.py --no-commit`, reference existing evidence, and do not require work/archive/journal commits.

Report what changed, why, verification and material limitations. Commit/push/install/Provider authorization remains separate; completing local work does not grant those permissions.
