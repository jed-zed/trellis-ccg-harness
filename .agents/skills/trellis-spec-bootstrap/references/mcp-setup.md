# MCP Setup

GitNexus and ABCoder are recommended when bootstrapping Trellis specs because they expose architecture and AST context to the agent. They are tool choices, not platform requirements. Configure them through whatever MCP mechanism your agent host provides.

Neither tool is installed or run by default. Present the recommendation first,
and do not execute any install, indexing, or MCP-registration command until the
user explicitly approves that named tool.

## GitNexus

GitNexus builds a code knowledge graph from the repository. Use it for module boundaries, execution flows, dependency relationships, blast radius, and graph queries.

### Install and Index

```bash
# Run from the repository root.
npx --yes gitnexus@1.6.9 analyze

# Check index status.
npx --yes gitnexus@1.6.9 status

# Re-index after code changes when the analysis is stale.
npx --yes gitnexus@1.6.9 analyze
```

The index is written to `.gitnexus/`. Keep embeddings only if the project already uses them; otherwise a normal index is enough for spec bootstrapping.

### MCP Server Command

Use this server command in the host's MCP configuration:

```bash
npx --yes gitnexus@1.6.9 mcp
```

Pinned source identity: npm package `gitnexus@1.6.9`, Git commit
`4227194ad7bdfbedc29a7fe20e09c6737ce0e744`, npm integrity
`sha512-Rq5LXFygx7jjMp/YFsIAcnnzuKvvCsb4rxHFILnu05ZOqk7xNXTUSMRa968EOCbxcKFxnhKYaGXoabOUeGZX6A==`.

### Useful Tools

| Tool | Purpose |
|------|---------|
| `gitnexus_query` | Find execution flows and functional areas by concept |
| `gitnexus_context` | Inspect callers, callees, references, and process participation for a symbol |
| `gitnexus_impact` | Understand blast radius before changing a symbol |
| `gitnexus_detect_changes` | Check changed symbols and affected flows before finishing |
| `gitnexus_cypher` | Run direct graph queries |
| `gitnexus_list_repos` | List indexed repositories |

## ABCoder

ABCoder parses code into UniAST and gives precise package, file, and node-level structure. Use it for signatures, type shapes, implementations, dependencies, and reverse references.

### Install

```bash
go install github.com/cloudwego/abcoder@v0.3.1
abcoder --help
```

Pinned source identity: release `v0.3.1`, Git commit
`375e069f1f02dca204208d87c7b6f6274544f581`, Git tree
`b5c075398edbb63cb26c5acfe5a5b2f967e54a2f`, module checksum
`h1:6lK6+KVZZZ4oQ17FG+Rinav395Gs6XY+l4NZoFV7o1Q=`, and `go.mod`
checksum `h1:UvVOoWaFhVy3oGSbMHDVmD0Hy4ivioeX/52JvsQnR0g=`.

### Parse Repositories

```bash
abcoder parse /absolute/path/to/package \
  --lang typescript \
  --name package-name \
  --output ~/abcoder-asts
```

For monorepos, parse each package with a stable `--name` so task notes can reference the same repository names.

### MCP Server Command

Use this server command in the host's MCP configuration:

```bash
abcoder mcp ~/abcoder-asts
```

### Useful Tools

| Tool | Layer | Purpose |
|------|-------|---------|
| `list_repos` | 1 | List parsed repositories |
| `get_repo_structure` | 2 | Inspect packages and files |
| `get_package_structure` | 3 | Inspect nodes within a package |
| `get_file_structure` | 3 | Inspect functions, classes, types, and signatures in a file |
| `get_ast_node` | 4 | Retrieve code, dependencies, references, and implementations |

## Verification

After configuration, verify from the agent host that both MCP servers are visible. Then run one simple query against each server before starting the spec writing pass.

```bash
ls .gitnexus/meta.json
ls ~/abcoder-asts/*.json
```
