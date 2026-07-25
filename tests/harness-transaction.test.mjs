import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  acquireTransactionLock,
  recoverInterruptedTransaction,
  replaceComponentTransaction,
  replaceManagedFilesTransaction,
  rollbackLastTransaction,
} from "../scripts/lib/harness-transaction.mjs";
import {
  buildOwnedUninstallPlan,
} from "../scripts/lib/harness-lifecycle.mjs";

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
      mergeBaseWithOriginalAtCapture: "e".repeat(40),
      personalOnlyCommitsAtCapture: 26,
      originalOnlyCommitsAtCapture: 25,
    },
  });
  return {
    repoRoot,
    candidate,
    cleanup: () => rmSync(repoRoot, { recursive: true, force: true }),
  };
}

function git(repoRoot, args) {
  const result = spawnSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    shell: false,
  });
  assert.equal(
    result.status,
    0,
    [result.stdout, result.stderr].filter(Boolean).join("\n"),
  );
  return String(result.stdout ?? "").trim();
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

function spawnInterruptedTransaction({
  operation,
  repoRoot,
  candidate,
  marker,
  boundary = null,
}) {
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
    const onTransactionBoundary = async (name, details) => {
      if (name !== ${JSON.stringify(boundary)}) return;
      if (name === "copy-in-progress") {
        const fs = await import("node:fs/promises");
        await fs.mkdir(details.stagedComponent, { recursive: true });
        await fs.writeFile(
          (await import("node:path")).join(
            details.stagedComponent,
            "partial-copy.txt",
          ),
          "partial\\n",
        );
      }
      await pause();
    };
    if (${JSON.stringify(operation)} === "replace") {
      await api.replaceComponentTransaction({
        repoRoot: ${JSON.stringify(repoRoot)},
        candidateDir: ${JSON.stringify(candidate)},
        commit: ${JSON.stringify("c".repeat(40))},
        gitTree: ${JSON.stringify("d".repeat(40))},
        onTransactionBoundary,
        ...(${JSON.stringify(boundary)} === null
          ? { afterReplace: pause }
          : {}),
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

function managedFilesFixture() {
  const value = fixture();
  const candidateRoot = path.join(value.repoRoot, "trellis-candidate");
  mkdirSync(path.join(value.repoRoot, ".trellis"), { recursive: true });
  mkdirSync(
    path.join(value.repoRoot, ".agents", "skills", "trellis-start"),
    { recursive: true },
  );
  mkdirSync(path.join(candidateRoot, ".trellis"), { recursive: true });
  mkdirSync(
    path.join(candidateRoot, ".agents", "skills", "trellis-start"),
    { recursive: true },
  );
  mkdirSync(path.join(candidateRoot, ".codex", "agents"), {
    recursive: true,
  });
  writeFileSync(path.join(value.repoRoot, ".trellis", ".version"), "0.6.8\n");
  writeFileSync(
    path.join(
      value.repoRoot,
      ".agents",
      "skills",
      "trellis-start",
      "SKILL.md",
    ),
    "old\n",
  );
  writeFileSync(path.join(candidateRoot, ".trellis", ".version"), "0.6.9\n");
  writeFileSync(
    path.join(
      candidateRoot,
      ".agents",
      "skills",
      "trellis-start",
      "SKILL.md",
    ),
    "new\n",
  );
  writeFileSync(
    path.join(candidateRoot, ".codex", "agents", "trellis-new.toml"),
    "name = \"new\"\n",
  );
  return {
    ...value,
    candidateRoot,
    managedPaths: [
      ".trellis/.version",
      ".agents/skills/trellis-start/SKILL.md",
      ".codex/agents/trellis-new.toml",
    ],
  };
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

test("a failed final-path gate restores the component behind a global link", async () => {
  const value = fixture();
  const globalRoot = mkdtempSync(path.join(tmpdir(), "global link with spaces-"));
  const globalEntry = path.join(globalRoot, "ccg-workflow");
  try {
    const component = path.join(
      value.repoRoot,
      "components",
      "ccg-workflow",
    );
    writeFileSync(path.join(component, "cli.txt"), "old-cli\n");
    writeFileSync(path.join(value.candidate, "cli.txt"), "new-cli\n");
    symlinkSync(
      component,
      globalEntry,
      process.platform === "win32" ? "junction" : "dir",
    );

    await assert.rejects(
      replaceComponentTransaction({
        repoRoot: value.repoRoot,
        candidateDir: value.candidate,
        commit: "c".repeat(40),
        gitTree: "d".repeat(40),
        afterReplace: () => {
          assert.equal(
            readFileSync(path.join(globalEntry, "cli.txt"), "utf8"),
            "new-cli\n",
          );
          throw new Error("simulated final build failure");
        },
      }),
      /simulated final build failure/,
    );
    assert.equal(
      readFileSync(path.join(globalEntry, "cli.txt"), "utf8"),
      "old-cli\n",
    );
  } finally {
    value.cleanup();
    rmSync(globalRoot, { recursive: true, force: true });
  }
});

test("component replacement rejects symbolic links and junctions", async () => {
  const value = fixture();
  try {
    const outside = path.join(value.repoRoot, "outside");
    mkdirSync(outside);
    writeFileSync(path.join(outside, "secret.txt"), "outside\n");
    symlinkSync(
      outside,
      path.join(value.candidate, "linked-outside"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(
      replaceComponentTransaction({
        repoRoot: value.repoRoot,
        candidateDir: value.candidate,
        commit: "c".repeat(40),
        gitTree: "d".repeat(40),
      }),
      /symbolic link|junction|reparse/i,
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

test("replacement removes stale comparison counters and rollback restores them", async () => {
  const value = fixture();
  const manifestPath = path.join(value.repoRoot, "harness.sources.json");
  const staleFields = [
    "mergeBaseWithOriginalAtCapture",
    "personalOnlyCommitsAtCapture",
    "originalOnlyCommitsAtCapture",
  ];
  try {
    const originalManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    await replaceComponentTransaction({
      repoRoot: value.repoRoot,
      candidateDir: value.candidate,
      commit: "c".repeat(40),
      gitTree: "d".repeat(40),
    });

    const updatedManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (const field of staleFields) {
      assert.equal(Object.hasOwn(updatedManifest.ccg, field), false);
    }

    await rollbackLastTransaction({ repoRoot: value.repoRoot });
    const restoredManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (const field of staleFields) {
      assert.equal(
        restoredManifest.ccg[field],
        originalManifest.ccg[field],
      );
    }
  } finally {
    value.cleanup();
  }
});

test("a successful replacement prunes the superseded rollback snapshot", async () => {
  const value = fixture();
  try {
    await replaceComponentTransaction({
      repoRoot: value.repoRoot,
      candidateDir: value.candidate,
      commit: "c".repeat(40),
      gitTree: "d".repeat(40),
    });
    await replaceComponentTransaction({
      repoRoot: value.repoRoot,
      candidateDir: value.candidate,
      commit: "e".repeat(40),
      gitTree: "f".repeat(40),
    });

    const record = JSON.parse(
      readFileSync(
        path.join(
          value.repoRoot,
          ".harness-cache",
          "last-transaction.json",
        ),
        "utf8",
      ),
    );
    const snapshotsRoot = path.join(
      value.repoRoot,
      ".harness-cache",
      "snapshots",
    );
    assert.deepEqual(
      readdirSync(snapshotsRoot).sort(),
      [path.basename(record.snapshotPath)],
    );
  } finally {
    value.cleanup();
  }
});

for (const dirtyCase of [
  {
    name: "modified tracked file",
    mutate(value) {
      writeFileSync(
        path.join(value.repoRoot, "components", "ccg-workflow", "version.txt"),
        "user-modified\n",
      );
    },
  },
  {
    name: "staged tracked file",
    mutate(value) {
      writeFileSync(
        path.join(value.repoRoot, "components", "ccg-workflow", "version.txt"),
        "user-staged\n",
      );
      git(value.repoRoot, ["add", "components/ccg-workflow/version.txt"]);
    },
  },
  {
    name: "untracked file",
    mutate(value) {
      writeFileSync(
        path.join(value.repoRoot, "components", "ccg-workflow", "notes.txt"),
        "user-note\n",
      );
    },
  },
  {
    name: "ignored file",
    mutate(value) {
      const ignored = path.join(
        value.repoRoot,
        "components",
        "ccg-workflow",
        "ignored",
      );
      mkdirSync(ignored);
      writeFileSync(path.join(ignored, "user.cache"), "important\n");
    },
  },
  {
    name: "renamed file",
    mutate(value) {
      renameSync(
        path.join(value.repoRoot, "components", "ccg-workflow", "version.txt"),
        path.join(value.repoRoot, "components", "ccg-workflow", "renamed.txt"),
      );
    },
  },
]) {
  test(`rollback refuses a ${dirtyCase.name} without mutating state`, async () => {
    const value = fixture();
    try {
      writeFileSync(
        path.join(value.repoRoot, ".gitignore"),
        "components/ccg-workflow/ignored/\n.harness-cache/\n",
      );
      git(value.repoRoot, ["init"]);
      git(value.repoRoot, ["config", "user.email", "test@example.invalid"]);
      git(value.repoRoot, ["config", "user.name", "Harness Test"]);
      git(value.repoRoot, ["add", "."]);
      git(value.repoRoot, ["commit", "-m", "fixture"]);
      await replaceComponentTransaction({
        repoRoot: value.repoRoot,
        candidateDir: value.candidate,
        commit: "c".repeat(40),
        gitTree: "d".repeat(40),
      });
      dirtyCase.mutate(value);

      const componentPath = path.join(
        value.repoRoot,
        "components",
        "ccg-workflow",
      );
      const manifestPath = path.join(value.repoRoot, "harness.sources.json");
      const recordPath = path.join(
        value.repoRoot,
        ".harness-cache",
        "last-transaction.json",
      );
      const record = JSON.parse(readFileSync(recordPath, "utf8"));
      const snapshotMarker = path.join(
        value.repoRoot,
        record.snapshotPath,
        "component",
        "version.txt",
      );
      const manifestBefore = readFileSync(manifestPath, "utf8");
      const recordBefore = readFileSync(recordPath, "utf8");
      const indexBefore = git(value.repoRoot, ["write-tree"]);
      const stagedBefore = git(value.repoRoot, [
        "diff",
        "--cached",
        "--name-status",
      ]);
      const surfaceBefore = git(value.repoRoot, [
        "status",
        "--porcelain",
        "--ignored",
        "--",
        componentPath,
      ]);

      await assert.rejects(
        rollbackLastTransaction({ repoRoot: value.repoRoot }),
        /component changed|refusing rollback/i,
      );

      assert.equal(readFileSync(manifestPath, "utf8"), manifestBefore);
      assert.equal(readFileSync(recordPath, "utf8"), recordBefore);
      assert.equal(readFileSync(snapshotMarker, "utf8"), "old\n");
      assert.equal(git(value.repoRoot, ["write-tree"]), indexBefore);
      assert.equal(
        git(value.repoRoot, ["diff", "--cached", "--name-status"]),
        stagedBefore,
      );
      assert.equal(
        git(value.repoRoot, [
          "status",
          "--porcelain",
          "--ignored",
          "--",
          componentPath,
        ]),
        surfaceBefore,
      );
    } finally {
      value.cleanup();
    }
  });
}

test("rollback rejects malformed or redirected records before mutation", async () => {
  for (const mutateRecord of [
    (record) => ({ ...record, unexpected: true }),
    (record) => ({ ...record, snapshotPath: "../outside" }),
    (record) => ({ ...record, schemaVersion: 999 }),
    (record) => ({
      ...record,
      current: { ...record.current, manifestSha256: "0".repeat(64) },
    }),
  ]) {
    const value = fixture();
    try {
      await replaceComponentTransaction({
        repoRoot: value.repoRoot,
        candidateDir: value.candidate,
        commit: "c".repeat(40),
        gitTree: "d".repeat(40),
      });
      const manifestPath = path.join(value.repoRoot, "harness.sources.json");
      const recordPath = path.join(
        value.repoRoot,
        ".harness-cache",
        "last-transaction.json",
      );
      const componentPath = path.join(
        value.repoRoot,
        "components",
        "ccg-workflow",
        "version.txt",
      );
      const record = JSON.parse(readFileSync(recordPath, "utf8"));
      writeJson(recordPath, mutateRecord(record));
      const manifestBefore = readFileSync(manifestPath, "utf8");
      const componentBefore = readFileSync(componentPath, "utf8");
      const recordBefore = readFileSync(recordPath, "utf8");

      await assert.rejects(
        rollbackLastTransaction({ repoRoot: value.repoRoot }),
        /schema|invalid|snapshot|manifest|unsupported/i,
      );
      assert.equal(readFileSync(manifestPath, "utf8"), manifestBefore);
      assert.equal(readFileSync(componentPath, "utf8"), componentBefore);
      assert.equal(readFileSync(recordPath, "utf8"), recordBefore);
    } finally {
      value.cleanup();
    }
  }
});

test("transaction state rejects a cache junction before external mutation", async () => {
  const value = fixture();
  const outside = mkdtempSync(path.join(tmpdir(), "harness-outside-"));
  const sentinel = path.join(outside, "sentinel.txt");
  try {
    writeFileSync(sentinel, "unchanged\n");
    symlinkSync(
      outside,
      path.join(value.repoRoot, ".harness-cache"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(
      replaceComponentTransaction({
        repoRoot: value.repoRoot,
        candidateDir: value.candidate,
        commit: "c".repeat(40),
        gitTree: "d".repeat(40),
      }),
      /symbolic link|junction|regular directory/i,
    );
    assert.equal(readFileSync(sentinel, "utf8"), "unchanged\n");
  } finally {
    value.cleanup();
    rmSync(outside, { recursive: true, force: true });
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

for (const boundary of [
  "before-journal",
  "copy-in-progress",
  "before-current-rename",
]) {
  test(`replacement recovery is deterministic after hard kill at ${boundary}`, async () => {
    const value = fixture();
    const marker = path.join(value.repoRoot, `${boundary}-ready`);
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
        boundary,
      });
      await waitForFile(marker, child);
      child.kill();
      await once(child, "exit");

      const result = await recoverInterruptedTransaction({
        repoRoot: value.repoRoot,
        isProcessAlive: () => false,
      });
      assert.equal(
        result.outcome,
        boundary === "before-journal"
          ? "stale-lock-cleared"
          : "rolled-back",
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
        readFileSync(
          path.join(value.repoRoot, "harness.sources.json"),
          "utf8",
        ),
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
          path.join(
            value.repoRoot,
            ".harness-cache",
            "transaction.lock",
          ),
        ),
        false,
      );
    } finally {
      value.cleanup();
    }
  });
}

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
    writeJson(lockPath, {
      schemaVersion: 2,
      pid: 424242,
      createdAt: new Date().toISOString(),
      token: "00000000-0000-4000-8000-000000000000",
      repoRoot: value.repoRoot,
    });
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

test("managed Trellis files update and roll back through the shared lifecycle", async () => {
  const value = managedFilesFixture();
  try {
    const record = await replaceManagedFilesTransaction({
      repoRoot: value.repoRoot,
      candidateRoot: value.candidateRoot,
      paths: value.managedPaths,
      kind: "trellis",
      previous: { version: "0.6.8", integrity: "sha512-old" },
      current: { version: "0.6.9", integrity: "sha512-new" },
    });
    assert.equal(record.operation, "managed-files");
    assert.equal(
      readFileSync(path.join(value.repoRoot, ".trellis", ".version"), "utf8"),
      "0.6.9\n",
    );
    assert.equal(
      readFileSync(
        path.join(
          value.repoRoot,
          ".codex",
          "agents",
          "trellis-new.toml",
        ),
        "utf8",
      ),
      "name = \"new\"\n",
    );

    const rolledBack = await rollbackLastTransaction({
      repoRoot: value.repoRoot,
    });
    assert.equal(rolledBack.status, "rolled-back");
    assert.equal(
      readFileSync(path.join(value.repoRoot, ".trellis", ".version"), "utf8"),
      "0.6.8\n",
    );
    assert.equal(
      existsSync(
        path.join(
          value.repoRoot,
          ".codex",
          "agents",
          "trellis-new.toml",
        ),
      ),
      false,
    );
  } finally {
    value.cleanup();
  }
});

test("managed rollback refuses post-update edits without touching its snapshot", async () => {
  const value = managedFilesFixture();
  try {
    await replaceManagedFilesTransaction({
      repoRoot: value.repoRoot,
      candidateRoot: value.candidateRoot,
      paths: value.managedPaths,
      kind: "trellis",
      previous: { version: "0.6.8", integrity: "sha512-old" },
      current: { version: "0.6.9", integrity: "sha512-new" },
    });
    const versionPath = path.join(value.repoRoot, ".trellis", ".version");
    const recordPath = path.join(
      value.repoRoot,
      ".harness-cache",
      "last-transaction.json",
    );
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    const snapshotVersion = path.join(
      value.repoRoot,
      record.snapshotPath,
      "files",
      ".trellis",
      ".version",
    );
    writeFileSync(versionPath, "user-edited\n");
    const recordBefore = readFileSync(recordPath, "utf8");

    await assert.rejects(
      rollbackLastTransaction({ repoRoot: value.repoRoot }),
      /managed path changed|refusing rollback/i,
    );
    assert.equal(readFileSync(versionPath, "utf8"), "user-edited\n");
    assert.equal(readFileSync(snapshotVersion, "utf8"), "0.6.8\n");
    assert.equal(readFileSync(recordPath, "utf8"), recordBefore);
  } finally {
    value.cleanup();
  }
});

test("managed file recovery restores all originals after an interrupted apply", async () => {
  const value = managedFilesFixture();
  const marker = path.join(value.repoRoot, "managed-ready");
  try {
    const source = `
      const api = await import(${JSON.stringify(TRANSACTION_MODULE)});
      await api.replaceManagedFilesTransaction({
        repoRoot: ${JSON.stringify(value.repoRoot)},
        candidateRoot: ${JSON.stringify(value.candidateRoot)},
        paths: ${JSON.stringify(value.managedPaths)},
        kind: "trellis",
        previous: { version: "0.6.8", integrity: "sha512-old" },
        current: { version: "0.6.9", integrity: "sha512-new" },
        afterApply: async () => {
          (await import("node:fs/promises")).writeFile(
            ${JSON.stringify(marker)},
            "ready\\n",
          );
          setInterval(() => {}, 1000);
          await new Promise(() => {});
        },
      });
    `;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", source],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    await waitForFile(marker, child);
    child.kill();
    await once(child, "exit");

    const result = await recoverInterruptedTransaction({
      repoRoot: value.repoRoot,
      isProcessAlive: () => false,
    });
    assert.equal(result.operation, "managed-files");
    assert.equal(result.outcome, "rolled-back");
    assert.equal(
      readFileSync(path.join(value.repoRoot, ".trellis", ".version"), "utf8"),
      "0.6.8\n",
    );
    assert.equal(
      existsSync(
        path.join(
          value.repoRoot,
          ".codex",
          "agents",
          "trellis-new.toml",
        ),
      ),
      false,
    );
  } finally {
    value.cleanup();
  }
});

test("managed file recovery reverses an interrupted rollback", async () => {
  const value = managedFilesFixture();
  const marker = path.join(value.repoRoot, "managed-rollback-ready");
  try {
    await replaceManagedFilesTransaction({
      repoRoot: value.repoRoot,
      candidateRoot: value.candidateRoot,
      paths: value.managedPaths,
      kind: "trellis",
      previous: { version: "0.6.8", integrity: "sha512-old" },
      current: { version: "0.6.9", integrity: "sha512-new" },
    });
    const source = `
      const api = await import(${JSON.stringify(TRANSACTION_MODULE)});
      await api.rollbackLastTransaction({
        repoRoot: ${JSON.stringify(value.repoRoot)},
        afterRestore: async () => {
          (await import("node:fs/promises")).writeFile(
            ${JSON.stringify(marker)},
            "ready\\n",
          );
          setInterval(() => {}, 1000);
          await new Promise(() => {});
        },
      });
    `;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", source],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    await waitForFile(marker, child);
    child.kill();
    await once(child, "exit");

    const result = await recoverInterruptedTransaction({
      repoRoot: value.repoRoot,
      isProcessAlive: () => false,
    });
    assert.equal(result.operation, "managed-files-rollback");
    assert.equal(result.outcome, "rolled-back");
    assert.equal(
      readFileSync(path.join(value.repoRoot, ".trellis", ".version"), "utf8"),
      "0.6.9\n",
    );

    await rollbackLastTransaction({ repoRoot: value.repoRoot });
    assert.equal(
      readFileSync(path.join(value.repoRoot, ".trellis", ".version"), "utf8"),
      "0.6.8\n",
    );
  } finally {
    value.cleanup();
  }
});

test("managed file updates reject candidate parent links and junctions", async () => {
  const value = managedFilesFixture();
  try {
    const outside = path.join(value.repoRoot, "outside-managed");
    mkdirSync(outside);
    writeFileSync(
      path.join(outside, "trellis-new.toml"),
      "name = \"outside\"\n",
    );
    rmSync(path.join(value.candidateRoot, ".codex", "agents"), {
      recursive: true,
      force: true,
    });
    symlinkSync(
      outside,
      path.join(value.candidateRoot, ".codex", "agents"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await assert.rejects(
      replaceManagedFilesTransaction({
        repoRoot: value.repoRoot,
        candidateRoot: value.candidateRoot,
        paths: value.managedPaths,
        kind: "trellis",
        previous: { version: "0.6.8" },
        current: { version: "0.6.9" },
      }),
      /symbolic link|junction|regular directory|path component/i,
    );
  } finally {
    value.cleanup();
  }
});

test("managed recovery preserves a directory created after process death", async () => {
  const value = managedFilesFixture();
  const marker = path.join(value.repoRoot, "managed-directory-ready");
  const managedTarget = path.join(
    value.repoRoot,
    ".codex",
    "agents",
    "trellis-new.toml",
  );
  try {
    const source = `
      const api = await import(${JSON.stringify(TRANSACTION_MODULE)});
      await api.replaceManagedFilesTransaction({
        repoRoot: ${JSON.stringify(value.repoRoot)},
        candidateRoot: ${JSON.stringify(value.candidateRoot)},
        paths: ${JSON.stringify(value.managedPaths)},
        kind: "trellis",
        previous: { version: "0.6.8" },
        current: { version: "0.6.9" },
        afterApply: async () => {
          await (await import("node:fs/promises")).writeFile(
            ${JSON.stringify(marker)},
            "ready\\n",
          );
          setInterval(() => {}, 1000);
          await new Promise(() => {});
        },
      });
    `;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", source],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    await waitForFile(marker, child);
    child.kill();
    await once(child, "exit");

    rmSync(managedTarget, { force: true });
    mkdirSync(managedTarget);
    writeFileSync(path.join(managedTarget, "keep.txt"), "user-owned\n");

    await assert.rejects(
      recoverInterruptedTransaction({
        repoRoot: value.repoRoot,
        isProcessAlive: () => false,
      }),
      /regular file|directory|managed/i,
    );
    assert.equal(
      readFileSync(path.join(managedTarget, "keep.txt"), "utf8"),
      "user-owned\n",
    );
    assert.equal(
      existsSync(
        path.join(
          value.repoRoot,
          ".harness-cache",
          "transaction-journal.json",
        ),
      ),
      true,
    );
  } finally {
    value.cleanup();
  }
});

test("managed file updates reject paths outside the Trellis-owned surface", async () => {
  const value = managedFilesFixture();
  try {
    mkdirSync(path.join(value.candidateRoot, "docs"), { recursive: true });
    writeFileSync(
      path.join(value.candidateRoot, "docs", "user-owned.md"),
      "replace\n",
    );
    await assert.rejects(
      replaceManagedFilesTransaction({
        repoRoot: value.repoRoot,
        candidateRoot: value.candidateRoot,
        paths: ["docs/user-owned.md"],
        kind: "trellis",
        previous: { version: "0.6.8" },
        current: { version: "0.6.9" },
      }),
      /managed|allowed|surface/i,
    );
  } finally {
    value.cleanup();
  }
});

test("uninstall planning only selects unchanged Harness-owned global state", () => {
  const repoRoot = path.resolve("C:/harness");
  const snapshot = (overrides = {}) => {
    const value = {
      version: "1.0.0",
      entryPath: path.resolve("C:/npm/root/package"),
      entryIdentity: { dev: "1", ino: "2", birthtimeNs: "3" },
      packageJsonSha256: "a".repeat(64),
      contentIdentity: {
        algorithm: "sha256-tree-v1",
        digest: "b".repeat(64),
        entryCount: 2,
      },
      ...overrides,
    };
    if (value.sourcePath !== undefined) delete value.contentIdentity;
    return value;
  };
  const ccgInstalled = snapshot({
    version: "3.3.0",
    sourcePath: path.resolve("C:/personal/ccg"),
  });
  const trellisInstalled = snapshot({ version: "0.6.8" });
  const plan = buildOwnedUninstallPlan(
    {
      schemaVersion: 2,
      repoRoot,
      updatedAt: new Date().toISOString(),
      entries: [
        {
          id: "ccg-link",
          kind: "npm-global-link",
          package: "ccg-workflow",
          originalBeforeFirstManagement: null,
          installedByHarness: ccgInstalled,
        },
        {
          id: "trellis-global",
          kind: "npm-global-package",
          package: "@mindfoldhq/trellis",
          originalBeforeFirstManagement: null,
          installedByHarness: trellisInstalled,
        },
      ],
    },
    {
      "ccg-link": {
        ...ccgInstalled,
        sourcePath: path.resolve("C:/different/ccg"),
      },
      "trellis-global": trellisInstalled,
    },
    repoRoot,
  );
  assert.deepEqual(plan.remove.map((entry) => entry.id), ["trellis-global"]);
  assert.deepEqual(plan.skip.map((entry) => entry.id), ["ccg-link"]);
});
