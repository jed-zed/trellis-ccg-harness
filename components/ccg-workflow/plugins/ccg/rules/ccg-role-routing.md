# CCG Unified Role Routing

CCG has four formal top-level routing roles:

- `frontend`
- `backend`
- `search`
- `product-manager`

Use `ccg routing get <role> --json` to inspect one role and
`ccg routing set <role> <provider>` to change only that role. Analysis,
planning, implementation, and review are phases inside these roles, not
additional routing authorities.

The product-manager Provider selection exists only at
`routing.product-manager`. `[product_manager]` stores behavior parameters such
as enablement, contract version, retry, timeout, and output limits. Harness,
projects, and Trellis tasks may restrict allowed Providers but must not select
one or introduce fallback.

Routing changes never install, authenticate, invoke, or grant permissions to a
Provider. Product-manager calls remain read-only and require explicit per-call
authorization.
