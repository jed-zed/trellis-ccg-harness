# npm package contents

The personal branch selectively adopts v3.6.7's explicit skill-category
allowlist. Its existing source manifest, install guidance, SSH bridge guidance,
product-manager prompt, provider prompts, Git commands, Git engine strategy,
and DevOps Git workflow remain in the package. New upstream providers, DSH,
and unrelated skill groups are not added by this change. The fork attribution
in `NOTICE.md` is explicitly included alongside npm's automatic LICENSE and
README retention.

`package.json` lists the current skill groups, including their scripts,
shared tool library, agent metadata, references, and CSS assets. The security
domain retains `SKILL.md`, `blue-team.md`, `code-audit.md`, and
`threat-intel.md`. Only `red-team.md`, `pentest.md`, and `vuln-research.md`
remain source-only. These reference notes stay in Git; this change does not
delete or rewrite them. Python bytecode and `__pycache__` are excluded across
all template groups.

The existing Claude installer still removes the security domain after copying
skills. This package change does not alter that installation policy. The
original security index, skill-routing rule, and skill-router hook also retain
links to the three source-only references, which can be read from a source checkout. Avoid
interpreting package retention as a change to installed skill behavior.

Other existing tool skills, including `tools/override-refusal`, stay within the
existing distribution scope. The whitelist change does not endorse or modify
their instructions. Engine fixtures and the fake Grok wrapper are likewise
retained as existing, non-secret resources.

Build locally, then run:

```sh
npm run check:package
npm run test:package
```

The checks use Node's standard library and the local npm CLI. They run
`npm pack --dry-run --json --ignore-scripts --offline` with an isolated
temporary cache. They do not install, execute lifecycle hooks, contact models,
publish, or modify an installed runtime. The contract checks the actual npm
file manifest against an independent set of permitted runtime directories and
required files, including the three compiled entry points. Every approved
template file and every compiled shared chunk in the source checkout must
appear in the manifest. Critical installer and Git assets remain required
even if they are accidentally deleted from the source checkout.

Regression probes use a separate temporary package. They verify that new skill
groups and Python caches stay out, that missing Git/security references fail,
and that accidental credential files and token-containing Markdown fail.
Only file paths and finding categories are printed; matching secret values
are never included in reports. Temporary files are removed after each check.

The scan rejects common credential filenames, private-key blocks, GitHub
tokens, provider API keys, and AWS access-key IDs in packaged text. It is a
targeted check, not a general entropy scanner. Placeholder guidance and safe
security documentation are retained. Manual review remains useful for secret
formats outside these categories. The dry run verifies npm's file manifest
and corresponding local file bytes; it does not extract a built tarball or
prove that every possible installation route executes successfully.
