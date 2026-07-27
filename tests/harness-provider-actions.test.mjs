import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { recordGlobalInitState } from "../.agents/skills/harness-init/scripts/guided-init.mjs";
import {
  executeProviderAction as executeProviderActionRuntime,
  fingerprintProtectedClaudeBoundary,
  planProviderAction as planProviderActionRuntime,
} from "../.agents/skills/harness-init/scripts/provider-actions.mjs";

async function resolveTestCommand(logicalName) {
  return {
    logicalName,
    command: process.execPath,
    argsPrefix: [`fixture-${logicalName}.mjs`],
    identity: { kind: "test-command", logicalName },
  };
}

function planProviderAction(options) {
  return planProviderActionRuntime({
    ...options,
    resolveCommand: resolveTestCommand,
  });
}

function executeProviderAction(options) {
  return executeProviderActionRuntime({
    ...options,
    resolveCommand: resolveTestCommand,
    verifyCommand: async () => {},
  });
}

async function temporaryHome() {
  return mkdtemp(path.join(os.tmpdir(), "harness-provider-actions-"));
}

function actionsWith(provider, action) {
  return {
    codex: provider === "codex" ? action : "later",
    gemini: provider === "gemini" ? action : "later",
    grok: provider === "grok" ? action : "later",
    claude: provider === "claude" ? action : "skip",
  };
}

async function recordPending(homeDir, provider, action) {
  const providerActions = actionsWith(provider, action);
  if (provider === "claude") providerActions.claude = action;
  const pendingProviderActions = [{
    provider,
    action,
    pending: true,
    executed: false,
    requiresSeparateApproval: true,
  }];
  await recordGlobalInitState({
    homeDir,
    catalog: { mode: "skip", repositoryPath: null },
    platformManifestPath: path.join(homeDir, "platform-manifest.json"),
    providerActions,
    pendingProviderActions,
  });
}

