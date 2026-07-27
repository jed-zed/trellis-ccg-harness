import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyThirdPartyGlobalActions as applyThirdPartyGlobalActionsRuntime,
  fingerprintPinnedNpmTool,
  normalizeAssetPlatform,
} from "../.agents/skills/harness-init/scripts/third-party-global-actions.mjs";
import {
  buildThirdPartyApprovalPlan,
  resolveThirdPartyApprovals,
} from "../.agents/skills/harness-init/scripts/third-party-approval.mjs";
import {
  assertTrustedCommandUnchanged,
  bindTrustedCommands,
  resolveTrustedCommand,
} from "../.agents/skills/harness-init/scripts/trusted-command-resolver.mjs";

const manifest = JSON.parse(readFileSync(new URL("../.agents/skills/harness-init/assets/third-party-sources.json", import.meta.url), "utf8"));
const approvalBindings = new WeakMap();

async function applyThirdPartyGlobalActions(options) {
  const binding = approvalBindings.get(options.approvals);
  if (!binding) return applyThirdPartyGlobalActionsRuntime(options);
  const { approvalPlan, approvals } = await binding;
  return applyThirdPartyGlobalActionsRuntime({
    ...options,
    approvals,
    approvalPlan,
    repoRoot: options.repoRoot ?? options.homeDir,
    strictDataBoundary: false,
  });
}

function manifestDigest(sourceManifest) {
  return createHash("sha256").update(`${JSON.stringify(sourceManifest, null, 2)}\n`).digest("hex");
}

function packageSourceFor(selector, sourceManifest = manifest) {
  const candidate = sourceManifest.candidates.find(
    (entry) => entry.packageSelector === selector,
  );
  return sourceManifest.sources.find((entry) => entry.id === candidate?.sourceId);
}

function materializePinnedPackage(args, { integrity, sourceManifest = manifest } = {}) {
  const prefix = args[args.indexOf("--prefix") + 1];
  const rootPackage = JSON.parse(readFileSync(path.join(prefix, "package.json"), "utf8"));
  const dependencies = Object.entries(rootPackage.dependencies ?? {});
  assert.equal(dependencies.length, 1);
  const [[name, version]] = dependencies;
  const selector = `${name}@${version}`;
  const source = packageSourceFor(selector, sourceManifest);
  const packageRoot = path.join(prefix, "node_modules", ...name.split("/"));
  mkdirSync(packageRoot, { recursive: true });
  const bin = source.id === "codegraph"
    ? "codegraph"
    : source.id === "context7"
      ? "context7-mcp"
      : "fast-context-mcp";
  writeFileSync(path.join(packageRoot, "cli.js"), "#!/usr/bin/env node\n");
  writeFileSync(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ name, version, bin: { [bin]: "cli.js" } }),
  );
  if (integrity) {
    const lockPath = path.join(prefix, "package-lock.json");
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    lock.packages[`node_modules/${name}`].integrity = integrity;
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  }
}

async function seedOwnedNpmTool(value, candidateId = "codegraph") {
  const candidate = manifest.candidates.find((entry) => entry.id === candidateId);
  const source = manifest.sources.find((entry) => entry.id === candidate.sourceId);
  const target = path.join(
    value.homeDir,
    ".agents",
    "harness",
    "tools",
    candidate.id,
    source.release,
  );
  mkdirSync(target, { recursive: true });
  const { name, version } = /^(?<name>(?:@[^/@]+\/)?[^@/]+)@(?<version>.+)$/.exec(candidate.packageSelector).groups;
  writeFileSync(path.join(target, "package.json"), `${JSON.stringify({
    private: true,
    dependencies: { [name]: version },
  }, null, 2)}\n`);
  const lockPath = fileURLToPath(new URL(
    `../.agents/skills/harness-init/assets/${source.packageLock.path}`,
    import.meta.url,
  ));
  copyFileSync(lockPath, path.join(target, "package-lock.json"));
  materializePinnedPackage(["ci", "--prefix", target]);
  const treeSha256 = await fingerprintPinnedNpmTool(target);
  const packageRoot = path.join(target, "node_modules", ...name.split("/"));
  const installed = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  const binRelative = typeof installed.bin === "string"
    ? installed.bin
    : installed.bin[candidate.entrypoint];
  const ownershipPath = path.join(
    value.homeDir,
    ".agents",
    "harness",
    "third-party-global-actions.json",
  );
  mkdirSync(path.dirname(ownershipPath), { recursive: true });
  writeFileSync(ownershipPath, `${JSON.stringify({
    schemaVersion: 1,
    owner: "trellis-ccg-harness",
    actions: {
      [candidate.id]: {
        packageInstalled: true,
        mcpConfigured: false,
        sourceManifestSha256: manifestDigest(manifest),
        packageSelector: candidate.packageSelector,
        packageIntegrity: source.packageIntegrity,
        packageLockSha256: source.packageLock.sha256,
        target,
        command: process.execPath,
        commandArgs: [path.resolve(packageRoot, binRelative)],
        treeSha256,
      },
    },
    results: {},
  }, null, 2)}\n`);
  return target;
}

function removeFixtureRoot(root) {
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; ; attempt += 1) {
    try {
      rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if (
        process.platform !== "win32" ||
        error?.code !== "EPERM" ||
        attempt >= 20
      ) {
        throw error;
      }
      Atomics.wait(sleeper, 0, 0, 100);
    }
  }
}

