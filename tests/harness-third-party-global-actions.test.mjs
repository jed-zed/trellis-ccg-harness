import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { applyThirdPartyGlobalActions } from "../.agents/skills/harness-init/scripts/third-party-global-actions.mjs";

const manifest = JSON.parse(readFileSync(new URL("../.agents/skills/harness-init/assets/third-party-sources.json", import.meta.url), "utf8"));
function manifestDigest(sourceManifest) {
  return createHash("sha256").update(`${JSON.stringify(sourceManifest, null, 2)}\n`).digest("hex");
}

function packageSourceFor(selector, sourceManifest = manifest) {
  return selector.startsWith("@colbymchenry/")
    ? sourceManifest.sources.find((entry) => entry.id === "codegraph")
    : sourceManifest.sources.find((entry) => entry.id === "fast-context");
}

function materializePinnedPackage(args, { integrity, sourceManifest = manifest } = {}) {
  const prefix = args[args.indexOf("--prefix") + 1];
  const selector = args.at(-1);
  const source = packageSourceFor(selector, sourceManifest);
  const at = selector.lastIndexOf("@");
  const name = selector.slice(0, at);
  const version = selector.slice(at + 1);
  const packageRoot = path.join(prefix, "node_modules", ...name.split("/"));
  mkdirSync(packageRoot, { recursive: true });
  const bin = source.id === "codegraph" ? "codegraph" : "fast-context-mcp";
  writeFileSync(path.join(packageRoot, "cli.js"), "#!/usr/bin/env node\n");
  writeFileSync(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ name, version, bin: { [bin]: "cli.js" } }),
  );
  writeFileSync(
    path.join(prefix, "package-lock.json"),
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { name: "harness-pinned-tool" },
        [`node_modules/${name}`]: {
          version,
          integrity: integrity ?? source.packageIntegrity,
        },
      },
    }),
  );
}

function fixture({ integrity, sourceManifest = manifest } = {}) {
  const homeDir = mkdtempSync(path.join(os.tmpdir(), "harness-actions-"));
  const commands = [];
  return {
    homeDir,
    commands,
    runCommand: async (command, args) => {
      commands.push({ command, args });
      if (command === "npm" && args[0] === "install") {
        materializePinnedPackage(args, { integrity, sourceManifest });
      }
      return { stdout: "", exitCode: 0 };
    },
    approvals(ids, selections) {
      const byGroup = new Map(sourceManifest.candidates.map((candidate) => [candidate.id, candidate.group]));
      return {
        sourceManifestSha256: manifestDigest(sourceManifest),
        approvedActionIds: ids,
        selections: selections ?? {
          globalSkills: ids.filter((id) => byGroup.get(id) === "global-skills"),
          globalPlugins: ids.filter((id) => byGroup.get(id) === "global-plugins"),
          projectSkills: ids.filter((id) => byGroup.get(id) === "project-skills"),
          mcpCli: ids.filter((id) => byGroup.get(id) === "mcp-cli"),
        },
      };
    },
    cleanup() { rmSync(homeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); },
  };
}

function ponytailHostRunner(value, { initiallyInstalled = false } = {}) {
  const pluginTree = manifest.candidates.find((entry) => entry.id === "ponytail.install").sourceGitTree;
  let installed = initiallyInstalled;
  return async (command, args) => {
    value.commands.push({ command, args });
    if (command === "git") return { stdout: `${pluginTree}\n`, exitCode: 0 };
    if (command === "codex" && args.slice(0, 3).join(" ") === "plugin list --json") {
      return { stdout: JSON.stringify({ plugins: installed ? [{ name: "ponytail" }] : [] }), exitCode: 0 };
    }
    if (command === "codex" && args.slice(0, 2).join(" ") === "plugin add") installed = true;
    return { stdout: "", exitCode: 0 };
  };
}

function simulatedHardKill(message = "simulated hard kill") {
  const error = new Error(message);
  error.code = "HARNESS_SIMULATED_HARD_KILL";
  return error;
}

test("reject-all makes no commands and no writes", async () => {
  const value = fixture();
  try {
    const result = await applyThirdPartyGlobalActions({ manifest, approvals: value.approvals([]), homeDir: value.homeDir, runCommand: value.runCommand });
    assert.equal(result.status, "skipped");
    assert.deepEqual(value.commands, []);
    assert.equal(path.basename(result.ownershipPath), "third-party-global-actions.json");
    assert.equal(existsSync(result.ownershipPath), false);
  } finally { value.cleanup(); }
});

test("Ponytail hooks cannot bypass the explicitly approved plugin dependency", async () => {
  const value = fixture();
  try {
    await assert.rejects(
      applyThirdPartyGlobalActions({ manifest, approvals: value.approvals(["ponytail.hooks"]), homeDir: value.homeDir, runCommand: value.runCommand }),
      /requires explicitly approved dependencies/i,
    );
    assert.deepEqual(value.commands, []);
    assert.equal(existsSync(path.join(value.homeDir, ".agents", "harness", "third-party-global-actions.json")), false);
  } finally { value.cleanup(); }
});

