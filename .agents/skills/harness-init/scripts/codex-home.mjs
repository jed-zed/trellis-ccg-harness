import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

export function codexHomePath(homeDir, codexHome = null) {
  return path.resolve(codexHome ?? path.join(homeDir, ".codex"));
}

export async function sameCodexHome(left, right) {
  const normalize = (value) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  if (normalize(left) === normalize(right)) return true;
  try { return normalize(await realpath(left)) === normalize(await realpath(right)); }
  catch { return false; }
}

// An explicit split root is a physical configuration directory, never a link
// transplanted into AgentsHome. Defaults may be absent before first install.
export async function resolveCodexHome(homeDir, codexHome = null) {
  const target = codexHomePath(homeDir, codexHome);
  if (target === path.parse(target).root) {
    throw new Error("Codex home cannot be a filesystem root.");
  }
  let current = path.parse(target).root;
  for (const segment of path.relative(current, target).split(path.sep)) {
    current = path.join(current, segment);
    try {
      const state = await lstat(current);
      if (state.isSymbolicLink() || !state.isDirectory()) {
        throw new Error(`Codex home must use real non-linked directories: ${current}`);
      }
    } catch (error) {
      if (error?.code === "ENOENT" && target === path.resolve(homeDir, ".codex")) return target;
      throw error;
    }
  }
  return realpath(target);
}