function fixture({
  integrity,
  sourceManifest = manifest,
  platform = process.platform,
  arch = process.arch,
} = {}) {
  const homeDir = mkdtempSync(path.join(os.tmpdir(), "harness-actions-"));
  const commands = [];
  const mcpServers = new Map();
  const commandPackageRoot = path.join(homeDir, "trusted-command-packages");
  for (const [packageName, binName] of [
    ["npm", "npm"],
    ["@openai/codex", "codex"],
  ]) {
    const packageRoot = path.join(
      commandPackageRoot,
      ...packageName.split("/"),
    );
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(path.join(packageRoot, `${binName}.js`), "#!/usr/bin/env node\n");
    writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({
      name: packageName,
      version: "1.2.3",
      bin: { [binName]: `${binName}.js` },
    }));
  }
  const commandRoot = path.join(homeDir, "trusted-native-commands");
  mkdirSync(commandRoot, { recursive: true });
  for (const name of ["git", "powershell", "tar"]) {
    const target = path.join(
      commandRoot,
      platform === "win32" ? `${name}.exe` : name,
    );
    if (platform === process.platform) {
      copyFileSync(process.execPath, target);
    } else if (platform === "win32") {
      writeFileSync(target, Buffer.from([0x4d, 0x5a, 0x00, 0x00]));
    } else {
      writeFileSync(target, Buffer.from([0x7f, 0x45, 0x4c, 0x46]), {
        mode: 0o755,
      });
    }
  }
  const approvalPlanPromise = buildThirdPartyApprovalPlan({
    manifest: sourceManifest,
    homeDir,
    repoRoot: homeDir,
    strictDataBoundary: false,
    approvedPackageRoots: [commandPackageRoot],
    approvedCommandRoots: [commandRoot],
    env: { PATH: commandRoot },
    platform,
    arch,
  });
  return {
    homeDir,
    commands,
    mcpServers,
    approvalPlanPromise,
    runCommand: async (command, args) => {
      commands.push({ command, args });
      if (command === "npm" && args[0] === "ci") {
        materializePinnedPackage(args, { integrity, sourceManifest });
      }
      if (command === "codex" && args.slice(0, 2).join(" ") === "mcp add") {
        const separator = args.indexOf("--");
        mcpServers.set(args[2], {
          name: args[2],
          enabled: true,
          transport: {
            type: "stdio",
            command: args[separator + 1],
            args: args.slice(separator + 2),
          },
        });
      }
      if (command === "codex" && args.slice(0, 3).join(" ") === "mcp list --json") {
        return { stdout: JSON.stringify([...mcpServers.values()]), exitCode: 0 };
      }
      return { stdout: "", exitCode: 0 };
    },
    approvals(ids, selections) {
      const byGroup = new Map(sourceManifest.candidates.map((candidate) => [candidate.id, candidate.group]));
      const explicitSelections = selections ?? {
        globalSkills: ids.filter((id) => byGroup.get(id) === "global-skills"),
        globalPlugins: ids.filter((id) => byGroup.get(id) === "global-plugins"),
        projectSkills: ids.filter((id) => byGroup.get(id) === "project-skills"),
        mcpCli: ids.filter((id) => byGroup.get(id) === "mcp-cli"),
      };
      const placeholder = {
        sourceManifestSha256: manifestDigest(sourceManifest),
        approvedActionIds: ids,
        selections: explicitSelections,
      };
      approvalBindings.set(placeholder, approvalPlanPromise.then((approvalPlan) => ({
        approvalPlan,
        approvals: {
          ...resolveThirdPartyApprovals({
            plan: approvalPlan,
            selections: explicitSelections,
          }),
          // Several fail-closed tests intentionally supply an inconsistent
          // direct action set. Preserve that input so the runtime, rather than
          // the fixture's resolver, is the layer that rejects it.
          approvedActionIds: [...ids],
        },
      })));
      return placeholder;
    },
    cleanup() { removeFixtureRoot(homeDir); },
  };
}

function materializePonytailSource(sourceRoot) {
  mkdirSync(path.join(sourceRoot, ".codex-plugin"), { recursive: true });
  const source = manifest.sources.find((entry) => entry.id === "ponytail");
  writeFileSync(
    path.join(sourceRoot, ".codex-plugin", "plugin.json"),
    JSON.stringify({
      name: "ponytail",
      version: source.release,
      license: source.license,
    }),
  );
}

function ponytailHostRunner(value, { initiallyInstalled = false } = {}) {
  const pluginTree = manifest.candidates.find((entry) => entry.id === "ponytail.install").sourceGitTree;
  const source = manifest.sources.find((entry) => entry.id === "ponytail");
  const sourceRoot = path.join(value.homeDir, "pinned-ponytail");
  const marketplaceName = `harness-ponytail-${source.commit.slice(0, 12)}`;
  const marketplaceRoot = path.join(
    value.homeDir,
    ".agents",
    "harness",
    "marketplaces",
    "ponytail",
    source.commit,
  );
  const pluginId = `ponytail@${marketplaceName}`;
  let marketplaceInstalled = initiallyInstalled;
  let installed = initiallyInstalled;
  return async (command, args) => {
    value.commands.push({ command, args });
    if (command === "git") return { stdout: `${pluginTree}\n`, exitCode: 0 };
    if (command === "codex" && args.slice(0, 4).join(" ") === "plugin marketplace list --json") {
      return {
        stdout: JSON.stringify({
          marketplaces: marketplaceInstalled ? [{ name: marketplaceName, root: marketplaceRoot }] : [],
        }),
        exitCode: 0,
      };
    }
    if (command === "codex" && args.slice(0, 4).join(" ") === "plugin list --available --json") {
      return {
        stdout: JSON.stringify({
          installed: installed
            ? [{
                pluginId,
                name: "ponytail",
                marketplaceName,
                version: source.release,
                installed: true,
                source: { source: "local", path: sourceRoot },
              }]
            : [],
          available: [],
        }),
        exitCode: 0,
      };
    }
    if (command === "codex" && args.slice(0, 3).join(" ") === "plugin marketplace add") marketplaceInstalled = true;
    if (command === "codex" && args.slice(0, 2).join(" ") === "plugin add") installed = true;
    return { stdout: "", exitCode: 0 };
  };
}

function simulatedHardKill(message = "simulated hard kill") {
  const error = new Error(message);
  error.code = "HARNESS_SIMULATED_HARD_KILL";
  return error;
}