test("Ponytail full default cannot bypass its separately approved plugin dependency", async () => {
  const value = fixture();
  try {
    await assert.rejects(
      applyThirdPartyGlobalActions({
        manifest,
        approvals: value.approvals(["ponytail.default-full"]),
        homeDir: value.homeDir,
        platform: "linux",
        env: {},
        runCommand: value.runCommand,
      }),
      /requires explicitly approved dependencies.*ponytail\.install/i,
    );
    assert.deepEqual(value.commands, []);
    assert.equal(existsSync(path.join(value.homeDir, ".config", "ponytail", "config.json")), false);
  } finally { value.cleanup(); }
});

test("Ponytail full default records reversible ownership and is idempotent", async () => {
  const value = fixture();
  try {
    const sourceRoot = path.join(value.homeDir, "pinned-ponytail");
    mkdirSync(sourceRoot);
    const runCommand = ponytailHostRunner(value);
    const options = {
      manifest,
      approvals: value.approvals(["ponytail.install", "ponytail.default-full"]),
      homeDir: value.homeDir,
      allowNetwork: true,
      sourceResolver: async () => sourceRoot,
      platform: "linux",
      env: {},
      runCommand,
    };
    const first = await applyThirdPartyGlobalActions(options);
    const defaultAction = first.actions.find((entry) => entry.id === "ponytail.default-full");
    assert.equal(defaultAction.status, "installed");
    assert.equal(readFileSync(defaultAction.configPath, "utf8"), `${JSON.stringify({ defaultMode: "full" }, null, 2)}\n`);
    const ownership = JSON.parse(readFileSync(first.ownershipPath, "utf8"));
    const owned = ownership.actions["ponytail.default-full"];
    assert.equal(owned.target, defaultAction.configPath);
    assert.equal(owned.mode, "full");
    assert.equal(owned.sha256, createHash("sha256").update(readFileSync(defaultAction.configPath)).digest("hex"));
    assert.deepEqual(owned.rollback, {
      operation: "remove-created-file-if-unchanged",
      previousExists: false,
      expectedSha256: owned.sha256,
    });

    const addCalls = value.commands.filter((entry) => entry.command === "codex" && entry.args.includes("add")).length;
    const second = await applyThirdPartyGlobalActions(options);
    assert.equal(second.actions.find((entry) => entry.id === "ponytail.default-full").status, "unchanged");
    assert.equal(value.commands.filter((entry) => entry.command === "codex" && entry.args.includes("add")).length, addCalls);
  } finally { value.cleanup(); }
});

test("Ponytail full default preserves an existing user configuration", async () => {
  const value = fixture();
  try {
    const sourceRoot = path.join(value.homeDir, "pinned-ponytail");
    const configPath = path.join(value.homeDir, ".config", "ponytail", "config.json");
    mkdirSync(sourceRoot);
    mkdirSync(path.dirname(configPath), { recursive: true });
    const userBytes = "{\n  \"defaultMode\": \"review\",\n  \"userOption\": true\n}\n";
    writeFileSync(configPath, userBytes);
    const result = await applyThirdPartyGlobalActions({
      manifest,
      approvals: value.approvals(["ponytail.install", "ponytail.default-full"]),
      homeDir: value.homeDir,
      allowNetwork: true,
      sourceResolver: async () => sourceRoot,
      platform: "linux",
      env: {},
      runCommand: ponytailHostRunner(value),
    });
    const defaultAction = result.actions.find((entry) => entry.id === "ponytail.default-full");
    assert.equal(defaultAction.status, "failed");
    assert.match(defaultAction.error, /modified by the user|not Harness-owned/i);
    assert.equal(readFileSync(configPath, "utf8"), userBytes);
    const ownership = JSON.parse(readFileSync(result.ownershipPath, "utf8"));
    assert.equal(ownership.actions["ponytail.default-full"], undefined);
  } finally { value.cleanup(); }
});

test("Ponytail full default rolls back a new config when ownership cannot commit", async () => {
  const value = fixture();
  try {
    const sourceRoot = path.join(value.homeDir, "pinned-ponytail");
    const configPath = path.join(value.homeDir, ".config", "ponytail", "config.json");
    const ownershipPath = path.join(value.homeDir, ".agents", "harness", "third-party-global-actions.json");
    mkdirSync(sourceRoot);
    mkdirSync(path.dirname(ownershipPath), { recursive: true });
    const priorOwnership = `${JSON.stringify({
      schemaVersion: 1,
      owner: "trellis-ccg-harness",
      actions: {
        "ponytail.install": {
          sourceManifestSha256: manifestDigest(manifest),
        },
      },
      results: {},
    }, null, 2)}\n`;
    writeFileSync(ownershipPath, priorOwnership);
    await assert.rejects(
      applyThirdPartyGlobalActions({
        manifest,
        approvals: value.approvals(["ponytail.install", "ponytail.default-full"]),
        homeDir: value.homeDir,
        allowNetwork: true,
        sourceResolver: async () => sourceRoot,
        platform: "linux",
        env: {},
        runCommand: ponytailHostRunner(value, { initiallyInstalled: true }),
        faultInjector: async (phase) => {
          if (phase === "before-ownership") throw new Error("simulated ownership failure");
        },
      }),
      /simulated ownership failure/i,
    );
    assert.equal(existsSync(configPath), false);
    assert.equal(readFileSync(ownershipPath, "utf8"), priorOwnership);
  } finally { value.cleanup(); }
});

