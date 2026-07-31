import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  fingerprintPinnedMcpTree,
  launchThirdPartyMcp,
  parseThirdPartyMcpLauncherArgs,
} from "../.agents/skills/harness-init/scripts/third-party-mcp-launcher.mjs";

const manifest = JSON.parse(readFileSync(new URL("../.agents/skills/harness-init/assets/third-party-sources.json", import.meta.url), "utf8"));
const candidate = manifest.candidates.find((entry) => entry.id === "codegraph");
const { name: packageName } = /^(?<name>(?:@[^/@]+\/)?[^@/]+)@latest$/.exec(candidate.packageSelector).groups;
const packageVersion = "9.9.9";
const packageIntegrity = `sha512-${Buffer.from("resolved-latest-package").toString("base64")}`;

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function fixture() {
  const homeDir = mkdtempSync(path.join(os.tmpdir(), "harness-mcp-launcher-"));
  const candidateId = candidate.id;
  const target = path.join(homeDir, ".agents", "harness", "tools", candidateId, "latest");
  const packagePath = path.join(target, "node_modules", ...packageName.split("/"));
  const entrypoint = path.join(packagePath, "server.mjs");
  mkdirSync(packagePath, { recursive: true });
  writeFileSync(entrypoint, "process.stdin.pipe(process.stdout);\n");
  writeFileSync(path.join(packagePath, "package.json"), JSON.stringify({
    name: packageName,
    version: packageVersion,
    bin: { [candidate.entrypoint]: "server.mjs" },
  }));
  writeFileSync(
    path.join(target, "package.json"),
    canonicalJson({ private: true, dependencies: { [packageName]: "latest" } }),
  );
  const installedLock = Buffer.from(canonicalJson({
    name: "harness-latest-addon",
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { [packageName]: "latest" } },
      [`node_modules/${packageName}`]: {
        version: packageVersion,
        resolved: `https://registry.npmjs.org/${packageName}/-/${candidateId}-${packageVersion}.tgz`,
        integrity: packageIntegrity,
      },
    },
  }));
  writeFileSync(path.join(target, "package-lock.json"), installedLock);
  const packageLockSha256 = createHash("sha256").update(installedLock).digest("hex");
  const manifestDigest = createHash("sha256").update(canonicalJson(manifest)).digest("hex");
  const ownershipPath = path.join(homeDir, ".agents", "harness", "third-party-global-actions.json");
  const writeOwnership = async (mutate = (value) => value) => {
    const treeSha256 = await fingerprintPinnedMcpTree(target);
    const ownership = mutate({
      schemaVersion: 1,
      owner: "trellis-ccg-harness",
      sourceManifestSha256: manifestDigest,
      actions: {
        [candidateId]: {
          packageInstalled: true,
          mcpConfigured: true,
          sourceManifestSha256: manifestDigest,
          packageSelector: candidate.packageSelector,
          packageVersion,
          packageIntegrity,
          packageLockSha256,
          target,
          command: process.execPath,
          commandArgs: [entrypoint],
          treeSha256,
        },
      },
    });
    mkdirSync(path.dirname(ownershipPath), { recursive: true });
    writeFileSync(ownershipPath, canonicalJson(ownership));
  };
  return {
    homeDir,
    candidateId,
    target,
    entrypoint,
    ownershipPath,
    writeOwnership,
    cleanup: () => rmSync(homeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 }),
  };
}

test("launches only the owned Node entrypoint with sanitized environment, inherited stdio, and no shell", async () => {
  const value = fixture();
  try {
    await value.writeOwnership();
    const calls = [];
    const child = new EventEmitter();
    const result = await launchThirdPartyMcp({
      homeDir: value.homeDir,
      candidateId: value.candidateId,
      env: {
        HOME: value.homeDir,
        PATH: "attacker-path",
        NODE_OPTIONS: "--require=attacker.js",
        NODE_PATH: "attacker-node-path",
        TAR_OPTIONS: "--to-command=attacker",
        LD_PRELOAD: "attacker.so",
        DYLD_INSERT_LIBRARIES: "attacker.dylib",
      },
      spawnImpl(command, args, options) {
        calls.push({ command, args, options });
        return child;
      },
    });
    assert.equal(result, child);
    assert.deepEqual(calls, [{
      command: process.execPath,
      args: [value.entrypoint],
      options: {
        cwd: value.target,
        env: { HOME: value.homeDir },
        shell: false,
        stdio: "inherit",
        windowsHide: true,
      },
    }]);
    assert.equal(existsSync(path.join(value.homeDir, ".claude")), false);
  } finally {
    value.cleanup();
  }
});

test("rejects installed-file drift before spawn and never creates .claude", async () => {
  const value = fixture();
  try {
    await value.writeOwnership();
    writeFileSync(value.entrypoint, "tampered\n");
    await assert.rejects(
      launchThirdPartyMcp({ homeDir: value.homeDir, candidateId: value.candidateId, spawnImpl() { throw new Error("must not spawn"); } }),
      /drifted.*fingerprint/i,
    );
    assert.equal(existsSync(path.join(value.homeDir, ".claude")), false);
  } finally {
    value.cleanup();
  }
});

