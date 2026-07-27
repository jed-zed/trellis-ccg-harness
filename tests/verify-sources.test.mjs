import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERIFY_SCRIPT = path.join(ROOT, "scripts", "verify-sources.ps1");
const PERSONAL_REPO =
  "https://github.com/jed-zed/ccg-gptpro-worflow";
const THIRD_PARTY_MANIFEST = path.join(
  ROOT,
  ".agents",
  "skills",
  "harness-init",
  "assets",
  "third-party-sources.json",
);
const THIRD_PARTY_VALIDATOR = path.join(
  ROOT,
  ".agents",
  "skills",
  "harness-init",
  "scripts",
  "third-party-approval.mjs",
);
const TRUSTED_COMMAND_RESOLVER = path.join(
  ROOT,
  ".agents",
  "skills",
  "harness-init",
  "scripts",
  "trusted-command-resolver.mjs",
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env ?? process.env,
    shell: false,
  });
  if (options.allowFailure) return result;
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`,
  );
  return String(result.stdout).trim();
}

function git(root, ...args) {
  return run("git", ["-C", root, ...args]);
}

function write(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, value);
}

function commitAll(root, message) {
  git(root, "add", "--all");
  git(root, "commit", "-m", message);
  return {
    commit: git(root, "rev-parse", "HEAD"),
    tree: git(root, "rev-parse", "HEAD^{tree}"),
  };
}

function initializeRepo(root) {
  git(root, "init");
  git(root, "config", "user.email", "tests@example.invalid");
  git(root, "config", "user.name", "Harness Tests");
}

function writeSourceFiles(sourceRoot, marker = "initial") {
  write(
    path.join(sourceRoot, "package.json"),
    `${JSON.stringify({ name: "ccg-workflow", version: "3.3.0" }, null, 2)}\n`,
  );
  const required = [
    "plugins/ccg/.codex-plugin/plugin.json",
    "plugins/ccg/skills/ccg-gptpro-bridge/scripts/gptpro_bridge.py",
    "plugins/ccg/skills/ccg-grok-intel/scripts/grok-intelligence/runner.mjs",
    "src/commands/doctor.ts",
    "templates/engine/tools/grok-intelligence/runner.mjs",
  ];
  for (const relative of required) {
    write(path.join(sourceRoot, relative), `${marker}:${relative}\n`);
  }
}

function writeHarnessManifest(harnessRoot, source) {
  write(
    path.join(harnessRoot, "harness.sources.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        trellis: { version: "0.6.8" },
        ccg: {
          package: "ccg-workflow",
          version: "3.3.0",
          authoritativeRepository: PERSONAL_REPO,
          authoritativeRemoteNameInSourceCheckout: "gptpro",
          commit: source.commit,
          gitTree: source.tree,
          snapshotPath: "components/ccg-workflow",
        },
      },
      null,
      2,
    )}\n`,
  );
}

function copySourceSnapshot(sourceRoot, harnessRoot) {
  const component = path.join(harnessRoot, "components", "ccg-workflow");
  rmSync(component, { recursive: true, force: true });
  cpSync(sourceRoot, component, {
    recursive: true,
    filter: (source) => path.basename(source) !== ".git",
  });
}

function copyThirdPartySourceAssets(harnessRoot) {
  const harnessInit = path.join(
    harnessRoot,
    ".agents",
    "skills",
    "harness-init",
  );
  mkdirSync(path.join(harnessInit, "assets"), { recursive: true });
  mkdirSync(path.join(harnessInit, "scripts"), { recursive: true });
  cpSync(
    THIRD_PARTY_MANIFEST,
    path.join(harnessInit, "assets", "third-party-sources.json"),
  );
  cpSync(
    THIRD_PARTY_VALIDATOR,
    path.join(harnessInit, "scripts", "third-party-approval.mjs"),
  );
  cpSync(
    TRUSTED_COMMAND_RESOLVER,
    path.join(harnessInit, "scripts", "trusted-command-resolver.mjs"),
  );
}

