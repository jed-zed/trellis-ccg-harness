import path from "node:path";

import { resolveCurrentTask } from "./context.mjs";
import { parseDispatchMode, truthy } from "./conflict-utils.mjs";
import {
  commandError,
  defaultRunner,
  readJson,
  readTextIfPresent,
  runCommand,
  sha256,
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
  contract,
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
    const statePath = path
      .relative(repoRoot, path.join(task.directory, contract.productManager.stateFile))
      .replaceAll("\\", "/");
    const evidencePath = path
      .relative(
        repoRoot,
        path.join(task.directory, contract.productManager.evidenceRoot),
      )
      .replaceAll("\\", "/");
    const stateIgnoreArgs = [
      "-C",
      repoRoot,
      "check-ignore",
      "--quiet",
      "--",
      statePath,
    ];
    const evidenceIgnoreArgs = [
      "-C",
      repoRoot,
      "check-ignore",
      "--quiet",
      "--",
      evidencePath,
    ];
    const stateIgnore = runCommand("git", stateIgnoreArgs, {
      repoRoot,
      runner,
      env,
    });
    const evidenceIgnore = runCommand("git", evidenceIgnoreArgs, {
      repoRoot,
      runner,
      env,
    });
    const routingValid =
      stateIgnore.status === 1 && evidenceIgnore.status === 0;
    add(
      "product-manager-state-routing",
      "blocking",
      routingValid ? "ok" : "conflict",
      routingValid
        ? "Canonical product-manager state is committable while task-local evidence is ignored."
        : "Product-manager state or evidence ignore routing is unsafe.",
      {
        statePath,
        stateIgnored: stateIgnore.status === 0,
        evidencePath,
        evidenceIgnored: evidenceIgnore.status === 0,
      },
      "Keep product-manager.json under the Trellis task and ignore only its .ccg-evidence/product-manager runtime evidence.",
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

function checkModelPolicy({ contract, add, env }) {
  const claudeOverride =
    truthy(env.HARNESS_ENABLE_CLAUDE) ||
    String(env.HARNESS_MODEL ?? "").toLowerCase() === "claude";
  const valid =
    contract.authorities.workspaceOwner === "codex" &&
    contract.models.codex?.workspaceWrite === true &&
    contract.models.claude?.enabled === true &&
    contract.models.claude?.workspaceWrite === false &&
    !claudeOverride;
  add(
    "model-policy",
    "blocking",
    valid ? "ok" : "conflict",
    valid
      ? "Codex is the sole writer and Claude is restricted to read-only provider work."
      : "Model ownership or the Claude read-only policy was violated.",
    {
      workspaceOwner: contract.authorities.workspaceOwner,
      claudeEnabled: contract.models.claude?.enabled,
      claudeEnvironmentOverride: claudeOverride,
    },
    "Restore Codex-only write ownership; select Claude only through installed CCG product-manager config.",
  );
}

function checkProviderSeparation({ contract, add }) {
  const names = [
    contract.providers.officialGrokCliAcp?.credentialEnv,
    contract.providers.openAICompatibleGrok?.apiKeyEnv,
  ].filter(Boolean);
  const distinct = new Set(names).size === names.length;
  add(
    "provider-separation",
    "blocking",
    distinct ? "ok" : "conflict",
    distinct
      ? "Official and compatible Grok credentials are separate; GPT Pro uses the credential-free sidebar Skill boundary."
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

function checkProductManagerPolicy({ contract, add }) {
  const policy = contract.productManager;
  const allowed = policy?.allowedProviders;
  const capabilities = policy?.providerCapabilities;
  const validAllowed =
    Array.isArray(allowed) &&
    allowed.length > 0 &&
    allowed.every((provider) => ["codex", "gemini", "claude"].includes(provider)) &&
    new Set(allowed).size === allowed.length;
  const validCapabilities =
    validAllowed &&
    allowed.every((provider) => {
      const capability = capabilities?.[provider];
      return (
        capability?.readOnly === true &&
        capability?.workspaceWrite === false &&
        capability?.terminal === false &&
        capability?.subagents === false &&
        capability?.network === "explicit-per-call" &&
        capability?.paid === "explicit-per-call"
      );
    }) &&
    capabilities?.grok?.readOnly === false;
  const validAuthority =
    policy?.stateAuthority === "trellis-task-projection" &&
    policy?.stateFile === "product-manager.json" &&
    policy?.evidenceRoot === ".ccg-evidence/product-manager" &&
    policy?.selectedProviderAuthority === "unified-ccg-routing";
  const valid = validAllowed && validCapabilities && validAuthority;
  add(
    "product-manager-policy",
    "blocking",
    valid ? "ok" : "conflict",
    valid
      ? "Product-manager authority and provider capability policy are fail-closed."
      : "Product-manager authority or provider capability policy is unsafe.",
    {
      stateAuthority: policy?.stateAuthority,
      selectedProviderAuthority: policy?.selectedProviderAuthority,
      allowedProviders: allowed,
    },
    "Restore Trellis task projection authority and independently no-tool provider capabilities.",
  );
}

function checkProductManagerManagedAssets({ repoRoot, contract, add }) {
  try {
    const projectPath = path.join(repoRoot, ".harness", "project.json");
    const projectSchemaPath = path.join(
      repoRoot,
      ".harness",
      "project.schema.json",
    );
    const productManagerSchemaPath = path.join(
      repoRoot,
      ".harness",
      "product-manager.schema.json",
    );
    const ownership = readJson(
      path.join(repoRoot, ".harness", "ownership.json"),
    );
    const project = readJson(projectPath);
    const projectBytes = readTextIfPresent(projectPath);
    const projectSchemaBytes = readTextIfPresent(projectSchemaPath);
    const productManagerSchemaBytes = readTextIfPresent(
      productManagerSchemaPath,
    );
    const managedPaths = new Set(ownership.managedPaths ?? []);
    const policy = project.productManager;
    const matches =
      typeof projectBytes === "string" &&
      typeof projectSchemaBytes === "string" &&
      typeof productManagerSchemaBytes === "string" &&
      ownership.contractSha256 === sha256(projectBytes) &&
      ownership.schemaSha256 === sha256(projectSchemaBytes) &&
      ownership.productManagerSchemaSha256 ===
        sha256(productManagerSchemaBytes) &&
      managedPaths.has(".harness/project.json") &&
      managedPaths.has(".harness/project.schema.json") &&
      managedPaths.has(".harness/product-manager.schema.json") &&
      policy?.stateAuthority === contract.productManager.stateAuthority &&
      policy?.stateFile ===
        `.trellis/tasks/<task>/${contract.productManager.stateFile}` &&
      policy?.evidenceRoot ===
        `.trellis/tasks/<task>/${contract.productManager.evidenceRoot}` &&
      policy?.selectedProviderAuthority ===
        contract.productManager.selectedProviderAuthority &&
      JSON.stringify(policy?.allowedProviders) ===
        JSON.stringify(contract.productManager.allowedProviders);
    add(
      "product-manager-managed-assets",
      "blocking",
      matches ? "ok" : "conflict",
      matches
        ? "Harness-owned product-manager contract and schemas match their ownership digests."
        : "Harness-owned product-manager contract, schema, or ownership digest drift was detected.",
      {
        managedProject: managedPaths.has(".harness/project.json"),
        managedProjectSchema: managedPaths.has(
          ".harness/project.schema.json",
        ),
        managedProductManagerSchema: managedPaths.has(
          ".harness/product-manager.schema.json",
        ),
        stateAuthority: policy?.stateAuthority,
        selectedProviderAuthority: policy?.selectedProviderAuthority,
      },
      "Run the approved harness-init product-manager migration instead of editing managed assets by hand.",
    );
  } catch (error) {
    add(
      "product-manager-managed-assets",
      "blocking",
      "conflict",
      "Harness-owned product-manager contract or schema is missing or invalid.",
      redactString(error.message),
      "Run the approved harness-init product-manager migration.",
    );
  }
}

export function runPolicyChecks(context) {
  checkModelPolicy(context);
  checkProviderSeparation(context);
  checkCommandNamespaces(context);
  checkProductManagerPolicy(context);
  checkProductManagerManagedAssets(context);
}
