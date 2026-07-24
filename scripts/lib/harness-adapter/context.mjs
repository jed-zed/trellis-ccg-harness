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

function runCurrentTaskCommand(
  repoRoot,
  runner,
  env,
  pythonCandidates,
) {
  const configuredPython = env.HARNESS_PYTHON?.trim();
  const candidates = pythonCandidates ?? [
    ...(configuredPython ? [configuredPython] : []),
    "python",
    "python3",
  ];
  const scriptPath = path.join(repoRoot, ".trellis", "scripts", "task.py");
  for (const candidate of [...new Set(candidates)]) {
    const result = runCommand(
      candidate,
      [scriptPath, "current"],
      { repoRoot, runner, env },
    );
    if (result.error?.code !== "ENOENT") {
      return { result, usedPython: candidate };
    }
  }
  const error = new Error("Python executable was not found.");
  error.code = "PYTHON_MISSING";
  throw error;
}

function assertTaskCommandSucceeded(result) {
  if (result.status === 0 && result.stdout) {
    return;
  }
  const detail = result.stderr || result.stdout;
  const error = new Error(
    detail
      ? redactString(detail)
      : "Trellis has no active task for this session.",
  );
  error.code =
    /no (?:active|current) task|not found/i.test(detail)
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
  } = {},
) {
  const { result, usedPython } = runCurrentTaskCommand(
    repoRoot,
    runner,
    env,
    pythonCandidates,
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
    taskResolver = resolveCurrentTask,
  } = {},
) {
  const contract = readJson(path.join(repoRoot, ".harness", "adapter.json"));
  const sources = readJson(path.join(repoRoot, "harness.sources.json"));
  const task = taskResolver(repoRoot, { runner, env });
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
    providers: summarizeProviders(contract.providers),
  };

  return redactValue(context);
}
