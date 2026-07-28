import assert from "node:assert/strict";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { delimiter } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CURRENT_VERSION = "3.3.0";
const TARGET_VERSION = "3.3.1";

function write(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, value);
}

function writeCommand(binRoot, name, output) {
  if (process.platform === "win32") {
    write(path.join(binRoot, `${name}.cmd`), `@echo off\r\necho ${output}\r\n`);
    return;
  }
  const target = path.join(binRoot, name);
  write(target, `#!/bin/sh\nprintf '%s\\n' '${output}'\n`);
  chmodSync(target, 0o755);
}

function adapterReport(
  extraFinding = null,
  runtime = {
    status: "ok",
    actual: TARGET_VERSION,
    summary: "Installed personal CCG CLI is available.",
  },
  plugin = {
    status: "ok",
    actual: `${TARGET_VERSION}+codex.1`,
    available: [`${TARGET_VERSION}+codex.1`],
    summary: "Installed personal CCG Codex plugin cache is available.",
  },
) {
  const findings = [
    {
      id: "adapter-contract",
      severity: "blocking",
      status: "ok",
      summary: "Adapter contract is valid.",
    },
    {
      id: "source-manifest",
      severity: "blocking",
      status: "ok",
      summary: "Source manifest is valid.",
    },
    {
      id: "trellis-version",
      severity: "blocking",
      status: "ok",
      summary: "Trellis assets match.",
    },
    {
      id: "ccg-component-version",
      severity: "blocking",
      status: "ok",
      summary: "CCG component matches.",
    },
    {
      id: "ccg-source-tree",
      severity: "blocking",
      status: "ok",
      summary: "CCG tree matches.",
    },
    {
      id: "ccg-runtime-cli",
      severity: "blocking",
      status: runtime.status,
      summary: runtime.summary,
      evidence: { actual: runtime.actual },
    },
    {
      id: "ccg-plugin-cache",
      severity: "warning",
      status: plugin.status,
      summary: plugin.summary,
      evidence: {
        actual: plugin.actual,
        available: plugin.available,
      },
    },
  ];
  if (extraFinding) findings.push(extraFinding);
  const summary = {
    blocking: findings.filter(
      (finding) =>
        finding.status === "conflict" && finding.severity === "blocking",
    ).length,
    warning: findings.filter(
      (finding) =>
        finding.status === "conflict" && finding.severity === "warning",
    ).length,
    info: 0,
    ok: findings.filter((finding) => finding.status === "ok").length,
  };
  return {
    schemaVersion: 1,
    findings,
    summary,
    exitCode: summary.blocking > 0 ? 2 : 0,
  };
}

function fixture() {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "harness-doctor-"));
  const scriptsRoot = path.join(fixtureRoot, "scripts");
  const binRoot = path.join(fixtureRoot, "bin");
  mkdirSync(scriptsRoot, { recursive: true });
  mkdirSync(binRoot, { recursive: true });
  cpSync(path.join(ROOT, "scripts", "doctor.ps1"), path.join(scriptsRoot, "doctor.ps1"));
  write(
    path.join(fixtureRoot, "harness.sources.json"),
    `${JSON.stringify(
      {
        harness: {
          repository: "https://github.com/jed-zed/trellis-ccg-harness",
          visibility: "public",
        },
        trellis: { version: "0.6.9" },
        ccg: {
          snapshotPath: "components/ccg-workflow",
          version: CURRENT_VERSION,
        },
      },
      null,
      2,
    )}\n`,
  );
  write(
    path.join(scriptsRoot, "python-resolver.mjs"),
    'process.stdout.write(\'{"version":"3.12.0","command":"python"}\\n\');\n',
  );
  write(
    path.join(scriptsRoot, "verify-sources.ps1"),
    [
      "param(",
      "  [string]$RepoRoot,",
      "  [switch]$Index",
      ")",
      'Write-Output "Source verification passed."',
      "exit 0",
      "",
    ].join("\n"),
  );
  write(
    path.join(scriptsRoot, "harness-adapter.mjs"),
    [
      'import { readFileSync } from "node:fs";',
      'const report = JSON.parse(readFileSync(process.env.TEST_ADAPTER_REPORT, "utf8"));',
      'process.stdout.write(`${JSON.stringify(report)}\\n`);',
      "process.exitCode = report.exitCode;",
      "",
    ].join("\n"),
  );
  for (const [name, output] of [
    ["trellis", "0.6.9"],
    ["pnpm", "10.17.1"],
    ["go", "go version go1.26.5 test/amd64"],
    ["git", "https://github.com/jed-zed/trellis-ccg-harness.git"],
    ["gh", "false"],
  ]) {
    writeCommand(binRoot, name, output);
  }
  return {
    fixtureRoot,
    binRoot,
    writeReport(name, report) {
      const reportPath = path.join(fixtureRoot, name);
      write(reportPath, `${JSON.stringify(report, null, 2)}\n`);
      return reportPath;
    },
    cleanup() {
      rmSync(fixtureRoot, { recursive: true, force: true });
    },
  };
}

function runDoctor(value, reportPath, targetVersion = TARGET_VERSION) {
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(value.fixtureRoot, "scripts", "doctor.ps1"),
    "-RepoRoot",
    value.fixtureRoot,
  ];
  if (targetVersion !== null) {
    args.push("-CcgUpdateTargetVersion", targetVersion);
  }
  return spawnSync(
    "pwsh",
    args,
    {
      encoding: "utf8",
      shell: false,
      env: {
        ...process.env,
        PATH: `${value.binRoot}${delimiter}${process.env.PATH}`,
        TEST_ADAPTER_REPORT: reportPath,
      },
    },
  );
}