test("rejects .bin link-target drift before spawn", async (t) => {
  const value = fixture();
  try {
    const binRoot = path.join(value.target, "node_modules", ".bin");
    const packageRoot = path.dirname(value.entrypoint);
    mkdirSync(binRoot, { recursive: true });
    writeFileSync(path.join(packageRoot, "other.mjs"), "process.exit(0);\n");
    const shim = path.join(binRoot, "codegraph");
    try {
      symlinkSync("../@colbymchenry/codegraph/server.mjs", shim, "file");
    } catch (error) {
      t.skip(`cannot create test symlink on this host: ${error.message}`);
      return;
    }
    await value.writeOwnership();
    unlinkSync(shim);
    symlinkSync("../@colbymchenry/codegraph/other.mjs", shim, "file");
    await assert.rejects(
      launchThirdPartyMcp({
        homeDir: value.homeDir,
        candidateId: value.candidateId,
        spawnImpl() { throw new Error("must not spawn"); },
      }),
      /drifted.*fingerprint/i,
    );
  } finally {
    value.cleanup();
  }
});

test("rejects a linked owned tool directory before spawn", async (t) => {
  const value = fixture();
  try {
    await value.writeOwnership();
    const outside = path.join(value.homeDir, "outside");
    mkdirSync(outside);
    rmSync(value.target, { recursive: true, force: true });
    try {
      symlinkSync(outside, value.target, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      t.skip(`cannot create test link on this host: ${error.message}`);
      return;
    }
    await assert.rejects(
      launchThirdPartyMcp({ homeDir: value.homeDir, candidateId: value.candidateId, spawnImpl() { throw new Error("must not spawn"); } }),
      /symbolic link|reparse|regular non-linked/i,
    );
  } finally {
    value.cleanup();
  }
});

test("rejects tampered ownership digests and escaped paths before spawn", async () => {
  const value = fixture();
  try {
    await value.writeOwnership((ownership) => {
      ownership.actions.codegraph.sourceManifestSha256 = "b".repeat(64);
      ownership.actions.codegraph.target = path.join(value.homeDir, "outside-approved-tool-root");
      return ownership;
    });
    await assert.rejects(
      launchThirdPartyMcp({ homeDir: value.homeDir, candidateId: value.candidateId, spawnImpl() { throw new Error("must not spawn"); } }),
      /source manifest digest does not match/i,
    );
    await value.writeOwnership((ownership) => {
      ownership.sourceManifestSha256 = "b".repeat(64);
      ownership.actions.codegraph.sourceManifestSha256 = "b".repeat(64);
      return ownership;
    });
    await assert.rejects(
      launchThirdPartyMcp({ homeDir: value.homeDir, candidateId: value.candidateId, spawnImpl() { throw new Error("must not spawn"); } }),
      /source manifest digest does not match ownership/i,
    );
    await value.writeOwnership((ownership) => {
      ownership.actions.codegraph.target = path.join(value.homeDir, "outside-approved-tool-root");
      return ownership;
    });
    await assert.rejects(
      launchThirdPartyMcp({ homeDir: value.homeDir, candidateId: value.candidateId, spawnImpl() { throw new Error("must not spawn"); } }),
      /installation target does not match/i,
    );
    await value.writeOwnership((ownership) => {
      ownership.actions.codegraph.commandArgs.push(value.entrypoint);
      return ownership;
    });
    await assert.rejects(
      launchThirdPartyMcp({ homeDir: value.homeDir, candidateId: value.candidateId, spawnImpl() { throw new Error("must not spawn"); } }),
      /exactly one owned entrypoint/i,
    );
  } finally {
    value.cleanup();
  }
});

test("rejects an unknown candidate and does not read or write .claude", async () => {
  const value = fixture();
  try {
    await value.writeOwnership();
    await assert.rejects(
      launchThirdPartyMcp({ homeDir: value.homeDir, candidateId: "not-approved", spawnImpl() { throw new Error("must not spawn"); } }),
      /not authorized/i,
    );
    assert.equal(existsSync(path.join(value.homeDir, ".claude")), false);
  } finally {
    value.cleanup();
  }
});

test("requires exactly one absolute home and candidate CLI argument", () => {
  const absoluteHome = path.resolve(os.tmpdir());
  assert.deepEqual(
    parseThirdPartyMcpLauncherArgs(["--home", absoluteHome, "--candidate", "codegraph"]),
    { homeDir: absoluteHome, candidateId: "codegraph" },
  );
  assert.throws(
    () => parseThirdPartyMcpLauncherArgs(["--home", "relative", "--candidate", "codegraph"]),
    /absolute path/i,
  );
  assert.throws(
    () => parseThirdPartyMcpLauncherArgs(["--home", absoluteHome, "--candidate", "codegraph", "--candidate", "fast-context"]),
    /one value|unknown/i,
  );
});
