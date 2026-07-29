import { existsSync } from "node:fs";
import path from "node:path";

import {
  assertInside,
  defaultRunner,
  readJson,
  readTextIfPresent,
  relativePosix,
  runCommand,
  sha256,
} from "./process.mjs";
import {
  isSecretKeyName,
  redactString,
  redactValue,
} from "./redaction.mjs";
import { resolvePython } from "../python-resolver.mjs";

function runCurrentTaskCommand(
  repoRoot,
  runner,
  env,
  pythonCandidates,
  platform,
) {
  const configuredPython = env.HARNESS_PYTHON?.trim();
  const python = resolvePython({
    configuredCommand: configuredPython,
    platform,
    ...(pythonCandidates
      ? {
          candidates: pythonCandidates.map((command) => ({
            command,
            argsPrefix: [],
          })),
        }
      : {}),
    runner: (command, args) =>
      runCommand(command, args, { repoRoot, runner, env }),
  });
  const scriptPath = path.join(repoRoot, ".trellis", "scripts", "task.py");
  const result = runCommand(
    python.command,
    [...python.argsPrefix, scriptPath, "current"],
    { repoRoot, runner, env },
  );
  return {
    result,
    usedPython: [
      python.command,
      ...python.argsPrefix,
    ].join(" "),
  };
}

function assertTaskCommandSucceeded(result) {
  if (result.status === 0 && result.stdout) {
    return;
  }
  const detail = result.stderr || result.stdout;
  const noActiveTask =
    (result.status === 1 && !detail && !result.error) ||
    /no (?:active|current) task/i.test(detail);
  const error = new Error(
    detail
      ? redactString(detail)
      : noActiveTask
        ? "Trellis has no active task for this session."
        : "Trellis task resolution failed without diagnostics.",
  );
  error.code = noActiveTask
    ? "NO_ACTIVE_TASK"
    : "TASK_RESOLUTION_FAILED";
  throw error;
}

function loadTask(repoRoot, relativeTaskPath, usedPython) {
  const taskRoot = path.resolve(repoRoot, ".trellis", "tasks");
  const taskDirectory = path.resolve(repoRoot, relativeTaskPath);
  assertInside(taskRoot, taskDirectory, "Active Trellis task");
  const taskJsonPath = path.join(taskDirectory, "task.json");
  if (!existsSync(taskJsonPath)) {
    const error = new Error(
      `Active Trellis task is missing task.json: ${relativePosix(repoRoot, taskDirectory)}`,
    );
    error.code = "TASK_METADATA_MISSING";
    throw error;
  }
  return {
    python: usedPython,
    directory: taskDirectory,
    relativeDirectory: relativePosix(repoRoot, taskDirectory),
    metadata: readJson(taskJsonPath),
  };
}

export function resolveCurrentTask(
  repoRoot,
  {
    runner = defaultRunner,
    env = process.env,
    pythonCandidates,
    platform = process.platform,
  } = {},
) {
  const { result, usedPython } = runCurrentTaskCommand(
    repoRoot,
    runner,
    env,
    pythonCandidates,
    platform,
  );
  assertTaskCommandSucceeded(result);
  return loadTask(repoRoot, result.stdout, usedPython);
}

function collectArtifacts(repoRoot, taskDirectory) {
  const artifacts = {};
  for (const name of ["prd.md", "design.md", "implement.md"]) {
    const artifactPath = path.join(taskDirectory, name);
    const contents = readTextIfPresent(artifactPath);
    if (contents !== null) {
      artifacts[name] = {
        path: relativePosix(repoRoot, artifactPath),
        sha256: sha256(contents),
      };
    }
  }
  return artifacts;
}

export function collectProductManagerSummary(
  repoRoot,
  taskDirectory,
  taskId,
) {
  const statePath = path.join(taskDirectory, "product-manager.json");
  const contents = readTextIfPresent(statePath);
  if (contents === null) return null;
  const state = JSON.parse(contents);
  if (
    state?.schemaVersion !== 1 ||
    state.taskId !== taskId ||
    !Number.isSafeInteger(state.stateRevision) ||
    !Number.isSafeInteger(state.planRevision)
  ) {
    throw new Error(
      "Canonical product-manager.json is malformed or belongs to another Trellis task.",
    );
  }
  return {
    path: relativePosix(repoRoot, statePath),
    sha256: sha256(contents),
    stateRevision: state.stateRevision,
    planRevision: state.planRevision,
    planDigest: state.planDigest,
    progress: state.progress,
    currentGate: state.currentGate
      ? {
          kind: state.currentGate.kind,
          checkpointId: state.currentGate.checkpointId,
          status: state.currentGate.status,
          presentationRequired:
            state.currentGate.presentationRequired === true,
          presentedAt: state.currentGate.presentedAt ?? null,
        }
      : null,
    nextAction: state.nextAction,
    latestAdvice: state.latestAdvice
      ? {
          ...state.latestAdvice,
          stale: state.latestAdvice.planRevision !== state.planRevision,
        }
      : null,
  };
}

function summarizeProviders(providers) {
  return Object.fromEntries(
    Object.entries(providers).map(([name, provider]) => [
      name,
      Object.fromEntries(
        Object.entries(provider).filter(
          ([key]) => !isSecretKeyName(key),
        ),
      ),
    ]),
  );
}

export function buildCanonicalContext(
  repoRoot,
  {
    runner = defaultRunner,
    env = process.env,
    pythonPlatform = process.platform,
    taskResolver = resolveCurrentTask,
  } = {},
) {
  const contract = readJson(path.join(repoRoot, ".harness", "adapter.json"));
  const sources = readJson(path.join(repoRoot, "harness.sources.json"));
  const task = taskResolver(repoRoot, {
    runner,
    env,
    platform: pythonPlatform,
  });
  const context = {
    schemaVersion: contract.schemaVersion,
    harness: contract.harness.definition,
    authorities: contract.authorities,
    task: {
      id: task.metadata.id,
      title: task.metadata.title,
      status: task.metadata.status,
      path: task.relativeDirectory,
      artifacts: collectArtifacts(repoRoot, task.directory),
      productManager: collectProductManagerSummary(
        repoRoot,
        task.directory,
        task.metadata.id,
      ),
    },
    sources: {
      trellis: {
        package: sources.trellis.package,
        version: sources.trellis.version,
      },
      ccg: {
        package: sources.ccg.package,
        version: sources.ccg.version,
        repository: sources.ccg.authoritativeRepository,
        commit: sources.ccg.commit,
        gitTree: sources.ccg.gitTree,
        snapshotPath: sources.ccg.snapshotPath,
      },
    },
    runtime: contract.runtime,
    models: contract.models,
    routing: contract.routing,
    providers: summarizeProviders(contract.providers),
  };

  return redactValue(context);
}