test("trusted command resolution accepts only explicit package/native roots and binds exact identities", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "harness-command-resolver-"));
  try {
    for (const [packageName, binName, version] of [
      ["npm", "npm", "11.6.2"],
      ["@openai/codex", "codex", "0.142.0"],
      ["@google/gemini-cli", "gemini", "0.1.0"],
    ]) {
      const packageRoot = path.join(root, "node_modules", ...packageName.split("/"));
      mkdirSync(path.join(packageRoot, "bin"), { recursive: true });
      writeFileSync(path.join(packageRoot, "bin", `${binName}.js`), "#!/usr/bin/env node\n");
      writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({
        name: packageName,
        version,
        bin: { [binName]: `bin/${binName}.js` },
      }));
    }
    writeFileSync(path.join(root, "npm.cmd"), "@echo unsafe\n");
    writeFileSync(path.join(root, "codex.cmd"), "@echo unsafe\n");
    writeFileSync(path.join(root, "gemini.cmd"), "@echo unsafe\n");
    const env = { PATH: root };
    for (const name of ["npm", "codex", "gemini"]) {
      const binding = await resolveTrustedCommand(name, {
        env,
        platform: process.platform,
        approvedPackageRoots: [path.join(root, "node_modules")],
      });
      assert.equal(binding.command, path.resolve(process.execPath));
      assert.equal(binding.argsPrefix.length, 1);
      assert.match(
        binding.argsPrefix[0],
        name === "npm" ? /npm(?:-cli)?\.js$/ : new RegExp(`${name}\\.js$`),
      );
      assert.equal(binding.identity.kind, "node-package-bin");
      await assertTrustedCommandUnchanged(binding);
    }
    const grokName = process.platform === "win32" ? "grok.exe" : "grok";
    copyFileSync(process.execPath, path.join(root, grokName));
    const grok = await resolveTrustedCommand("grok", {
      env,
      platform: process.platform,
      approvedCommandRoots: [root],
    });
    assert.equal(grok.identity.kind, "native-binary");
    assert.equal(path.basename(grok.command), grokName);
    await assertTrustedCommandUnchanged(grok);
  } finally {
    removeFixtureRoot(root);
  }
});

test("PATH-prepended fake packages and binaries are not trusted without an approved root", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "harness-command-path-poison-"));
  try {
    for (const [packageName, binName] of [
      ["npm", "npm"],
      ["@openai/codex", "codex"],
      ["@google/gemini-cli", "gemini"],
    ]) {
      const packageRoot = path.join(root, "node_modules", ...packageName.split("/"));
      mkdirSync(path.join(packageRoot, "bin"), { recursive: true });
      writeFileSync(path.join(packageRoot, "bin", `${binName}.js`), "#!/usr/bin/env node\n");
      writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({
        name: packageName,
        version: "1.2.3",
        bin: { [binName]: `bin/${binName}.js` },
      }));
    }
    for (const name of ["codex", "git", "powershell", "tar", "grok"]) {
      const executable = path.join(root, process.platform === "win32" ? `${name}.exe` : name);
      copyFileSync(process.execPath, executable);
    }
    const env = { PATH: root };
    for (const name of ["npm", "codex", "gemini", "git", "powershell", "tar", "grok"]) {
      await assert.rejects(
        resolveTrustedCommand(name, {
          env,
          nodePath: name === "npm" ? path.join(root, "fake-node") : process.execPath,
          platform: process.platform,
        }),
        /trusted|approved|installation root/i,
        `${name} must reject the PATH-prepended fake`,
      );
    }
  } finally {
    removeFixtureRoot(root);
  }
});

test("environment-derived user and system roots never become trust anchors", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "harness-command-forged-roots-"));
  try {
    const packageRoot = path.join(root, "npm", "node_modules", "@openai", "codex");
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(path.join(packageRoot, "cli.js"), "#!/usr/bin/env node\n");
    writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({
      name: "@openai/codex",
      version: "1.2.3",
      bin: { codex: "cli.js" },
    }));
    const fakeNative = path.join(root, process.platform === "win32" ? "git.exe" : "git");
    copyFileSync(process.execPath, fakeNative);
    const env = {
      PATH: root,
      APPDATA: root,
      LOCALAPPDATA: root,
      ProgramFiles: root,
      "ProgramFiles(x86)": root,
      SystemRoot: root,
    };
    await assert.rejects(
      resolveTrustedCommand("codex", { env, platform: process.platform }),
      /trusted|approved|installation root/i,
    );
    await assert.rejects(
      resolveTrustedCommand("git", { env, platform: process.platform }),
      /approved|installation root/i,
    );
  } finally {
    removeFixtureRoot(root);
  }
});

test("approved package roots reject linked parents and package dependency drift", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "harness-command-tree-"));
  try {
    const realParent = path.join(root, "real");
    const packageRoot = path.join(realParent, "node_modules", "@google", "gemini-cli");
    const dependencyRoot = path.join(realParent, "node_modules", "fixture-dep");
    const dependency = path.join(dependencyRoot, "index.js");
    mkdirSync(packageRoot, { recursive: true });
    mkdirSync(path.dirname(dependency), { recursive: true });
    writeFileSync(path.join(packageRoot, "cli.js"), "#!/usr/bin/env node\n");
    writeFileSync(dependency, "export default 1;\n");
    writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({
      name: "@google/gemini-cli",
      version: "1.2.3",
      bin: { gemini: "cli.js" },
      dependencies: { "fixture-dep": "1.0.0" },
    }));
    writeFileSync(path.join(dependencyRoot, "package.json"), JSON.stringify({
      name: "fixture-dep",
      version: "1.0.0",
      main: "index.js",
    }));
    const binding = await resolveTrustedCommand("gemini", {
      env: {},
      approvedPackageRoots: [path.join(realParent, "node_modules")],
    });
    await assertTrustedCommandUnchanged(binding);
    writeFileSync(dependency, "export default 2;\n");
    await assert.rejects(
      assertTrustedCommandUnchanged(binding),
      /package tree changed/i,
    );

    const linkedParent = path.join(root, "linked");
    try {
      symlinkSync(realParent, linkedParent, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      t.diagnostic(`linked-parent assertion skipped on this host: ${error.message}`);
      return;
    }
    await assert.rejects(
      resolveTrustedCommand("gemini", {
        env: {},
        approvedPackageRoots: [path.join(linkedParent, "node_modules")],
      }),
      /linked parent|non-linked/i,
    );
  } finally {
    removeFixtureRoot(root);
  }
});

