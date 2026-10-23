# Execution

1. Preserve owned before-images and read original failures; investigate the two independent paths in parallel.
2. Reproduce the failure, implement the smallest supported repair within assigned paths, and run focused offline regressions.
3. Accept frozen worker output, inspect the integrated diff, and run required conflicts/source checks as applicable.
4. Record passed/failed/unknown evidence and preserve protected work. Archive only if both requested outcomes are satisfied; no automatic commit.

Completed: waiter worker owned only watcher script/tests; Python worker owned only diagnostic artifacts and isolated test processes; root owned project config, spec and task records. Both leaves are frozen with no running owned commands. The root accepted their evidence, reviewed the actual diff and verified effective configuration. All old failure outcomes remain unchanged.
