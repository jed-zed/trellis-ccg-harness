import path from "node:path";

import { resolveCurrentTask } from "./context.mjs";
import { parseDispatchMode } from "./conflict-utils.mjs";
import {
  commandError,
  defaultRunner,
  readJson,
  readTextIfPresent,
  runCommand,
} from "./process.mjs";
import { redactString } from "./redaction.mjs";

function checkTrellisVersion({ repoRoot, sources, add }) {
  const actual = readTextIfPresent(
    path.join(repoRoot, ".trellis", ".version"),
  )?.trim();
  const matches = actual === sources.trellis.version;
  add(
    "trellis-version",
    "blocking",
    matches ? "ok" : "conflict",
    matches
      ? "Trellis project assets match the source manifest."
      : "Trellis project version drift was detected.",
    { expected: sources.trellis.version, actual: actual ?? "missing" },
    "Regenerate or upgrade Trellis assets and refresh the source manifest.",
  );
}

function checkComponentVersion({ repoRoot, sources, add }) {
  let actual = null;
  try {
    actual = readJson(
      path.join(repoRoot, sources.ccg.snapshotPath, "package.json"),
    );
  } catch {
    // The deterministic conflict below reports missing component metadata.
  }
  const matches =
    actual?.name === sources.ccg.package &&
    actual?.version === sources.ccg.version;
  add(
    "ccg-component-version",
    "blocking",
    matches ? "ok" : "conflict",
    matches
      ? "Personal CCG component identity matches the source manifest."
      : "Personal CCG component identity drift was detected.",
    {
      expected: `${sources.ccg.package}@${sources.ccg.version}`,
      actual: actual ? `${actual.name}@${actual.version}` : "missing",
    },
    "Restore the recorded personal CCG snapshot.",
  );
}

function resolveTreeish({ repoRoot, runner, env, treeish }) {
  if (treeish !== "INDEX") {
    return treeish;
  }
  const result = runCommand(
    "git",
    ["-C", repoRoot, "write-tree"],
    { repoRoot, runner, env },
  );
  return result.status === 0 ? result.stdout : "INDEX_UNAVAILABLE";
}

function checkSourceTree(context) {
  const { repoRoot, sources, add, runner, env } = context;
  const treeish = resolveTreeish(context);
  const args = [
    "-C",
    repoRoot,
    "rev-parse",
    `${treeish}:${sources.ccg.snapshotPath}`,
  ];
  const result = runCommand("git", args, { repoRoot, runner, env });
  const matches =
    result.status === 0 && result.stdout === sources.ccg.gitTree;
  add(
    "ccg-source-tree",
    "blocking",
    matches ? "ok" : "conflict",
    matches
      ? "Personal CCG Git tree matches the recorded authoritative tree."
      : "Personal CCG Git tree drift was detected.",
    {
      expected: sources.ccg.gitTree,
      actual:
        result.status === 0
          ? result.stdout
          : commandError("git", args, result),
    },
    "Restore the personal snapshot; do not replace it with original upstream.",
  );
}

function checkPackageManager({ repoRoot, contract, add }) {
  let actual = null;
  try {
    actual = readJson(path.join(repoRoot, "package.json")).packageManager;
  } catch {
    // Reported as deterministic package-manager drift below.
  }
  const expected =
    `${contract.packageManager.name}@${contract.packageManager.version}`;
  const matches = actual === expected;
  add(
    "package-manager",
    "blocking",
    matches ? "ok" : "conflict",
    matches
      ? "Package-manager contract is aligned."
      : "Package-manager drift was detected.",
    { expected, actual: actual ?? "missing" },
    "Align package.json with the adapter contract.",
  );
}

export function runVersionAndSourceChecks(context) {
  checkTrellisVersion(context);
  checkComponentVersion(context);
  checkSourceTree(context);
  checkPackageManager(context);
}

function checkDispatch({ repoRoot, contract, add }) {
  const config =
    readTextIfPresent(path.join(repoRoot, ".trellis", "config.yaml")) ?? "";
  const actual = parseDispatchMode(config);
  const matches = actual === contract.dispatch.codex;
  add(
    "codex-dispatch",
    "blocking",
    matches ? "ok" : "conflict",
    matches
      ? "Codex dispatch mode is inline as required."
      : "Codex dispatch mode conflicts with the Harness policy.",
    { expected: contract.dispatch.codex, actual: actual ?? "missing" },
    "Set codex.dispatch_mode to inline.",
  );
}