test("trusted command execution strips environment injection variables", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "harness-command-env-"));
  try {
    const packageRoot = path.join(root, "node_modules", "@google", "gemini-cli");
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(
      path.join(packageRoot, "cli.js"),
      "process.stdout.write(JSON.stringify({NODE_OPTIONS:process.env.NODE_OPTIONS,NODE_PATH:process.env.NODE_PATH,TAR_OPTIONS:process.env.TAR_OPTIONS,LD_PRELOAD:process.env.LD_PRELOAD,DYLD_INSERT_LIBRARIES:process.env.DYLD_INSERT_LIBRARIES,HOME:process.env.HOME}));\n",
    );
    writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({
      name: "@google/gemini-cli",
      version: "1.2.3",
      bin: { gemini: "cli.js" },
    }));
    const bound = await bindTrustedCommands(["gemini"], {
      approvedPackageRoots: [path.join(root, "node_modules")],
      env: {
        HOME: root,
        NODE_OPTIONS: "--no-warnings",
        NODE_PATH: root,
        TAR_OPTIONS: "--checkpoint-action=exec=malicious",
        LD_PRELOAD: "malicious.so",
        DYLD_INSERT_LIBRARIES: "malicious.dylib",
      },
    });
    const result = await bound.run("gemini", [], {
      env: {
        HOME: `${root}-override`,
        NODE_OPTIONS: "--trace-warnings",
        NODE_PATH: `${root}-override`,
        TAR_OPTIONS: "--to-command=malicious",
        LD_PRELOAD: "override.so",
        DYLD_INSERT_LIBRARIES: "override.dylib",
      },
    });
    assert.deepEqual(JSON.parse(result.stdout), { HOME: `${root}-override` });
  } finally {
    removeFixtureRoot(root);
  }
});

test("ripgrep asset platform defaults preserve the raw host platform for Ponytail", () => {
  assert.equal(
    normalizeAssetPlatform(process.platform, process.arch),
    `${process.platform}-${process.arch}`,
  );
  assert.equal(normalizeAssetPlatform("win32", "x64"), "win32-x64");
  assert.equal(normalizeAssetPlatform("linux", "arm64"), "linux-arm64");
});

test("npm .bin symlink targets and link text are validated and fingerprinted", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "harness-bin-link-"));
  try {
    const packageRoot = path.join(root, "node_modules", "fixture");
    const binRoot = path.join(root, "node_modules", ".bin");
    mkdirSync(packageRoot, { recursive: true });
    mkdirSync(binRoot, { recursive: true });
    writeFileSync(path.join(root, "package-lock.json"), "{}\n");
    writeFileSync(path.join(root, "package.json"), "{}\n");
    writeFileSync(path.join(packageRoot, "cli.js"), "one\n");
    writeFileSync(path.join(packageRoot, "other.js"), "two\n");
    const shim = path.join(binRoot, "fixture");
    try {
      symlinkSync("../fixture/cli.js", shim, "file");
    } catch (error) {
      t.skip(`cannot create test symlink on this host: ${error.message}`);
      return;
    }
    const first = await fingerprintPinnedNpmTool(root);
    unlinkSync(shim);
    symlinkSync("../fixture/other.js", shim, "file");
    const second = await fingerprintPinnedNpmTool(root);
    assert.notEqual(first, second);
    unlinkSync(shim);
    symlinkSync(path.join(packageRoot, "cli.js"), shim, "file");
    await assert.rejects(fingerprintPinnedNpmTool(root), /relative link target/i);
  } finally {
    removeFixtureRoot(root);
  }
});

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

test("global actions reject approval-plan or approval-evidence drift before host commands and writes", async () => {
  const value = fixture();
  try {
    const approvalPlan = await buildThirdPartyApprovalPlan({
      manifest,
      homeDir: value.homeDir,
      repoRoot: value.homeDir,
      strictDataBoundary: false,
    });
    const selections = {
      globalSkills: [],
      globalPlugins: [],
      projectSkills: [],
      mcpCli: ["codegraph"],
    };
    const approvals = resolveThirdPartyApprovals({ plan: approvalPlan, selections });
    const driftedPlan = structuredClone(approvalPlan);
    driftedPlan.strictDataBoundary = true;
    await assert.rejects(
      applyThirdPartyGlobalActionsRuntime({
        manifest,
        approvalPlan: driftedPlan,
        approvals,
        homeDir: value.homeDir,
        repoRoot: value.homeDir,
        allowNetwork: true,
        runCommand: value.runCommand,
        strictDataBoundary: false,
      }),
      /drifted after presentation|strict-data-boundary policy drifted/i,
    );
    const driftedApprovals = structuredClone(approvals);
    driftedApprovals.planEvidence.blockedCandidateIds.push("codegraph");
    await assert.rejects(
      applyThirdPartyGlobalActionsRuntime({
        manifest,
        approvalPlan,
        approvals: driftedApprovals,
        homeDir: value.homeDir,
        repoRoot: value.homeDir,
        allowNetwork: true,
        runCommand: value.runCommand,
        strictDataBoundary: false,
      }),
      /exact displayed approval plan/i,
    );
    assert.deepEqual(value.commands, []);
    assert.equal(
      existsSync(path.join(value.homeDir, ".agents", "harness", "third-party-global-actions.json")),
      false,
    );
  } finally { value.cleanup(); }
});

