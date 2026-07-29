import { homedir } from "node:os";
import path from "node:path";

import {
  conflictExitCode,
  makeFinding,
  summarizeFindings,
} from "./conflict-utils.mjs";
import {
  runCcgRuntimeCheck,
  runInformationalChecks,
  runUserStateChecks,
} from "./conflict-runtime.mjs";
import {
  runPolicyChecks,
  runStateAndTaskChecks,
  runVersionAndSourceChecks,
} from "./conflict-static.mjs";
import { resolveCurrentTask } from "./context.mjs";
import {
  defaultAsyncRunner,
  defaultRunner,
  readJson,
} from "./process.mjs";
import { redactString, redactValue } from "./redaction.mjs";

function createAddFinding(findings) {
  return (...args) => {
    const [id, severity, status, summary, evidence, action] = args;
    findings.push(
      makeFinding({ id, severity, status, summary, evidence, action }),
    );
  };
}

function loadAdapterContract(repoRoot, add) {
  try {
    const contract = readJson(
      path.join(repoRoot, ".harness", "adapter.json"),
    );
    const supported = contract.schemaVersion === 1;
    add(
      "adapter-contract",
      "blocking",
      supported ? "ok" : "conflict",
      supported
        ? "Harness adapter contract schema is supported."
        : "Harness adapter contract schema is unsupported.",
      { schemaVersion: contract.schemaVersion },
      "Restore a schemaVersion 1 adapter contract.",
    );
    return contract;
  } catch (error) {
    add(
      "adapter-contract",
      "blocking",
      "conflict",
      "Harness adapter contract is missing or invalid.",
      redactString(error.message),
      "Restore .harness/adapter.json.",
    );
    return null;
  }
}

function loadSourceManifest(repoRoot, add) {
  try {
    const sources = readJson(path.join(repoRoot, "harness.sources.json"));
    add(
      "source-manifest",
      "blocking",
      "ok",
      "Harness source manifest is readable.",
    );
    return sources;
  } catch (error) {
    add(
      "source-manifest",
      "blocking",
      "conflict",
      "Harness source manifest is missing or invalid.",
      redactString(error.message),
      "Restore harness.sources.json.",
    );
    return null;
  }
}

function loadContracts(repoRoot, findings) {
  const add = createAddFinding(findings);
  return {
    contract: loadAdapterContract(repoRoot, add),
    sources: loadSourceManifest(repoRoot, add),
  };
}

function buildReport(schemaVersion, findings) {
  const redactedFindings = redactValue(findings);
  const report = {
    schemaVersion: schemaVersion ?? 1,
    findings: redactedFindings,
    summary: summarizeFindings(redactedFindings),
  };
  report.exitCode = conflictExitCode(report);
  return report;
}

export { conflictExitCode };

export async function auditConflicts(
  repoRoot,
  {
    runner = defaultRunner,
    runtimeRunner,
    env = process.env,
    homeDir = homedir(),
    includeRuntimeState = true,
    includeUserState = true,
    treeish = "HEAD",
    taskResolver = resolveCurrentTask,
  } = {},
) {
  const findings = [];
  const { contract, sources } = loadContracts(repoRoot, findings);
  if (!contract || !sources) {
    return buildReport(contract?.schemaVersion, findings);
  }
  const add = createAddFinding(findings);
  const shared = { repoRoot, contract, sources, add, runner, env };

  runVersionAndSourceChecks({ ...shared, treeish });
  runStateAndTaskChecks({ ...shared, taskResolver });
  runPolicyChecks(shared);
  await runCcgRuntimeCheck({
    ...shared,
    runner:
      runtimeRunner ??
      (runner === defaultRunner ? defaultAsyncRunner : runner),
    includeRuntimeState,
  });
  runUserStateChecks({
    ...shared,
    homeDir,
    includeUserState,
  });
  runInformationalChecks(shared);

  return buildReport(contract.schemaVersion, findings);
}
