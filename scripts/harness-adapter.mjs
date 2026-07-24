#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  auditConflicts,
  buildCanonicalContext,
  conflictExitCode,
  probeOpenAICompatibleGrok,
  redactString,
  redactValue,
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
  node scripts/harness-adapter.mjs grok-probe [--json] [--chat] [--search] [--live]

Notes:
  - context reads the active canonical Trellis task.
  - conflicts is offline; --ci skips user-level plugin and hook inspection.
  - grok-probe is explicit and may call a paid provider. It reads only
    HARNESS_GROK_BASE_URL, HARNESS_GROK_API_KEY, and HARNESS_GROK_MODEL.
`);
}

function handleContext() {
  printJson(buildCanonicalContext(repoRoot));
}

function handleConflicts(args) {
  const report = auditConflicts(repoRoot, {
    includeUserState: !hasFlag(args, "--ci"),
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

const COMMAND_HANDLERS = new Map([
  ["context", handleContext],
  ["conflicts", handleConflicts],
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
