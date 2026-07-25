import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  acquireTransactionLock,
  buildOwnedUninstallPlan,
  recoverInterruptedTransaction,
  replaceComponentTransaction,
  rollbackLastTransaction,
} from "../scripts/lib/harness-transaction.mjs";

const TRANSACTION_MODULE = pathToFileURL(
  path.resolve("scripts", "lib", "harness-transaction.mjs"),
).href;

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture() {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "harness-transaction-"));
  const component = path.join(repoRoot, "components", "ccg-workflow");
  const candidate = path.join(repoRoot, "candidate");
  mkdirSync(component, { recursive: true });
  mkdirSync(candidate, { recursive: true });
  writeFileSync(path.join(component, "version.txt"), "old\n");
  writeFileSync(path.join(candidate, "version.txt"), "new\n");
  writeJson(path.join(candidate, "package.json"), {
    name: "ccg-workflow",
    version: "3.3.1",
  });
  writeFileSync(path.join(repoRoot, "user-settings.json"), '{"keep":true}\n');
  writeJson(path.join(repoRoot, "harness.sources.json"), {
    schemaVersion: 1,
    ccg: {
      package: "ccg-workflow",
      snapshotPath: "components/ccg-workflow",
      commit: "a".repeat(40),
      gitTree: "b".repeat(40),
    },
  });
  return {
    repoRoot,
    candidate,
    cleanup: () => rmSync(repoRoot, { recursive: true, force: true }),
  };
}