test("Ponytail hooks remain manual-pending when their plugin dependency was explicitly approved", async () => {
  const value = fixture();
  try {
    const sourceRoot = path.join(value.homeDir, "pinned-ponytail");
    mkdirSync(sourceRoot);
    const result = await applyThirdPartyGlobalActions({
      manifest,
      approvals: value.approvals(["ponytail.install", "ponytail.hooks"]),
      homeDir: value.homeDir,
      allowNetwork: true,
      sourceResolver: async () => sourceRoot,
      runCommand: async (command, args) => {
        value.commands.push({ command, args });
        if (command === "git") {
          return {
            stdout: manifest.candidates.find((entry) => entry.id === "ponytail.install").sourceGitTree,
            exitCode: 0,
          };
        }
        if (command === "codex" && args.slice(0, 3).join(" ") === "plugin list --json") {
          return { stdout: JSON.stringify({ plugins: [] }), exitCode: 0 };
        }
        return { stdout: "", exitCode: 0 };
      },
    });
    assert.equal(result.actions.at(-1).status, "manual-pending");
    assert.equal(value.commands.filter((entry) => entry.command === "codex").length, 3);
  } finally { value.cleanup(); }
});

test("Ponytail reuse requires both the pinned source tree and Codex JSON host inventory", async () => {
  const value = fixture();
  try {
    const sourceRoot = path.join(value.homeDir, "pinned-ponytail");
    mkdirSync(sourceRoot);
    const pluginTree = manifest.candidates.find((entry) => entry.id === "ponytail.install").sourceGitTree;
    let installedInHost = false;
    const runCommand = async (command, args) => {
      value.commands.push({ command, args });
      if (command === "git") return { stdout: `${pluginTree}\n`, exitCode: 0 };
      if (command === "codex" && args.slice(0, 3).join(" ") === "plugin list --json") {
        return { stdout: JSON.stringify({ plugins: installedInHost ? [{ name: "ponytail" }] : [] }), exitCode: 0 };
      }
      if (command === "codex" && args.slice(0, 2).join(" ") === "plugin add") installedInHost = true;
      return { stdout: "", exitCode: 0 };
    };
    const first = await applyThirdPartyGlobalActions({
      manifest,
      approvals: value.approvals(["ponytail.install"]),
      homeDir: value.homeDir,
      allowNetwork: true,
      sourceResolver: async () => sourceRoot,
      runCommand,
    });
    assert.equal(first.actions[0].status, "installed");
    const marketplaceCalls = value.commands.filter((entry) => entry.command === "codex" && entry.args.includes("marketplace")).length;
    const second = await applyThirdPartyGlobalActions({
      manifest,
      approvals: value.approvals(["ponytail.install"]),
      homeDir: value.homeDir,
      allowNetwork: true,
      sourceResolver: async () => sourceRoot,
      runCommand,
    });
    assert.equal(second.actions[0].status, "unchanged");
    assert.equal(value.commands.filter((entry) => entry.command === "codex" && entry.args.includes("marketplace")).length, marketplaceCalls);
  } finally { value.cleanup(); }
});

test("an existing unowned Ponytail host inventory is manual-pending and never re-added", async () => {
  const value = fixture();
  try {
    const sourceRoot = path.join(value.homeDir, "pinned-ponytail");
    mkdirSync(sourceRoot);
    const pluginTree = manifest.candidates.find((entry) => entry.id === "ponytail.install").sourceGitTree;
    const result = await applyThirdPartyGlobalActions({
      manifest,
      approvals: value.approvals(["ponytail.install"]),
      homeDir: value.homeDir,
      allowNetwork: true,
      sourceResolver: async () => sourceRoot,
      runCommand: async (command, args) => {
        value.commands.push({ command, args });
        if (command === "git") return { stdout: `${pluginTree}\n`, exitCode: 0 };
        if (command === "codex" && args.slice(0, 3).join(" ") === "plugin list --json") {
          return { stdout: JSON.stringify({ plugins: [{ name: "ponytail" }] }), exitCode: 0 };
        }
        return { stdout: "", exitCode: 0 };
      },
    });
    assert.equal(result.actions[0].status, "manual-pending");
    assert.equal(value.commands.some((entry) => entry.args.includes("marketplace")), false);
    assert.equal(value.commands.some((entry) => entry.args.includes("add")), false);
  } finally { value.cleanup(); }
});

test("a nonzero injected command result is a failed action, not a successful install", async () => {
  const value = fixture();
  try {
    const result = await applyThirdPartyGlobalActions({
      manifest,
      approvals: value.approvals(["codegraph"]),
      homeDir: value.homeDir,
      allowNetwork: true,
      runCommand: async (command, args) => {
        value.commands.push({ command, args });
        return { exitCode: 17 };
      },
    });
    assert.equal(result.status, "partial-failure");
    assert.match(result.actions[0].error, /exited with status 17/i);
  } finally { value.cleanup(); }
});