function runSetupDoctor(value, reportPath, previousPluginVersion) {
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(value.fixtureRoot, "scripts", "doctor.ps1"),
    "-RepoRoot",
    value.fixtureRoot,
    "-CcgUpdateTargetVersion",
    TARGET_VERSION,
    "-CcgSetupPreviousPluginVersion",
    previousPluginVersion,
  ];
  return spawnSync("pwsh", args, {
    encoding: "utf8",
    shell: false,
    env: {
      ...process.env,
      PATH: `${value.binRoot}${delimiter}${process.env.PATH}`,
      TEST_ADAPTER_REPORT: reportPath,
    },
  });
}

test("CCG doctor accepts owner-compatible versions while updates remain target-bound", () => {
  const value = fixture();
  try {
    const reportPath = value.writeReport("runtime-drift.json", adapterReport());
    const result = runDoctor(value, reportPath);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Installed personal CCG CLI is available/i);
    assert.match(result.stdout, /plugin cache includes update target/i);

    const ownerCompatibleReport = value.writeReport(
      "owner-compatible-runtime.json",
      adapterReport(null, {
        status: "ok",
        actual: "9.9.9",
        summary: "Installed personal CCG CLI is available.",
      }),
    );
    const strict = runDoctor(value, ownerCompatibleReport, null);
    assert.equal(strict.status, 0, `${strict.stdout}\n${strict.stderr}`);
    assert.match(
      strict.stdout,
      /Installed personal CCG CLI is available/i,
    );

    const unrelatedTarget = runDoctor(value, reportPath, "3.4.0");
    assert.notEqual(unrelatedTarget.status, 0);
    assert.match(
      `${unrelatedTarget.stdout}\n${unrelatedTarget.stderr}`,
      /Global CCG runtime must match update target 3\.4\.0/i,
    );

    const staleRuntimeReport = value.writeReport(
      "stale-runtime.json",
      adapterReport(null, {
        status: "ok",
        actual: CURRENT_VERSION,
        summary: "Installed personal CCG CLI is available.",
      }),
    );
    const staleRuntime = runDoctor(value, staleRuntimeReport);
    assert.notEqual(staleRuntime.status, 0);
    assert.match(
      `${staleRuntime.stdout}\n${staleRuntime.stderr}`,
      /global CCG runtime.*target 3\.3\.1|target.*runtime/i,
    );

    const missingPluginReport = value.writeReport(
      "missing-plugin.json",
      adapterReport(null, undefined, {
        status: "conflict",
        actual: "missing",
        available: [],
        summary: "Installed CCG plugin cache is missing.",
      }),
    );
    const missingPlugin = runDoctor(value, missingPluginReport);
    assert.notEqual(missingPlugin.status, 0);
    assert.match(
      `${missingPlugin.stdout}\n${missingPlugin.stderr}`,
      /plugin cache must include update target 3\.3\.1/i,
    );
  } finally {
    value.cleanup();
  }
});

test("CCG update doctor still fails closed on static adapter conflicts", () => {
  const value = fixture();
  try {
    const reportPath = value.writeReport(
      "static-conflict.json",
      adapterReport({
        id: "package-manager",
        severity: "blocking",
        status: "conflict",
        summary: "Package manager drift was detected.",
        evidence: { expected: "pnpm@10.17.1", actual: "npm@11" },
      }),
    );
    const result = runDoctor(value, reportPath);
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /package-manager|Layered adapter conflict audit exited with code 2/i,
    );
  } finally {
    value.cleanup();
  }
});

test("CCG update doctor still blocks interrupted transaction state", () => {
  const value = fixture();
  try {
    const reportPath = value.writeReport("runtime-drift.json", adapterReport());
    write(
      path.join(value.fixtureRoot, ".harness-cache", "transaction.lock"),
      "interrupted\n",
    );
    const result = runDoctor(value, reportPath);
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /Transaction lock residue found/i,
    );
  } finally {
    value.cleanup();
  }
});

test("CCG setup doctor permits only the exact preflight plugin transition", () => {
  const value = fixture();
  try {
    const missing = value.writeReport(
      "missing-plugin.json",
      adapterReport(null, undefined, {
        status: "conflict",
        actual: "missing",
        available: [],
        summary: "Installed CCG plugin cache is missing.",
      }),
    );
    const permittedMissing = runSetupDoctor(value, missing, "missing");
    assert.equal(
      permittedMissing.status,
      0,
      `${permittedMissing.stdout}\n${permittedMissing.stderr}`,
    );
    assert.match(
      permittedMissing.stdout,
      /permits the exact previous plugin identity missing/i,
    );

    const previousVersion = "3.3.0+codex.1";
    const previous = value.writeReport(
      "previous-plugin.json",
      adapterReport(null, undefined, {
        status: "conflict",
        actual: previousVersion,
        available: [previousVersion],
        summary: "Installed CCG plugin cache is mismatched.",
      }),
    );
    const permittedPrevious = runSetupDoctor(
      value,
      previous,
      previousVersion,
    );
    assert.equal(
      permittedPrevious.status,
      0,
      `${permittedPrevious.stdout}\n${permittedPrevious.stderr}`,
    );

    const wrongPrevious = runSetupDoctor(
      value,
      previous,
      "3.2.9+codex.1",
    );
    assert.notEqual(wrongPrevious.status, 0);
    assert.match(
      `${wrongPrevious.stdout}\n${wrongPrevious.stderr}`,
      /plugin cache must include update target/i,
    );
  } finally {
    value.cleanup();
  }
});