async function withHome(callback) {
  const homeDir = await temporaryHome();
  try {
    return await callback(homeDir);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
}

test("provider action plans are read-only and bind the exact pending state", async () => {
  await withHome(async (homeDir) => {
    await recordPending(homeDir, "codex", "login");
    const plan = await planProviderAction({ homeDir, provider: "codex", action: "login" });
    assert.equal(plan.execution.kind, "manual-only");
    assert.equal(
      plan.execution.reason,
      "provider-login-execution-not-provably-immutable",
    );
    assert.deepEqual(
      plan.execution.command,
      [process.execPath, "fixture-codex.mjs", "login"],
    );
    assert.match(plan.planSha256, /^[a-f0-9]{64}$/);
    await assert.rejects(
      planProviderAction({ homeDir, provider: "codex", action: "install" }),
      /exact pending action/i,
    );
  });
});

test("provider execution defaults to no effect without explicit approval", async () => {
  await withHome(async (homeDir) => {
    await recordPending(homeDir, "codex", "login");
    const plan = await planProviderAction({ homeDir, provider: "codex", action: "login" });
    let calls = 0;
    await assert.rejects(
      executeProviderAction({
        homeDir,
        provider: "codex",
        action: "login",
        planSha256: plan.planSha256,
        approved: false,
        runCommand: async () => { calls += 1; return { exitCode: 0 }; },
      }),
      /approved=true/i,
    );
    assert.equal(calls, 0);
  });
});

test("provider execution rejects plan drift before spawning a command", async () => {
  await withHome(async (homeDir) => {
    await recordPending(homeDir, "codex", "login");
    const plan = await planProviderAction({ homeDir, provider: "codex", action: "login" });
    await recordGlobalInitState({
      homeDir,
      catalog: { mode: "skip", repositoryPath: null },
      platformManifestPath: path.join(homeDir, "platform-manifest.json"),
      providerActions: { codex: "later", gemini: "later", grok: "later", claude: "skip" },
      pendingProviderActions: [],
    });
    let calls = 0;
    await assert.rejects(
      executeProviderAction({
        homeDir,
        provider: "codex",
        action: "login",
        planSha256: plan.planSha256,
        approved: true,
        runCommand: async () => { calls += 1; return { exitCode: 0 }; },
      }),
      /pending action|drift/i,
    );
    assert.equal(calls, 0);
  });
});

test("provider execution rejects executable identity drift before spawning", async () => {
  await withHome(async (homeDir) => {
    await recordPending(homeDir, "codex", "login");
    let revision = "a";
    const resolveCommand = async (logicalName) => ({
      logicalName,
      command: process.execPath,
      argsPrefix: ["fixture-codex.mjs"],
      identity: { kind: "test-command", logicalName, revision },
    });
    const plan = await planProviderActionRuntime({
      homeDir,
      provider: "codex",
      action: "login",
      resolveCommand,
    });
    revision = "b";
    let calls = 0;
    await assert.rejects(
      executeProviderActionRuntime({
        homeDir,
        provider: "codex",
        action: "login",
        planSha256: plan.planSha256,
        approved: true,
        resolveCommand,
        verifyCommand: async () => {},
        runCommand: async () => {
          calls += 1;
          return { exitCode: 0 };
        },
      }),
      /plan drifted/i,
    );
    assert.equal(calls, 0);
  });
});

test("Codex and Grok expose fixed auth-only guidance but never execute it", async () => {
  for (const [provider, command] of Object.entries({
    codex: [process.execPath, "fixture-codex.mjs", "login"],
    grok: [process.execPath, "fixture-grok.mjs", "login"],
  })) {
    await withHome(async (homeDir) => {
      await recordPending(homeDir, provider, "login");
      const plan = await planProviderAction({ homeDir, provider, action: "login" });
      assert.equal(plan.execution.kind, "manual-only");
      assert.equal(
        plan.execution.reason,
        "provider-login-execution-not-provably-immutable",
      );
      assert.deepEqual(plan.execution.command, command);
      let calls = 0;
      const result = await executeProviderAction({
        homeDir,
        provider,
        action: "login",
        planSha256: plan.planSha256,
        approved: true,
        runCommand: async () => {
          calls += 1;
          return { exitCode: 0 };
        },
      });
      assert.equal(result.status, "manual-only");
      assert.equal(result.executed, false);
      assert.deepEqual(result.execution.command, command);
      assert.equal(calls, 0);
    });
  }
  await withHome(async (homeDir) => {
    await recordPending(homeDir, "gemini", "login");
    const plan = await planProviderAction({
      homeDir,
      provider: "gemini",
      action: "login",
    });
    assert.equal(plan.execution.kind, "manual-only");
    let calls = 0;
    const result = await executeProviderAction({
      homeDir,
      provider: "gemini",
      action: "login",
      planSha256: plan.planSha256,
      approved: true,
      runCommand: async () => {
        calls += 1;
        return { exitCode: 0 };
      },
    });
    assert.equal(result.status, "manual-only");
    assert.equal(result.executed, false);
    assert.equal(calls, 0);
  });
});

test("untrusted provider command sources downgrade to manual-only without execution", async () => {
  for (const provider of ["codex", "grok"]) {
    await withHome(async (homeDir) => {
      await recordPending(homeDir, provider, "login");
      const resolveCommand = async () => {
        throw new Error("Provider executable is outside explicitly approved roots.");
      };
      const plan = await planProviderActionRuntime({
        homeDir,
        provider,
        action: "login",
        resolveCommand,
      });
      assert.deepEqual(plan.execution, {
        kind: "manual-only",
        reason: "provider-command-source-untrusted",
      });
      assert.match(plan.planSha256, /^[a-f0-9]{64}$/);
      let calls = 0;
      const result = await executeProviderActionRuntime({
        homeDir,
        provider,
        action: "login",
        planSha256: plan.planSha256,
        approved: true,
        resolveCommand,
        runCommand: async () => {
          calls += 1;
          return { exitCode: 0 };
        },
      });
      assert.equal(result.status, "manual-only");
      assert.equal(
        result.execution.reason,
        "provider-command-source-untrusted",
      );
      assert.equal(calls, 0);
    });
  }
});

test("installs and Claude are manual-only even with approval", async () => {
  await withHome(async (homeDir) => {
    await recordPending(homeDir, "codex", "install");
    const installPlan = await planProviderAction({ homeDir, provider: "codex", action: "install" });
    let calls = 0;
    const installResult = await executeProviderAction({
      homeDir,
      provider: "codex",
      action: "install",
      planSha256: installPlan.planSha256,
      approved: true,
      runCommand: async () => { calls += 1; return { exitCode: 0 }; },
    });
    assert.equal(installResult.status, "manual-only");
    assert.equal(installResult.executed, false);
    assert.equal(calls, 0);
  });
  await withHome(async (homeDir) => {
    await recordPending(homeDir, "claude", "login");
    const claudePlan = await planProviderAction({ homeDir, provider: "claude", action: "login" });
    assert.equal(claudePlan.execution.kind, "manual-only");
    const claudeResult = await executeProviderAction({
      homeDir,
      provider: "claude",
      action: "login",
      planSha256: claudePlan.planSha256,
      approved: true,
    });
    assert.equal(claudeResult.status, "manual-only");
    assert.equal(claudeResult.executed, false);
  });
});

test("manual-only logins never call a runner or create provider receipts", async () => {
  await withHome(async (homeDir) => {
    await recordPending(homeDir, "codex", "login");
    const plan = await planProviderAction({
      homeDir,
      provider: "codex",
      action: "login",
    });
    let calls = 0;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await executeProviderAction({
        homeDir,
        provider: "codex",
        action: "login",
        planSha256: plan.planSha256,
        approved: true,
        runCommand: async () => {
          calls += 1;
          return {
            exitCode: 0,
            stdout: "token=never-persist",
            stderr: "device-code=never-persist",
          };
        },
      });
      assert.equal(result.status, "manual-only");
      assert.equal(result.executed, false);
    }
    assert.equal(calls, 0);
    await assert.rejects(
      readFile(
        path.join(
          homeDir,
          ".agents",
          "harness",
          "provider-action-receipts",
          `${plan.planSha256}.json`,
        ),
      ),
      /ENOENT/,
    );
  });
});

