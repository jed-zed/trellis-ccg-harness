import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACCEPTANCE_SCRIPT = path.join(
  ROOT,
  "scripts",
  "clean-install-acceptance.ps1",
);
const PUBLIC_HARNESS_ORIGIN =
  "https://github.com/jed-zed/trellis-ccg-harness.git";
const PUBLIC_BASELINE_CONTRACT = path.join(
  ROOT,
  "tests",
  "fixtures",
  "public-baseline-approved-contract.json",
);
const GLOBAL_PLATFORM_SKILLS = [
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

const MOCK_RUNNER_SOURCE = String.raw`
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const phase = process.argv[2];
const behavior = process.argv[3] ?? "normal";
const repository = process.env.HARNESS_ACCEPTANCE_REPO;
const acceptanceHome = process.env.HARNESS_ACCEPTANCE_HOME;
const userProfile = process.env.HARNESS_ACCEPTANCE_USERPROFILE;
const codexHome = process.env.HARNESS_ACCEPTANCE_CODEX_HOME;
const npmPrefix = process.env.HARNESS_ACCEPTANCE_NPM_PREFIX;
const project = process.env.HARNESS_ACCEPTANCE_PROJECT;
const expectedWorkingDirectory = [
  "trellisProjectInit",
  "projectInit",
  "gates",
  "markReady",
].includes(phase)
  ? project
  : repository;

for (const [name, value] of Object.entries({
  repository,
  acceptanceHome,
  userProfile,
  codexHome,
  npmPrefix,
  project,
})) {
  if (!value) throw new Error("missing isolated environment: " + name);
}
if (process.env.HARNESS_ACCEPTANCE_LIVE !== "0") {
  throw new Error("offline fixture unexpectedly entered live mode");
}
if (path.resolve(process.cwd()) !== path.resolve(expectedWorkingDirectory)) {
  throw new Error(
    "unexpected workingDirectory for " +
      phase +
      ": " +
      process.cwd() +
      " expected " +
      expectedWorkingDirectory,
  );
}

function write(target, value) {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, value);
}

if (phase === "bootstrap") {
  if (readFileSync(path.join(repository, "release-marker.txt"), "utf8") !== "selected-ref\n") {
    throw new Error("HarnessRef was not materialized exactly");
  }
  write(path.join(repository, ".acceptance", "bootstrap"), "ok\n");
} else if (phase === "ccgCodexMode") {
  write(path.join(codexHome, ".ccg-version"), "3.3.2\n");
} else if (phase === "plugin") {
  write(
    path.join(
      codexHome,
      "plugins",
      "cache",
      "fixture-marketplace",
      "ccg",
      "3.3.2",
      ".codex-plugin",
      "plugin.json",
    ),
    JSON.stringify({ name: "ccg", version: "3.3.2" }),
  );
  if (behavior === "create-claude") {
    write(path.join(acceptanceHome, ".claude", "forbidden.txt"), "bad\n");
  }
} else if (phase === "globalSkills") {
  const skills = ${JSON.stringify(GLOBAL_PLATFORM_SKILLS)};
  for (const skill of skills) {
    write(
      path.join(acceptanceHome, ".agents", "skills", skill, "SKILL.md"),
      "---\nname: " + skill + "\n---\n",
    );
  }
} else if (phase === "trellisProjectInit") {
  mkdirSync(path.join(project, ".trellis"), { recursive: true });
  mkdirSync(path.join(project, ".agents"), { recursive: true });
  mkdirSync(path.join(project, ".codex"), { recursive: true });
} else if (phase === "projectInit") {
  write(path.join(project, "AGENTS.md"), "# Fixture project\n");
  write(
    path.join(project, ".harness", "project.json"),
    JSON.stringify({ schemaVersion: 1, status: "approved" }),
  );
  write(
    path.join(project, ".harness", "ownership.json"),
    JSON.stringify({ schemaVersion: 3, owner: "harness-init" }),
  );
  process.stdout.write(
    JSON.stringify({
      status: "approved-awaiting-gates",
      next: { action: "run-approved-quality-gates-then-mark-ready" },
    }),
  );
} else if (phase === "gates") {
  write(path.join(project, ".acceptance-gates"), "passed\n");
} else if (phase === "markReady") {
  const contractPath = path.join(project, ".harness", "project.json");
  const contract = JSON.parse(readFileSync(contractPath, "utf8"));
  contract.status = "ready";
  write(contractPath, JSON.stringify(contract));
} else {
  throw new Error("unexpected phase: " + phase);
}
`;

function write(target, value) {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, value);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env ?? process.env,
    shell: false,
  });
}

