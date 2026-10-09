export function isClaudeHost(env = process.env) {
  return env.CLAUDECODE === "1" || String(env.CCG_HOST ?? "").trim().toLowerCase() === "claude";
}

export function assertCodexMutationHost(env = process.env) {
  if (isClaudeHost(env)) {
    throw new Error("Personal Harness mutations require the Codex host; explicit Claude host markers are rejected.");
  }
}