test("global actions reject command or package roots injected after displayed-plan approval", async () => {
  const value = fixture();
  try {
    const approvalPlan = await value.approvalPlanPromise;
    const approvals = resolveThirdPartyApprovals({
      plan: approvalPlan,
      selections: {
        globalSkills: [],
        globalPlugins: [],
        projectSkills: [],
        mcpCli: ["codegraph"],
      },
    });
    await assert.rejects(
      applyThirdPartyGlobalActionsRuntime({
        manifest,
        approvals,
        approvalPlan,
        homeDir: value.homeDir,
        repoRoot: value.homeDir,
        strictDataBoundary: false,
        allowNetwork: true,
        runCommand: value.runCommand,
        approvedPackageRoots: [path.join(value.homeDir, "late-package-root")],
        approvedCommandRoots: [path.join(value.homeDir, "late-command-root")],
      }),
      /post-approval|displayed plan|root injection/i,
    );
    assert.deepEqual(value.commands, []);
    await assert.rejects(
      applyThirdPartyGlobalActions({
        manifest,
        approvals,
        approvalPlan,
        homeDir: value.homeDir,
        repoRoot: value.homeDir,
        strictDataBoundary: false,
        allowNetwork: true,
        runCommand: value.runCommand,
        assetPlatform: "forged-platform-x64",
      }),
      /asset platform.*drifted|execution platform drifted/i,
    );
    assert.deepEqual(value.commands, []);
  } finally {
    value.cleanup();
  }
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
        runCommand: value.runCommand,
      }),
      /requires explicitly approved dependencies.*ponytail\.install/i,
    );
    assert.deepEqual(value.commands, []);
    assert.equal(existsSync(path.join(value.homeDir, ".config", "ponytail", "config.json")), false);
  } finally { value.cleanup(); }
});

test("Ponytail host and default configuration remain manual without create-only host APIs", async () => {
  const value = fixture();
  try {
    const sourceRoot = path.join(value.homeDir, "pinned-ponytail");
    materializePonytailSource(sourceRoot);
    const result = await applyThirdPartyGlobalActions({
      manifest,
      approvals: value.approvals(["ponytail.install", "ponytail.default-full"]),
      homeDir: value.homeDir,
      allowNetwork: true,
      sourceResolver: async () => sourceRoot,
      runCommand: ponytailHostRunner(value),
    });
    assert.deepEqual(result.actions.map((entry) => entry.id), ["ponytail.install"]);
    assert.equal(result.actions[0].status, "manual-pending");
    assert.match(result.actions[0].reason, /create-only|not proven/i);
    assert.equal(existsSync(path.join(value.homeDir, ".config", "ponytail", "config.json")), false);
    assert.equal(value.commands.some((entry) =>
      entry.command === "codex" && entry.args.includes("add")
    ), false);
    const ownership = JSON.parse(readFileSync(result.ownershipPath, "utf8"));
    assert.equal(ownership.actions["ponytail.install"], undefined);
    assert.equal(ownership.actions["ponytail.default-full"], undefined);
  } finally { value.cleanup(); }
});

test("Ponytail manual path preserves an existing user configuration", async () => {
  const value = fixture();
  try {
    const sourceRoot = path.join(value.homeDir, "pinned-ponytail");
    const configPath = path.join(value.homeDir, ".config", "ponytail", "config.json");
    materializePonytailSource(sourceRoot);
    mkdirSync(path.dirname(configPath), { recursive: true });
    const userBytes = "{\n  \"defaultMode\": \"review\",\n  \"userOption\": true\n}\n";
    writeFileSync(configPath, userBytes);
    const result = await applyThirdPartyGlobalActions({
      manifest,
      approvals: value.approvals(["ponytail.install", "ponytail.default-full"]),
      homeDir: value.homeDir,
      allowNetwork: true,
      sourceResolver: async () => sourceRoot,
      runCommand: ponytailHostRunner(value),
    });
    assert.equal(result.actions[0].status, "manual-pending");
    assert.equal(readFileSync(configPath, "utf8"), userBytes);
  } finally { value.cleanup(); }
});

test("Ponytail hooks stay pending behind the manual plugin action", async () => {
  const value = fixture();
  try {
    const sourceRoot = path.join(value.homeDir, "pinned-ponytail");
    materializePonytailSource(sourceRoot);
    const result = await applyThirdPartyGlobalActions({
      manifest,
      approvals: value.approvals(["ponytail.install", "ponytail.hooks"]),
      homeDir: value.homeDir,
      allowNetwork: true,
      sourceResolver: async () => sourceRoot,
      runCommand: ponytailHostRunner(value),
    });
    assert.deepEqual(result.actions.map((entry) => entry.id), ["ponytail.install"]);
    assert.equal(result.actions[0].status, "manual-pending");
    assert.equal(value.commands.some((entry) => entry.command === "codex" && entry.args.includes("add")), false);
  } finally { value.cleanup(); }
});