function git(root, ...args) {
  const result = run("git", ["-C", root, ...args]);
  assert.equal(
    result.status,
    0,
    `git ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`,
  );
  return String(result.stdout).trim();
}

function initializeHarnessSource(sourceRoot) {
  mkdirSync(sourceRoot, { recursive: true });
  git(sourceRoot, "init");
  git(sourceRoot, "config", "user.email", "tests@example.invalid");
  git(sourceRoot, "config", "user.name", "Harness Tests");
  write(
    path.join(sourceRoot, "harness.sources.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        trellis: { package: "@mindfoldhq/trellis", version: "0.6.9" },
        ccg: {
          package: "ccg-workflow",
          version: "3.3.2",
          snapshotPath: "components/ccg-workflow",
        },
      },
      null,
      2,
    )}\n`,
  );
  write(
    path.join(sourceRoot, "scripts", "bootstrap.ps1"),
    'throw "fixture bootstrap must be replaced by the phase mock"\n',
  );
  write(
    path.join(sourceRoot, "scripts", "harness-init.mjs"),
    [
      "#!/usr/bin/env node",
      'if (process.argv[2] !== "third-party-plan") {',
      '  throw new Error("fixture only supports third-party-plan");',
      "}",
      'console.log(JSON.stringify({ sourceManifestSha256: "a".repeat(64) }));',
      "",
    ].join("\n"),
  );
  write(path.join(sourceRoot, "release-marker.txt"), "selected-ref\n");
  git(sourceRoot, "add", "--all");
  git(sourceRoot, "commit", "-m", "selected release");
  const selectedRef = git(sourceRoot, "rev-parse", "HEAD");

  write(path.join(sourceRoot, "release-marker.txt"), "newer-unselected-ref\n");
  git(sourceRoot, "add", "--all");
  git(sourceRoot, "commit", "-m", "newer release");
  return selectedRef;
}

function createMockRunner(root) {
  const runner = path.join(root, "phase-mock.mjs");
  write(runner, MOCK_RUNNER_SOURCE);
  return runner;
}

function commandManifest(root, runner, behavior = {}) {
  const phases = {};
  for (const phase of [
    "bootstrap",
    "plugin",
    "ccgCodexMode",
    "globalSkills",
    "trellisProjectInit",
    "projectInit",
    "gates",
    "markReady",
  ]) {
    phases[phase] = [
      {
        executable: process.execPath,
        arguments: [runner, phase, behavior[phase] ?? "normal"],
        workingDirectory: [
          "trellisProjectInit",
          "projectInit",
          "gates",
          "markReady",
        ].includes(phase)
          ? "{project}"
          : "{repo}",
      },
    ];
  }
  const manifest = path.join(root, "commands.json");
  write(
    manifest,
    `${JSON.stringify({ schemaVersion: 1, phases }, null, 2)}\n`,
  );
  return manifest;
}

function createLiveBootstrapProbe(root) {
  const probe = path.join(root, "live-bootstrap-probe.ps1");
  write(
    probe,
    String.raw`$ErrorActionPreference = "Stop"