test("CodeGraph uses exact selectors, checks integrity, configures an absolute MCP command, and never initializes an index", async () => {
  const value = fixture();
  try {
    const result = await applyThirdPartyGlobalActions({ manifest, approvals: value.approvals(["codegraph"]), homeDir: value.homeDir, allowNetwork: true, runCommand: value.runCommand });
    assert.equal(result.status, "applied");
    const text = JSON.stringify(value.commands);
    assert.match(text, /@colbymchenry\/codegraph@1\.5\.0/);
    assert.doesNotMatch(text, /(?:main|latest|codegraph init|npm view)/i);
    const mcp = value.commands.find((entry) => entry.command === "codex");
    assert.ok(mcp);
    assert.equal(path.isAbsolute(mcp.args.at(-1)), true);
  } finally { value.cleanup(); }
});

test("a failed MCP configuration remains pending and is retried after the package is reused", async () => {
  const value = fixture();
  try {
    let mcpAttempts = 0;
    const first = await applyThirdPartyGlobalActions({
      manifest,
      approvals: value.approvals(["codegraph"]),
      homeDir: value.homeDir,
      allowNetwork: true,
      runCommand: async (command, args) => {
        value.commands.push({ command, args });
        if (command === "npm") materializePinnedPackage(args);
        if (command === "codex" && args[0] === "mcp") {
          mcpAttempts += 1;
          return { exitCode: 1 };
        }
        return { stdout: "", exitCode: 0 };
      },
    });
    assert.equal(first.status, "partial-failure");
    const ownershipPath = path.join(value.homeDir, ".agents", "harness", "third-party-global-actions.json");
    const firstOwnership = JSON.parse(readFileSync(ownershipPath, "utf8"));
    assert.equal(firstOwnership.actions.codegraph.packageInstalled, true);
    assert.equal(firstOwnership.actions.codegraph.mcpConfigured, false);

    const second = await applyThirdPartyGlobalActions({
      manifest,
      approvals: value.approvals(["codegraph"]),
      homeDir: value.homeDir,
      allowNetwork: true,
      runCommand: async (command, args) => {
        value.commands.push({ command, args });
        if (command === "codex" && args[0] === "mcp") mcpAttempts += 1;
        return { stdout: "", exitCode: 0 };
      },
    });
    assert.equal(second.status, "applied");
    assert.equal(second.actions[0].status, "configured");
    assert.equal(mcpAttempts, 2);
    const secondOwnership = JSON.parse(readFileSync(ownershipPath, "utf8"));
    assert.equal(secondOwnership.actions.codegraph.packageInstalled, true);
    assert.equal(secondOwnership.actions.codegraph.mcpConfigured, true);
  } finally { value.cleanup(); }
});

test("action failures redact Authorization, Bearer, and credential values", async () => {
  const value = fixture();
  try {
    const result = await applyThirdPartyGlobalActions({
      manifest,
      approvals: value.approvals(["codegraph"]),
      homeDir: value.homeDir,
      allowNetwork: true,
      runCommand: async () => {
        throw new Error("Authorization: Bearer top-secret; credential=also-secret token=still-secret");
      },
    });
    const message = result.actions[0].error;
    assert.doesNotMatch(message, /top-secret|also-secret|still-secret/i);
    assert.match(message, /Authorization=\[redacted\]|Bearer \[redacted\]/i);
    assert.match(message, /credential=\[redacted\]|token=\[redacted\]/i);
  } finally { value.cleanup(); }
});

test("unknown direct approval ids and a pre-existing action lock fail closed before commands", async () => {
  const value = fixture();
  try {
    await assert.rejects(
      applyThirdPartyGlobalActions({
        manifest,
        approvals: value.approvals(["not-a-candidate"]),
        homeDir: value.homeDir,
        runCommand: value.runCommand,
      }),
      /unknown approved id/i,
    );
    assert.deepEqual(value.commands, []);
    const lockDir = path.join(value.homeDir, ".agents", "harness");
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(
      path.join(lockDir, "third-party-global-actions.lock"),
      JSON.stringify({ owner: "trellis-ccg-harness", id: "other" }),
    );
    await assert.rejects(
      applyThirdPartyGlobalActions({
        manifest,
        approvals: value.approvals(["codegraph"]),
        homeDir: value.homeDir,
        allowNetwork: true,
        runCommand: value.runCommand,
      }),
      /already in progress|concurrent|unauthenticated|tampered/i,
    );
    assert.deepEqual(value.commands, []);
  } finally { value.cleanup(); }
});

