import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  collectHookCommands,
  countHookCommands,
  parseCcgVersion,
} from "./conflict-utils.mjs";
import {
  commandError,
  defaultRunner,
  readJson,
  readTextIfPresent,
  runCommand,
} from "./process.mjs";

function runtimeInvocations(contract, env) {
  const invocations = [];
  if (process.platform === "win32" && env.APPDATA) {
    const npmCliPath = path.join(
      env.APPDATA,
      "npm",
      "node_modules",
      "ccg-workflow",
      "bin",
      "ccg.mjs",
    );
    if (existsSync(npmCliPath)) {
      invocations.push({
        command: process.execPath,
        args: [npmCliPath, "--version"],
      });
    }
  }
  invocations.push({
    command: contract.runtime.ccg.command,
    args: ["--version"],
  });
  return invocations;
}

export function runCcgRuntimeCheck({
  repoRoot,
  contract,
  sources,
  add,
  runner = defaultRunner,
  env = process.env,
}) {
  let result = null;
  let selectedInvocation = null;
  for (const invocation of runtimeInvocations(contract, env)) {
    const attempt = runCommand(
      invocation.command,
      invocation.args,
      { repoRoot, runner, env },
    );
    selectedInvocation = invocation;
    result = attempt;
    if (attempt.error?.code !== "ENOENT") {
      break;
    }
  }

  const installedVersion =
    result?.status === 0 ? parseCcgVersion(result.stdout) : null;
  if (installedVersion === null) {
    add(
      "ccg-runtime-cli",
      "blocking",
      "conflict",
      "Installed CCG CLI could not be verified.",
      result?.status === 0
        ? result.stdout
        : commandError(
            selectedInvocation.command,
            selectedInvocation.args,
            result,
          ),
      "Install the personal CCG CLI before running model workflows.",
    );
    return;
  }

  const versionMatches = installedVersion === sources.ccg.version;
  add(
    "ccg-runtime-cli",
    "blocking",
    versionMatches ? "ok" : "conflict",
    versionMatches
      ? "Installed CCG CLI matches the source manifest."
      : "Installed CCG CLI version drift was detected.",
    { expected: sources.ccg.version, actual: installedVersion },
    "Install the CCG CLI version recorded in harness.sources.json.",
  );
}

