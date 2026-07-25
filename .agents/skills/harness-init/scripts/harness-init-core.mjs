import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const CONTRACT_STATUSES = new Set(["draft", "approved", "ready"]);
const MANIFEST_CANDIDATES = [
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "pyproject.toml",
  "requirements.txt",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
];
const CREDENTIAL_KEY = /(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|private[_-]?key|client[_-]?secret|credential)/i;
const CREDENTIAL_VALUE = /(?:\bsk-[A-Za-z0-9_-]{8,}\b|\bgh[pousr]_[A-Za-z0-9_]{8,}\b|\bBearer\s+[A-Za-z0-9._~-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const ALLOWED_POLICY_KEYS = new Set([
  "credentialFieldsForbidden",
  "secretPolicy",
]);

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function assertInside(root, target, label) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside the target repository.`);
  }
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertString(value, label, { allowNull = false } = {}) {
  if (allowNull && value === null) return;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
}

function assertStringArray(value, label) {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || !entry.trim())
  ) {
    throw new Error(`${label} must be an array of non-empty strings.`);
  }
}

function assertSafeProjectPaths(values, label) {
  assertStringArray(values, label);
  for (const value of values) {
    const normalized = value.replaceAll("\\", "/");
    if (
      normalized.startsWith("/") ||
      /^[A-Za-z]:/.test(normalized) ||
      path.posix.normalize(normalized) !== normalized ||
      normalized === ".." ||
      normalized.startsWith("../")
    ) {
      throw new Error(`${label} contains an unsafe project path: ${value}.`);
    }
  }
}

function assertNoCredentials(value, location = "$") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoCredentials(entry, `${location}[${index}]`),
    );
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && CREDENTIAL_VALUE.test(value)) {
      throw new Error(
        `Credential or secret value is forbidden in the contract at ${location}.`,
      );
    }
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (CREDENTIAL_KEY.test(key) && !ALLOWED_POLICY_KEYS.has(key)) {
      throw new Error(
        `Credential or secret field is forbidden in the contract at ${location}.${key}.`,
      );
    }
    assertNoCredentials(entry, `${location}.${key}`);
  }
}

function assertProviders(providers) {
  assertObject(providers, "providers");
  for (const provider of ["codex", "gemini", "claude", "grok", "gptPro"]) {
    assertObject(providers[provider], `providers.${provider}`);
    for (const field of ["enabled", "workspaceWrite"]) {
      if (typeof providers[provider][field] !== "boolean") {
        throw new Error(`providers.${provider}.${field} must be boolean.`);
      }
    }
  }
  if (!providers.codex.enabled || !providers.codex.workspaceWrite) {
    throw new Error("Codex must remain the enabled workspace writer.");
  }
  if (providers.claude.enabled || providers.claude.workspaceWrite) {
    throw new Error("Claude must remain disabled with no workspace write access.");
  }
  for (const provider of ["gemini", "grok", "gptPro"]) {
    if (providers[provider].workspaceWrite) {
      throw new Error(
        `${provider} cannot receive workspace write authority.`,
      );
    }
  }
  for (const provider of ["grok", "gptPro"]) {
    if (
      providers[provider].enabled &&
      providers[provider].manualOnly !== true
    ) {
      throw new Error(`${provider} must remain manual-only when enabled.`);
    }
  }
}

function assertContractObjects(contract) {
  for (const field of [
    "project",
    "authorities",
    "workflow",
    "toolchain",
    "qualityGates",
    "security",
    "hooks",
    "source",
    "ci",
    "approval",
  ]) {
    assertObject(contract[field], field);
  }
  if (!Array.isArray(contract.unresolvedDecisions)) {
    throw new Error("unresolvedDecisions must be an array.");
  }
}

function assertContractAuthorities(authorities) {
  const expected = {
    lifecycle: "trellis",
    tasks: ".trellis/tasks",
    requirements: ".trellis/tasks",
    specifications: ".trellis/spec",
    intelligence: "ccg",
    workspaceWriter: "codex",
  };
  for (const [key, value] of Object.entries(expected)) {
    if (authorities[key] !== value) {
      throw new Error(`authorities.${key} must be ${value}.`);
    }
  }
}

function assertContractWorkflow(contract) {
  if (contract.workflow.dispatchMode !== "inline") {
    throw new Error("workflow.dispatchMode must be inline.");
  }
  if (contract.workflow.planningApprovalRequired !== true) {
    throw new Error("Planning approval must remain required.");
  }
  for (const field of [
    "taskLifecycle",
    "managedProjectPaths",
    "ignoredRuntimePaths",
    "forbiddenTrackedPaths",
  ]) {
    assertSafeProjectPaths(
      contract.workflow[field],
      `workflow.${field}`,
    );
  }
  for (const field of [
    "requiredLocalCommands",
    "requiredCiChecks",
    "definitionOfDone",
  ]) {
    assertStringArray(contract.qualityGates[field], `qualityGates.${field}`);
  }
}

function assertContractSecurity(contract) {
  if (contract.security.credentialFieldsForbidden !== true) {
    throw new Error("Credential fields must remain forbidden.");
  }
  if (
    contract.security.secretPolicy !==
    "environment-or-owned-secret-store"
  ) {
    throw new Error(
      "security.secretPolicy must use environment-or-owned-secret-store.",
    );
  }
  assertSafeProjectPaths(
    contract.security.forbiddenTrackedPaths,
    "security.forbiddenTrackedPaths",
  );
  if (contract.hooks.globalMutationAllowed !== false) {
    throw new Error("Global mutation must remain disabled.");
  }
  if (contract.ci.offlineByDefault !== true) {
    throw new Error("CI must remain offline by default.");
  }
}

function assertApprovedContract(contract) {
  if (contract.status !== "approved") {
    throw new Error(
      "Project contract must have status approved before initialization.",
    );
  }
  if (contract.unresolvedDecisions.length !== 0) {
    throw new Error(
      "Approved project contract cannot contain unresolved decisions.",
    );
  }
  for (const field of ["name", "purpose", "adoptionMode"]) {
    assertString(contract.project[field], `project.${field}`);
  }
  if (contract.project.repositoryRoot !== ".") {
    throw new Error("project.repositoryRoot must be '.'.");
  }
  assertString(
    contract.security.dataClassification,
    "security.dataClassification",
  );
  assertString(contract.security.networkPolicy, "security.networkPolicy");
  for (const field of [
    "dependencyPolicy",
    "updatePolicy",
    "rollbackPolicy",
    "uninstallPolicy",
  ]) {
    assertString(contract.source[field], `source.${field}`);
  }
  assertString(contract.approval.approvedBy, "approval.approvedBy");
  assertString(contract.approval.approvedAt, "approval.approvedAt");
  if (Number.isNaN(Date.parse(contract.approval.approvedAt))) {
    throw new Error("approval.approvedAt must be an ISO date-time.");
  }
}

function assertDraftProjectFields(contract) {
  for (const field of ["name", "purpose", "adoptionMode"]) {
    assertString(contract.project[field], `project.${field}`, {
      allowNull: contract.status === "draft",
    });
  }
}

export function validateProjectContract(
  contract,
  { requireApproved = false } = {},
) {
  assertObject(contract, "Project contract");
  assertNoCredentials(contract);
  if (contract.schemaVersion !== 1) {
    throw new Error("Project contract schemaVersion must be 1.");
  }
  if (!CONTRACT_STATUSES.has(contract.status)) {
    throw new Error("Project contract status is unsupported.");
  }

  assertContractObjects(contract);
  assertContractAuthorities(contract.authorities);
  assertContractWorkflow(contract);
  assertProviders(contract.providers);
  assertContractSecurity(contract);
  if (requireApproved) assertApprovedContract(contract);
  else assertDraftProjectFields(contract);
  return contract;
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readJson(target) {
  return JSON.parse(await readFile(target, "utf8"));
}

export async function applyProjectContract({
  repoRoot,
  contractPath,
  skillRoot,
}) {
  const root = path.resolve(repoRoot);
  const sourceSkill = path.resolve(skillRoot);
  const contract = await readJson(path.resolve(contractPath));
  validateProjectContract(contract, { requireApproved: true });
  const contractBytes = canonicalJson(contract);
  const harnessDir = path.join(root, ".harness");
  const projectPath = path.join(harnessDir, "project.json");
  assertInside(root, harnessDir, "Harness contract directory");

  if (await exists(harnessDir)) {
    if (await exists(projectPath)) {
      const currentBytes = canonicalJson(await readJson(projectPath));
      const ownershipPath = path.join(harnessDir, "ownership.json");
      if (
        currentBytes === contractBytes &&
        await exists(ownershipPath)
      ) {
        return {
          status: "unchanged",
          projectPath,
          contractSha256: sha256(contractBytes),
        };
      }
    }
    throw new Error(
      "The .harness path already exists and is treated as user-owned; refusing collision.",
    );
  }

  const schemaPath = path.join(
    sourceSkill,
    "assets",
    "project-contract.schema.json",
  );
  const schemaBytes = await readFile(schemaPath);
  const stageDir = path.join(root, `.harness-init-${randomUUID()}`);
  assertInside(root, stageDir, "Harness initialization staging directory");
  const ownership = {
    schemaVersion: 1,
    owner: "trellis-ccg-harness",
    contractSha256: sha256(contractBytes),
    managedPaths: [
      ".harness/ownership.json",
      ".harness/project.json",
      ".harness/project.schema.json",
    ],
  };

  try {
    await mkdir(stageDir, { mode: 0o700 });
    await writeFile(
      path.join(stageDir, "project.json"),
      contractBytes,
      { mode: 0o600 },
    );
    await writeFile(
      path.join(stageDir, "project.schema.json"),
      schemaBytes,
      { mode: 0o600 },
    );
    await writeFile(
      path.join(stageDir, "ownership.json"),
      canonicalJson(ownership),
      { mode: 0o600 },
    );
    await rename(stageDir, harnessDir);
  } catch (error) {
    await rm(stageDir, { recursive: true, force: true });
    if (error?.code === "EEXIST" || error?.code === "ENOTEMPTY") {
      throw new Error(
        "The .harness path already exists; refusing initialization collision.",
      );
    }
    throw error;
  }

  return {
    status: "applied",
    projectPath,
    contractSha256: ownership.contractSha256,
  };
}

export async function inspectProject(repoRoot) {
  const root = path.resolve(repoRoot);
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) {
    throw new Error(`Repository root is not a directory: ${root}`);
  }
  const manifests = [];
  for (const candidate of MANIFEST_CANDIDATES) {
    if (await exists(path.join(root, candidate))) manifests.push(candidate);
  }
  const harnessDir = path.join(root, ".harness");
  const harnessExists = await exists(harnessDir);
  const projectExists = await exists(path.join(harnessDir, "project.json"));
  return {
    repositoryRoot: root,
    manifests,
    gitPresent: await exists(path.join(root, ".git")),
    trellisPresent: await exists(path.join(root, ".trellis")),
    harnessState: projectExists
      ? "initialized"
      : harnessExists
        ? "partial"
        : "absent",
    harnessInitSkillPresent: await exists(
      path.join(root, ".agents", "skills", "harness-init", "SKILL.md"),
    ),
  };
}

export async function exportHarnessInitSkill({
  sourceSkillRoot,
  targetRepo,
}) {
  const source = path.resolve(sourceSkillRoot);
  const root = path.resolve(targetRepo);
  if (!(await exists(path.join(source, "SKILL.md")))) {
    throw new Error(`Harness Init Skill source is invalid: ${source}`);
  }
  const targetParent = path.join(root, ".agents", "skills");
  const target = path.join(targetParent, "harness-init");
  assertInside(root, target, "Harness Init Skill target");
  if (await exists(target)) {
    throw new Error(
      `Harness Init Skill target already exists; refusing collision: ${target}`,
    );
  }
  const stage = path.join(
    targetParent,
    `.harness-init-export-${randomUUID()}`,
  );
  await mkdir(targetParent, { recursive: true, mode: 0o700 });
  try {
    await cp(source, stage, {
      recursive: true,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
    });
    await rename(stage, target);
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
  return { status: "exported", target };
}

function requireOption(args, index, option) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function parseCliArgs(argv) {
  const [command, ...args] = argv;
  if (!["inspect", "validate", "apply", "export-skill"].includes(command)) {
    throw new Error(
      `Unknown Harness Init command: ${command ?? "(missing)"}.`,
    );
  }
  const result = {
    command,
    repoRoot: process.cwd(),
    contractPath: null,
    targetRepo: null,
  };
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (option === "--repo-root") {
      result.repoRoot = path.resolve(requireOption(args, index, option));
      index++;
    } else if (option === "--contract") {
      result.contractPath = path.resolve(requireOption(args, index, option));
      index++;
    } else if (option === "--target") {
      result.targetRepo = path.resolve(requireOption(args, index, option));
      index++;
    } else {
      throw new Error(`Unknown option for ${command}: ${option}`);
    }
  }
  if (["validate", "apply"].includes(command) && !result.contractPath) {
    throw new Error(`${command} requires --contract <path>.`);
  }
  if (command === "export-skill" && !result.targetRepo) {
    throw new Error("export-skill requires --target <repository>.");
  }
  return result;
}

const DEFAULT_SKILL_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export async function runHarnessInitCli(
  argv,
  {
    skillRoot = DEFAULT_SKILL_ROOT,
    stdout = process.stdout,
  } = {},
) {
  const args = parseCliArgs(argv);
  let result;
  if (args.command === "inspect") {
    result = await inspectProject(args.repoRoot);
  } else if (args.command === "validate") {
    const contract = await readJson(args.contractPath);
    validateProjectContract(contract);
    result = {
      status: "valid",
      contractStatus: contract.status,
      unresolvedDecisions: contract.unresolvedDecisions.length,
    };
  } else if (args.command === "apply") {
    result = await applyProjectContract({
      repoRoot: args.repoRoot,
      contractPath: args.contractPath,
      skillRoot,
    });
  } else {
    result = await exportHarnessInitSkill({
      sourceSkillRoot: skillRoot,
      targetRepo: args.targetRepo,
    });
  }
  stdout.write(canonicalJson(result));
  return result;
}

const invokedPath = process.argv[1]
  ? path.resolve(process.argv[1])
  : null;
if (invokedPath === path.resolve(fileURLToPath(import.meta.url))) {
  runHarnessInitCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`Harness Init failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