function checkTrackedRuntime({ repoRoot, contract, add, runner, env }) {
  const args = [
    "-C",
    repoRoot,
    "ls-files",
    "--",
    ...contract.state.forbiddenTrackedPaths,
  ];
  const result = runCommand("git", args, { repoRoot, runner, env });
  const paths =
    result.status === 0 && result.stdout
      ? result.stdout.split(/\r?\n/).filter(Boolean)
      : [];
  const clean = result.status === 0 && paths.length === 0;
  add(
    "tracked-runtime-state",
    "blocking",
    clean ? "ok" : "conflict",
    clean
      ? "No forbidden runtime state is tracked."
      : "Forbidden runtime state is tracked or could not be inspected.",
    result.status === 0 ? { paths } : commandError("git", args, result),
    "Remove runtime evidence and credentials from Git tracking.",
  );
}

function checkTaskAuthority({
  repoRoot,
  add,
  runner,
  env,
  taskResolver,
}) {
  try {
    const task = taskResolver(repoRoot, { runner, env });
    add(
      "task-authority",
      "blocking",
      "ok",
      "Active task resolves through the Trellis canonical task directory.",
      {
        task: task.metadata.id,
        status: task.metadata.status,
        path: task.relativeDirectory,
      },
    );
  } catch (error) {
    const noActiveTask = error.code === "NO_ACTIVE_TASK";
    add(
      "task-authority",
      noActiveTask ? "info" : "blocking",
      noActiveTask ? "info" : "conflict",
      noActiveTask
        ? "No active Trellis task is bound to this session."
        : "Trellis task authority could not be resolved safely.",
      noActiveTask ? undefined : redactString(error.message),
      noActiveTask
        ? "Run context only while a Trellis task is active."
        : "Repair the active Trellis task pointer or metadata.",
    );
  }
}

export function runStateAndTaskChecks(context) {
  const taskResolver = context.taskResolver ?? resolveCurrentTask;
  checkDispatch(context);
  checkTrackedRuntime(context);
  checkTaskAuthority({ ...context, taskResolver });
}

function checkModelPolicy({ contract, add }) {
  const models = contract.models ?? {};
  const externalWriters = Object.entries(models)
    .filter(
      ([name, model]) =>
        name !== contract.authorities.workspaceOwner &&
        model?.workspaceWrite !== false,
    )
    .map(([name]) => name);
  const roles = contract.routing?.roles ?? [];
  const valid =
    contract.authorities.workspaceOwner === "codex" &&
    models.codex?.workspaceWrite === true &&
    externalWriters.length === 0 &&
    contract.routing?.authority === "ccg" &&
    roles.length === 3 &&
    ["frontend", "backend", "search"].every((role) => roles.includes(role));
  add(
    "model-policy",
    "blocking",
    valid ? "ok" : "conflict",
    valid
      ? "CCG owns role routing and Codex is the sole workspace writer."
      : "Role-routing authority or model write ownership was violated.",
    {
      workspaceOwner: contract.authorities.workspaceOwner,
      routingAuthority: contract.routing?.authority,
      roles,
      externalWriters,
    },
    "Restore CCG role-routing authority and Codex-only workspace writes.",
  );
}

function checkProviderSeparation({ contract, add }) {
  const names = [
    contract.providers.officialGrokCliAcp?.credentialEnv,
    contract.providers.openAICompatibleGrok?.apiKeyEnv,
    contract.providers.gptPro?.apiKeyEnv,
  ].filter(Boolean);
  const distinct = new Set(names).size === names.length;
  add(
    "provider-separation",
    "blocking",
    distinct ? "ok" : "conflict",
    distinct
      ? "Official Grok, compatible Grok, and GPT Pro credentials are separate."
      : "Provider credential namespaces overlap.",
    { credentialEnvNames: names },
    "Assign a unique environment variable to every provider boundary.",
  );
}

function checkCommandNamespaces({ contract, add }) {
  const namespaces = Object.values(contract.commands.namespaces);
  const distinct = new Set(namespaces).size === namespaces.length;
  add(
    "command-namespaces",
    "blocking",
    distinct ? "ok" : "conflict",
    distinct
      ? "Trellis and CCG command namespaces are distinct."
      : "Trellis and CCG command namespaces collide.",
    { namespaces: contract.commands.namespaces },
    "Keep trellis and ccg command prefixes separate.",
  );
}

export function runPolicyChecks(context) {
  checkModelPolicy(context);
  checkProviderSeparation(context);
  checkCommandNamespaces(context);
}
