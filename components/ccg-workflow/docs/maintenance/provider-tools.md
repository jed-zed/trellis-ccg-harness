# Optional Kimi and OpenCode providers

The existing platform and role defaults remain unchanged. Kimi/OpenCode are explicit frontend/backend choices; search and product-manager retain their existing supported providers. Installing or selecting a provider does not log in, call a model, or grant execution approval.

```powershell
ccg providers install --backend kimi --prefix C:\private-tools\kimi --shell-path E:\Git\bin\bash.exe
ccg providers doctor --backend kimi --prefix C:\private-tools\kimi --json
ccg providers configure --backend kimi --prefix C:\private-tools\kimi --role backend --model kimi-for-coding
$env:CCG_KIMI_PREFIX = 'C:\private-tools\kimi'
```

```sh
ccg providers install --backend opencode --prefix /absolute/private-tools/opencode
ccg providers doctor --backend opencode --prefix /absolute/private-tools/opencode --json
ccg providers configure --backend opencode --prefix /absolute/private-tools/opencode --role frontend --model provider/model
export CCG_OPENCODE_PREFIX=/absolute/private-tools/opencode
```

Use an absolute dedicated directory. New installs are staged in an owned sibling, verified with a local help/version probe, and renamed only after success. Existing directories are reused only when their complete receipt matches; user changes cause a refusal and remain intact. Failure removes only the new staging directory. No global PATH, credentials, provider settings, controller MCP, or GPT Pro browser settings are modified.

`@moonshot-ai/kimi-code@2.1.1` requires Node >=22.19.0. Windows requires Git Bash and an absolute `KIMI_SHELL_PATH` or `--shell-path`. The official npm migration script renames/removes legacy global Python shims, so this installer always uses `--ignore-scripts`. Regular `ws` and `qrcode` dependencies remain installed; optional PTY and clipboard packages are omitted. The private canonical npm launcher binds the official `dist/main.mjs` entry. CCG does not install or start WSL.

The Go wrapper verifies the default bare `kimi` product before forwarding a task. Its stream parser currently supports the fixed official npm version 2.1.1. On Windows, only the canonical npm `.cmd` launcher with the matching package name, version, repository and `bin.kimi` entry is accepted. A legacy Python `kimi.exe`, an unverified native launcher or another npm version fails with an official setup link before a child starts. It does not probe an unknown executable with a prompt, uninstall Python or rewrite its shim.

On Unix, a standard global/local npm `kimi` symlink must resolve to the verified package's fixed `dist/main.mjs`. A regular private shell launcher additionally requires the absolute `CCG_KIMI_PREFIX`, a matching PATH launcher, and its complete SHA-256 receipt. The receipt is bounded to 8 MiB; missing, extra or modified files fail. Prefix, receipt, package metadata and runtime entry reject links or special files. npm's receipted internal bin links are compared as link text and must stay inside the prefix. After verification, the wrapper invokes Node directly without executing shell launcher text. The CCG TypeScript entry prepends the selected prefix only to the child PATH; a direct Go invocation also needs that prefix on its process-local PATH. Explicit custom command names keep their caller-defined contract and are outside this default-product check.

`opencode-ai@1.18.34` contains an uninstalled placeholder entry. CCG explicitly installs its matching official native package and copies that executable into the private bin directory. It skips the upstream install script and its automatic temporary npm fallback. x64 selects the CPU-compatible baseline build. Linux defaults to glibc; musl users explicitly set `CCG_OPENCODE_LIBC=musl` during both installation and execution. Unsupported managed platforms fail with the official manual setup link.

Doctor checks the owned receipt, package identity, dependency/entry paths and local `--help` (Kimi) or `--version` (OpenCode). `authentication: not-checked` is deliberate: config or token file existence is not proof of successful authentication. Use the provider's native login separately. No diagnostic submits a prompt.

`routing.kimiModel` and `routing.opencodeModel` persist independently. Blank models retain the provider CLI's own default; CCG never silently switches providers. Noninteractive init accepts `--kimi-model` and `--opencode-model`, and menus preserve the other model. Generated shell templates accept safe model identifiers only; direct wrapper argv/environment supports richer single-line identifiers without shell interpolation.

The new native noninteractive commands have provider-specific automatic approval semantics. Actual wrapper execution requires the separate explicit `--allow-native-auto-approval` acknowledgement. Installation/configuration does not imply that acknowledgement, and templates do not insert it automatically.

Rollback: unset the process-local `CCG_KIMI_PREFIX`/`CCG_OPENCODE_PREFIX`; explicitly restore the desired role with `ccg routing set <role> <previous-provider>`. The private directory can be retained for inspection. The implementation does not uninstall another tool or rewrite another provider's credentials.

Official contracts: [Kimi setup](https://moonshotai.github.io/kimi-code/en/guides/getting-started), [Kimi source](https://github.com/MoonshotAI/kimi-code), [OpenCode CLI](https://opencode.ai/docs/cli/), [OpenCode source](https://github.com/anomalyco/opencode). Local software startup and protocol fixtures do not establish successful paid model execution or latency improvements.
