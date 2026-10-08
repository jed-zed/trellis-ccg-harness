import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  materializeGitTree,
  verifyMaterializedGitTree,
} from "../scripts/lib/git-tree-materializer.mjs";

const COMPONENT = "components/ccg-workflow";

test("CCG import survives normal Git add and clone with exact blobs and executable modes", async (t) => {
  const temporaryRoot = path.resolve(tmpdir());
  const root = mkdtempSync(path.join(temporaryRoot, "ccg-source-roundtrip-"));
  const source = path.join(root, "fixture source");
  const harness = path.join(root, "fixture Harness");
  const clone = path.join(root, "fresh clone");
  const emptyConfig = path.join(root, "empty.gitconfig");
  const emptyAttributes = path.join(root, "empty.attributes");
  writeFileSync(emptyConfig, "");
  writeFileSync(emptyAttributes, "");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name)),
  );
  Object.assign(env, {
    HOME: root,
    USERPROFILE: root,
    XDG_CONFIG_HOME: path.join(root, "xdg"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: emptyConfig,
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_ATTR_NOSYSTEM: "1",
  });
  const execute = (command, args, options = {}) => {
    assert.equal(command, "git");
    const result = spawnSync(command, [
      ...[source, harness, clone].flatMap((repo) => ["-c", `safe.directory=${repo}`]),
      "-c", "core.longpaths=true",
      "-c", `core.attributesFile=${emptyAttributes}`,
      ...args,
    ], {
      cwd: options.cwd,
      env,
      encoding: options.encoding === null ? null : "utf8",
      input: options.input,
      maxBuffer: options.maxBuffer,
      timeout: 60_000,
      shell: false,
      windowsHide: true,
    });
    assert.equal(result.status, 0, [
      result.error?.message,
      `${command} ${args.join(" ")}`,
      String(result.stderr ?? ""),
    ].filter(Boolean).join("\n"));
    if (!options.capture) return "";
    return options.encoding === null
      ? Buffer.from(result.stdout ?? [])
      : String(result.stdout ?? "");
  };
  const git = (repo, args) => execute("git", ["-C", repo, ...args], { capture: true }).trim();
  const initialize = (repo, autocrlf) => {
    mkdirSync(repo);
    git(repo, ["init"]);
    git(repo, ["config", "user.email", "ccg-roundtrip@example.invalid"]);
    git(repo, ["config", "user.name", "CCG Roundtrip Fixture"]);
    git(repo, ["config", "core.autocrlf", String(autocrlf)]);
    git(repo, ["config", "core.fileMode", "false"]);
    git(repo, ["config", "core.safecrlf", "false"]);
    git(repo, ["config", "commit.gpgsign", "false"]);
  };
  const files = new Map([
    ["package.json", Buffer.from('{\r\n  "name": "fixture-ccg-source",\r\n  "version": "1.0.0"\r\n}\r\n')],
    ["docs/README.md", Buffer.from("# Reviewed source fixture\r\n\r\nKeep these CRLF bytes.\r\n")],
    ["bin/ccg.mjs", Buffer.from("#!/usr/bin/env node\nconsole.log('fixture source only')\n")],
    ["scripts/check.sh", Buffer.from("#!/bin/sh\nprintf 'fixture source only\\n'\n")],
  ]);
  const executableFiles = ["bin/ccg.mjs", "scripts/check.sh"];
  try {
    initialize(source, false);
    for (const [relative, bytes] of files) {
      const target = path.join(source, ...relative.split("/"));
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, bytes);
      if (process.platform !== "win32" && executableFiles.includes(relative)) {
        chmodSync(target, 0o755);
      }
    }
    git(source, ["add", "."]);
    // Windows has no filesystem execute bit; record the real source Git modes.
    git(source, ["update-index", "--chmod=+x", "--", ...executableFiles]);
    git(source, ["commit", "-m", "Fixture-only CCG source with mixed line endings"]);
    const sourceCommit = git(source, ["rev-parse", "HEAD"]);
    const sourceTree = git(source, ["rev-parse", "HEAD^{tree}"]);

    initialize(harness, true);
    writeFileSync(
      path.join(harness, ".gitattributes"),
      readFileSync(new URL("../.gitattributes", import.meta.url)),
    );
    // Existing Harness snapshots have LF blobs and real executable index modes.
    // Starting with source CRLF blobs in the index would hide text=auto's bug:
    // Git deliberately leaves already-indexed CRLF blobs unnormalized.
    for (const [relative, bytes] of files) {
      const target = path.join(harness, COMPONENT, ...relative.split("/"));
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, bytes.toString("utf8").replaceAll("\r\n", "\n"));
    }
    git(harness, ["add", "."]);
    git(harness, ["update-index", "--chmod=+x", "--", ...executableFiles.map((relative) => `${COMPONENT}/${relative}`)]);
    git(harness, ["commit", "-m", "Fixture-only previous LF Harness snapshot"]);
    // Transfer actual local objects, without a remote or a fabricated tree.
    git(harness, ["fetch", "--no-tags", source, sourceCommit]);
    const componentRoot = path.join(harness, COMPONENT);
    assert.equal(path.relative(harness, componentRoot).replaceAll("\\", "/"), COMPONENT);
    rmSync(componentRoot, { recursive: true });
    const materialized = await materializeGitTree({
      checkout: source,
      commit: sourceCommit,
      destination: componentRoot,
      execute,
    });
    assert.equal(materialized.files, files.size);
    assert.deepEqual(
      materialized.entries.filter((entry) => entry.mode === "100755").map((entry) => entry.path),
      executableFiles,
    );
    // A normal add must preserve both the authoritative blobs and seeded Git modes.
    git(harness, ["add", "--", COMPONENT]);
    const importedTree = git(harness, ["write-tree"]);
    const componentTree = git(harness, ["rev-parse", `${importedTree}:${COMPONENT}`]);
    t.diagnostic(JSON.stringify({ sourceCommit, sourceTree, componentTree }));
    assert.equal(componentTree, sourceTree, "normal Git add changed the authoritative CCG subtree");
    git(harness, ["commit", "-m", "Fixture-only Harness source import"]);
    const importCommit = git(harness, ["rev-parse", "HEAD"]);

    execute("git", [
      "clone", "--no-local", "--no-hardlinks", "--no-checkout",
      "-c", "core.autocrlf=true", "-c", "core.fileMode=false",
      harness, clone,
    ]);
    git(clone, ["checkout", "--detach", importCommit]);
    assert.equal(git(clone, ["rev-parse", `HEAD:${COMPONENT}`]), sourceTree);
    await verifyMaterializedGitTree(path.join(clone, COMPONENT), materialized.entries);
    const hashes = {};
    for (const [relative, expected] of files) {
      const filename = path.join(clone, COMPONENT, ...relative.split("/"));
      const actual = readFileSync(filename);
      assert.deepEqual(actual, expected, `clone changed bytes: ${relative}`);
      hashes[relative] = createHash("sha256").update(actual).digest("hex");
      if (executableFiles.includes(relative)) {
        assert.match(git(clone, ["ls-files", "--stage", "--", `${COMPONENT}/${relative}`]), /^100755 /);
        if (process.platform !== "win32") assert.notEqual(statSync(filename).mode & 0o111, 0);
      }
    }
    assert.equal(git(clone, ["status", "--porcelain", "--untracked-files=all", "--", COMPONENT]), "");
    git(clone, ["add", "--", COMPONENT]);
    const repeatedTree = git(clone, ["write-tree"]);
    assert.equal(git(clone, ["rev-parse", `${repeatedTree}:${COMPONENT}`]), sourceTree);
    assert.equal(git(clone, ["status", "--porcelain", "--untracked-files=all", "--", COMPONENT]), "");
    t.diagnostic(JSON.stringify({ importCommit, cleanComponent: true, executableFiles, sha256: hashes }));
  } finally {
    const relative = path.relative(temporaryRoot, path.resolve(root));
    assert.ok(relative && !path.isAbsolute(relative) && !relative.startsWith(".."));
    assert.match(path.basename(root), /^ccg-source-roundtrip-/);
    rmSync(root, { recursive: true, force: true });
  }
});
