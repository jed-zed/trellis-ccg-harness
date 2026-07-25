import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  materializeGitTree,
  verifyMaterializedGitTree,
} from "../scripts/lib/git-tree-materializer.mjs";

function execute(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: options.encoding === null ? null : "utf8",
    input: options.input,
    maxBuffer: options.maxBuffer,
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${result.stderr}`,
    );
  }
  if (!options.capture) return "";
  return options.encoding === null
    ? Buffer.from(result.stdout ?? [])
    : String(result.stdout ?? "");
}

function git(repo, args) {
  return execute("git", ["-C", repo, ...args], { capture: true }).trim();
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "git tree with spaces-"));
  const repo = path.join(root, "source repo");
  mkdirSync(repo);
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "test@example.invalid"]);
  git(repo, ["config", "user.name", "Harness Test"]);
  writeFileSync(path.join(repo, "package.json"), '{"name":"fixture"}\n');
  mkdirSync(path.join(repo, "bin"));
  writeFileSync(path.join(repo, "bin", "tool.mjs"), "#!/usr/bin/env node\n");
  if (process.platform !== "win32") {
    chmodSync(path.join(repo, "bin", "tool.mjs"), 0o755);
  }
  writeFileSync(path.join(repo, "keep.txt"), "tracked\n");
  writeFileSync(path.join(repo, "large.bin"), Buffer.alloc(2 * 1024 * 1024, 7));
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "fixture"]);
  return {
    root,
    repo,
    commit: git(repo, ["rev-parse", "HEAD"]),
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("Git tree materialization is path, blob, and mode bound", async () => {
  const value = fixture();
  const destination = path.join(value.root, "candidate output");
  try {
    const materialized = await materializeGitTree({
      checkout: value.repo,
      commit: value.commit,
      destination,
      execute,
    });
    assert.equal(materialized.files, 4);
    assert.match(materialized.manifestSha256, /^[a-f0-9]{64}$/);

    writeFileSync(path.join(destination, "keep.txt"), "changed\n");
    await assert.rejects(
      verifyMaterializedGitTree(destination, materialized.entries),
      /blob mismatch/i,
    );
    writeFileSync(path.join(destination, "keep.txt"), "tracked\n");

    rmSync(path.join(destination, "package.json"));
    await assert.rejects(
      verifyMaterializedGitTree(destination, materialized.entries),
      /missing package\.json/i,
    );
    writeFileSync(path.join(destination, "package.json"), '{"name":"fixture"}\n');

    writeFileSync(path.join(destination, "extra.txt"), "extra\n");
    await assert.rejects(
      verifyMaterializedGitTree(destination, materialized.entries),
      /extra extra\.txt/i,
    );
    rmSync(path.join(destination, "extra.txt"));

    if (process.platform !== "win32") {
      chmodSync(path.join(destination, "bin", "tool.mjs"), 0o644);
      await assert.rejects(
        verifyMaterializedGitTree(destination, materialized.entries),
        /executable mode mismatch/i,
      );
    }
  } finally {
    value.cleanup();
  }
});

test("materialization excludes protected literal paths before checkout", async () => {
  const value = fixture();
  const destination = path.join(value.root, "projection");
  try {
    const materialized = await materializeGitTree({
      checkout: value.repo,
      commit: value.commit,
      destination,
      exclusions: ["keep.txt"],
      execute,
    });
    assert.equal(
      materialized.entries.some((entry) => entry.path === "keep.txt"),
      false,
    );
    assert.equal(materialized.files, 3);
  } finally {
    value.cleanup();
  }
});