async function waitForFile(filePath, child) {
  const deadline = Date.now() + 10_000;
  while (!existsSync(filePath)) {
    if (child.exitCode !== null) {
      throw new Error(`Crash fixture exited before creating ${filePath}.`);
    }
    if (Date.now() >= deadline) {
      child.kill();
      throw new Error(`Timed out waiting for ${filePath}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function spawnInterruptedTransaction({ operation, repoRoot, candidate, marker }) {
  const source = `
    const api = await import(${JSON.stringify(TRANSACTION_MODULE)});
    const pause = async () => {
      (await import("node:fs/promises")).writeFile(
        ${JSON.stringify(marker)},
        "ready\\n",
      );
      setInterval(() => {}, 1000);
      await new Promise(() => {});
    };
    if (${JSON.stringify(operation)} === "replace") {
      await api.replaceComponentTransaction({
        repoRoot: ${JSON.stringify(repoRoot)},
        candidateDir: ${JSON.stringify(candidate)},
        commit: ${JSON.stringify("c".repeat(40))},
        gitTree: ${JSON.stringify("d".repeat(40))},
        afterReplace: pause,
      });
    } else {
      await api.rollbackLastTransaction({
        repoRoot: ${JSON.stringify(repoRoot)},
        afterRestore: pause,
      });
    }
  `;
  return spawn(process.execPath, ["--input-type=module", "-e", source], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("component replacement rolls back every owned path after interruption", async () => {
  const value = fixture();
  try {
    const manifestBefore = readFileSync(
      path.join(value.repoRoot, "harness.sources.json"),
      "utf8",
    );
    await assert.rejects(
      replaceComponentTransaction({
        repoRoot: value.repoRoot,
        candidateDir: value.candidate,
        commit: "c".repeat(40),
        gitTree: "d".repeat(40),
        afterReplace: () => {
          throw new Error("simulated interruption");
        },
      }),
      /simulated interruption/,
    );
    assert.equal(
      readFileSync(
        path.join(
          value.repoRoot,
          "components",
          "ccg-workflow",
          "version.txt",
        ),
        "utf8",
      ),
      "old\n",
    );
    assert.equal(
      readFileSync(path.join(value.repoRoot, "harness.sources.json"), "utf8"),
      manifestBefore,
    );
    assert.equal(
      readFileSync(path.join(value.repoRoot, "user-settings.json"), "utf8"),
      '{"keep":true}\n',
    );
  } finally {
    value.cleanup();
  }
});

test("component replacement rejects repository/runtime metadata before activation", async () => {
  const value = fixture();
  try {
    mkdirSync(path.join(value.candidate, ".git"), { recursive: true });
    await assert.rejects(
      replaceComponentTransaction({
        repoRoot: value.repoRoot,
        candidateDir: value.candidate,
        commit: "c".repeat(40),
        gitTree: "d".repeat(40),
      }),
      /forbidden candidate path.*\.git/i,
    );
    assert.equal(
      readFileSync(
        path.join(value.repoRoot, "components", "ccg-workflow", "version.txt"),
        "utf8",
      ),
      "old\n",
    );
  } finally {
    value.cleanup();
  }
});

test("rollback restores the last verified snapshot without touching user files", async () => {
  const value = fixture();
  try {
    await replaceComponentTransaction({
      repoRoot: value.repoRoot,
      candidateDir: value.candidate,
      commit: "c".repeat(40),
      gitTree: "d".repeat(40),
    });
    assert.equal(
      readFileSync(
        path.join(
          value.repoRoot,
          "components",
          "ccg-workflow",
          "version.txt",
        ),
        "utf8",
      ),
      "new\n",
    );

    await rollbackLastTransaction({ repoRoot: value.repoRoot });

    assert.equal(
      readFileSync(
        path.join(
          value.repoRoot,
          "components",
          "ccg-workflow",
          "version.txt",
        ),
        "utf8",
      ),
      "old\n",
    );
    assert.equal(
      readFileSync(path.join(value.repoRoot, "user-settings.json"), "utf8"),
      '{"keep":true}\n',
    );
  } finally {
    value.cleanup();
  }
});

test("rollback interruption restores the current component and keeps the snapshot", async () => {
  const value = fixture();
  try {
    await replaceComponentTransaction({
      repoRoot: value.repoRoot,
      candidateDir: value.candidate,
      commit: "c".repeat(40),
      gitTree: "d".repeat(40),
    });
    const manifestBeforeRollback = readFileSync(
      path.join(value.repoRoot, "harness.sources.json"),
      "utf8",
    );
    await assert.rejects(
      rollbackLastTransaction({
        repoRoot: value.repoRoot,
        afterRestore: () => {
          throw new Error("simulated rollback gate failure");
        },
      }),
      /simulated rollback gate failure/,
    );
    assert.equal(
      readFileSync(
        path.join(value.repoRoot, "components", "ccg-workflow", "version.txt"),
        "utf8",
      ),
      "new\n",
    );
    assert.equal(
      readFileSync(path.join(value.repoRoot, "harness.sources.json"), "utf8"),
      manifestBeforeRollback,
    );
  } finally {
    value.cleanup();
  }
});

test("transaction lock is exclusive and explicitly released", async () => {
  const value = fixture();
  try {
    const first = await acquireTransactionLock(value.repoRoot);
    await assert.rejects(acquireTransactionLock(value.repoRoot), /lock|running/i);
    await first.release();
    const second = await acquireTransactionLock(value.repoRoot);
    await second.release();
  } finally {
    value.cleanup();
  }
});

test("explicit recovery restores the previous component after process death", async () => {
  const value = fixture();
  const marker = path.join(value.repoRoot, "replace-ready");
  try {
    const manifestBefore = readFileSync(
      path.join(value.repoRoot, "harness.sources.json"),
      "utf8",
    );
    const child = spawnInterruptedTransaction({
      operation: "replace",
      repoRoot: value.repoRoot,
      candidate: value.candidate,
      marker,
    });
    await waitForFile(marker, child);
    child.kill();
    await once(child, "exit");

    assert.ok(
      existsSync(
        path.join(
          value.repoRoot,
          ".harness-cache",
          "transaction-journal.json",
        ),
      ),
    );
    const result = await recoverInterruptedTransaction({
      repoRoot: value.repoRoot,
      isProcessAlive: () => false,
    });

    assert.equal(result.operation, "replacement");
    assert.equal(result.outcome, "rolled-back");
    assert.equal(
      readFileSync(
        path.join(value.repoRoot, "components", "ccg-workflow", "version.txt"),
        "utf8",
      ),
      "old\n",
    );
    assert.equal(
      readFileSync(path.join(value.repoRoot, "harness.sources.json"), "utf8"),
      manifestBefore,
    );
    assert.equal(
      existsSync(
        path.join(
          value.repoRoot,
          ".harness-cache",
          "transaction-journal.json",
        ),
      ),
      false,
    );
    assert.equal(
      existsSync(
        path.join(value.repoRoot, ".harness-cache", "transaction.lock"),
      ),
      false,
    );
  } finally {
    value.cleanup();
  }
});

test("explicit recovery reverses an interrupted rollback after process death", async () => {
  const value = fixture();
  const marker = path.join(value.repoRoot, "rollback-ready");
  try {
    await replaceComponentTransaction({
      repoRoot: value.repoRoot,
      candidateDir: value.candidate,
      commit: "c".repeat(40),
      gitTree: "d".repeat(40),
    });
    const manifestBeforeRollback = readFileSync(
      path.join(value.repoRoot, "harness.sources.json"),
      "utf8",
    );

    const child = spawnInterruptedTransaction({
      operation: "rollback",
      repoRoot: value.repoRoot,
      candidate: value.candidate,
      marker,
    });
    await waitForFile(marker, child);
    child.kill();
    await once(child, "exit");

    const result = await recoverInterruptedTransaction({
      repoRoot: value.repoRoot,
      isProcessAlive: () => false,
    });
    assert.equal(result.operation, "rollback");
    assert.equal(result.outcome, "rolled-back");
    assert.equal(
      readFileSync(
        path.join(value.repoRoot, "components", "ccg-workflow", "version.txt"),
        "utf8",
      ),
      "new\n",
    );
    assert.equal(
      readFileSync(path.join(value.repoRoot, "harness.sources.json"), "utf8"),
      manifestBeforeRollback,
    );
  } finally {
    value.cleanup();
  }
});

test("explicit recovery clears a stale lock but refuses a live owner", async () => {
  const value = fixture();
  const lockPath = path.join(
    value.repoRoot,
    ".harness-cache",
    "transaction.lock",
  );
  try {
    mkdirSync(path.dirname(lockPath), { recursive: true });
    writeJson(lockPath, { pid: 424242, createdAt: new Date().toISOString() });
    await assert.rejects(
      recoverInterruptedTransaction({
        repoRoot: value.repoRoot,
        isProcessAlive: () => true,
      }),
      /still running/i,
    );
    const result = await recoverInterruptedTransaction({
      repoRoot: value.repoRoot,
      isProcessAlive: () => false,
    });
    assert.equal(result.outcome, "stale-lock-cleared");
    assert.equal(existsSync(lockPath), false);
  } finally {
    value.cleanup();
  }
});

test("uninstall planning only selects unchanged Harness-owned global state", () => {
  const plan = buildOwnedUninstallPlan(
    {
      entries: [
        {
          id: "ccg-link",
          kind: "npm-global-link",
          package: "ccg-workflow",
          sourcePath: "C:/personal/ccg",
        },
        {
          id: "trellis",
          kind: "npm-global-package",
          package: "@mindfoldhq/trellis",
          version: "0.6.8",
        },
      ],
    },
    {
      "ccg-link": { sourcePath: "C:/different/ccg" },
      trellis: { version: "0.6.8" },
    },
  );
  assert.deepEqual(plan.remove.map((entry) => entry.id), ["trellis"]);
  assert.deepEqual(plan.skip.map((entry) => entry.id), ["ccg-link"]);
});