$prefix = $env:NPM_CONFIG_PREFIX
$repository = $env:HARNESS_ACCEPTANCE_REPO
$probeRoot = Join-Path $repository ".acceptance"
New-Item -ItemType Directory -Path $prefix, $probeRoot -Force | Out-Null
Set-Content -LiteralPath (Join-Path $prefix "trellis.cmd") -Encoding ascii -Value @(
  "@echo off",
  "echo 0.6.9"
)
$ccgBin = Join-Path $prefix "node_modules/ccg-workflow/bin"
New-Item -ItemType Directory -Path $ccgBin -Force | Out-Null
Set-Content -LiteralPath (Join-Path $ccgBin "ccg.mjs") -Encoding utf8NoBOM -Value (
  "console.log('3.3.2');"
)
Set-Content -LiteralPath (Join-Path $prefix "ccg.cmd") -Encoding ascii -Value @(
  "@echo off",
  "node ""%~dp0\node_modules\ccg-workflow\bin\ccg.mjs"" %*"
)
$trellisVersion = ((& trellis --version) | Select-Object -Last 1).Trim()
$adapterCcg = Join-Path $env:APPDATA "npm/node_modules/ccg-workflow/bin/ccg.mjs"
$origin = ((& git -C $repository remote get-url origin) | Select-Object -Last 1).Trim()
Set-Content -LiteralPath (Join-Path $probeRoot "trellis-version.txt") -Value $trellisVersion
Set-Content -LiteralPath (Join-Path $probeRoot "adapter-ccg-visible.txt") -Value (
  (Test-Path -LiteralPath $adapterCcg -PathType Leaf).ToString().ToLowerInvariant()
)
Set-Content -LiteralPath (Join-Path $probeRoot "origin.txt") -Value $origin
`,
  );
  return probe;
}

function runLiveBootstrapProbe(value) {
  const manifest = JSON.parse(readFileSync(value.manifest, "utf8"));
  const probe = createLiveBootstrapProbe(value.fixtureRoot);
  manifest.phases.bootstrap = [
    {
      executable: "pwsh",
      arguments: ["-NoProfile", "-File", probe],
      workingDirectory: "{repo}",
    },
  ];
  write(value.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
  return runAcceptance(value, [
    "-Live",
    "-ProjectContract",
    PUBLIC_BASELINE_CONTRACT,
  ]);
}

function fixture(behavior = {}) {
  const fixtureRoot = mkdtempSync(
    path.join(tmpdir(), "clean-install-acceptance-test-"),
  );
  const sourceRoot = path.join(fixtureRoot, "source");
  const selectedRef = initializeHarnessSource(sourceRoot);
  const runner = createMockRunner(fixtureRoot);
  const manifest = commandManifest(fixtureRoot, runner, behavior);
  const workingRoot = path.join(fixtureRoot, "acceptance");
  const isolation = {
    home: path.join(workingRoot, "home with spaces"),
    userProfile: path.join(workingRoot, "profile with spaces"),
    codexHome: path.join(workingRoot, "codex home"),
    npmPrefix: path.join(workingRoot, "npm prefix"),
    project: path.join(workingRoot, "project with spaces"),
  };
  const outsideHome = path.join(fixtureRoot, "outside-global-home");
  write(path.join(outsideHome, "sentinel.txt"), "untouched\n");
  const report = path.join(fixtureRoot, "report.json");
  return {
    fixtureRoot,
    sourceRoot,
    selectedRef,
    manifest,
    workingRoot,
    isolation,
    outsideHome,
    report,
    cleanup: () => rmSync(fixtureRoot, { recursive: true, force: true }),
  };
}

function runAcceptance(value, extra = []) {
  return run(
    "pwsh",
    [
      "-NoProfile",
      "-File",
      ACCEPTANCE_SCRIPT,
      "-HarnessSource",
      value.sourceRoot,
      "-HarnessRef",
      value.selectedRef,
      "-CommandManifest",
      value.manifest,
      "-WorkingRoot",
      value.workingRoot,
      "-HomeRoot",
      value.isolation.home,
      "-UserProfileRoot",
      value.isolation.userProfile,
      "-CodexRoot",
      value.isolation.codexHome,
      "-NpmPrefixRoot",
      value.isolation.npmPrefix,
      "-ProjectRoot",
      value.isolation.project,
      "-ReportPath",
      value.report,
      ...extra,
    ],
    {
      env: {
        ...process.env,
        HOME: value.outsideHome,
        USERPROFILE: value.outsideHome,
        CODEX_HOME: path.join(value.outsideHome, ".codex"),
        NPM_CONFIG_PREFIX: path.join(value.outsideHome, ".npm-global"),
      },
    },
  );
}

function findClaudeDirectories(root) {
  const found = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!existsSync(current)) continue;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(current, entry.name);
      if (entry.name === ".claude") found.push(candidate);
      else pending.push(candidate);
    }
  }
  return found;
}

test("offline clean-install acceptance materializes an exact ref in isolated roots", () => {
  const value = fixture();
  try {
    const result = runAcceptance(value);
    assert.equal(
      result.status,
      0,
      `acceptance failed:\n${result.stdout}\n${result.stderr}`,
    );
    const report = JSON.parse(readFileSync(value.report, "utf8"));
    assert.equal(report.status, "passed");
    assert.equal(report.mode, "offline");
    assert.equal(report.requestedRef, value.selectedRef);
    assert.equal(report.resolvedRef, value.selectedRef);
    assert.equal(report.approvedAwaitingGatesObserved, true);
    assert.equal(report.claudeState, "absent-after-every-phase");
    assert.equal(report.claudeDirectoryCount, 0);
    assert.deepEqual(
      report.phases.map(({ name, status }) => [name, status]),
      [
        ["source", "passed"],
        ["bootstrap", "passed"],
        ["plugin", "passed"],
        ["ccgCodexMode", "passed"],
        ["globalSkills", "passed"],
        ["trellisProjectInit", "passed"],
        ["projectInit", "passed"],
        ["gates", "passed"],
        ["markReady", "passed"],
      ],
    );
    assert.equal(
      readFileSync(
        path.join(value.workingRoot, "harness", "release-marker.txt"),
        "utf8",
      ),
      "selected-ref\n",
    );
    assert.equal(
      JSON.parse(
        readFileSync(
          path.join(value.isolation.project, ".harness", "project.json"),
          "utf8",
        ),
      ).status,
      "ready",
    );
    assert.deepEqual(findClaudeDirectories(value.workingRoot), []);
    for (const thirdPartySkill of [
      "grill-me",
      "grilling",
      "diagnosing-bugs",
      "caveman",
    ]) {
      assert.equal(
        existsSync(
          path.join(value.isolation.home, ".agents", "skills", thirdPartySkill),
        ),
        false,
      );
      assert.equal(
        existsSync(
          path.join(value.isolation.project, ".agents", "skills", thirdPartySkill),
        ),
        false,
      );
    }
    for (const thirdPartyRuntime of [
      ".agents/harness/sources/ponytail",
      ".agents/harness/tools/codegraph",
      ".agents/harness/tools/fast-context",
    ]) {
      assert.equal(
        existsSync(path.join(value.isolation.home, thirdPartyRuntime)),
        false,
      );
    }
    assert.equal(
      readFileSync(path.join(value.outsideHome, "sentinel.txt"), "utf8"),
      "untouched\n",
    );
    for (const forbidden of [".agents", ".codex", ".npm-global", ".claude"]) {
      assert.equal(existsSync(path.join(value.outsideHome, forbidden)), false);
    }
  } finally {
    value.cleanup();
  }
});

test("plugin acceptance scans hidden Codex plugin directories", () => {
  const script = readFileSync(ACCEPTANCE_SCRIPT, "utf8");
  const pluginAssertion = script.match(
    /function Assert-PluginArtifacts\b[\s\S]*?\r?\n}\r?\n\r?\nfunction Assert-GlobalSkillArtifacts/,
  );
  assert.ok(pluginAssertion, "plugin artifact assertion must remain defined");
  assert.match(pluginAssertion[0], /Get-ChildItem\b[^\r\n]*\s-Force\b/);
});

test("acceptance stops at the first phase that creates .claude", () => {
  const value = fixture({ plugin: "create-claude" });
  try {
    const result = runAcceptance(value);
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /plugin.*forbidden \.claude|forbidden \.claude.*plugin/i,
    );
    const report = JSON.parse(readFileSync(value.report, "utf8"));
    assert.equal(report.status, "failed");
    assert.equal(report.phases.at(-1).name, "plugin");
    assert.equal(report.phases.at(-1).status, "failed");
    assert.equal(
      existsSync(
        path.join(value.isolation.project, ".harness", "project.json"),
      ),
      false,
    );
    assert.equal(report.claudeDirectoryCount, 1);
  } finally {
    value.cleanup();
  }
});

test("offline mode rejects remote Harness sources before cloning", () => {
  const value = fixture();
  try {
    value.sourceRoot = "https://example.invalid/harness.git";
    const result = runAcceptance(value);
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /offline acceptance requires.*local directory/i,
    );
    assert.equal(existsSync(path.join(value.workingRoot, "harness")), false);
  } finally {
    value.cleanup();
  }
});

test("command workingDirectory cannot escape isolated acceptance roots", () => {
  const value = fixture();
  try {
    const manifest = JSON.parse(readFileSync(value.manifest, "utf8"));
    manifest.phases.bootstrap[0].workingDirectory = value.outsideHome;
    write(value.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
    const result = runAcceptance(value);
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /workingDirectory escapes the isolated acceptance roots/i,
    );
    assert.equal(
      existsSync(
        path.join(value.workingRoot, "harness", ".acceptance", "bootstrap"),
      ),
      false,
    );
    assert.equal(
      readFileSync(path.join(value.outsideHome, "sentinel.txt"), "utf8"),
      "untouched\n",
    );
  } finally {
    value.cleanup();
  }
});

test("live mode requires an explicit approved project contract before cloning", () => {
  const value = fixture();
  try {
    const result = run("pwsh", [
      "-NoProfile",
      "-File",
      ACCEPTANCE_SCRIPT,
      "-Live",
      "-HarnessSource",
      value.sourceRoot,
      "-HarnessRef",
      value.selectedRef,
    ]);
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /requires -ProjectContract/i,
    );
    assert.equal(existsSync(value.workingRoot), false);
  } finally {
    value.cleanup();
  }
});

test(
  "Windows live bootstrap exposes newly installed isolated npm shims to its doctor",
  { skip: process.platform !== "win32" },
  () => {
    const value = fixture();
    try {
      runLiveBootstrapProbe(value);
      assert.equal(
        readFileSync(
          path.join(
            value.workingRoot,
            "harness",
            ".acceptance",
            "trellis-version.txt",
          ),
          "utf8",
        ).trim(),
        "0.6.9",
      );
      assert.deepEqual(findClaudeDirectories(value.workingRoot), []);
    } finally {
      value.cleanup();
    }
  },
);

test(
  "Windows live runtime exposes an arbitrary isolated npm prefix through APPDATA",
  { skip: process.platform !== "win32" },
  () => {
    const value = fixture();
    try {
      runLiveBootstrapProbe(value);
      assert.equal(
        readFileSync(
          path.join(
            value.workingRoot,
            "harness",
            ".acceptance",
            "adapter-ccg-visible.txt",
          ),
          "utf8",
        ).trim(),
        "true",
      );
      assert.deepEqual(findClaudeDirectories(value.workingRoot), []);
    } finally {
      value.cleanup();
    }
  },
);

test(
  "local live materialization assigns the fixed public origin without changing the exact ref",
  { skip: process.platform !== "win32" },
  () => {
    const value = fixture();
    try {
      runLiveBootstrapProbe(value);
      const checkout = path.join(value.workingRoot, "harness");
      assert.equal(
        readFileSync(
          path.join(checkout, ".acceptance", "origin.txt"),
          "utf8",
        ).trim(),
        PUBLIC_HARNESS_ORIGIN,
      );
      assert.equal(
        readFileSync(path.join(checkout, "release-marker.txt"), "utf8"),
        "selected-ref\n",
      );
      assert.deepEqual(findClaudeDirectories(value.workingRoot), []);
    } finally {
      value.cleanup();
    }
  },
);

test("automatic cleanup removes only its generated acceptance root", () => {
  const value = fixture();
  try {
    const result = run(
      "pwsh",
      [
        "-NoProfile",
        "-File",
        ACCEPTANCE_SCRIPT,
        "-HarnessSource",
        value.sourceRoot,
        "-HarnessRef",
        value.selectedRef,
        "-CommandManifest",
        value.manifest,
        "-ReportPath",
        value.report,
      ],
      {
        env: {
          ...process.env,
          HOME: value.outsideHome,
          USERPROFILE: value.outsideHome,
          CODEX_HOME: path.join(value.outsideHome, ".codex"),
          NPM_CONFIG_PREFIX: path.join(value.outsideHome, ".npm-global"),
        },
      },
    );
    assert.equal(
      result.status,
      0,
      `automatic acceptance failed:\n${result.stdout}\n${result.stderr}`,
    );
    const report = JSON.parse(readFileSync(value.report, "utf8"));
    assert.match(
      path.basename(report.isolation.workingRoot),
      /^trellis-ccg-clean-install-[0-9a-f-]{36}$/i,
    );
    assert.equal(existsSync(report.isolation.workingRoot), false);
    assert.equal(
      readFileSync(path.join(value.sourceRoot, "release-marker.txt"), "utf8"),
      "newer-unselected-ref\n",
    );
  } finally {
    value.cleanup();
  }
});

test("command interface exposes guided setup as an explicit phase contract", () => {
  const result = run("pwsh", [
    "-NoProfile",
    "-File",
    ACCEPTANCE_SCRIPT,
    "-DescribeCommandInterface",
  ]);
  assert.equal(
    result.status,
    0,
    `interface description failed:\n${result.stdout}\n${result.stderr}`,
  );
  const description = JSON.parse(result.stdout);
  assert.deepEqual(description.requiredPhases, [
    "bootstrap",
    "plugin",
    "ccgCodexMode",
    "globalSkills",
    "trellisProjectInit",
    "projectInit",
    "gates",
    "markReady",
  ]);
  assert.deepEqual(description.liveDefaultPhases, description.requiredPhases);
  assert.deepEqual(
    Object.keys(description.liveCommands),
    description.requiredPhases,
  );
  assert.equal(description.commandShape.workingDirectory, "{repo}");
  assert.match(description.liveRequirements.join("\n"), /ProjectContract/);
  assert.deepEqual(description.liveCommands.bootstrap[0], {
    executable: "pwsh",
    arguments: [
      "-NoProfile",
      "-File",
      "{repo}/scripts/bootstrap.ps1",
      "-RepoRoot",
      "{repo}",
      "-LinkCcg",
    ],
    workingDirectory: "{repo}",
  });
  assert.deepEqual(description.liveCommands.ccgCodexMode[0].arguments, [
    "codex-mode",
    "install",
  ]);
  assert.deepEqual(
    description.liveCommands.plugin.map((command) => command.arguments),
    [
      ["plugin", "marketplace", "add", "{repo}/components/ccg-workflow"],
      ["plugin", "add", "ccg@ccg-gptpro-worflow"],
    ],
  );
  assert.deepEqual(
    description.liveCommands.trellisProjectInit[0].arguments.slice(0, 3),
    ["init", "--codex", "--yes"],
  );
  assert.equal(
    description.liveCommands.trellisProjectInit[0].workingDirectory,
    "{project}",
  );
  assert.ok(
    description.liveCommands.globalSkills[0].arguments.includes(
      "--catalog-mode",
    ),
  );
  for (const flag of [
    "--third-party-global-skills",
    "--third-party-global-plugins",
    "--third-party-mcp-cli",
    "--third-party-source-sha256",
  ]) {
    assert.ok(description.liveCommands.globalSkills[0].arguments.includes(flag));
  }
  assert.equal(
    description.liveCommands.globalSkills[0].arguments[
      description.liveCommands.globalSkills[0].arguments.indexOf(
        "--third-party-global-skills",
      ) + 1
    ],
    "none",
  );
  assert.equal(
    description.liveCommands.globalSkills[0].arguments[
      description.liveCommands.globalSkills[0].arguments.indexOf(
        "--third-party-global-plugins",
      ) + 1
    ],
    "none",
  );
  assert.equal(
    description.liveCommands.globalSkills[0].arguments[
      description.liveCommands.globalSkills[0].arguments.indexOf(
        "--third-party-mcp-cli",
      ) + 1
    ],
    "none",
  );
  assert.equal(
    description.liveCommands.globalSkills[0].arguments[
      description.liveCommands.globalSkills[0].arguments.indexOf(
        "--third-party-source-sha256",
      ) + 1
    ],
    "{thirdPartySourceSha256}",
  );
  assert.ok(
    description.liveCommands.projectInit[0].arguments.includes(
      "--no-project-skills",
    ),
  );
  assert.equal(
    description.liveCommands.projectInit[0].arguments[
      description.liveCommands.projectInit[0].arguments.indexOf(
        "--third-party-project-skills",
      ) + 1
    ],
    "none",
  );
  assert.equal(
    description.liveCommands.projectInit[0].arguments[
      description.liveCommands.projectInit[0].arguments.indexOf(
        "--third-party-source-sha256",
      ) + 1
    ],
    "{thirdPartySourceSha256}",
  );
  assert.match(
    description.tokens["{thirdPartySourceSha256}"],
    /canonical.*SHA-256/i,
  );
  assert.ok(
    description.liveCommands.markReady[0].arguments.includes("mark-ready"),
  );
  assert.deepEqual(
    description.liveCommands.gates.map((command) => command.executable),
    ["pwsh", "node", "ccg"],
  );
  assert.ok(
    description.liveCommands.gates[1].arguments.includes("conflicts"),
  );
  assert.deepEqual(description.liveCommands.gates[2], {
    executable: "ccg",
    arguments: ["doctor", "--platform", "codex"],
    workingDirectory: "{project}",
  });
  assert.match(description.tokens["{project}"], /project/i);
});
