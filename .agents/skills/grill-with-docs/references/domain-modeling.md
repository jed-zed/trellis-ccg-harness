# Domain Modeling

Actively build and sharpen the project's domain model as you design. Challenge
terms, invent edge-case scenarios, and write the glossary and decisions down
when they crystallize. Merely reading `CONTEXT.md` is not this skill; use it
when changing the model.

## File Structure

Most repositories have a single context:

```text
/
├── CONTEXT.md
├── docs/
│   └── adr/
└── src/
```

If `CONTEXT-MAP.md` exists at the root, the repository has multiple contexts.
The map identifies each context's `CONTEXT.md`, ADR directory, and
relationships.

Create files lazily. If neither context file nor ADR directory exists, create
one only when the first term or qualifying decision is ready to record.

## During the Session

### Challenge Against the Glossary

Call out any use of a term that conflicts with `CONTEXT.md` and ask which
meaning is intended.

### Sharpen Fuzzy Language

When a term is vague or overloaded, propose one precise canonical term and
distinguish it from nearby concepts.

### Discuss Concrete Scenarios

Stress-test domain relationships with concrete edge cases that force boundaries
and invariants to become explicit.

### Cross-reference With Code

Check claims about existing behavior against source and tests. Surface
contradictions for the user to resolve.

### Update `CONTEXT.md` Inline

When a term is resolved, update the relevant `CONTEXT.md` immediately using
[CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md).

Keep `CONTEXT.md` free of implementation details. It is a domain glossary, not
a specification, scratch pad, or store for implementation decisions.

### Offer ADRs Sparingly

Offer an ADR only when all three conditions hold:

1. the decision is costly to reverse;
2. it would surprise a future reader without context;
3. it resolves a real tradeoff between meaningful alternatives.

Otherwise skip the ADR. Use [ADR-FORMAT.md](./ADR-FORMAT.md).