function fixture() {
  const fixtureRoot = mkdtempSync(
    path.join(tmpdir(), "harness-source-verification-"),
  );
  const sourceRoot = path.join(fixtureRoot, "personal-source");
  const harnessRoot = path.join(fixtureRoot, "harness");
  mkdirSync(sourceRoot, { recursive: true });
  mkdirSync(harnessRoot, { recursive: true });
  initializeRepo(sourceRoot);
  writeSourceFiles(sourceRoot);
  const source = commitAll(sourceRoot, "initial personal source");
  git(sourceRoot, "remote", "add", "gptpro", PERSONAL_REPO);

  initializeRepo(harnessRoot);
  write(path.join(harnessRoot, ".trellis", ".version"), "0.6.8\n");
  copySourceSnapshot(sourceRoot, harnessRoot);
  copyThirdPartySourceAssets(harnessRoot);
  writeHarnessManifest(harnessRoot, source);
  commitAll(harnessRoot, "initial harness");

  return {
    fixtureRoot,
    sourceRoot,
    harnessRoot,
    source,
    cleanup: () =>
      rmSync(fixtureRoot, { recursive: true, force: true }),
  };
}

function verify(value, extra = []) {
  return verifyCheckout(value, value.sourceRoot, extra);
}

function verifyCheckout(value, checkout, extra = [], options = {}) {
  return run(
    "pwsh",
    [
      "-NoProfile",
      "-File",
      VERIFY_SCRIPT,
      "-RepoRoot",
      value.harnessRoot,
      "-AuthoritativeCheckout",
      checkout,
      ...extra,
    ],
    { allowFailure: true, env: options.env },
  );
}

function environmentWithPathPrefix(prefix, base = process.env) {
  const env = { ...base };
  let currentPath = "";
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() !== "path") continue;
    currentPath ||= env[key];
    delete env[key];
  }
  env.PATH = `${prefix}${path.delimiter}${currentPath}`;
  return env;
}

function writeCommandShim(directory, name) {
  mkdirSync(directory, { recursive: true });
  const file = path.join(
    directory,
    process.platform === "win32" ? `${name}.cmd` : name,
  );
  writeFileSync(
    file,
    process.platform === "win32"
      ? "@echo off\r\necho unsafe shim\r\n"
      : "#!/bin/sh\necho unsafe shim\n",
  );
  if (process.platform !== "win32") chmodSync(file, 0o755);
  return file;
}

function runIdentityDriftProbe(targetPath) {
  const powershell = `
$errors = $null
$tokens = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
  $env:HARNESS_TEST_VERIFY_SCRIPT,
  [ref]$tokens,
  [ref]$errors
)
if ($errors.Count -ne 0) { throw "Unable to parse verifier functions." }
$functions = $ast.FindAll({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst]
}, $true)
foreach ($function in $functions) {
  Invoke-Expression $function.Extent.Text
}
$identity = Get-TrustedCommandFileIdentity -Name "node" -Path $env:HARNESS_TEST_COMMAND_PATH
$bytes = [System.IO.File]::ReadAllBytes($env:HARNESS_TEST_COMMAND_PATH)
$bytes[$bytes.Length - 1] = $bytes[$bytes.Length - 1] -bxor 1
[System.IO.File]::WriteAllBytes($env:HARNESS_TEST_COMMAND_PATH, $bytes)
$lease = Open-TrustedCommandLease -Identity $identity
$lease.Dispose()
`;
  return run(
    "pwsh",
    ["-NoProfile", "-Command", powershell],
    {
      allowFailure: true,
      env: {
        ...process.env,
        HARNESS_TEST_VERIFY_SCRIPT: VERIFY_SCRIPT,
        HARNESS_TEST_COMMAND_PATH: targetPath,
      },
    },
  );
}

