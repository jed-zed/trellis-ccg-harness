#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  auditConflicts,
  buildProductManagerStatus,
  buildCanonicalContext,
  conflictExitCode,
  presentProductManagerGate,
  resolveCurrentTask,
  probeOpenAICompatibleGrok,
  redactString,
  redactValue,
  respondToProductManagerGate,
  runInstalledProductManagerReview,
  syncProductManagerPlan,
} from "./lib/harness-adapter.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function hasFlag(args, flag) {
  return args.includes(flag);
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printConflictReport(report) {
  for (const finding of report.findings) {
    const label =
      finding.status === "ok"
        ? "PASS"
        : finding.severity === "blocking"
          ? "BLOCK"
          : finding.severity === "warning"
            ? "WARN"
            : "INFO";
    process.stdout.write(
      `${label.padEnd(5)} ${finding.id}: ${finding.summary}\n`,
    );
    if (finding.status !== "ok" && finding.evidence !== undefined) {
      process.stdout.write(
        `      evidence: ${JSON.stringify(finding.evidence)}\n`,
      );
    }
    if (finding.status !== "ok" && finding.action) {
      process.stdout.write(`      action: ${finding.action}\n`);
    }
  }
  const summary = report.summary;
  process.stdout.write(
    `\nSummary: ${summary.blocking} blocking, ${summary.warning} warning, ` +
      `${summary.info} info, ${summary.ok} passed\n`,
  );
}

function usage() {
  process.stdout.write(`Harness adapter

Usage:
  node scripts/harness-adapter.mjs context [--json]
  node scripts/harness-adapter.mjs conflicts [--json] [--ci] [--index]
  node scripts/harness-adapter.mjs pm <status|sync-plan|review|respond|final-eligibility>
  node scripts/harness-adapter.mjs grok-probe [--json] [--chat] [--search] [--live]

Notes:
  - context reads the active canonical Trellis task.
  - conflicts is offline; --ci skips user-level plugin and hook inspection.
  - grok-probe is explicit and may call a paid provider. It reads only
    HARNESS_GROK_BASE_URL, HARNESS_GROK_API_KEY, and HARNESS_GROK_MODEL.
`);
}

function optionValue(args, name) {
  const direct = args.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function handleContext() {
  printJson(buildCanonicalContext(repoRoot));
}

async function handleConflicts(args) {
  const deterministicCi = hasFlag(args, "--ci");
  const report = await auditConflicts(repoRoot, {
    includeRuntimeState: !deterministicCi,
    includeUserState: !deterministicCi,
    treeish: hasFlag(args, "--index") ? "INDEX" : "HEAD",
  });
  if (hasFlag(args, "--json")) {
    printJson(report);
  } else {
    printConflictReport(report);
  }
  process.exitCode = conflictExitCode(report);
}

async function handleGrokProbe(args) {
  const contract = JSON.parse(
    readFileSync(path.join(repoRoot, ".harness", "adapter.json"), "utf8"),
  );
  const live = hasFlag(args, "--live");
  const report = await probeOpenAICompatibleGrok(contract, {
    includeChat: live || hasFlag(args, "--chat"),
    includeSearch: live || hasFlag(args, "--search"),
  });
  printJson(report);
  const attemptedChecks = [report.models, report.chat, report.search].filter(
    Boolean,
  );
  const failed = attemptedChecks.some(
    (check) =>
      check.ok === false ||
      ("sourceBacked" in check && check.sourceBacked === false),
  );
  if (report.configured && failed) {
    process.exitCode = 2;
  }
}

async function handleProductManager(args) {
  const [action, ...options] = args;
  if (!action) {
    throw new Error(
      "pm requires status, sync-plan, review, present, respond, or final-eligibility.",
    );
  }
  const task = resolveCurrentTask(repoRoot);
  if (action === "sync-plan") {
    printJson(syncProductManagerPlan(task.directory));
    return;
  }
  if (action === "status") {
    printJson(buildProductManagerStatus(task.directory));
    return;
  }
  if (action === "final-eligibility") {
    printJson(buildProductManagerStatus(task.directory).finalEligibility);
    return;
  }
  if (action === "present") {
    const revision = Number(optionValue(options, "--state-revision"));
    if (!Number.isSafeInteger(revision)) {
      throw new Error("pm present requires --state-revision.");
    }
    printJson(
      presentProductManagerGate(task.directory, {
        expectedRevision: revision,
      }),
    );
    return;
  }
  if (action === "respond") {
    const response = optionValue(options, "--response");
    const revision = Number(optionValue(options, "--state-revision"));
    if (!response || !Number.isSafeInteger(revision)) {
      throw new Error(
        "pm respond requires --response and --state-revision.",
      );
    }
    printJson(
      respondToProductManagerGate(task.directory, {
        response,
        expectedRevision: revision,
      }),
    );
    return;
  }
  if (action === "review") {
    const triggerType = optionValue(options, "--trigger");
    const checkpointId = optionValue(options, "--checkpoint");
    if (!triggerType || !checkpointId) {
      throw new Error(
        "pm review requires --trigger and --checkpoint.",
      );
    }
    const evidenceRefs = options
      .flatMap((value, index) =>
        value === "--evidence" ? [options[index + 1]] : [],
      )
      .filter(Boolean);
    const grillHandoffPath = optionValue(
      options,
      "--grill-handoff",
    );
    let grillHandoff = null;
    if (grillHandoffPath) {
      const absoluteHandoff = path.resolve(grillHandoffPath);
      const relativeHandoff = path.relative(
        task.directory,
        absoluteHandoff,
      );
      if (
        !relativeHandoff ||
        relativeHandoff.startsWith("..") ||
        path.isAbsolute(relativeHandoff)
      ) {
        throw new Error(
          "GRILL_HANDOFF must be a file inside the active Trellis task.",
        );
      }
      grillHandoff = JSON.parse(
        readFileSync(absoluteHandoff, "utf8"),
      );
    }
    printJson(
      await runInstalledProductManagerReview(repoRoot, task.directory, {
        triggerType,
        checkpointId,
        evidenceRefs,
        grillHandoff,
        responseFile: optionValue(options, "--provider-response"),
        allowProviderCall: hasFlag(options, "--allow-provider-call"),
      }),
    );
    return;
  }
  throw new Error(`Unknown pm action: ${action}`);
}

const COMMAND_HANDLERS = new Map([
  ["context", handleContext],
  ["conflicts", handleConflicts],
  ["pm", handleProductManager],
  ["grok-probe", handleGrokProbe],
]);

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || hasFlag(args, "--help") || hasFlag(args, "-h")) {
    usage();
    return;
  }
  const handler = COMMAND_HANDLERS.get(command);
  if (!handler) {
    throw new Error(`Unknown Harness adapter command: ${command}`);
  }
  await handler(args);
}

main().catch((error) => {
  const safe = redactValue({
    error: redactString(error?.message ?? String(error)),
  });
  process.stderr.write(`${JSON.stringify(safe, null, 2)}\n`);
  process.exitCode = 2;
});
