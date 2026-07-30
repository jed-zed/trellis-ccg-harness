# AI installation contract

Use this contract when a user gives an AI the repository URL and asks it to
install the Trellis CCG Harness.

## Authority boundary

A repository URL or a request to "install this repository" authorizes
read-only inspection and planning only. It does not authorize:

- global or project filesystem writes;
- optional third-party add-ons;
- catalog or third-party network access;
- Provider CLI installation or login;
- paid Provider calls.

Obtain fresh, explicit approval for each mutating scope. Never translate a
previous or unrelated approval into installation authority.

## Required state machine

### 1. Inspect without mutation

Read `README.md`, this file, `harness.sources.json`, and
`.agents/skills/harness-init/assets/third-party-sources.json`. Confirm the
repository root and current Git state. Do not install dependencies or run
Provider CLIs merely to inspect the repository.

Preview core Global Setup:

```powershell
pnpm setup -- -PreviewOnly -HomeDir "<absolute-user-home>"
```

Present the exact core versions, source identity, target home, catalog choice,
and Provider guidance to the user. Stop and obtain explicit approval before
running core setup.

### 2. Run only the approved core setup

For the public baseline, after explicit approval:

```powershell
pnpm setup -- `
  -NonInteractive `
  -HomeDir "<absolute-user-home>" `
  -CatalogMode skip `
  -ProviderActions "codex=later,gemini=later,grok=later,claude=skip" `
  -Approved `
  -ApproveTrellis `
  -ApproveCcgCli `
  -ApproveCodexMode `
  -ApproveCcgPlugin `
  -ApproveGlobalInit
```

Do not add catalog network, third-party network, Provider install/login, or
other optional actions unless the user separately approves them.

### 3. Inspect add-ons without mutation

Read current global add-on state:

```powershell
pnpm addons -- `
  --status `
  --home-dir "<absolute-user-home>" `
  --repo-root "<absolute-repository>"
```

The JSON result contains global candidates only. Report each candidate's
status, recommendation, dependencies, scripts, hooks, executable, network, and
data-egress effects. `recommended: true` is display metadata; it is never a
selection.

Choose only candidates the user is considering, then generate a read-only
plan. Every group must be explicit; use `none` for an empty group:

```powershell
pnpm addons -- `
  --plan-only `
  --home-dir "<absolute-user-home>" `
  --repo-root "<absolute-repository>" `
  --third-party-global-skills "<ids-or-none>" `
  --third-party-global-plugins "<ids-or-none>" `
  --third-party-mcp-cli "<ids-or-none>"
```

Present the exact selections, `sourceManifestSha256`, `planSha256`,
`networkCandidateIds`, write/effect summary, blocked decisions, and
manual-pending outcomes. Stop and obtain fresh approval for the exact
candidate list and, separately, third-party network access when required.

### 4. Apply the exact approved add-on plan

Repeat the identical candidate groups and reviewed digests:

```powershell
pnpm addons -- `
  --non-interactive `
  --home-dir "<absolute-user-home>" `
  --repo-root "<absolute-repository>" `
  --third-party-global-skills "<exact-approved-ids-or-none>" `
  --third-party-global-plugins "<exact-approved-ids-or-none>" `
  --third-party-mcp-cli "<exact-approved-ids-or-none>" `
  --third-party-source-sha256 "<reviewed-source-sha256>" `
  --third-party-plan-sha256 "<reviewed-plan-sha256>" `
  --allow-third-party-network `
  --approved
```

Omit `--allow-third-party-network` only when the reviewed plan has no network
candidates. The command reconstructs the canonical plan before mutation and
fails if the manifest, plan, target, command binding, strict-data-boundary
policy, dependency state, or candidate state changed.

Never retry by removing digest, approval, ownership, drift, dependency, or
data-boundary checks. Drifted targets require separate manual remediation.
Ponytail hooks/default require the Ponytail plugin to be exact-installed or
selected and still approved after policy checks in the same transaction.

### 5. Verify and report accurately

```powershell
pnpm doctor
pnpm harness:conflicts
```

Report `completed`, `skipped`, `blocked`, `drifted`, and `manual-pending`
items separately. In particular, never claim that an MCP is registered when
the result says `manual-pending`.

Project-specific third-party Skills are outside `pnpm addons`; they remain
part of the reviewed `project-init` contract.
