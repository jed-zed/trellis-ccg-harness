# `CONTEXT.md` Format

## Structure

```md
# {Context Name}

{One or two sentences describing the context and why it exists.}

## Language

**Order**:
{A one- or two-sentence definition}
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request
```

## Rules

- Be opinionated. Pick one canonical word and list competing words under
  `_Avoid_`.
- Keep definitions to one or two sentences. Define what the concept is, not
  what its implementation does.
- Include only project-specific domain concepts, not general programming terms.
- Add subheadings only when natural clusters emerge.

## Single and Multiple Contexts

For most repositories, keep one `CONTEXT.md` at the root. When
`CONTEXT-MAP.md` exists, use it to locate context-specific glossaries and infer
which context the current topic affects. Ask when the target context is
ambiguous.

A context map should name each context, link to its `CONTEXT.md`, summarize its
purpose, and describe cross-context relationships.