function fetchedSourceEnv(sourceRoot) {
  const env = {
    ...process.env,
    GIT_ALLOW_PROTOCOL: "file",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `url.${pathToFileURL(sourceRoot).href}.insteadOf`,
    GIT_CONFIG_VALUE_0: PERSONAL_REPO,
  };
  delete env.HARNESS_CCG_SOURCE_CHECKOUT;
  return env;
}

function verifyFetched(value, extra = []) {
  return run(
    "pwsh",
    [
      "-NoProfile",
      "-File",
      VERIFY_SCRIPT,
      "-RepoRoot",
      value.harnessRoot,
      ...extra,
    ],
    {
      allowFailure: true,
      env: fetchedSourceEnv(value.sourceRoot),
    },
  );
}

function runEnvironmentSanitizationProbe() {
  const powershell = `
$errors = $null
$tokens = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
  $env:HARNESS_TEST_VERIFY_SCRIPT,
  [ref]$tokens,
  [ref]$errors
)
if ($errors.Count -ne 0) { throw "Unable to parse verifier functions." }
$functions = $ast.FindAll({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst]
}, $true)
foreach ($function in $functions) {
  Invoke-Expression $function.Extent.Text
}
$git = Resolve-TrustedNativeCommand -Name "git"
$node = Resolve-TrustedNativeCommand -Name "node"
$hostile = @{
  PATH = "attacker-path"
  NODE_OPTIONS = "--definitely-invalid-harness-option"
  NODE_PATH = "attacker-node-path"
  LD_PRELOAD = "attacker-loader"
  DYLD_INSERT_LIBRARIES = "attacker-loader"
  GIT_CONFIG_KEY_0 = "alias.status"
  GIT_CONFIG_VALUE_0 = "!attacker"
  GIT_CONFIG_PARAMETERS = "attacker"
  GIT_EXEC_PATH = "attacker-git-exec"
  GIT_SSH = "attacker-git-ssh"
  GIT_SSH_COMMAND = "attacker-git-ssh-command"
}
foreach ($entry in $hostile.GetEnumerator()) {
  [System.Environment]::SetEnvironmentVariable($entry.Key, $entry.Value)
}
$forbidden = @(
  "PATH",
  "NODE_OPTIONS",
  "NODE_PATH",
  "LD_PRELOAD",
  "DYLD_INSERT_LIBRARIES",
  "GIT_CONFIG_KEY_0",
  "GIT_CONFIG_VALUE_0",
  "GIT_CONFIG_PARAMETERS",
  "GIT_EXEC_PATH",
  "GIT_SSH",
  "GIT_SSH_COMMAND"
)
foreach ($identity in @($git, $node)) {
  $startInfo = New-TrustedProcessStartInfo -Identity $identity -Arguments @("--version")
  foreach ($name in $forbidden) {
    if ($startInfo.Environment.ContainsKey($name)) {
      throw "$($identity.Name) child inherited forbidden environment variable: $name"
    }
  }
}
$gitResult = Invoke-TrustedTextCommand -Identity $git -Arguments @("--version")
$nodeResult = Invoke-TrustedTextCommand -Identity $node -Arguments @("--version")
if ($gitResult.ExitCode -ne 0 -or $nodeResult.ExitCode -ne 0) {
  throw "Trusted commands failed under hostile parent environment."
}
`;
  return run(
    "pwsh",
    ["-NoProfile", "-Command", powershell],
    {
      allowFailure: true,
      env: {
        ...process.env,
        HARNESS_TEST_VERIFY_SCRIPT: VERIFY_SCRIPT,
      },
    },
  );
}

