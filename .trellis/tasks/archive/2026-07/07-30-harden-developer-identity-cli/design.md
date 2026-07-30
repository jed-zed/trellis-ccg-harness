# Design: safe developer identity initialization

## CLI parsing

Replace positional `sys.argv` access with a small `argparse.ArgumentParser`
containing exactly one required `developer_name` positional argument.
`argparse` then owns `-h`/`--help`, missing arguments, and extra arguments,
ensuring those paths exit before identity lookup and initialization.

## Shared validation

Add a validation helper in `common/developer.py` and call it at the start of
`init_developer()`. The helper accepts a trimmed, non-empty, human-readable
single path component and rejects:

- leading `-`;
- `.` or `..`;
- `/` or `\`;
- ASCII control characters;
- Windows-invalid filename characters and trailing space/dot.

The check is intentionally portable because a Trellis project may move between
Windows, macOS, and Linux. It does not reduce names to ASCII.

## Regression fixture

Add a Node test that copies the minimal `.trellis/scripts` runtime into a
temporary repository fixture and invokes Python as a subprocess. The test
asserts exit status, output, and the complete absence or presence of
`.developer` and workspace files for each case.

Direct validation coverage imports the Python helper in a short subprocess so
the CLI and library boundary are both checked without mutating the real
workspace.

## Ownership and upgrades

Do not edit `.trellis/.template-hashes.json`. The differing content remains an
honest local overlay. A Harness regression test protects the required behavior,
and the Trellis candidate-update transaction must be exercised so future
updates cannot silently lose the fix or leave `.new` conflict files.