test("a stale npm-install journal is authenticated, blocks live recovery, and never replays an uncertain install", async () => {
  const value = fixture();
  try {
    const faultInjector = async (phase) => {
      if (phase === "after-side-effect:codegraph:npm-install") throw simulatedHardKill();
    };
    await assert.rejects(
      applyThirdPartyGlobalActions({
        manifest,
        approvals: value.approvals(["codegraph"]),
        homeDir: value.homeDir,
        allowNetwork: true,
        runCommand: value.runCommand,
        faultInjector,
      }),
      (error) => error?.code === "HARNESS_SIMULATED_HARD_KILL",
    );
    const journalPath = path.join(value.homeDir, ".agents", "harness", "third-party-global-actions.journal.json");
    const lockPath = path.join(value.homeDir, ".agents", "harness", "third-party-global-actions.lock");
    const keyPath = path.join(value.homeDir, ".harness-init", "third-party-global-actions.key");
    assert.equal(existsSync(journalPath), true);
    assert.equal(existsSync(lockPath), true);
    assert.equal(readFileSync(keyPath).length, 32);
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    assert.equal(journal.sourceManifestSha256, manifestDigest(manifest));
    assert.deepEqual(journal.approvedActionIds, ["codegraph"]);
    assert.equal(journal.steps.codegraph.effects["npm-install"].state, "attempting");
    assert.ok(journal.provenance.digest);

    await assert.rejects(
      applyThirdPartyGlobalActions({
        manifest,
        approvals: value.approvals(["codegraph"]),
        homeDir: value.homeDir,
        allowNetwork: true,
        runCommand: value.runCommand,
      }),
      /live process|concurrent recovery/i,
    );
    const npmCallsBeforeRecovery = value.commands.filter((entry) => entry.command === "npm").length;
    const recovered = await applyThirdPartyGlobalActions({
      manifest,
      approvals: value.approvals(["codegraph"]),
      homeDir: value.homeDir,
      allowNetwork: true,
      runCommand: value.runCommand,
      processAlive: async () => false,
    });
    assert.equal(recovered.recovered, true);
    assert.equal(recovered.actions[0].status, "manual-pending");
    assert.equal(value.commands.filter((entry) => entry.command === "npm").length, npmCallsBeforeRecovery);
    assert.equal(existsSync(journalPath), false);
    assert.equal(existsSync(lockPath), false);
  } finally { value.cleanup(); }
});

test("an interrupted MCP host mutation is reconciled by exact read-only inventory without replay", async () => {
  const value = fixture();
  try {
    let configured = null;
    const runCommand = async (command, args) => {
      if (command === "codex" && args.slice(0, 3).join(" ") === "mcp list --json") {
        value.commands.push({ command, args });
        return {
          stdout: JSON.stringify({
            servers: configured
              ? [{ name: "codegraph", command: configured.command, args: configured.args }]
              : [],
          }),
          exitCode: 0,
        };
      }
      const result = await value.runCommand(command, args);
      if (command === "codex" && args.slice(0, 3).join(" ") === "mcp add codegraph") {
        const separator = args.indexOf("--");
        configured = { command: args[separator + 1], args: args.slice(separator + 2) };
      }
      return result;
    };
    await assert.rejects(
      applyThirdPartyGlobalActions({
        manifest,
        approvals: value.approvals(["codegraph"]),
        homeDir: value.homeDir,
        allowNetwork: true,
        runCommand,
        faultInjector: async (phase) => {
          if (phase === "after-side-effect:codegraph:mcp-configure") throw simulatedHardKill();
        },
      }),
      (error) => error?.code === "HARNESS_SIMULATED_HARD_KILL",
    );
    const addCalls = value.commands.filter((entry) =>
      entry.command === "codex" && entry.args.slice(0, 3).join(" ") === "mcp add codegraph"
    ).length;
    const recovered = await applyThirdPartyGlobalActions({
      manifest,
      approvals: value.approvals(["codegraph"]),
      homeDir: value.homeDir,
      allowNetwork: true,
      runCommand,
      processAlive: async () => false,
    });
    assert.equal(recovered.actions[0].status, "recovered");
    assert.equal(recovered.actions[0].mcpConfigured, true);
    assert.equal(value.commands.filter((entry) =>
      entry.command === "codex" && entry.args.slice(0, 3).join(" ") === "mcp add codegraph"
    ).length, addCalls);
    const ownership = JSON.parse(readFileSync(recovered.ownershipPath, "utf8"));
    assert.equal(ownership.actions.codegraph.mcpConfigured, true);
    assert.equal(value.commands.some((entry) => entry.args.includes("init")), false);
  } finally { value.cleanup(); }
});

test("an interrupted Ponytail host mutation becomes manual-pending and is never replayed or claimed", async () => {
  const value = fixture();
  try {
    const sourceRoot = path.join(value.homeDir, "pinned-ponytail");
    mkdirSync(sourceRoot);
    const runCommand = ponytailHostRunner(value);
    await assert.rejects(
      applyThirdPartyGlobalActions({
        manifest,
        approvals: value.approvals(["ponytail.install"]),
        homeDir: value.homeDir,
        allowNetwork: true,
        sourceResolver: async () => sourceRoot,
        runCommand,
        faultInjector: async (phase) => {
          if (phase === "after-side-effect:ponytail.install:plugin-add") throw simulatedHardKill();
        },
      }),
      (error) => error?.code === "HARNESS_SIMULATED_HARD_KILL",
    );
    const addCalls = value.commands.filter((entry) =>
      entry.command === "codex" && entry.args.includes("add")
    ).length;
    const recovered = await applyThirdPartyGlobalActions({
      manifest,
      approvals: value.approvals(["ponytail.install"]),
      homeDir: value.homeDir,
      allowNetwork: true,
      sourceResolver: async () => sourceRoot,
      runCommand,
      processAlive: async () => false,
    });
    assert.equal(recovered.actions[0].status, "manual-pending");
    assert.match(recovered.actions[0].reason, /cannot prove.*pinned source|interrupted/i);
    assert.equal(value.commands.filter((entry) =>
      entry.command === "codex" && entry.args.includes("add")
    ).length, addCalls);
    const ownership = JSON.parse(readFileSync(recovered.ownershipPath, "utf8"));
    assert.equal(ownership.actions["ponytail.install"], undefined);
  } finally { value.cleanup(); }
});