test("an existing unowned Ponytail host inventory is manual-pending and never re-added", async () => {
  const value = fixture();
  try {
    const sourceRoot = path.join(value.homeDir, "pinned-ponytail");
    materializePonytailSource(sourceRoot);
    const result = await applyThirdPartyGlobalActions({
      manifest,
      approvals: value.approvals(["ponytail.install"]),
      homeDir: value.homeDir,
      allowNetwork: true,
      sourceResolver: async () => sourceRoot,
      runCommand: ponytailHostRunner(value, { initiallyInstalled: true }),
    });
    assert.equal(result.actions[0].status, "manual-pending");
    assert.equal(value.commands.some((entry) =>
      entry.command === "codex" &&
      entry.args.slice(0, 3).join(" ") === "plugin marketplace add"
    ), false);
    assert.equal(value.commands.some((entry) =>
      entry.command === "codex" &&
      entry.args.slice(0, 2).join(" ") === "plugin add"
    ), false);
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

test("global actions pass every external command a minimal injection-free environment", async () => {
  const value = fixture();
  try {
    const observed = [];
    const runCommand = async (command, args, options) => {
      observed.push({ command, args, options });
      if (command === "npm") materializePinnedPackage(args);
      if (command === "codex" && args.slice(0, 3).join(" ") === "mcp list --json") {
        return { stdout: "[]", exitCode: 0 };
      }
      return { stdout: "", exitCode: 0 };
    };
    await applyThirdPartyGlobalActions({
      manifest,
      approvals: value.approvals(["codegraph"]),
      homeDir: value.homeDir,
      allowNetwork: true,
      runCommand,
      env: {
        HOME: value.homeDir,
        PATH: "attacker-path",
        NODE_OPTIONS: "--require=attacker.js",
        NODE_PATH: "attacker-node-path",
        TAR_OPTIONS: "--to-command=attacker",
        LD_PRELOAD: "attacker.so",
        DYLD_INSERT_LIBRARIES: "attacker.dylib",
      },
    });
    assert.ok(observed.length >= 1);
    for (const entry of observed) {
      assert.equal(entry.options.shell, false);
      assert.equal(entry.options.env.HOME, value.homeDir);
      for (const forbidden of [
        "PATH",
        "NODE_OPTIONS",
        "NODE_PATH",
        "TAR_OPTIONS",
        "LD_PRELOAD",
        "DYLD_INSERT_LIBRARIES",
      ]) {
        assert.equal(entry.options.env[forbidden], undefined);
      }
    }
  } finally {
    value.cleanup();
  }
});

test("CodeGraph uses exact selectors and integrity but leaves non-atomic MCP creation manual", async () => {
  const value = fixture();
  try {
    const result = await applyThirdPartyGlobalActions({ manifest, approvals: value.approvals(["codegraph"]), homeDir: value.homeDir, allowNetwork: true, runCommand: value.runCommand });
    assert.equal(result.status, "applied");
    const text = JSON.stringify(value.commands);
    assert.doesNotMatch(text, /(?:main|latest|codegraph init|npm view)/i);
    const npm = value.commands.find((entry) => entry.command === "npm");
    assert.deepEqual(npm.args.slice(0, 2), ["ci", "--prefix"]);
    assert.equal(npm.args.includes("--ignore-scripts"), true);
    const source = manifest.sources.find((entry) => entry.id === "codegraph");
    assert.equal(source.packageLock.sha256, "12ef016f442cf837e433e9a61488b1ec87d7df85490455df384b26a549d27847");
    assert.equal(result.actions[0].status, "manual-pending");
    assert.match(result.actions[0].reason, /create-only|overwrite/i);
    assert.equal(value.commands.some(
      (entry) =>
        entry.command === "codex" &&
        entry.args.slice(0, 2).join(" ") === "mcp add",
    ), false);
    assert.equal(value.commands.filter(
      (entry) =>
        entry.command === "codex" &&
        entry.args.slice(0, 3).join(" ") === "mcp list --json",
    ).length, 0);
  } finally { value.cleanup(); }
});

test("unknown MCP inventory remains manual and never mutates host configuration", async () => {
  const value = fixture();
  try {
    const runCommand = async (command, args) => {
      value.commands.push({ command, args });
      if (command === "npm") materializePinnedPackage(args);
      if (command === "codex" && args.slice(0, 3).join(" ") === "mcp list --json") {
        return { stdout: "", exitCode: 0 };
      }
      return { stdout: "", exitCode: 0 };
    };
    const result = await applyThirdPartyGlobalActions({
      manifest,
      approvals: value.approvals(["codegraph"]),
      homeDir: value.homeDir,
      allowNetwork: true,
      runCommand,
    });
    assert.equal(result.status, "applied");
    assert.equal(result.actions[0].status, "manual-pending");
    assert.match(result.actions[0].reason, /create-only.*tool-directory/i);
    assert.equal(value.commands.some(
      (entry) => entry.command === "codex" && entry.args.slice(0, 2).join(" ") === "mcp add",
    ), false);
    const ownership = JSON.parse(readFileSync(
      path.join(value.homeDir, ".agents", "harness", "third-party-global-actions.json"),
      "utf8",
    ));
    assert.equal(ownership.actions.codegraph, undefined);
  } finally { value.cleanup(); }
});

test("an existing conflicting or exact-but-unowned MCP is never overwritten or claimed", async () => {
  for (const existing of ["conflicting", "exact-unowned"]) {
    const value = fixture();
    try {
      const launcher = path.join(
        value.homeDir,
        ".agents",
        "skills",
        "harness-init",
        "scripts",
        "third-party-mcp-launcher.mjs",
      );
      const exactTransport = {
        type: "stdio",
        command: process.execPath,
        args: [launcher, "--home", value.homeDir, "--candidate", "codegraph"],
      };
      const server = existing === "exact-unowned"
        ? { name: "codegraph", enabled: true, transport: exactTransport }
        : {
            name: "codegraph",
            enabled: true,
            transport: {
              type: "stdio",
              command: process.execPath,
              args: ["user-owned-server.mjs"],
            },
          };
      value.mcpServers.set("codegraph", structuredClone(server));
      const result = await applyThirdPartyGlobalActions({
        manifest,
        approvals: value.approvals(["codegraph"]),
        homeDir: value.homeDir,
        allowNetwork: true,
        runCommand: value.runCommand,
      });
      assert.equal(result.status, "applied");
      assert.equal(result.actions[0].status, "manual-pending");
      assert.match(result.actions[0].reason, /create-only.*tool-directory/i);
      assert.equal(
        value.commands.some(
          (entry) =>
            entry.command === "codex" &&
            entry.args.slice(0, 2).join(" ") === "mcp add",
        ),
        false,
      );
      assert.deepEqual(value.mcpServers.get("codegraph"), server);
    } finally {
      value.cleanup();
    }
  }
});

test("Context7 installs only after explicit approval and keeps MCP host mutation manual", async () => {
  const value = fixture();
  try {
    const result = await applyThirdPartyGlobalActions({
      manifest,
      approvals: value.approvals(["context7"]),
      homeDir: value.homeDir,
      allowNetwork: true,
      runCommand: value.runCommand,
    });
    assert.equal(result.status, "applied");
    const npm = value.commands.find((entry) => entry.command === "npm");
    assert.equal(npm.args[0], "ci");
    assert.equal(npm.args.includes("--ignore-scripts"), true);
    const source = manifest.sources.find((entry) => entry.id === "context7");
    assert.equal(source.packageLock.sha256, "177549944f63b0186c070cf875c52737ab2842a8c943907e9e988186d8fea328");
    assert.equal(result.actions[0].status, "manual-pending");
    assert.equal(value.commands.some(
      (entry) =>
        entry.command === "codex" &&
        entry.args.slice(0, 2).join(" ") === "mcp add",
    ), false);
    assert.doesNotMatch(JSON.stringify(value.commands), /(?:main|latest|npm view)/i);
  } finally { value.cleanup(); }
});

test("an absent MCP remains manual across retries and is never added without create-only semantics", async () => {
  const value = fixture();
  try {
    let mcpAttempts = 0;
    const runCommand = async (command, args) => {
      value.commands.push({ command, args });
      if (command === "npm") materializePinnedPackage(args);
      if (command === "codex" && args.slice(0, 2).join(" ") === "mcp add") {
        mcpAttempts += 1;
      }
      if (command === "codex" && args.slice(0, 3).join(" ") === "mcp list --json") {
        return { stdout: "[]", exitCode: 0 };
      }
      return { stdout: "", exitCode: 0 };
    };
    const first = await applyThirdPartyGlobalActions({
      manifest,
      approvals: value.approvals(["codegraph"]),
      homeDir: value.homeDir,
      allowNetwork: true,
      runCommand,
    });
    assert.equal(first.status, "applied");
    assert.equal(first.actions[0].status, "manual-pending");
    const ownershipPath = path.join(value.homeDir, ".agents", "harness", "third-party-global-actions.json");
    const firstOwnership = JSON.parse(readFileSync(ownershipPath, "utf8"));
    assert.equal(firstOwnership.actions.codegraph, undefined);

    const second = await applyThirdPartyGlobalActions({
      manifest,
      approvals: value.approvals(["codegraph"]),
      homeDir: value.homeDir,
      allowNetwork: true,
      runCommand,
    });
    assert.equal(second.status, "applied");
    assert.equal(second.actions[0].status, "manual-pending");
    assert.equal(mcpAttempts, 0);
    const secondOwnership = JSON.parse(readFileSync(ownershipPath, "utf8"));
    assert.equal(secondOwnership.actions.codegraph, undefined);
    assert.equal(value.commands.filter((entry) => entry.command === "npm").length, 2);
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

test("a stale npm-ci journal is authenticated, blocks live recovery, and never replays an uncertain install", async () => {
  const value = fixture();
  try {
    const faultInjector = async (phase) => {
      if (phase === "after-side-effect:codegraph:npm-ci") throw simulatedHardKill();
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
    assert.equal(journal.steps.codegraph.effects["npm-ci"].state, "attempting");
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

test("manual tool publish never reaches MCP inventory or mutation", async () => {
  const value = fixture();
  try {
    let inspections = 0;
    const concurrent = {
      name: "codegraph",
      enabled: true,
      transport: {
        type: "stdio",
        command: process.execPath,
        args: ["user-owned-concurrent-server.mjs"],
      },
    };
    const runCommand = async (command, args) => {
      if (command === "codex" && args.slice(0, 3).join(" ") === "mcp list --json") {
        value.commands.push({ command, args });
        inspections += 1;
        return {
          stdout: JSON.stringify({
            servers: inspections === 1 ? [] : [concurrent],
          }),
          exitCode: 0,
        };
      }
      return value.runCommand(command, args);
    };
    const result = await applyThirdPartyGlobalActions({
      manifest,
      approvals: value.approvals(["codegraph"]),
      homeDir: value.homeDir,
      allowNetwork: true,
      runCommand,
    });
    assert.equal(result.status, "applied");
    assert.equal(result.actions[0].status, "manual-pending");
    assert.match(result.actions[0].reason, /create-only.*tool-directory/i);
    assert.equal(inspections, 0);
    assert.equal(value.commands.some((entry) =>
      entry.command === "codex" && entry.args.slice(0, 2).join(" ") === "mcp add"
    ), false);
    const ownership = JSON.parse(readFileSync(result.ownershipPath, "utf8"));
    assert.equal(ownership.actions.codegraph, undefined);
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
    assert.equal(ownership.actions.codegraph, undefined);
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
          if (phase === "after-intent:codegraph:npm-ci") throw simulatedHardKill();
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
      /approval plan|canonical plan|displayed approval plan/i,
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
    assert.match(result.actions[0].error, /package-lock.*(?:integrity|approved lock artifact)/i);
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
  let linkedTarget = null;
  try {
    const target = await seedOwnedNpmTool(value);
    const outside = path.join(value.homeDir, "outside");
    mkdirSync(outside);
    rmSync(target, { recursive: true, force: true });
    try {
      symlinkSync(outside, target, process.platform === "win32" ? "junction" : "dir");
      linkedTarget = target;
    } catch (error) {
      t.skip(`cannot create test link on this host: ${error.message}`);
      return;
    }
    const repeated = await applyThirdPartyGlobalActions({ manifest, approvals: value.approvals(["codegraph"]), homeDir: value.homeDir, allowNetwork: true, runCommand: value.runCommand });
    assert.equal(repeated.status, "partial-failure");
    assert.match(repeated.actions[0].error, /non-linked|symbolic link|reparse/i);
    assert.equal(value.commands.filter((entry) => entry.command === "npm").length, 0);
  } finally {
    if (linkedTarget && existsSync(linkedTarget)) unlinkSync(linkedTarget);
    value.cleanup();
  }
});

test("an owned npm tool with modified installed files is rejected before reuse", async () => {
  const value = fixture();
  try {
    const target = await seedOwnedNpmTool(value);
    const script = path.join(target, "node_modules", "@colbymchenry", "codegraph", "cli.js");
    writeFileSync(script, "tampered\n");
    const repeated = await applyThirdPartyGlobalActions({ manifest, approvals: value.approvals(["codegraph"]), homeDir: value.homeDir, allowNetwork: true, runCommand: value.runCommand });
    assert.equal(repeated.status, "partial-failure");
    assert.match(repeated.actions[0].error, /drifted.*fingerprint/i);
    assert.equal(value.commands.filter((entry) => entry.command === "npm").length, 0);
  } finally { value.cleanup(); }
});

test("fast-context is only acted on after plan approval and uses its exact immutable selector", async () => {
  const value = fixture();
  try {
    const result = await applyThirdPartyGlobalActions({ manifest, approvals: value.approvals(["fast-context"]), homeDir: value.homeDir, allowNetwork: true, runCommand: value.runCommand });
    assert.equal(result.actions[0].status, "manual-pending");
    assert.equal(value.commands.find((entry) => entry.command === "npm").args[0], "ci");
    assert.match(result.actions[0].reason, /create-only.*tool-directory/i);
    assert.equal(existsSync(result.actions[0].target), false);
  } finally { value.cleanup(); }
});

test("unsupported ripgrep platform skips without a fallback or network call", async () => {
  const value = fixture({ platform: "freebsd", arch: "x64" });
  try {
    let fetched = false;
    const result = await applyThirdPartyGlobalActions({ manifest, approvals: value.approvals(["ripgrep"]), homeDir: value.homeDir, allowNetwork: true, platform: "freebsd", arch: "x64", runCommand: value.runCommand, fetchImpl: async () => { fetched = true; throw new Error("must not fetch"); } });
    assert.equal(result.actions[0].status, "skipped-unsupported-platform");
    assert.equal(fetched, false);
    assert.deepEqual(value.commands, []);
  } finally { value.cleanup(); }
});

test("ripgrep rejects an unsafe asset basename before download or staging", async () => {
  const sourceManifest = structuredClone(manifest);
  const ripgrep = sourceManifest.sources.find((entry) => entry.id === "ripgrep");
  ripgrep.assets.find((entry) => entry.platform === "win32-x64").name = "../rg.zip";
  const value = fixture({ sourceManifest, platform: "win32", arch: "x64" });
  try {
    let fetched = false;
    await assert.rejects(
      applyThirdPartyGlobalActions({
        manifest: sourceManifest,
        approvals: value.approvals(["ripgrep"]),
        homeDir: value.homeDir,
        allowNetwork: true,
        platform: "win32",
        arch: "x64",
        runCommand: value.runCommand,
        fetchImpl: async () => {
          fetched = true;
          throw new Error("must not fetch");
        },
      }),
      /safe basename/i,
    );
    assert.equal(fetched, false);
  } finally {
    value.cleanup();
  }
});

test("ripgrep rejects tar symlink and hardlink inventory before extraction", async () => {
  const sourceManifest = structuredClone(manifest);
  const archive = Buffer.from("fixture tar archive");
  const asset = sourceManifest.sources
    .find((entry) => entry.id === "ripgrep")
    .assets.find((entry) => entry.platform === "linux-x64");
  asset.sha256 = createHash("sha256").update(archive).digest("hex");
  const value = fixture({ sourceManifest, platform: "linux", arch: "x64" });
  try {
    let extracted = false;
    const result = await applyThirdPartyGlobalActions({
      manifest: sourceManifest,
      approvals: value.approvals(["ripgrep"]),
      homeDir: value.homeDir,
      allowNetwork: true,
      platform: "linux",
      arch: "x64",
      runCommand: async (command, args) => {
        value.commands.push({ command, args });
        if (command !== "tar") return { stdout: "", exitCode: 0 };
        if (args[0] === "-tzf") return { stdout: "ripgrep/rg\n", exitCode: 0 };
        if (args[0] === "-tvzf") {
          return { stdout: "lrwxrwxrwx user/group 0 date ripgrep/rg -> ../../outside\n", exitCode: 0 };
        }
        extracted = true;
        return { stdout: "", exitCode: 0 };
      },
      fetchImpl: async () => ({
        ok: true,
        arrayBuffer: async () => archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength),
      }),
    });
    assert.equal(result.status, "partial-failure");
    assert.match(result.actions[0].error, /link or special member/i);
    assert.equal(extracted, false);
  } finally {
    value.cleanup();
  }
});

test("supported ripgrep verifies the pinned asset but leaves global publish manual", async () => {
  const sourceManifest = structuredClone(manifest);
  const archive = Buffer.from("fixture archive");
  const ripgrep = sourceManifest.sources.find((entry) => entry.id === "ripgrep");
  const asset = ripgrep.assets.find((entry) => entry.platform === "win32-x64");
  asset.sha256 = createHash("sha256").update(archive).digest("hex");
  const value = fixture({ sourceManifest, platform: "win32", arch: "x64" });
  try {
    let fetches = 0;
    const runCommand = async (command, args) => {
      value.commands.push({ command, args });
      if (command === "powershell") {
        const destination = args.at(-2);
        mkdirSync(path.dirname(destination), { recursive: true });
        writeFileSync(destination, "fixture-rg");
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
      platform: "win32",
      arch: "x64",
      runCommand,
      fetchImpl,
    });
    assert.equal(first.actions[0].status, "manual-pending");
    assert.match(first.actions[0].reason, /create-only.*tool-directory/i);
    assert.equal(existsSync(path.join(
      value.homeDir,
      ".agents",
      "harness",
      "tools",
      "ripgrep",
      ripgrep.release,
    )), false);
    const second = await applyThirdPartyGlobalActions({
      manifest: sourceManifest,
      approvals: value.approvals(["ripgrep"]),
      homeDir: value.homeDir,
      allowNetwork: true,
      platform: "win32",
      arch: "x64",
      runCommand,
      fetchImpl,
    });
    assert.equal(second.actions[0].status, "manual-pending");
    assert.equal(fetches, 2);
  } finally { value.cleanup(); }
});

test("ripgrep extraction with no usable extractor result is failed and never recorded as installed", async () => {
  const sourceManifest = structuredClone(manifest);
  const archive = Buffer.from("fixture archive");
  const asset = sourceManifest.sources.find((entry) => entry.id === "ripgrep").assets.find((entry) => entry.platform === "win32-x64");
  asset.sha256 = createHash("sha256").update(archive).digest("hex");
  const value = fixture({ sourceManifest, platform: "win32", arch: "x64" });
  try {
    const result = await applyThirdPartyGlobalActions({
      manifest: sourceManifest,
      approvals: value.approvals(["ripgrep"]),
      homeDir: value.homeDir,
      allowNetwork: true,
      platform: "win32",
      arch: "x64",
      runCommand: async () => ({ exitCode: 1 }),
      fetchImpl: async () => ({ ok: true, arrayBuffer: async () => archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) }),
    });
    assert.equal(result.status, "partial-failure");
    assert.equal(result.actions[0].status, "failed");
    assert.doesNotMatch(result.actions[0].status, /installed/);
  } finally { value.cleanup(); }
});