test("source verifier binds clean authoritative commit, tree, and committed snapshot", () => {
  const value = fixture();
  try {
    const result = verify(value);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Source verification passed/);
    assert.match(
      result.stdout,
      /Git command:.*bytes, SHA-256 [0-9a-f]{64}/i,
    );
    assert.match(
      result.stdout,
      /Node command:.*bytes, SHA-256 [0-9a-f]{64}/i,
    );

    const manifestPath = path.join(value.harnessRoot, "harness.sources.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.ccg.commit = "f".repeat(40);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const wrongCommit = verify(value);
    assert.notEqual(wrongCommit.status, 0);
    assert.match(
      `${wrongCommit.stdout}\n${wrongCommit.stderr}`,
      /checkout HEAD mismatch|commit/i,
    );
  } finally {
    value.cleanup();
  }
});

test("source verifier rejects authoritative and component dirty state", () => {
  const value = fixture();
  try {
    write(path.join(value.sourceRoot, "untracked.txt"), "dirty\n");
    const dirtySource = verify(value);
    assert.notEqual(dirtySource.status, 0);
    assert.match(
      `${dirtySource.stdout}\n${dirtySource.stderr}`,
      /authoritative CCG checkout is dirty/i,
    );
    rmSync(path.join(value.sourceRoot, "untracked.txt"));

    write(
      path.join(value.harnessRoot, "components", "ccg-workflow", "untracked.txt"),
      "dirty\n",
    );
    const dirtyComponent = verify(value);
    assert.notEqual(dirtyComponent.status, 0);
    assert.match(
      `${dirtyComponent.stdout}\n${dirtyComponent.stderr}`,
      /component is dirty/i,
    );
  } finally {
    value.cleanup();
  }
});

test("omitted checkout rejects Git environment URL rewrites while explicit checkout remains strict", () => {
  const value = fixture();
  try {
    const siblingRoot = path.join(value.fixtureRoot, "ccg-workflow");
    mkdirSync(siblingRoot, { recursive: true });
    initializeRepo(siblingRoot);
    writeSourceFiles(siblingRoot, "drifting sibling");
    commitAll(siblingRoot, "different sibling source");
    git(siblingRoot, "remote", "add", "gptpro", PERSONAL_REPO);

    const fetched = verifyFetched(value);
    assert.notEqual(fetched.status, 0);
    assert.match(
      `${fetched.stdout}\n${fetched.stderr}`,
      /git fetch[\s\S]*failed/i,
    );

    const explicitSibling = verifyCheckout(value, siblingRoot);
    assert.notEqual(explicitSibling.status, 0);
    assert.match(
      `${explicitSibling.stdout}\n${explicitSibling.stderr}`,
      /checkout HEAD mismatch/i,
    );
  } finally {
    value.cleanup();
  }
});

