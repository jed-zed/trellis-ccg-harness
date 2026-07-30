# Design: isolate automation side effects

## Task structure

The parent task coordinates two child tasks with separate ownership and
verification:

```text
stop-automation-side-effects
├── stop-test-browser-popups
└── harden-developer-identity-cli
```

The browser fix belongs to the personal CCG source and then flows into the
Harness snapshot through `harness:update`. The identity fix belongs to the
Trellis-generated Python runtime in this project and is maintained as an
intentional, regression-tested project overlay until an upstream release
contains the same behavior.

## Shared safety properties

- Informational/help paths are read-only.
- Test paths do not launch external UI.
- Invalid input fails before durable state is written.
- Production defaults remain unchanged.
- Ownership/provenance metadata is not falsified to make a local overlay look
  upstream-owned.

## Upgrade compatibility

The Trellis overlay must be tested against the installed version and exercised
through the Harness Trellis candidate-update path. If a future Trellis release
ships an equivalent fix, remove the overlay only after comparing behavior and
allowing the official template hash to become authoritative again.
