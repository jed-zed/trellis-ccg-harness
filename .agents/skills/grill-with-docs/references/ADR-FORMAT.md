# ADR Format

ADRs live in the project's existing ADR directory. When the project has no
defined location, use `docs/adr/` and sequential four-digit numbers such as
`0001-event-sourced-orders.md`.

Create the directory only when the first qualifying ADR is needed.

## Minimal Template

```md
# {Short title of the decision}

{One to three sentences stating the context, decision, and reason.}
```

Add status, considered options, or consequences only when they materially help
future readers.

## Numbering

Find the highest existing ADR number and increment it by one.

## When to Offer an ADR

Require all three:

1. changing the decision later would be meaningfully costly;
2. the choice would surprise a future reader without context;
3. the choice resolves a real tradeoff.

Good candidates include architectural shape, integration patterns, lock-in
technology choices, domain ownership boundaries, deliberate deviations from an
obvious path, constraints invisible in code, and non-obvious rejected
alternatives.