function checkPluginCache({
  sources,
  add,
  homeDir,
}) {
  const pluginCacheRoot = path.join(
    homeDir,
    ".codex",
    "plugins",
    "cache",
    "ccg-gptpro-worflow",
    "ccg",
  );
  let pluginVersion = null;
  try {
    const candidates = readdirSync(pluginCacheRoot, {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter(
        (version) =>
          version === sources.ccg.version ||
          version.startsWith(`${sources.ccg.version}+`),
      )
      .sort((left, right) => right.localeCompare(left));
    for (const candidate of candidates) {
      const manifest = readJson(
        path.join(
          pluginCacheRoot,
          candidate,
          ".codex-plugin",
          "plugin.json",
        ),
      );
      if (
        manifest.version === candidate &&
        (
          manifest.version === sources.ccg.version ||
          manifest.version.startsWith(`${sources.ccg.version}+`)
        )
      ) {
        pluginVersion = manifest.version;
        break;
      }
    }
  } catch {
    // A missing user cache is runtime drift and must fail closed.
  }
  const matches =
    pluginVersion === sources.ccg.version ||
    pluginVersion?.startsWith(`${sources.ccg.version}+`);
  add(
    "ccg-plugin-cache",
    "blocking",
    matches ? "ok" : "conflict",
    matches
      ? "Installed CCG Codex plugin cache matches the source manifest."
      : "Installed CCG Codex plugin cache is missing or mismatched.",
    { expected: sources.ccg.version, actual: pluginVersion ?? "missing" },
    "Sync the personal CCG Codex plugin cache.",
  );
}

function readHooks(filePath) {
  try {
    return readJson(filePath);
  } catch {
    return {};
  }
}

function isTrellisWorkflowStateHook(command) {
  return String(command)
    .replaceAll("\\", "/")
    .toLowerCase()
    .includes(".codex/hooks/inject-workflow-state.py");
}

function checkPromptHookOverlap({
  repoRoot,
  contract,
  add,
  homeDir,
}) {
  const projectHooks = readHooks(path.join(repoRoot, ".codex", "hooks.json"));
  const userHooks = readHooks(path.join(homeDir, ".codex", "hooks.json"));
  const eventName = contract.hooks.promptEvent;
  const projectHookCount = countHookCommands(projectHooks, eventName);
  const userHookCount = countHookCommands(userHooks, eventName);
  const projectWorkflowHooks = collectHookCommands(
    projectHooks,
    eventName,
  ).filter(isTrellisWorkflowStateHook);
  const userWorkflowHooks = collectHookCommands(
    userHooks,
    eventName,
  ).filter(isTrellisWorkflowStateHook);
  const duplicates =
    projectWorkflowHooks.length > 0 && userWorkflowHooks.length > 0;
  const yieldMarker = contract.hooks.globalYieldMarker;
  const globalHookSource = readTextIfPresent(
    path.join(homeDir, ".codex", "hooks", "inject-workflow-state.py"),
  );
  const projectLocalPrecedence =
    duplicates &&
    contract.hooks.userOverlapPolicy === "project-local-precedence" &&
    typeof yieldMarker === "string" &&
    globalHookSource?.includes(yieldMarker) === true;
  const effectiveOverlap = duplicates && !projectLocalPrecedence;
  add(
    "prompt-hook-overlap",
    "warning",
    effectiveOverlap ? "conflict" : "ok",
    effectiveOverlap
      ? "Project and user Trellis workflow hooks both inject prompt context."
      : projectLocalPrecedence
        ? "The user-level Trellis hook yields to the project-local hook."
        : "No duplicate Trellis prompt-state injection was detected.",
    {
      event: eventName,
      projectHookCount,
      userHookCount,
      projectWorkflowHookCount: projectWorkflowHooks.length,
      userWorkflowHookCount: userWorkflowHooks.length,
      projectLocalPrecedence,
    },
    "Install the project-local precedence guard in the user-level Trellis hook.",
  );
}

export function runUserStateChecks(context) {
  if (!context.includeUserState) {
    context.add(
      "user-runtime-state",
      "info",
      "info",
      "User-level plugin and hook checks are skipped in deterministic CI mode.",
    );
    return;
  }
  checkPluginCache(context);
  checkPromptHookOverlap(context);
}

function directoryEntries(directory) {
  try {
    return readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function findHarnessClaudeAssets(repoRoot) {
  const claudeRoot = path.join(repoRoot, ".claude");
  const found = [];
  for (const directory of ["agents", "skills"]) {
    for (const entry of directoryEntries(path.join(claudeRoot, directory))) {
      if (
        entry.name.startsWith("trellis-") ||
        entry.name === "ccg" ||
        entry.name.startsWith("ccg-")
      ) {
        found.push(`.claude/${directory}/${entry.name}`);
      }
    }
  }
  for (const relative of [
    "commands/trellis",
    "commands/ccg",
    "hooks/inject-subagent-context.py",
    "hooks/inject-workflow-state.py",
    "hooks/session-start.py",
    ".ccg",
    "plan",
  ]) {
    if (existsSync(path.join(claudeRoot, ...relative.split("/")))) {
      found.push(`.claude/${relative}`);
    }
  }
  const settings = readTextIfPresent(path.join(claudeRoot, "settings.json"));
  if (
    settings &&
    /trellis|ccg|inject-(?:subagent-context|workflow-state)|session-start/i.test(
      settings,
    )
  ) {
    found.push(".claude/settings.json");
  }
  return found.sort();
}

export function runInformationalChecks({
  repoRoot,
  contract,
  sources,
  add,
}) {
  add(
    "grok-runtime",
    "info",
    "info",
    contract.models.grok.enabled
      ? "Grok is enabled by project policy."
      : "Grok is optional and disabled; it does not block the Harness.",
  );
  const claudeRoot = path.join(repoRoot, ".claude");
  const harnessClaudeAssets = findHarnessClaudeAssets(repoRoot);
  if (harnessClaudeAssets.length > 0) {
    add(
      "harness-claude-assets",
      "blocking",
      "conflict",
      "Harness, Trellis, or CCG runtime assets remain under project .claude.",
      { paths: harnessClaudeAssets },
      "Migrate the owned assets to .agents/.codex and remove only the identified Claude-runtime residue.",
    );
  } else if (existsSync(claudeRoot)) {
    add(
      "user-claude-assets",
      "info",
      "info",
      "Unrecognized project .claude content is user-owned and was not modified.",
      undefined,
      "Review it manually if a completely empty project Claude surface is required.",
    );
  }
  if (
    existsSync(
      path.join(repoRoot, sources.ccg.snapshotPath, ".github", "workflows"),
    )
  ) {
    add(
      "nested-component-workflows",
      "info",
      "info",
      "Nested CCG workflows are source provenance only and do not run as root CI.",
    );
  }
}
