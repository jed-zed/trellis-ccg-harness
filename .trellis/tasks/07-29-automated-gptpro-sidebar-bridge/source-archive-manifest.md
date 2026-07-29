# Source archive manifest

Generated for the automated GPT Pro side-panel bridge delivery.

## Repository baselines

| Repository | Base commit | Source commit |
| --- | --- | --- |
| `ccg-gptpro-worflow` | `fe3935722abda6c734ecbb784da0011789d11a63` | `59ef05f7496fa9659d7df5d82bcecbdcd7a3ebd0` |
| `codex-skill-repository` | `0ba0035c0d86f521f33ddd7341f846abc568bf76` | `38c4fd3ce54913175b884419bdc8a40d72297e37` |
| `trellis-ccg-harness` | `677ea35e9533bff676a8f1c133b72dc0ad2866d8` | `bcb3acf` |

## Inclusion rule

The archive contains the tracked files changed between each base and source
commit, plus this manifest. The three repositories are stored under separate
top-level directories. The Harness copy therefore includes its formally
materialized CCG component snapshot as well as the adapter, Project Skill,
tests, and Trellis task artifacts changed for this delivery.

## Exclusions

The archive does not include `.git`, `node_modules`, build output, caches,
databases, browser or Codex runtime state, `.ccg-evidence`, `.env` files,
cookies, credentials, tokens, API keys, private keys, or untracked files.

Before publication, the staged archive tree is scanned for private-key headers,
common credential assignments, GitHub tokens, OpenAI-style keys, Slack tokens,
JWT-shaped values, and AWS access-key identifiers. The archive size and
SHA-256 are recorded in `acceptance.md`.
