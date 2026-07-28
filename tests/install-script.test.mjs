import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const INSTALL_SCRIPT = path.join(REPO_ROOT, "scripts", "install.ps1");
const CCG_VERSION = "3.3.2";
const CCG_PLUGIN_VERSION = "3.3.2+codex.1";
const PLATFORM_SKILLS = [
  "harness-init",
  "trellis-before-dev",
  "trellis-brainstorm",
  "trellis-break-loop",
  "trellis-channel",
  "trellis-check",
  "trellis-continue",
  "trellis-finish-work",
  "trellis-meta",
  "trellis-session-insight",
  "trellis-spec-bootstrap",
  "trellis-start",
  "trellis-update-spec",
];

function writeJson(target, value) {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

function commandShimSource() {
  return `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [command, ...args] = process.argv.slice(2);
const statePath = process.env.MOCK_CODEX_STATE;
const logPath = process.env.MOCK_COMMAND_LOG;
appendFileSync(logPath, JSON.stringify({ command, args }) + "\\n");
const readState = () => JSON.parse(readFileSync(statePath, "utf8"));
const writeState = (value) => writeFileSync(statePath, JSON.stringify(value, null, 2) + "\\n");
const versionForRoot = (state, root) =>
  state.reportedPluginVersions?.[path.resolve(root)] ??
  state.reportedPluginVersion;

if (command === "trellis" && args[0] === "--version") {
  console.log("trellis 0.6.9");
} else if (command === "ccg" && args[0] === "--version") {
  console.log("${CCG_VERSION}");
} else if (command === "ccg" && args.join(" ") === "codex-mode install") {
  const state = readState();
  if (state.codexModeBehavior === "fail-create-claude") {
    writeFileSync(
      path.join(process.env.HOME, ".claude", "failed-codex-mode.txt"),
      "forbidden\\n",
    );
    console.error("Codex mode failed after changing .claude");
    process.exitCode = 92;
  } else if (state.codexModeBehavior === "fail-once") {
    state.codexModeBehavior = "normal";
    writeState(state);
    console.error("Codex mode failed once");
    process.exitCode = 93;
  } else {
    console.log("Codex mode installed");
  }
} else if (command === "codex" && args[0] === "--version") {
  console.log("codex-cli 0.142.0");
} else if (
  command === "codex" &&
  args.slice(0, 4).join(" ") === "plugin marketplace list --json"
) {
  console.log(JSON.stringify({ marketplaces: readState().marketplaces }));
} else if (
  command === "codex" &&
  args.slice(0, 4).join(" ") === "plugin list --available --json"
) {
  const state = readState();
  const marketplace = state.marketplaces.find((entry) => entry.name === "ccg-gptpro-worflow");
  const available = marketplace
    ? [{
        pluginId: "ccg@ccg-gptpro-worflow",
        name: "ccg",
        marketplaceName: "ccg-gptpro-worflow",
        version: versionForRoot(state, marketplace.root),
        installed: false,
        source: {
          source: "local",
          path: path.join(marketplace.root, "plugins", "ccg"),
        },
      }]
    : [];
  console.log(JSON.stringify({ installed: state.installed, available }));
} else if (
  command === "codex" &&
  args.slice(0, 3).join(" ") === "plugin marketplace add"
) {
  const state = readState();
  const root = path.resolve(args[3]);
  state.marketplaces.push({ name: "ccg-gptpro-worflow", root });
  writeState(state);
  console.log(JSON.stringify({ name: "ccg-gptpro-worflow", root }));
} else if (
  command === "codex" &&
  args.slice(0, 2).join(" ") === "plugin add"
) {
  const state = readState();
  if (state.pluginBehavior === "fail-create-claude") {
    writeFileSync(
      path.join(process.env.HOME, ".claude", "failed-plugin-add.txt"),
      "forbidden\\n",
    );
    console.error("Codex plugin add failed after changing .claude");
    process.exitCode = 94;
  } else {
    const marketplace = state.marketplaces.find((entry) => entry.name === "ccg-gptpro-worflow");
    if (state.pluginBehavior === "fail-once") {
      state.pluginBehavior = "normal";
      writeState(state);
      console.error("Codex plugin add failed once");
      process.exitCode = 95;
    } else {
      state.installed.push({
        pluginId: "ccg@ccg-gptpro-worflow",
        name: "ccg",
        marketplaceName: "ccg-gptpro-worflow",
        version: versionForRoot(state, marketplace.root),
        installed: true,
        enabled: true,
        source: {
          source: "local",
          path: path.join(marketplace.root, "plugins", "ccg"),
        },
      });
      writeState(state);
      console.log(JSON.stringify({ pluginId: args[2], installed: true }));
    }
  }
} else if (
  command === "codex" &&
  args.slice(0, 2).join(" ") === "plugin remove"
) {
  const state = readState();
  state.installed = state.installed.filter((entry) => entry.pluginId !== args[2]);
  writeState(state);
  console.log(JSON.stringify({ pluginId: args[2], removed: true }));
} else if (
  command === "codex" &&
  args.slice(0, 3).join(" ") === "plugin marketplace remove"
) {
  const state = readState();
  state.marketplaces = state.marketplaces.filter((entry) => entry.name !== args[3]);
  writeState(state);
  console.log(JSON.stringify({ name: args[3], removed: true }));
} else {
  console.error("Unexpected mock command:", command, args.join(" "));
  process.exitCode = 91;
}
`;
}

function globalInitSource() {
  return `import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
if (args[0] === "third-party-plan") {
  appendFileSync(process.env.MOCK_COMMAND_LOG, JSON.stringify({
    command: "third-party-plan",
    args,
  }) + "\\n");
  console.log(JSON.stringify({ sourceManifestSha256: "f".repeat(64) }));
  process.exit(0);
}
appendFileSync(process.env.MOCK_COMMAND_LOG, JSON.stringify({
  command: "global-init",
  args,
}) + "\\n");
const value = (flag) => args[args.indexOf(flag) + 1];
const homeDir = value("--home-dir");
const providerText = value("--provider-actions");
const actions = Object.fromEntries(
  providerText.split(",").map((entry) => entry.split("=")),
);
const skillRoot = path.join(homeDir, ".agents", "skills");
const names = ${JSON.stringify(PLATFORM_SKILLS)};
const managedPlatformSkills = names.map((name) => {
  const targetPath = path.join(skillRoot, name);
  mkdirSync(targetPath, { recursive: true });
  writeFileSync(path.join(targetPath, "SKILL.md"), "# " + name + "\\n");
  return {
    name,
    targetPath,
    treeSha256: "0".repeat(64),
    fileCount: 1,
    totalBytes: name.length + 3,
  };
});
const harnessRoot = path.join(homeDir, ".agents", "harness");
mkdirSync(harnessRoot, { recursive: true });
writeFileSync(
  path.join(harnessRoot, "global-skills.json"),
  JSON.stringify({
    schemaVersion: 1,
    owner: "trellis-ccg-harness",
    installMode: "copy",
    managedPlatformSkills,
  }, null, 2) + "\\n",
);
const pendingProviderActions = Object.entries(actions)
  .filter(([, action]) => ["install", "login"].includes(action))
  .map(([provider, action]) => ({
    provider,
    status: provider === "gemini" ? "not-installed" : "authentication-unknown",
    action,
    pending: true,
    executed: false,
    requiresSeparateApproval: true,
    guidance: {
      kind: "official-documentation",
      reference: provider + " official documentation",
    },
  }));
writeFileSync(
  path.join(harnessRoot, "global-init.json"),
  JSON.stringify({
    schemaVersion: 1,
    owner: "trellis-ccg-harness",
    providerActions: actions,
    pendingProviderActions,
    zeroClaudeProfile: !["install", "login", "keep"].includes(actions.claude),
  }, null, 2) + "\\n",
);
console.log(JSON.stringify({
  status: pendingProviderActions.length ? "needs-provider-actions" : "initialized",
  platform: {
    status: "installed",
    installedSkills: names,
  },
  pendingProviderActions,
  zeroClaudeProfile: !["install", "login", "keep"].includes(actions.claude),
}));
`;
}

function fixture({
  createClaudeTrees = true,
  mutateClaudeDuringBootstrap = false,
  codexModeBehavior = "normal",
  pluginBehavior = "normal",
  pluginManifestVersion = CCG_PLUGIN_VERSION,
  reportedPluginVersion = CCG_PLUGIN_VERSION,
} = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "harness-setup-"));
  const repoRoot = path.join(root, "repo");
  const homeDir = path.join(root, "home");
  const binDir = path.join(root, "bin");
  const logPath = path.join(root, "commands.jsonl");
  const statePath = path.join(root, "codex-state.json");
  const ccgRoot = path.join(repoRoot, "components", "ccg-workflow");
  mkdirSync(path.join(ccgRoot, "plugins", "ccg"), { recursive: true });
  mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  if (createClaudeTrees) {
    mkdirSync(path.join(homeDir, ".claude"), { recursive: true });
    mkdirSync(path.join(repoRoot, ".claude"), { recursive: true });
    writeFileSync(path.join(homeDir, ".claude", "user.txt"), "preserve-user\n");
    writeFileSync(
      path.join(repoRoot, ".claude", "project.txt"),
      "preserve-project\n",
    );
  }
  writeFileSync(logPath, "");
  writeJson(statePath, {
    marketplaces: [],
    installed: [],
    codexModeBehavior,
    pluginBehavior,
    reportedPluginVersion,
  });
  writeJson(path.join(repoRoot, "harness.sources.json"), {
    trellis: {
      package: "@mindfoldhq/trellis",
      version: "0.6.9",
    },
    ccg: {
      package: "ccg-workflow",
      version: CCG_VERSION,
      snapshotPath: "components/ccg-workflow",
    },
  });
  writeJson(path.join(ccgRoot, "package.json"), {
    name: "ccg-workflow",
    version: CCG_VERSION,
  });
  writeJson(path.join(ccgRoot, ".codex-plugin", "marketplace.json"), {
    name: "ccg-gptpro-worflow",
    plugins: [
      {
        name: "ccg",
        version: CCG_VERSION,
        source: "./plugins/ccg",
      },
    ],
  });
  writeJson(
    path.join(ccgRoot, "plugins", "ccg", ".codex-plugin", "plugin.json"),
    {
      name: "ccg",
      version: pluginManifestVersion,
    },
  );
  const bootstrapMutation = mutateClaudeDuringBootstrap
    ? `Set-Content -LiteralPath (Join-Path $env:HOME ".claude/user.txt") -Value "changed"`
    : "";
  writeFileSync(
    path.join(repoRoot, "scripts", "bootstrap.ps1"),
    `param(
  [string]$RepoRoot,
  [switch]$LinkCcg,
  [string]$CcgSetupTargetVersion,
  [string]$CcgSetupPreviousPluginVersion,
  [string]$AuthoritativeCcgCheckout
)
Add-Content -LiteralPath $env:MOCK_COMMAND_LOG -Value '{"command":"bootstrap"}'
${bootstrapMutation}
`,
  );
  writeFileSync(
    path.join(repoRoot, "scripts", "doctor.ps1"),
    `param([string]$RepoRoot, [string]$AuthoritativeCheckout)
Add-Content -LiteralPath $env:MOCK_COMMAND_LOG -Value '{"command":"doctor"}'
`,
  );
  writeFileSync(
    path.join(repoRoot, "scripts", "harness-init.mjs"),
    globalInitSource(),
  );
  writeFileSync(path.join(binDir, "mock-cli.mjs"), commandShimSource());
  for (const command of ["codex", "ccg", "trellis"]) {
    const unixPath = path.join(binDir, command);
    writeFileSync(
      unixPath,
      `#!/bin/sh\nexec node "$(dirname "$0")/mock-cli.mjs" ${command} "$@"\n`,
    );
    chmodSync(unixPath, 0o755);
    writeFileSync(
      path.join(binDir, `${command}.cmd`),
      `@echo off\r\nnode "%~dp0mock-cli.mjs" ${command} %*\r\n`,
    );
  }
  return {
    root,
    repoRoot,
    homeDir,
    binDir,
    logPath,
    statePath,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function setupArgs(value, extra = []) {
  return [
    "-NoProfile",
    "-File",
    INSTALL_SCRIPT,
    "-RepoRoot",
    value.repoRoot,
    "-HomeDir",
    value.homeDir,
    "-NonInteractive",
    "-Approved",
    "-ApproveTrellis",
    "-ApproveCcgCli",
    "-ApproveCodexMode",
    "-ApproveCcgPlugin",
    "-ApproveGlobalInit",
    "-CatalogMode",
    "skip",
    "-ProviderActions",
    "codex=keep,gemini=install,grok=later,claude=skip",
    ...extra,
  ];
}

function runSetup(value, extra = []) {
  return spawnSync("pwsh", setupArgs(value, extra), {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${value.binDir}${path.delimiter}${process.env.PATH ?? ""}`,
      MOCK_CODEX_STATE: value.statePath,
      MOCK_COMMAND_LOG: value.logPath,
    },
  });
}

function setupDiagnostic(result) {
  return stripVTControlCharacters(
    [result.stdout, result.stderr].filter(Boolean).join("\n"),
  ).replace(/\s+/g, " ").trim();
}

function commandLog(value) {
  return readFileSync(value.logPath, "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function installOwnedPreviousPlugin(value, {
  version = "3.3.1",
  pluginVersion = `${version}+codex.1`,
} = {}) {
  const marketplaceRoot = path.join(value.root, "previous-ccg");
  const pluginSource = path.join(marketplaceRoot, "plugins", "ccg");
  mkdirSync(path.join(pluginSource, ".codex-plugin"), { recursive: true });
  writeJson(path.join(marketplaceRoot, ".codex-plugin", "marketplace.json"), {
    name: "ccg-gptpro-worflow",
    plugins: [{
      name: "ccg",
      version,
      source: "./plugins/ccg",
    }],
  });
  writeJson(path.join(pluginSource, ".codex-plugin", "plugin.json"), {
    name: "ccg",
    version: pluginVersion,
  });
  writeJson(
    path.join(value.homeDir, ".agents", "harness", "codex-plugin.json"),
    {
      schemaVersion: 1,
      owner: "trellis-ccg-harness",
      marketplace: {
        name: "ccg-gptpro-worflow",
        sourceRoot: marketplaceRoot,
      },
      plugin: {
        id: "ccg@ccg-gptpro-worflow",
        baseVersion: version,
        version: pluginVersion,
        sourcePath: pluginSource,
      },
    },
  );
  const state = JSON.parse(readFileSync(value.statePath, "utf8"));
  state.marketplaces = [{
    name: "ccg-gptpro-worflow",
    root: marketplaceRoot,
  }];
  state.installed = [{
    pluginId: "ccg@ccg-gptpro-worflow",
    name: "ccg",
    marketplaceName: "ccg-gptpro-worflow",
    version: pluginVersion,
    installed: true,
    enabled: true,
    source: {
      source: "local",
      path: pluginSource,
    },
  }];
  state.reportedPluginVersions = {
    [path.resolve(marketplaceRoot)]: pluginVersion,
    [path.resolve(
      value.repoRoot,
      "components",
      "ccg-workflow",
    )]: CCG_PLUGIN_VERSION,
  };
  writeJson(value.statePath, state);
  return { marketplaceRoot, pluginSource, version, pluginVersion };
}

test("non-interactive Global Setup is explicit, exact, provider-safe, and idempotent", () => {
  const value = fixture();
  try {
    const first = runSetup(value);
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
    assert.match(first.stdout, /CCG CLI: build\/link exact 3\.3\.2/);
    assert.match(
      first.stdout,
      /Codex plugin: ccg@ccg-gptpro-worflow@3\.3\.2\+codex\.1/,
    );
    assert.match(first.stdout, /needs-provider-actions/);
    assert.match(first.stdout, /gemini: install/);
    assert.match(
      first.stdout,
      /Catalog network: False; third-party network: False/i,
    );
    assert.match(first.stdout, /provider-action-plan/);
    assert.match(first.stdout, /manual-only/);
    assert.match(first.stdout, /\.claude state: unchanged/);
    assert.equal(
      readFileSync(path.join(value.homeDir, ".claude", "user.txt"), "utf8"),
      "preserve-user\n",
    );
    assert.equal(
      readFileSync(path.join(value.repoRoot, ".claude", "project.txt"), "utf8"),
      "preserve-project\n",
    );
    assert.equal(
      existsSync(
        path.join(value.homeDir, ".agents", "harness", "codex-plugin.json"),
      ),
      true,
    );
    const pluginOwnership = JSON.parse(
      readFileSync(
        path.join(value.homeDir, ".agents", "harness", "codex-plugin.json"),
        "utf8",
      ),
    );
    assert.equal(pluginOwnership.plugin.version, CCG_PLUGIN_VERSION);
    const firstCalls = commandLog(value);
    const pluginInstallIndex = firstCalls.findIndex(
      ({ command, args }) =>
        command === "codex" &&
        args.slice(0, 2).join(" ") === "plugin add",
    );
    const codexModeIndex = firstCalls.findIndex(
      ({ command, args }) =>
        command === "ccg" && args.join(" ") === "codex-mode install",
    );
    assert.ok(pluginInstallIndex >= 0);
    assert.ok(codexModeIndex > pluginInstallIndex);
    const finalDoctorIndex = firstCalls.findIndex(
      ({ command }) => command === "doctor",
    );
    const globalInitIndex = firstCalls.findIndex(
      ({ command }) => command === "global-init",
    );
    assert.ok(finalDoctorIndex > codexModeIndex);
    assert.ok(globalInitIndex > finalDoctorIndex);
    const globalSkills = JSON.parse(
      readFileSync(
        path.join(value.homeDir, ".agents", "harness", "global-skills.json"),
        "utf8",
      ),
    );
    assert.equal(globalSkills.managedPlatformSkills.length, 13);
    const firstGlobalInit = commandLog(value).find(
      ({ command }) => command === "global-init",
    );
    assert.ok(firstGlobalInit);
    for (const flag of [
      "--third-party-global-skills",
      "--third-party-global-plugins",
      "--third-party-mcp-cli",
    ]) {
      assert.equal(
        firstGlobalInit.args[firstGlobalInit.args.indexOf(flag) + 1],
        "none",
      );
    }
    assert.equal(
      firstGlobalInit.args[
        firstGlobalInit.args.indexOf("--third-party-source-sha256") + 1
      ],
      "f".repeat(64),
    );
    assert.equal(
      commandLog(value).some(({ command }) => command === "third-party-plan"),
      true,
    );

    const second = runSetup(value);
    assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
    const calls = commandLog(value);
    assert.equal(
      calls.filter(
        ({ command, args }) =>
          command === "codex" &&
          args.slice(0, 3).join(" ") === "plugin marketplace add",
      ).length,
      1,
    );
    assert.equal(
      calls.filter(
        ({ command, args }) =>
          command === "codex" &&
          args.slice(0, 2).join(" ") === "plugin add",
      ).length,
      1,
    );
    assert.equal(
      calls.some(
        ({ command, args }) =>
          ["codex", "gemini", "grok", "claude"].includes(command) &&
          args.some((entry) => ["login", "install"].includes(entry)) &&
          !(command === "codex" && args[0] === "plugin"),
      ),
      false,
    );
    for (const relativePath of [
      ".agents/skills/grill-me",
      ".agents/skills/grilling",
      ".agents/skills/caveman",
      ".agents/harness/sources/ponytail",
      ".agents/harness/tools/codegraph",
      ".agents/harness/tools/fast-context",
    ]) {
      assert.equal(existsSync(path.join(value.homeDir, relativePath)), false);
    }
  } finally {
    value.cleanup();
  }
});

test("interactive Global Setup leaves third-party choices to the CLI prompts", () => {
  const value = fixture({ createClaudeTrees: false });
  try {
    const args = setupArgs(value).filter((entry) => entry !== "-NonInteractive");
    const result = spawnSync("pwsh", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${value.binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        MOCK_CODEX_STATE: value.statePath,
        MOCK_COMMAND_LOG: value.logPath,
      },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const globalInit = commandLog(value).find(
      ({ command }) => command === "global-init",
    );
    assert.ok(globalInit);
    for (const option of [
      "--third-party-global-skills",
      "--third-party-global-plugins",
      "--third-party-mcp-cli",
      "--third-party-source-sha256",
    ]) {
      assert.equal(globalInit.args.includes(option), false);
    }
    assert.match(
      readFileSync(INSTALL_SCRIPT, "utf8"),
      /if \(\$NonInteractive\) \{[\s\S]*--third-party-global-skills[\s\S]*"none"/,
    );
  } finally {
    value.cleanup();
  }
});

test("Codex may report the exact marketplace base version for the same plugin snapshot", () => {
  const value = fixture({ reportedPluginVersion: CCG_VERSION });
  try {
    const result = runSetup(value);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const ownership = JSON.parse(
      readFileSync(
        path.join(value.homeDir, ".agents", "harness", "codex-plugin.json"),
        "utf8",
      ),
    );
    assert.equal(ownership.plugin.version, CCG_PLUGIN_VERSION);
  } finally {
    value.cleanup();
  }
});

test("Global Setup accepts a newer immutable CCG version recorded by the Harness", () => {
  const value = fixture();
  try {
    const version = "3.4.1";
    const pluginVersion = `${version}+codex.1`;
    const ccgRoot = path.join(
      value.repoRoot,
      "components",
      "ccg-workflow",
    );
    const sourceManifestPath = path.join(value.repoRoot, "harness.sources.json");
    const sourceManifest = JSON.parse(readFileSync(sourceManifestPath, "utf8"));
    sourceManifest.ccg.version = version;
    writeJson(sourceManifestPath, sourceManifest);
    writeJson(path.join(ccgRoot, "package.json"), {
      name: "ccg-workflow",
      version,
    });
    writeJson(path.join(ccgRoot, ".codex-plugin", "marketplace.json"), {
      name: "ccg-gptpro-worflow",
      plugins: [{
        name: "ccg",
        version,
        source: "./plugins/ccg",
      }],
    });
    writeJson(
      path.join(ccgRoot, "plugins", "ccg", ".codex-plugin", "plugin.json"),
      { name: "ccg", version: pluginVersion },
    );
    const state = JSON.parse(readFileSync(value.statePath, "utf8"));
    state.reportedPluginVersion = pluginVersion;
    writeJson(value.statePath, state);

    const result = runSetup(value, ["-PreviewOnly"]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /CCG CLI: build\/link exact 3\.4\.1 snapshot/);
  } finally {
    value.cleanup();
  }
});

test("Global Setup transactionally upgrades an exact Harness-owned Codex plugin", () => {
  const value = fixture();
  try {
    installOwnedPreviousPlugin(value);
    const result = runSetup(value);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const ownership = JSON.parse(
      readFileSync(
        path.join(value.homeDir, ".agents", "harness", "codex-plugin.json"),
        "utf8",
      ),
    );
    assert.equal(ownership.plugin.version, CCG_PLUGIN_VERSION);
    assert.equal(
      path.resolve(ownership.marketplace.sourceRoot),
      path.resolve(value.repoRoot, "components", "ccg-workflow"),
    );
    const state = JSON.parse(readFileSync(value.statePath, "utf8"));
    assert.equal(state.installed.length, 1);
    assert.equal(state.installed[0].version, CCG_PLUGIN_VERSION);
    assert.equal(
      path.resolve(state.installed[0].source.path),
      path.resolve(
        value.repoRoot,
        "components",
        "ccg-workflow",
        "plugins",
        "ccg",
      ),
    );
    const calls = commandLog(value);
    const removePlugin = calls.findIndex(
      ({ command, args }) =>
        command === "codex" &&
        args.slice(0, 2).join(" ") === "plugin remove",
    );
    const removeMarketplace = calls.findIndex(
      ({ command, args }) =>
        command === "codex" &&
        args.slice(0, 3).join(" ") === "plugin marketplace remove",
    );
    const addMarketplace = calls.findIndex(
      ({ command, args }) =>
        command === "codex" &&
        args.slice(0, 3).join(" ") === "plugin marketplace add",
    );
    const addPlugin = calls.findIndex(
      ({ command, args }) =>
        command === "codex" &&
        args.slice(0, 2).join(" ") === "plugin add",
    );
    assert.ok(removePlugin >= 0);
    assert.ok(removeMarketplace > removePlugin);
    assert.ok(addMarketplace > removeMarketplace);
    assert.ok(addPlugin > addMarketplace);
  } finally {
    value.cleanup();
  }
});

test("a failed owned Codex plugin upgrade restores the previous registration", () => {
  const value = fixture();
  try {
    const previous = installOwnedPreviousPlugin(value);
    const beforeOwnership = readFileSync(
      path.join(value.homeDir, ".agents", "harness", "codex-plugin.json"),
    );
    const state = JSON.parse(readFileSync(value.statePath, "utf8"));
    state.pluginBehavior = "fail-once";
    writeJson(value.statePath, state);

    const result = runSetup(value);
    assert.notEqual(result.status, 0);
    assert.match(setupDiagnostic(result), /plugin add failed once/i);
    assert.deepEqual(
      readFileSync(
        path.join(value.homeDir, ".agents", "harness", "codex-plugin.json"),
      ),
      beforeOwnership,
    );
    const restored = JSON.parse(readFileSync(value.statePath, "utf8"));
    assert.deepEqual(restored.marketplaces, [{
      name: "ccg-gptpro-worflow",
      root: previous.marketplaceRoot,
    }]);
    assert.equal(restored.installed.length, 1);
    assert.equal(restored.installed[0].version, previous.pluginVersion);
    assert.equal(
      path.resolve(restored.installed[0].source.path),
      path.resolve(previous.pluginSource),
    );
    assert.equal(
      commandLog(value).some(({ command }) => command === "global-init"),
      false,
    );
  } finally {
    value.cleanup();
  }
});

test("a CCG plugin from another marketplace fails closed before mutation", () => {
  const value = fixture();
  try {
    writeJson(value.statePath, {
      marketplaces: [],
      installed: [
        {
          pluginId: "ccg@foreign",
          name: "ccg",
          marketplaceName: "foreign",
          version: CCG_PLUGIN_VERSION,
          source: {
            source: "local",
            path: path.join(value.root, "foreign", "plugins", "ccg"),
          },
        },
      ],
    });
    const result = runSetup(value, ["-PreviewOnly"]);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /another marketplace/i);
    assert.equal(
      commandLog(value).some(({ command }) =>
        ["bootstrap", "ccg", "global-init"].includes(command),
      ),
      false,
    );
  } finally {
    value.cleanup();
  }
});

test("a different Codex build of the same CCG base version fails closed", () => {
  const value = fixture();
  try {
    writeJson(value.statePath, {
      marketplaces: [{
        name: "ccg-gptpro-worflow",
        root: path.join(value.repoRoot, "components", "ccg-workflow"),
      }],
      installed: [{
        pluginId: "ccg@ccg-gptpro-worflow",
        name: "ccg",
        marketplaceName: "ccg-gptpro-worflow",
        version: "3.3.2+codex.2",
        source: {
          source: "local",
          path: path.join(
            value.repoRoot,
            "components",
            "ccg-workflow",
            "plugins",
            "ccg",
          ),
        },
      }],
      reportedPluginVersion: CCG_PLUGIN_VERSION,
    });
    const result = runSetup(value, ["-PreviewOnly"]);
    assert.notEqual(result.status, 0);
    assert.match(
      setupDiagnostic(result),
      /Installed Codex plugin 'ccg@ccg-gptpro-worflow'[\s\S]*Harness snapshot/i,
    );
    assert.equal(
      commandLog(value).some(({ command }) =>
        ["bootstrap", "ccg", "global-init"].includes(command),
      ),
      false,
    );
  } finally {
    value.cleanup();
  }
});

test("the exact plugin identity from a different local source fails closed", () => {
  const value = fixture();
  try {
    writeJson(value.statePath, {
      marketplaces: [{
        name: "ccg-gptpro-worflow",
        root: path.join(value.repoRoot, "components", "ccg-workflow"),
      }],
      installed: [{
        pluginId: "ccg@ccg-gptpro-worflow",
        name: "ccg",
        marketplaceName: "ccg-gptpro-worflow",
        version: CCG_PLUGIN_VERSION,
        source: {
          source: "local",
          path: path.join(value.root, "foreign", "plugins", "ccg"),
        },
      }],
      reportedPluginVersion: CCG_PLUGIN_VERSION,
    });
    const result = runSetup(value, ["-PreviewOnly"]);
    assert.notEqual(result.status, 0);
    assert.match(
      setupDiagnostic(result),
      /Installed Codex plugin 'ccg@ccg-gptpro-worflow'[\s\S]*Harness snapshot/i,
    );
    assert.equal(
      commandLog(value).some(({ command }) =>
        ["bootstrap", "ccg", "global-init"].includes(command),
      ),
      false,
    );
  } finally {
    value.cleanup();
  }
});

test("the Codex plugin manifest must be the matching +codex build", () => {
  for (const pluginManifestVersion of [
    "3.3.2",
    "3.3.2+other.1",
    "3.3.3+codex.1",
  ]) {
    const value = fixture({ pluginManifestVersion });
    try {
      const result = runSetup(value, ["-PreviewOnly"]);
      assert.notEqual(result.status, 0);
      assert.match(
        `${result.stdout}\n${result.stderr}`,
        /Codex plugin manifest version/i,
      );
      assert.equal(commandLog(value).length, 0);
    } finally {
      value.cleanup();
    }
  }
});

test("a recorded CCG snapshot outside RepoRoot is rejected before mutation", () => {
  const value = fixture();
  try {
    const manifestPath = path.join(value.repoRoot, "harness.sources.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.ccg.snapshotPath = "..";
    writeJson(manifestPath, manifest);
    const result = runSetup(value, ["-PreviewOnly"]);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /escapes RepoRoot/i);
    assert.equal(commandLog(value).length, 0);
  } finally {
    value.cleanup();
  }
});

test("Global Setup leaves absent user and project .claude trees absent", () => {
  const value = fixture({ createClaudeTrees: false });
  try {
    const result = runSetup(value);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(existsSync(path.join(value.homeDir, ".claude")), false);
    assert.equal(existsSync(path.join(value.repoRoot, ".claude")), false);
    for (const relativePath of [
      ".agents/skills/caveman",
      ".agents/harness/sources/ponytail",
      ".agents/harness/tools/codegraph",
      ".agents/harness/tools/fast-context",
    ]) {
      assert.equal(existsSync(path.join(value.homeDir, relativePath)), false);
    }
  } finally {
    value.cleanup();
  }
});

test("the .claude guard stops after the first offending Harness-owned step", () => {
  const value = fixture({ mutateClaudeDuringBootstrap: true });
  try {
    const result = runSetup(value);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /changed.*\.claude/is);
    const calls = commandLog(value);
    assert.equal(calls.some(({ command }) => command === "bootstrap"), true);
    assert.equal(calls.some(({ command }) => command === "global-init"), false);
    assert.equal(
      calls.some(
        ({ command, args }) =>
          command === "ccg" && args.join(" ") === "codex-mode install",
      ),
      false,
    );
  } finally {
    value.cleanup();
  }
});

test("a failed Codex mode install is audited after plugin registration", () => {
  const value = fixture({ codexModeBehavior: "fail-create-claude" });
  try {
    const result = runSetup(value);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /changed.*\.claude/is);
    const calls = commandLog(value);
    const pluginInstallIndex = calls.findIndex(
      ({ command, args }) =>
        command === "codex" &&
        args.slice(0, 2).join(" ") === "plugin add",
    );
    const codexModeIndex = calls.findIndex(
      ({ command, args }) =>
        command === "ccg" && args.join(" ") === "codex-mode install",
    );
    assert.ok(pluginInstallIndex >= 0);
    assert.ok(codexModeIndex > pluginInstallIndex);
    assert.equal(calls.some(({ command }) => command === "global-init"), false);
    assert.equal(
      existsSync(
        path.join(value.homeDir, ".agents", "harness", "codex-plugin.json"),
      ),
      true,
    );
  } finally {
    value.cleanup();
  }
});

test("a failed plugin add is audited before Codex mode", () => {
  const value = fixture({ pluginBehavior: "fail-create-claude" });
  try {
    const result = runSetup(value);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /changed.*\.claude/is);
    const calls = commandLog(value);
    assert.equal(
      calls.some(
        ({ command, args }) =>
          command === "codex" &&
          args.slice(0, 2).join(" ") === "plugin add",
      ),
      true,
    );
    assert.equal(
      calls.some(
        ({ command, args }) =>
          command === "ccg" && args.join(" ") === "codex-mode install",
      ),
      false,
    );
    assert.equal(calls.some(({ command }) => command === "global-init"), false);
  } finally {
    value.cleanup();
  }
});

test("a plain Codex mode failure can resume without reinstalling the plugin", () => {
  const value = fixture({ codexModeBehavior: "fail-once" });
  try {
    const first = runSetup(value);
    assert.notEqual(first.status, 0);
    assert.match(`${first.stdout}\n${first.stderr}`, /failed once/i);

    const second = runSetup(value);
    assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
    const calls = commandLog(value);
    assert.equal(
      calls.filter(
        ({ command, args }) =>
          command === "codex" &&
          args.slice(0, 2).join(" ") === "plugin add",
      ).length,
      1,
    );
    assert.equal(
      calls.filter(
        ({ command, args }) =>
          command === "ccg" && args.join(" ") === "codex-mode install",
      ).length,
      2,
    );
  } finally {
    value.cleanup();
  }
});

test("non-interactive execution requires every core approval flag", () => {
  const value = fixture();
  try {
    const args = setupArgs(value);
    args.splice(args.indexOf("-ApproveCcgPlugin"), 1);
    const result = spawnSync("pwsh", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${value.binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        MOCK_CODEX_STATE: value.statePath,
        MOCK_COMMAND_LOG: value.logPath,
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(
      setupDiagnostic(result),
      /Non-interactive setup requires -Approved[\s\S]*every explicit core[\s\S]*approval flag:/i,
    );
    assert.equal(commandLog(value).length, 0);
  } finally {
    value.cleanup();
  }
});