test("explicit pinned checkout binds the recorded tree after fetch environment injection is rejected", () => {
  const value = fixture();
  try {
    const pinnedCheckout = path.join(value.fixtureRoot, "pinned-source");
    git(
      value.fixtureRoot,
      "-c",
      "core.autocrlf=false",
      "clone",
      value.sourceRoot,
      pinnedCheckout,
    );
    git(pinnedCheckout, "remote", "add", "gptpro", PERSONAL_REPO);

    writeSourceFiles(value.sourceRoot, "newer checkout");
    commitAll(value.sourceRoot, "newer personal source");
    write(path.join(value.sourceRoot, "untracked.txt"), "unrelated worktree state\n");

    const strict = verify(value);
    assert.notEqual(strict.status, 0);
    assert.match(
      `${strict.stdout}\n${strict.stderr}`,
      /checkout HEAD mismatch|checkout is dirty/i,
    );

    const fetched = verifyFetched(value);
    assert.notEqual(fetched.status, 0);
    assert.match(
      `${fetched.stdout}\n${fetched.stderr}`,
      /git fetch[\s\S]*failed/i,
    );

    const pinned = verifyCheckout(value, pinnedCheckout);
    assert.equal(pinned.status, 0, `${pinned.stdout}\n${pinned.stderr}`);

    const componentResidue = path.join(
      value.harnessRoot,
      "components",
      "ccg-workflow",
      "residue.txt",
    );
    write(componentResidue, "untracked component drift\n");
    const dirtyComponent = verifyCheckout(value, pinnedCheckout);
    assert.notEqual(dirtyComponent.status, 0);
    assert.match(
      `${dirtyComponent.stdout}\n${dirtyComponent.stderr}`,
      /component is dirty/i,
    );
    rmSync(componentResidue);

    const manifestPath = path.join(value.harnessRoot, "harness.sources.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.ccg.gitTree = "f".repeat(40);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const forgedTree = verifyCheckout(value, pinnedCheckout);
    assert.notEqual(forgedTree.status, 0);
    assert.match(
      `${forgedTree.stdout}\n${forgedTree.stderr}`,
      /authoritative commit to Git tree mismatch/i,
    );
  } finally {
    value.cleanup();
  }
});

test("index verification reads the staged tree and rejects untracked residue", () => {
  const value = fixture();
  try {
    writeSourceFiles(value.sourceRoot, "updated");
    const updated = commitAll(value.sourceRoot, "updated personal source");
    copySourceSnapshot(value.sourceRoot, value.harnessRoot);
    writeHarnessManifest(value.harnessRoot, updated);
    git(
      value.harnessRoot,
      "add",
      "harness.sources.json",
      "components/ccg-workflow",
    );

    const staged = verify(value, ["-Index"]);
    assert.equal(staged.status, 0, `${staged.stdout}\n${staged.stderr}`);

    write(
      path.join(
        value.harnessRoot,
        "components",
        "ccg-workflow",
        "src",
        "commands",
        "doctor.ts",
      ),
      "unstaged tracked worktree drift\n",
    );
    const manifestPath = path.join(value.harnessRoot, "harness.sources.json");
    const worktreeManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    worktreeManifest.ccg.commit = "f".repeat(40);
    writeFileSync(
      manifestPath,
      `${JSON.stringify(worktreeManifest, null, 2)}\n`,
    );
    const stagedWithTrackedDrift = verify(value, ["-Index"]);
    assert.equal(
      stagedWithTrackedDrift.status,
      0,
      `${stagedWithTrackedDrift.stdout}\n${stagedWithTrackedDrift.stderr}`,
    );

    write(
      path.join(value.harnessRoot, "components", "ccg-workflow", "residue.txt"),
      "untracked\n",
    );
    const residue = verify(value, ["-Index"]);
    assert.notEqual(residue.status, 0);
    assert.match(
      `${residue.stdout}\n${residue.stderr}`,
      /untracked/i,
    );
  } finally {
    value.cleanup();
  }
});

test("third-party source manifest is validated, canonically pinned, and required in both trees", () => {
  const value = fixture();
  const manifestPath = path.join(
    value.harnessRoot,
    ".agents",
    "skills",
    "harness-init",
    "assets",
    "third-party-sources.json",
  );
  try {
    const clean = verify(value);
    assert.equal(clean.status, 0, `${clean.stdout}\n${clean.stderr}`);
    assert.match(clean.stdout, /Third-party manifest SHA-256/i);

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.generatedAt = "2026-07-26T20:30:01.000Z";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const canonicalDrift = verify(value);
    assert.notEqual(canonicalDrift.status, 0);
    assert.match(
      `${canonicalDrift.stdout}\n${canonicalDrift.stderr}`,
      /canonical SHA-256 mismatch/i,
    );

    const stagedStillCanonical = verify(value, ["-Index"]);
    assert.equal(
      stagedStillCanonical.status,
      0,
      `${stagedStillCanonical.stdout}\n${stagedStillCanonical.stderr}`,
    );

    git(value.harnessRoot, "add", manifestPath);
    const stagedDrift = verify(value, ["-Index"]);
    assert.notEqual(stagedDrift.status, 0);
    assert.match(
      `${stagedDrift.stdout}\n${stagedDrift.stderr}`,
      /canonical SHA-256 mismatch/i,
    );

    git(
      value.harnessRoot,
      "rm",
      "--cached",
      "--",
      ".agents/skills/harness-init/assets/third-party-sources.json",
    );
    const missingStaged = verify(value, ["-Index"]);
    assert.notEqual(missingStaged.status, 0);
    assert.match(
      `${missingStaged.stdout}\n${missingStaged.stderr}`,
      /missing from the staged Git tree/i,
    );

    rmSync(manifestPath);
    const missingWorktree = verify(value);
    assert.notEqual(missingWorktree.status, 0);
    assert.match(
      `${missingWorktree.stdout}\n${missingWorktree.stderr}`,
      /Third-party source manifest not found/i,
    );
  } finally {
    value.cleanup();
  }
});

test("third-party source manifest rejects mutable selectors through the shared validator", () => {
  const value = fixture();
  try {
    const manifestPath = path.join(
      value.harnessRoot,
      ".agents",
      "skills",
      "harness-init",
      "assets",
      "third-party-sources.json",
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.sources[0].commit = "main";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const result = verify(value);
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /full immutable 40-character commit|mutable selector/i,
    );
  } finally {
    value.cleanup();
  }
});

test("index verification executes the staged validator and binds both validator trees", () => {
  const value = fixture();
  const validatorPath = path.join(
    value.harnessRoot,
    ".agents",
    "skills",
    "harness-init",
    "scripts",
    "third-party-approval.mjs",
  );
  try {
    writeFileSync(validatorPath, "export const malformed = ;\n");

    const worktreeDrift = verify(value);
    assert.notEqual(worktreeDrift.status, 0);
    assert.match(
      `${worktreeDrift.stdout}\n${worktreeDrift.stderr}`,
      /validator SHA-256 mismatch/i,
    );

    const stagedStillTrusted = verify(value, ["-Index"]);
    assert.equal(
      stagedStillTrusted.status,
      0,
      `${stagedStillTrusted.stdout}\n${stagedStillTrusted.stderr}`,
    );

    git(value.harnessRoot, "add", validatorPath);
    const stagedDrift = verify(value, ["-Index"]);
    assert.notEqual(stagedDrift.status, 0);
    assert.match(
      `${stagedDrift.stdout}\n${stagedDrift.stderr}`,
      /Staged third-party source manifest validator SHA-256 mismatch/i,
    );

    git(
      value.harnessRoot,
      "rm",
      "--cached",
      "--",
      ".agents/skills/harness-init/scripts/third-party-approval.mjs",
    );
    const missingStaged = verify(value, ["-Index"]);
    assert.notEqual(missingStaged.status, 0);
    assert.match(
      `${missingStaged.stdout}\n${missingStaged.stderr}`,
      /validator is missing from the staged Git\s+tree/i,
    );

    rmSync(validatorPath);
    const missingWorktree = verify(value);
    assert.notEqual(missingWorktree.status, 0);
    assert.match(
      `${missingWorktree.stdout}\n${missingWorktree.stderr}`,
      /validator not found/i,
    );
  } finally {
    value.cleanup();
  }
});

test("source verifier rejects PATH-prepended git and node scripts or shims", () => {
  const value = fixture();
  try {
    for (const command of ["git", "node"]) {
      const fakeBin = path.join(value.fixtureRoot, `fake-${command}`);
      writeCommandShim(fakeBin, command);
      const result = verifyCheckout(value, value.sourceRoot, [], {
        env: environmentWithPathPrefix(fakeBin),
      });
      assert.notEqual(result.status, 0);
      assert.match(
        `${result.stdout}\n${result.stderr}`,
        new RegExp(`${command} command must be a native executable, not a script or shim`, "i"),
      );
    }
  } finally {
    value.cleanup();
  }
});

test("source verifier clears Node and Git environment injection before execution", () => {
  const value = fixture();
  try {
    const marker = path.join(value.fixtureRoot, "node-options-injection.txt");
    const preload = path.join(value.fixtureRoot, "node-options-preload.cjs");
    writeFileSync(
      preload,
      `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "injected");\n`,
    );
    const result = verifyCheckout(value, value.sourceRoot, [], {
      env: {
        ...process.env,
        NODE_OPTIONS: `--require=${preload}`,
        NODE_PATH: path.join(value.fixtureRoot, "attacker-node-path"),
        GIT_CONFIG_COUNT: "not-a-number",
        GIT_EXEC_PATH: path.join(value.fixtureRoot, "attacker-git-exec"),
        GIT_SSH: path.join(value.fixtureRoot, "attacker-git-ssh"),
      },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(
      existsSync(marker),
      false,
      "NODE_OPTIONS preload must not execute inside the verifier's Node child",
    );
    const probe = runEnvironmentSanitizationProbe();
    assert.equal(probe.status, 0, `${probe.stdout}\n${probe.stderr}`);
  } finally {
    value.cleanup();
  }
});

test("source verifier rejects a command reached through a linked PATH directory", (t) => {
  const value = fixture();
  try {
    const linkedBin = path.join(value.fixtureRoot, "linked-node-bin");
    try {
      symlinkSync(
        path.dirname(process.execPath),
        linkedBin,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if (error?.code === "EPERM" || error?.code === "EACCES") {
        t.skip(`linked-directory creation is unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    const result = verifyCheckout(value, value.sourceRoot, [], {
      env: environmentWithPathPrefix(linkedBin),
    });
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /node command must not be reached through a linked parent directory/i,
    );
  } finally {
    value.cleanup();
  }
});

test("source verifier detects an executable identity drift before reuse", () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), "harness-command-identity-drift-"),
  );
  try {
    const executable = path.join(
      directory,
      process.platform === "win32" ? "node.exe" : "node",
    );
    copyFileSync(process.execPath, executable);
    if (process.platform !== "win32") chmodSync(executable, 0o755);
    const result = runIdentityDriftProbe(executable);
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /node command identity changed after verifier startup/i,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("source verification binds the trusted command resolver in worktree and index", () => {
  const value = fixture();
  const resolverPath = path.join(
    value.harnessRoot,
    ".agents",
    "skills",
    "harness-init",
    "scripts",
    "trusted-command-resolver.mjs",
  );
  try {
    writeFileSync(resolverPath, "export const tampered = true;\n");

    const worktreeDrift = verify(value);
    assert.notEqual(worktreeDrift.status, 0);
    assert.match(
      `${worktreeDrift.stdout}\n${worktreeDrift.stderr}`,
      /Trusted command resolver SHA-256 mismatch/i,
    );

    const stagedStillTrusted = verify(value, ["-Index"]);
    assert.equal(
      stagedStillTrusted.status,
      0,
      `${stagedStillTrusted.stdout}\n${stagedStillTrusted.stderr}`,
    );

    git(value.harnessRoot, "add", resolverPath);
    const stagedDrift = verify(value, ["-Index"]);
    assert.notEqual(stagedDrift.status, 0);
    assert.match(
      `${stagedDrift.stdout}\n${stagedDrift.stderr}`,
      /Staged trusted command resolver SHA-256 mismatch/i,
    );

    git(
      value.harnessRoot,
      "rm",
      "--cached",
      "--",
      ".agents/skills/harness-init/scripts/trusted-command-resolver.mjs",
    );
    const missingStaged = verify(value, ["-Index"]);
    assert.notEqual(missingStaged.status, 0);
    assert.match(
      `${missingStaged.stdout}\n${missingStaged.stderr}`,
      /Trusted command resolver is missing from the staged Git\s+tree/i,
    );

    rmSync(resolverPath);
    const missingWorktree = verify(value);
    assert.notEqual(missingWorktree.status, 0);
    assert.match(
      `${missingWorktree.stdout}\n${missingWorktree.stderr}`,
      /Trusted command resolver not found/i,
    );
  } finally {
    value.cleanup();
  }
});
