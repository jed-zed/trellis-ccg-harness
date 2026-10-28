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

async function assertDirectoryChain(target, allowFinalLink) {
  if (target === path.parse(target).root) {
    throw new Error("Codex home cannot be a filesystem root.");
  }
  let current = path.parse(target).root;
  const segments = path.relative(current, target).split(path.sep);
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const state = await lstat(current);
    if (allowFinalLink && index === segments.length - 1 && state.isSymbolicLink()) return;
    if (state.isSymbolicLink() || !state.isDirectory()) {
      throw new Error(`Codex home must use real non-linked directories: ${current}`);
    }
  }
}

// Only the HomeDir/.codex profile entry may itself be a link (e.g. a Windows
// junction); its ancestors and every other explicit root stay real directories.
// Callers bind the returned physical root, which must also be a link-free
// directory chain. Defaults may be absent before first install.
export async function resolveCodexHome(homeDir, codexHome = null) {
  const target = codexHomePath(homeDir, codexHome);
  const defaultHome = path.resolve(homeDir, ".codex");
  const isDefault = process.platform === "win32"
    ? target.toLowerCase() === defaultHome.toLowerCase()
    : target === defaultHome;
  try {
    await assertDirectoryChain(target, isDefault);
  } catch (error) {
    if (error?.code === "ENOENT" && isDefault) return target;
    throw error;
  }
  const physical = await realpath(target);
  await assertDirectoryChain(physical, false);
  return physical;
}
