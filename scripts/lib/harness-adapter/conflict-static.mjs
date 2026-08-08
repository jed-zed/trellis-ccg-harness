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
    contract.models.gptpro?.enabled === true &&
    contract.models.gptpro?.manualOnly === false &&
    contract.models.gptpro?.workspaceWrite === false &&
    !claudeOverride;
  add(
    "model-policy",
    "blocking",
    valid ? "ok" : "conflict",
    valid
      ? "Codex is the sole writer; Claude and automated GPT Pro remain read-only."
      : "Model ownership, Claude read-only policy, or the GPT Pro automation boundary was violated.",
    {
      workspaceOwner: contract.authorities.workspaceOwner,
      claudeEnabled: contract.models.claude?.enabled,
      claudeEnvironmentOverride: claudeOverride,
      gptProModel: contract.models.gptpro,
    },
    "Restore Codex-only writes, Claude read-only routing, and the enabled non-manual GPT Pro read-only model.",
  );
}

function checkProviderSeparation({ contract, add }) {
  const names = [
    contract.providers.officialGrokCliAcp?.credentialEnv,
    contract.providers.openAICompatibleGrok?.apiKeyEnv,
  ].filter(Boolean);
  const distinct = new Set(names).size === names.length;
  const gptPro = contract.providers.gptPro;
  const gptProValid =
    gptPro?.enabled === true &&
    gptPro?.manualOnly === false &&
    gptPro?.protocol === "chatgpt-pro-sidebar" &&
    gptPro?.skill === "chatgpt-pro-sidebar" &&
    gptPro?.transport === "agent-browser-cli-v2" &&
    gptPro?.continuation === "codex-root-wait" &&
    gptPro?.commands?.singleRound === "run-root" &&
    gptPro?.commands?.batch === "run-batch-root" &&
    gptPro?.commands?.slots === "slots" &&
    gptPro?.commands?.diagnosticRelease === "release-slot" &&
    gptPro?.batch?.defaultTimeoutSeconds === 7200 &&
    gptPro?.batch?.perThreadConcurrency === 3 &&
    gptPro?.batch?.globalConcurrency === 6;
  const valid = distinct && gptProValid;
  add(
    "provider-separation",
    "blocking",
    valid ? "ok" : "conflict",
    valid
      ? "Official and compatible Grok credentials are separate; GPT Pro uses the pinned external Chrome batch RootWait boundary."
      : "Provider credential namespaces overlap or the GPT Pro browser boundary drifted.",
    { credentialEnvNames: names, gptPro },
    "Assign unique provider credentials and restore the GPT Pro Skill, transport, RootWait commands, and 3/6 batch limits.",
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
    "Restore Trellis task projection authority and independently constrained read-only provider capabilities.",
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
    const claudeTransport = policy?.claudeTransport ?? "local";
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
      ["local", "ssh"].includes(claudeTransport) &&
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
        claudeTransport,
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

const SAFE_PROJECT_SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function normalizeProjectSkillPath(value, label) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  return value.replaceAll("\\", "/");
}

function projectSkillPathsOverlap(left, right) {
  return (
    left === right ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  );
}

function projectSkillInstallationPaths(id, installation) {
  const paths = installation?.paths;
  if (
    !paths ||
    typeof paths !== "object" ||
    Array.isArray(paths) ||
    Object.keys(paths).length === 0
  ) {
    throw new Error(`Selected third-party Project Skill ${id} has invalid or empty paths.`);
  }
  return Object.entries(paths).map(([name, record]) => {
    if (
      !SAFE_PROJECT_SKILL_NAME.test(name) ||
      !record ||
      typeof record !== "object" ||
      Array.isArray(record) ||
      !/^[a-f0-9]{64}$/.test(String(record.treeSha256 ?? ""))
    ) {
      throw new Error(`Selected third-party Project Skill ${id} has an invalid path record.`);
    }
    const targetPath = normalizeProjectSkillPath(
      record.targetPath ?? `.agents/skills/${name}`,
      `Selected third-party Project Skill ${id} target path`,
    );
    const segments = targetPath.split("/");
    if (
      !targetPath.startsWith(".agents/skills/") ||
      segments.length < 3 ||
      segments.some((segment) => !segment || segment === "." || segment === "..")
    ) {
      throw new Error(`Selected third-party Project Skill ${id} has an unsafe target path.`);
    }
    return targetPath;
  });
}

function checkProjectSkillPathOwnership({ repoRoot, add }) {
  try {
    const harnessRoot = path.join(repoRoot, ".harness");
    const project = readJson(path.join(harnessRoot, "project.json"));
    const selected = project.thirdParty?.projectSkills ?? [];
    if (!Array.isArray(selected)) {
      throw new Error("thirdParty.projectSkills must be an array.");
    }
    const catalogText = readTextIfPresent(
      path.join(harnessRoot, "project-skills.json"),
    );
    const catalog = catalogText === null ? { skills: [] } : JSON.parse(catalogText);
    if (!Array.isArray(catalog.skills)) {
      throw new Error("project-skills.json skills must be an array.");
    }
    const installationsText = readTextIfPresent(
      path.join(harnessRoot, "third-party-installations.json"),
    );
    const installations =
      installationsText === null
        ? {}
        : (JSON.parse(installationsText).installations ?? {});
    const missingInstallations = selected.filter((id) => !installations[id]);
    const thirdPartyPaths = selected
      .filter((id) => installations[id])
      .flatMap((id) => projectSkillInstallationPaths(id, installations[id]));
    const catalogPaths = catalog.skills.map((skill) =>
      normalizeProjectSkillPath(
        skill?.targetPath,
        "Catalog Project Skill target path",
      ),
    );
    const managedPaths = new Set(
      (project.workflow?.managedProjectPaths ?? []).map((entry) =>
        normalizeProjectSkillPath(entry, "Managed project path"),
      ),
    );
    const overlaps = [
      ...new Set(
        thirdPartyPaths.filter((skillPath) =>
          catalogPaths.some((catalogPath) =>
            projectSkillPathsOverlap(skillPath, catalogPath),
          ),
        ),
      ),
    ].sort();
    const unmanagedThirdPartyPaths = [
      ...new Set(thirdPartyPaths.filter((skillPath) => !managedPaths.has(skillPath))),
    ].sort();
    const valid =
      missingInstallations.length === 0 &&
      overlaps.length === 0 &&
      unmanagedThirdPartyPaths.length === 0;
    add(
      "project-skill-path-ownership",
      "blocking",
      valid ? "ok" : "conflict",
      valid
        ? "Catalog and selected third-party Project Skill paths have distinct managed ownership."
        : "Catalog and selected third-party Project Skill path ownership conflicts or is incomplete.",
      { overlaps, unmanagedThirdPartyPaths, missingInstallations },
      "Assign distinct paths to catalog and third-party Project Skills and include every selected third-party path in workflow.managedProjectPaths.",
    );
  } catch (error) {
    add(
      "project-skill-path-ownership",
      "blocking",
      "conflict",
      "Project Skill path ownership could not be inspected safely.",
      redactString(error.message),
      "Repair the project Skill manifests and rerun the Harness conflict audit.",
    );
  }
}

export function runPolicyChecks(context) {
  checkModelPolicy(context);
  checkProviderSeparation(context);
  checkCommandNamespaces(context);
  checkProductManagerPolicy(context);
  checkProductManagerManagedAssets(context);
  checkProjectSkillPathOwnership(context);
}