test("an interrupted local config activation is verified and rolled forward without rewriting it", async () => {
  const value = fixture();
  try {
    const sourceRoot = path.join(value.homeDir, "pinned-ponytail");
    mkdirSync(sourceRoot);
    const runCommand = ponytailHostRunner(value);
    const configPath = path.join(value.homeDir, ".config", "ponytail", "config.json");
    await assert.rejects(
      applyThirdPartyGlobalActions({
        manifest,
        approvals: value.approvals(["ponytail.install", "ponytail.default-full"]),
        homeDir: value.homeDir,
        allowNetwork: true,
        sourceResolver: async () => sourceRoot,
        platform: "linux",
        env: {},
        runCommand,
        faultInjector: async (phase) => {
          if (phase === "after-side-effect:ponytail.default-full:config-activate") {
            throw simulatedHardKill();
          }
        },
      }),
      (error) => error?.code === "HARNESS_SIMULATED_HARD_KILL",
    );
    const activatedBytes = readFileSync(configPath, "utf8");
    const addCalls = value.commands.filter((entry) =>
      entry.command === "codex" && entry.args.includes("add")
    ).length;
    const recovered = await applyThirdPartyGlobalActions({
      manifest,
      approvals: value.approvals(["ponytail.install", "ponytail.default-full"]),
      homeDir: value.homeDir,
      allowNetwork: true,
      sourceResolver: async () => sourceRoot,
      platform: "linux",
      env: {},
      runCommand,
      processAlive: async () => false,
    });
    assert.equal(recovered.actions.find((entry) => entry.id === "ponytail.default-full").status, "recovered");
    assert.equal(readFileSync(configPath, "utf8"), activatedBytes);
    assert.equal(value.commands.filter((entry) =>
      entry.command === "codex" && entry.args.includes("add")
    ).length, addCalls);
    const ownership = JSON.parse(readFileSync(recovered.ownershipPath, "utf8"));
    assert.equal(ownership.actions["ponytail.default-full"].sha256, createHash("sha256").update(activatedBytes).digest("hex"));
  } finally { value.cleanup(); }
});

test("hard kill before ownership resumes ownership-last without replaying completed effects", async () => {
  const value = fixture();
  try {
    await assert.rejects(
      applyThirdPartyGlobalActions({
        manifest,
        approvals: value.approvals(["codegraph"]),
        homeDir: value.homeDir,
        allowNetwork: true,
        runCommand: value.runCommand,
        faultInjector: async (phase) => {
          if (phase === "before-ownership") throw simulatedHardKill();
        },
      }),
      (error) => error?.code === "HARNESS_SIMULATED_HARD_KILL",
    );
    const npmCalls = value.commands.filter((entry) => entry.command === "npm").length;
    const mcpCalls = value.commands.filter((entry) => entry.command === "codex" && entry.args[0] === "mcp").length;
    const recovered = await applyThirdPartyGlobalActions({
      manifest,
      approvals: value.approvals(["codegraph"]),
      homeDir: value.homeDir,
      allowNetwork: true,
      runCommand: value.runCommand,
      processAlive: async () => false,
    });
    assert.equal(recovered.recovered, true);
    assert.equal(value.commands.filter((entry) => entry.command === "npm").length, npmCalls);
    assert.equal(value.commands.filter((entry) => entry.command === "codex" && entry.args[0] === "mcp").length, mcpCalls);
    const ownership = JSON.parse(readFileSync(recovered.ownershipPath, "utf8"));
    assert.equal(ownership.actions.codegraph.packageInstalled, true);
    assert.equal(ownership.actions.codegraph.mcpConfigured, true);
  } finally { value.cleanup(); }
});

test("a tampered authenticated journal fails closed before recovery commands", async () => {
  const value = fixture();
  try {
    await assert.rejects(
      applyThirdPartyGlobalActions({
        manifest,
        approvals: value.approvals(["codegraph"]),
        homeDir: value.homeDir,
        allowNetwork: true,
        runCommand: value.runCommand,
        faultInjector: async (phase) => {
          if (phase === "after-intent:codegraph:npm-install") throw simulatedHardKill();
        },
      }),
      (error) => error?.code === "HARNESS_SIMULATED_HARD_KILL",
    );
    const journalPath = path.join(value.homeDir, ".agents", "harness", "third-party-global-actions.journal.json");
    const tampered = JSON.parse(readFileSync(journalPath, "utf8"));
    tampered.approvedActionIds = ["fast-context"];
    writeFileSync(journalPath, `${JSON.stringify(tampered, null, 2)}\n`);
    const commandCount = value.commands.length;
    await assert.rejects(
      applyThirdPartyGlobalActions({
        manifest,
        approvals: value.approvals(["codegraph"]),
        homeDir: value.homeDir,
        allowNetwork: true,
        runCommand: value.runCommand,
        processAlive: async () => false,
      }),
      /journal.*unauthenticated|tampered/i,
    );
    assert.equal(value.commands.length, commandCount);
    assert.equal(existsSync(journalPath), true);
  } finally { value.cleanup(); }
});