test("ordinary .claude changes produce a different read-only fingerprint", async () => {
  await withHome(async (homeDir) => {
    const before = await fingerprintProtectedClaudeBoundary(homeDir);
    await mkdir(path.join(homeDir, ".claude"));
    await writeFile(
      path.join(homeDir, ".claude", "account.json"),
      "not-a-real-token",
    );
    const after = await fingerprintProtectedClaudeBoundary(homeDir);
    assert.notEqual(before.sha256, after.sha256);
    assert.equal(
      await readFile(path.join(homeDir, ".claude", "account.json"), "utf8"),
      "not-a-real-token",
    );
  });
});

test("retargeting a linked .claude entry changes its boundary fingerprint", async () => {
  await withHome(async (homeDir) => {
    const claudeDir = path.join(homeDir, ".claude");
    const firstTarget = path.join(homeDir, "claude-profile-a");
    const secondTarget = path.join(homeDir, "claude-profile-b");
    const profileLink = path.join(claudeDir, "profile");
    await mkdir(claudeDir);
    await mkdir(firstTarget);
    await mkdir(secondTarget);
    await symlink(
      firstTarget,
      profileLink,
      process.platform === "win32" ? "junction" : "dir",
    );
    const before = await fingerprintProtectedClaudeBoundary(homeDir);
    await rm(profileLink, { recursive: true, force: true });
    await symlink(
      secondTarget,
      profileLink,
      process.platform === "win32" ? "junction" : "dir",
    );
    const after = await fingerprintProtectedClaudeBoundary(homeDir);
    assert.notEqual(before.sha256, after.sha256);
  });
});

test("retargeting a .claude link during reachable-tree traversal is rejected", async () => {
  await withHome(async (homeDir) => {
    const claudeDir = path.join(homeDir, ".claude");
    const firstTarget = path.join(homeDir, "claude-profile-a");
    const secondTarget = path.join(homeDir, "claude-profile-b");
    const profileLink = path.join(claudeDir, "profile");
    await mkdir(claudeDir);
    await mkdir(firstTarget);
    await mkdir(secondTarget);
    await writeFile(path.join(firstTarget, "identity.txt"), "first");
    await writeFile(path.join(secondTarget, "identity.txt"), "second");
    await symlink(
      firstTarget,
      profileLink,
      process.platform === "win32" ? "junction" : "dir",
    );
    let retargeted = false;
    await assert.rejects(
      fingerprintProtectedClaudeBoundary(homeDir, {
        async onSymlinkTargetBound({ linkPath }) {
          if (linkPath !== profileLink) return;
          await rm(profileLink, { recursive: true, force: true });
          await symlink(
            secondTarget,
            profileLink,
            process.platform === "win32" ? "junction" : "dir",
          );
          retargeted = true;
        },
      }),
      /link changed while its reachable target was fingerprinted/i,
    );
    assert.equal(retargeted, true);
    assert.equal(
      await readFile(path.join(profileLink, "identity.txt"), "utf8"),
      "second",
    );
  });
});

test("mutating content reachable through a linked .claude target changes the fingerprint", async () => {
  await withHome(async (homeDir) => {
    const linkedTarget = path.join(homeDir, "claude-profile");
    const claudeLink = path.join(homeDir, ".claude");
    await mkdir(linkedTarget);
    await writeFile(path.join(linkedTarget, "account.json"), "before");
    await symlink(
      linkedTarget,
      claudeLink,
      process.platform === "win32" ? "junction" : "dir",
    );
    const before = await fingerprintProtectedClaudeBoundary(homeDir);
    await writeFile(path.join(claudeLink, "account.json"), "after");
    const after = await fingerprintProtectedClaudeBoundary(homeDir);
    assert.notEqual(before.sha256, after.sha256);
    assert.equal(
      await readFile(path.join(linkedTarget, "account.json"), "utf8"),
      "after",
    );
  });
});

test("linked .claude target cycles are fingerprinted without recursive traversal", async () => {
  await withHome(async (homeDir) => {
    const claudeDir = path.join(homeDir, ".claude");
    const linkedTarget = path.join(homeDir, "claude-profile");
    await mkdir(claudeDir);
    await mkdir(linkedTarget);
    await writeFile(path.join(linkedTarget, "account.json"), "unchanged");
    await symlink(
      linkedTarget,
      path.join(claudeDir, "profile"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await symlink(
      claudeDir,
      path.join(linkedTarget, "back"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const first = await fingerprintProtectedClaudeBoundary(homeDir);
    const second = await fingerprintProtectedClaudeBoundary(homeDir);
    assert.equal(first.sha256, second.sha256);
    assert.ok(first.entryCount < 20);
  });
});
