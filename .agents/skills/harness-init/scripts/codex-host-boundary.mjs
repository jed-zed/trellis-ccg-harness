// Host markers select host-specific content only (for example, the Codex
// native leaf workers policy is omitted from Claude context). They neither
// authorize nor block writes: mutation safety comes from explicit approvals,
// owned-path transactions and the `.claude` byte guards.
export function isClaudeHost(env = process.env) {
  return env.CLAUDECODE === "1" || String(env.CCG_HOST ?? "").trim().toLowerCase() === "claude";
}