test("durable action journals never persist command credentials", async () => {
  const value = fixture();
  try {
    await assert.rejects(
      applyThirdPartyGlobalActions({
        manifest,
        approvals: value.approvals(["codegraph"]),
        homeDir: value.homeDir,
        allowNetwork: true,
        runCommand: async () => {
          throw new Error("Authorization: Bearer journal-secret; credential=second-secret");
        },
        faultInjector: async (phase) => {
          if (phase === "before-ownership") throw simulatedHardKill("stop after safe failure receipt");
        },
      }),
      (error) => error?.code === "HARNESS_SIMULATED_HARD_KILL",
    );
    const journalText = readFileSync(
      path.join(value.homeDir, ".agents", "harness", "third-party-global-actions.journal.json"),
      "utf8",
    );
    assert.doesNotMatch(journalText, /journal-secret|second-secret/i);
    assert.match(journalText, /\[redacted\]/i);
  } finally { value.cleanup(); }
});

test("direct global actions require complete explicit selections that contain every approved id", async () => {
  const value = fixture();
  try {
    await assert.rejects(
      applyThirdPartyGlobalActions({
        manifest,
        approvals: { sourceManifestSha256: manifestDigest(manifest), approvedActionIds: ["codegraph"] },
        homeDir: value.homeDir,
        allowNetwork: true,
        runCommand: value.runCommand,
      }),
      /explicit selections|globalSkills.*explicit array/i,
    );
    await assert.rejects(
      applyThirdPartyGlobalActions({
        manifest,
        approvals: value.approvals(["codegraph"], {
          globalSkills: [], globalPlugins: [], projectSkills: [], mcpCli: [],
        }),
        homeDir: value.homeDir,
        allowNetwork: true,
        runCommand: value.runCommand,
      }),
      /not explicitly selected/i,
    );
    assert.deepEqual(value.commands, []);
    assert.equal(existsSync(path.join(value.homeDir, ".agents", "harness", "third-party-global-actions.json")), false);
  } finally { value.cleanup(); }
});

test("a staged npm package is rejected when its lock integrity is not the approved artifact integrity", async () => {
  const value = fixture({ integrity: "sha512-wrong" });
  try {
    const result = await applyThirdPartyGlobalActions({ manifest, approvals: value.approvals(["codegraph"]), homeDir: value.homeDir, allowNetwork: true, runCommand: value.runCommand });
    assert.equal(result.status, "partial-failure");
    assert.equal(result.actions[0].status, "failed");
    assert.match(result.actions[0].error, /package-lock.*integrity/i);
    assert.equal(value.commands.some((entry) => entry.command === "codex"), false);
  } finally { value.cleanup(); }
});

test("a global action refuses a tool target created after staging", async () => {
  const value = fixture();
  try {
    const target = path.join(value.homeDir, ".agents", "harness", "tools", "codegraph", "1.5.0");
    const result = await applyThirdPartyGlobalActions({
      manifest,
      approvals: value.approvals(["codegraph"]),
      homeDir: value.homeDir,
      allowNetwork: true,
      runCommand: value.runCommand,
      faultInjector: async (phase) => {
        if (phase === "before-activate:codegraph") {
          mkdirSync(target, { recursive: true });
          writeFileSync(path.join(target, "user-owned.txt"), "do not overwrite\n");
        }
      },
    });
    assert.equal(result.status, "partial-failure");
    assert.match(result.actions[0].error, /appeared after preflight/i);
    assert.equal(readFileSync(path.join(target, "user-owned.txt"), "utf8"), "do not overwrite\n");
  } finally {
    value.cleanup();
  }
});

test("a global action refuses to overwrite ownership changed before commit", async () => {
  const value = fixture();
  try {
    const ownershipPath = path.join(value.homeDir, ".agents", "harness", "third-party-global-actions.json");
    await assert.rejects(
      applyThirdPartyGlobalActions({
        manifest,
        approvals: value.approvals(["codegraph"]),
        homeDir: value.homeDir,
        allowNetwork: true,
        runCommand: value.runCommand,
        faultInjector: async (phase) => {
          if (phase === "before-ownership") {
            mkdirSync(path.dirname(ownershipPath), { recursive: true });
            writeFileSync(ownershipPath, JSON.stringify({ schemaVersion: 1, owner: "trellis-ccg-harness", actions: { user: {} }, results: {} }));
          }
        },
      }),
      /ownership changed before commit/i,
    );
    assert.deepEqual(JSON.parse(readFileSync(ownershipPath, "utf8")).actions, { user: {} });
  } finally {
    value.cleanup();
  }
});

test("an owned npm tool path is never reused through a symbolic link or junction", async (t) => {
  const value = fixture();
  try {
    const first = await applyThirdPartyGlobalActions({ manifest, approvals: value.approvals(["codegraph"]), homeDir: value.homeDir, allowNetwork: true, runCommand: value.runCommand });
    assert.equal(first.actions[0].status, "installed");
    const target = first.actions[0].target;
    const outside = path.join(value.homeDir, "outside");
    mkdirSync(outside);
    rmSync(target, { recursive: true, force: true });
    try {
      symlinkSync(outside, target, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      t.skip(`cannot create test link on this host: ${error.message}`);
      return;
    }
    const repeated = await applyThirdPartyGlobalActions({ manifest, approvals: value.approvals(["codegraph"]), homeDir: value.homeDir, allowNetwork: true, runCommand: value.runCommand });
    assert.equal(repeated.status, "partial-failure");
    assert.match(repeated.actions[0].error, /non-linked|symbolic link|reparse/i);
    assert.equal(value.commands.filter((entry) => entry.command === "npm").length, 1);
  } finally { value.cleanup(); }
});

test("an owned npm tool with modified installed files is rejected before reuse", async () => {
  const value = fixture();
  try {
    const first = await applyThirdPartyGlobalActions({ manifest, approvals: value.approvals(["codegraph"]), homeDir: value.homeDir, allowNetwork: true, runCommand: value.runCommand });
    const script = path.join(first.actions[0].target, "node_modules", "@colbymchenry", "codegraph", "cli.js");
    writeFileSync(script, "tampered\n");
    const repeated = await applyThirdPartyGlobalActions({ manifest, approvals: value.approvals(["codegraph"]), homeDir: value.homeDir, allowNetwork: true, runCommand: value.runCommand });
    assert.equal(repeated.status, "partial-failure");
    assert.match(repeated.actions[0].error, /drifted.*fingerprint/i);
    assert.equal(value.commands.filter((entry) => entry.command === "npm").length, 1);
  } finally { value.cleanup(); }
});

test("fast-context is only acted on after plan approval and uses its exact immutable selector", async () => {
  const value = fixture();
  try {
    const result = await applyThirdPartyGlobalActions({ manifest, approvals: value.approvals(["fast-context"]), homeDir: value.homeDir, allowNetwork: true, runCommand: value.runCommand });
    assert.equal(result.actions[0].status, "installed");
    assert.match(JSON.stringify(value.commands), /fast-context-mcp@1\.5\.2/);
  } finally { value.cleanup(); }
});

test("unsupported ripgrep platform skips without a fallback or network call", async () => {
  const value = fixture();
  try {
    let fetched = false;
    const result = await applyThirdPartyGlobalActions({ manifest, approvals: value.approvals(["ripgrep"]), homeDir: value.homeDir, allowNetwork: true, platform: "freebsd-x64", runCommand: value.runCommand, fetchImpl: async () => { fetched = true; throw new Error("must not fetch"); } });
    assert.equal(result.actions[0].status, "skipped-unsupported-platform");
    assert.equal(fetched, false);
    assert.deepEqual(value.commands, []);
  } finally { value.cleanup(); }
});

test("supported ripgrep downloads, safely extracts, fingerprints the executable, and reuses it unchanged", async () => {
  const sourceManifest = structuredClone(manifest);
  const archive = Buffer.from("fixture archive");
  const ripgrep = sourceManifest.sources.find((entry) => entry.id === "ripgrep");
  const asset = ripgrep.assets.find((entry) => entry.platform === "win32-x64");
  asset.sha256 = createHash("sha256").update(archive).digest("hex");
  const value = fixture({ sourceManifest });
  try {
    let fetches = 0;
    const runCommand = async (command, args) => {
      value.commands.push({ command, args });
      if (command === "pwsh") {
        const destination = args.at(-1);
        mkdirSync(destination, { recursive: true });
        writeFileSync(path.join(destination, "rg.exe"), "fixture-rg");
      }
      return { stdout: "", exitCode: 0 };
    };
    const fetchImpl = async () => {
      fetches += 1;
      return {
        ok: true,
        arrayBuffer: async () => archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength),
      };
    };
    const first = await applyThirdPartyGlobalActions({
      manifest: sourceManifest,
      approvals: value.approvals(["ripgrep"]),
      homeDir: value.homeDir,
      allowNetwork: true,
      platform: "win32-x64",
      runCommand,
      fetchImpl,
    });
    assert.equal(first.actions[0].status, "installed");
    assert.equal(existsSync(first.actions[0].executable), true);
    assert.equal(readFileSync(first.actions[0].executable, "utf8"), "fixture-rg");
    const second = await applyThirdPartyGlobalActions({
      manifest: sourceManifest,
      approvals: value.approvals(["ripgrep"]),
      homeDir: value.homeDir,
      allowNetwork: true,
      platform: "win32-x64",
      runCommand,
      fetchImpl,
    });
    assert.equal(second.actions[0].status, "unchanged");
    assert.equal(fetches, 1);
  } finally { value.cleanup(); }
});

test("ripgrep extraction with no usable extractor result is failed and never recorded as installed", async () => {
  const sourceManifest = structuredClone(manifest);
  const archive = Buffer.from("fixture archive");
  const asset = sourceManifest.sources.find((entry) => entry.id === "ripgrep").assets.find((entry) => entry.platform === "win32-x64");
  asset.sha256 = createHash("sha256").update(archive).digest("hex");
  const value = fixture({ sourceManifest });
  try {
    const result = await applyThirdPartyGlobalActions({
      manifest: sourceManifest,
      approvals: value.approvals(["ripgrep"]),
      homeDir: value.homeDir,
      allowNetwork: true,
      platform: "win32-x64",
      runCommand: async () => ({ exitCode: 1 }),
      fetchImpl: async () => ({ ok: true, arrayBuffer: async () => archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) }),
    });
    assert.equal(result.status, "partial-failure");
    assert.equal(result.actions[0].status, "failed");
    assert.doesNotMatch(result.actions[0].status, /installed/);
  } finally { value.cleanup(); }
});
