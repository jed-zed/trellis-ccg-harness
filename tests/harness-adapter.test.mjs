import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  REDACTED,
  auditConflicts,
  buildCanonicalContext,
  conflictExitCode,
  normalizeBaseUrl,
  probeOpenAICompatibleGrok,
  redactValue,
} from "../scripts/lib/harness-adapter.mjs";
import { runCommandAsync } from "../scripts/lib/harness-adapter/process.mjs";
import { resolvePython } from "../scripts/lib/python-resolver.mjs";

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("asynchronous command capture returns stdout and stderr", async () => {
  const result = await runCommandAsync(
    process.execPath,
    [
      "-e",
      "process.stdout.write('runtime-ok\\n'); process.stderr.write('note\\n')",
    ],
    {
      repoRoot: path.resolve("."),
    },
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "runtime-ok");
  assert.equal(result.stderr, "note");
});

test("asynchronous command capture fails closed on oversized output", async () => {
  const result = await runCommandAsync(
    process.execPath,
    ["-e", "process.stdout.write('x'.repeat(4096))"],
    {
      repoRoot: path.resolve("."),
      maxCaptureBytes: 32,
    },
  );
  assert.equal(result.status, null);
  assert.match(result.error.message, /capture limit/i);
});

test(
  "Windows asynchronous command capture supports an exact cmd bridge",
  { skip: process.platform !== "win32" },
  async () => {
    const commandLine = `""${process.execPath}" --version"`;
    const result = await runCommandAsync(
      process.env.ComSpec,
      ["/d", "/s", "/c", commandLine],
      {
        repoRoot: path.resolve("."),
        windowsVerbatimArguments: true,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^v\d+\./);
  },
);

function adapterContract() {
  return {
    schemaVersion: 1,
    harness: {
      definition: "Trellis plus personal CCG",
      adapterRole: "internal",
    },
    authorities: {
      lifecycle: "trellis",
      taskRoot: ".trellis/tasks",
      intelligence: "ccg",
      workspaceOwner: "codex",
    },
    runtime: {
      ccg: {
        mode: "installed-cli-plugin",
        command: "ccg",
        sourceSnapshotExecutable: false,
      },
    },
    productManager: {
      stateAuthority: "trellis-task-projection",
      stateFile: "product-manager.json",
      evidenceRoot: ".ccg-evidence/product-manager",
      selectedProviderAuthority: "unified-ccg-routing",
      allowedProviders: ["codex", "gemini", "claude"],
      providerCapabilities: {
        codex: {
          readOnly: true,
          workspaceWrite: false,
          terminal: false,
          subagents: false,
          network: "explicit-per-call",
          paid: "explicit-per-call",
        },
        gemini: {
          readOnly: true,
          workspaceWrite: false,
          terminal: false,
          subagents: false,
          network: "explicit-per-call",
          paid: "explicit-per-call",
        },
        claude: {
          readOnly: true,
          workspaceWrite: false,
          terminal: false,
          subagents: false,
          network: "explicit-per-call",
          paid: "explicit-per-call",
        },
        grok: {
          readOnly: false,
          workspaceWrite: false,
          terminal: false,
          subagents: false,
          network: "forbidden",
          paid: "forbidden",
        },
      },
    },
    state: {
      ignoredRuntimePaths: [".ccg", ".codex/ccg"],
      forbiddenTrackedPaths: [".ccg", ".codex/ccg"],
    },
    models: {
      codex: { enabled: true, workspaceWrite: true },
      gemini: { enabled: true, workspaceWrite: false },
      claude: { enabled: true, workspaceWrite: false },
      grok: {
        enabled: false,
        optional: true,
        workspaceWrite: false,
      },
      gptpro: {
        enabled: true,
        manualOnly: true,
        workspaceWrite: false,
      },
    },
    dispatch: { codex: "inline" },
    hooks: {
      projectAuthority: ".codex/hooks.json",
      promptEvent: "UserPromptSubmit",
      userOverlapPolicy: "project-local-precedence",
      globalYieldMarker: "TRELLIS_PROJECT_HOOK_PRECEDENCE_V1",
    },
    commands: {
      namespaces: { trellis: "trellis", ccg: "ccg" },
    },
    packageManager: { name: "pnpm", version: "10.17.1" },
    providers: {
      officialGrokCliAcp: {
        enabled: false,
        optional: true,
        credentialEnv: "XAI_API_KEY",
      },
      openAICompatibleGrok: {
        enabled: false,
        optional: true,
        baseUrlEnv: "HARNESS_GROK_BASE_URL",
        apiKeyEnv: "HARNESS_GROK_API_KEY",
        modelEnv: "HARNESS_GROK_MODEL",
        defaultModel: "grok-4.5",
        modelsPath: "/v1/models",
        chatPath: "/v1/chat/completions",
        responsesPath: "/v1/responses",
        timeoutMs: 1000,
      },
      gptPro: {
        enabled: true,
        manualOnly: true,
        apiKeyEnv: "HARNESS_GPTPRO_API_KEY",
      },
    },
    conflicts: {
      blockingExitCode: 2,
      severities: ["blocking", "warning", "info"],
    },
  };
}

function sourceManifest() {
  return {
    schemaVersion: 1,
    trellis: {
      package: "@mindfoldhq/trellis",
      version: "0.6.8",
    },
    ccg: {
      package: "ccg-workflow",
      version: "3.3.0",
      authoritativeRepository:
        "https://github.com/jed-zed/ccg-gptpro-worflow",
      commit: "personal-commit",
      gitTree: "personal-tree",
      snapshotPath: "components/ccg-workflow",
    },
  };
}

function createFixture() {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "harness-adapter-"));
  const homeDir = path.join(repoRoot, "home");
  const taskDirectory = path.join(
    repoRoot,
    ".trellis",
    "tasks",
    "fixture-task",
  );
  writeJson(
    path.join(repoRoot, ".harness", "adapter.json"),
    adapterContract(),
  );
  const project = {
    productManager: {
      ...adapterContract().productManager,
      stateFile: ".trellis/tasks/<task>/product-manager.json",
      evidenceRoot:
        ".trellis/tasks/<task>/.ccg-evidence/product-manager",
    },
  };
  const projectBytes = `${JSON.stringify(project, null, 2)}\n`;
  const projectSchemaBytes = `${JSON.stringify({ type: "object" }, null, 2)}\n`;
  const productManagerSchemaBytes = `${JSON.stringify(
    { type: "object" },
    null,
    2,
  )}\n`;
  writeText(path.join(repoRoot, ".harness", "project.json"), projectBytes);
  writeText(
    path.join(repoRoot, ".harness", "project.schema.json"),
    projectSchemaBytes,
  );
  writeText(
    path.join(repoRoot, ".harness", "product-manager.schema.json"),
    productManagerSchemaBytes,
  );
  writeJson(path.join(repoRoot, ".harness", "ownership.json"), {
    contractSha256: sha256(projectBytes),
    schemaSha256: sha256(projectSchemaBytes),
    productManagerSchemaSha256: sha256(productManagerSchemaBytes),
    managedPaths: [
      ".harness/project.json",
      ".harness/project.schema.json",
      ".harness/product-manager.schema.json",
    ],
  });
  writeJson(path.join(repoRoot, "harness.sources.json"), sourceManifest());
  writeJson(path.join(repoRoot, "package.json"), {
    name: "fixture",
    packageManager: "pnpm@10.17.1",
  });
  writeText(path.join(repoRoot, ".trellis", ".version"), "0.6.8\n");
  writeText(
    path.join(repoRoot, ".trellis", "config.yaml"),
    "codex:\n  dispatch_mode: inline\n",
  );
  writeJson(path.join(taskDirectory, "task.json"), {
    id: "fixture-task",
    title: "Fixture task",
    status: "in_progress",
  });
  writeText(path.join(taskDirectory, "prd.md"), "# Fixture\n");
  writeText(path.join(taskDirectory, "design.md"), "# Design\n");
  writeText(path.join(taskDirectory, "implement.md"), "# Implement\n");
  writeJson(
    path.join(repoRoot, "components", "ccg-workflow", "package.json"),
    { name: "ccg-workflow", version: "3.3.0" },
  );
  writeJson(path.join(repoRoot, ".codex", "hooks.json"), {
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: "command",
              command:
                "python -X utf8 .codex/hooks/inject-workflow-state.py",
            },
          ],
        },
      ],
    },
  });
  writeJson(
    path.join(
      homeDir,
      ".codex",
      "plugins",
      "cache",
      "ccg-gptpro-worflow",
      "ccg",
      "3.3.0",
      ".codex-plugin",
      "plugin.json",
    ),
    { name: "ccg", version: "3.3.0" },
  );

  const state = {
    tree: "personal-tree",
    tracked: "",
    ccgVersion: "ccg/3.3.0 win32-x64 node-v24.0.0",
    taskPath: ".trellis/tasks/fixture-task",
  };
  const runner = (command, args) => {
    if (
      (command === "python" || command === "python3") &&
      args.includes("--version")
    ) {
      return {
        status: 0,
        stdout: "Python 3.12.4",
        stderr: "",
      };
    }
    if (command === "python" || command === "python3") {
      return { status: 0, stdout: state.taskPath, stderr: "" };
    }
    if (command === "git" && args.includes("write-tree")) {
      return { status: 0, stdout: "index-tree", stderr: "" };
    }
    if (command === "git" && args.includes("rev-parse")) {
      return { status: 0, stdout: state.tree, stderr: "" };
    }
    if (command === "git" && args.includes("ls-files")) {
      return { status: 0, stdout: state.tracked, stderr: "" };
    }
    if (command === "git" && args.includes("check-ignore")) {
      return {
        status: args.at(-1).includes(".ccg-evidence/product-manager") ? 0 : 1,
        stdout: "",
        stderr: "",
      };
    }
    if (command === "ccg" || command === "ccg.cmd") {
      return { status: 0, stdout: state.ccgVersion, stderr: "" };
    }
    return {
      status: null,
      stdout: "",
      stderr: "",
      error: Object.assign(new Error(`missing ${command}`), { code: "ENOENT" }),
    };
  };

  return {
    repoRoot,
    homeDir,
    taskDirectory,
    runner,
    state,
    cleanup: () => rmSync(repoRoot, { recursive: true, force: true }),
  };
}

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

test("redacts nested credentials, bearer tokens, query tokens, and JWTs", () => {
  const secret = `sk-${"a".repeat(32)}`;
  const value = {
    apiKey: secret,
    nested: [
      `Bearer ${secret}`,
      `https://example.test/path?token=${secret}&safe=1`,
      "eyJabcdefghijk.abcdefghijk.abcdefghijk",
    ],
  };
  const redacted = redactValue(value, [secret]);
  const serialized = JSON.stringify(redacted);
  assert.equal(redacted.apiKey, REDACTED);
  assert.equal(redacted.nested[0], REDACTED);
  assert.equal(
    redacted.nested[1],
    `https://example.test/path?token=${REDACTED}&safe=1`,
  );
  assert.equal(redacted.nested[2], REDACTED);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("eyJabcdefghijk"), false);
});

test("preserves repeated aliases while still stopping actual cycles", () => {
  const shared = { artifact: "implement.md", token: "unsafe" };
  const cyclic = { name: "root" };
  cyclic.self = cyclic;

  const redacted = redactValue({
    first: shared,
    second: shared,
    cyclic,
  });

  assert.deepEqual(redacted.first, {
    artifact: "implement.md",
    token: REDACTED,
  });
  assert.deepEqual(redacted.second, redacted.first);
  assert.notEqual(redacted.second, "[CIRCULAR]");
  assert.equal(redacted.cyclic.self, "[CIRCULAR]");
});

test("normalizes HTTPS provider URLs and rejects remote HTTP", () => {
  assert.equal(
    normalizeBaseUrl("https://example.test/api///?token=unsafe"),
    "https://example.test/api",
  );
  assert.equal(
    normalizeBaseUrl("http://127.0.0.1:8080/"),
    "http://127.0.0.1:8080",
  );
  assert.throws(
    () => normalizeBaseUrl("http://example.test"),
    /must use HTTPS/,
  );
  assert.throws(
    () => normalizeBaseUrl("https://user:password@example.test"),
    /must not contain credentials/,
  );
});

test("resolves Python 3.9+ without assuming the python executable name", () => {
  const calls = [];
  const runner = (command, args) => {
    calls.push([command, args]);
    if (command === "python3") {
      return {
        status: 0,
        stdout: "Python 3.12.4",
        stderr: "",
      };
    }
    if (command === "which") {
      return {
        status: 0,
        stdout: "/opt/Python Tools/python3\n",
        stderr: "",
      };
    }
    return { status: 1, stdout: "", stderr: "" };
  };
  assert.deepEqual(resolvePython({ platform: "linux", runner }), {
    command: "/opt/Python Tools/python3",
    argsPrefix: [],
    version: "3.12.4",
  });
  assert.equal(calls[0][0], "python3");
});

test("project Codex hooks use the cross-platform Python launcher", () => {
  const hooks = JSON.parse(
    readFileSync(
      new URL("../.codex/hooks.json", import.meta.url),
      "utf8",
    ),
  );
  const serialized = JSON.stringify(hooks);
  assert.match(serialized, /python-hook-runner\.mjs/);
  assert.doesNotMatch(serialized, /"command":"python(?:3)?\s/);
});

test("builds canonical context from the active Trellis task", () => {
  const fixture = createFixture();
  try {
    const context = buildCanonicalContext(fixture.repoRoot, {
      runner: fixture.runner,
    });
    assert.equal(context.task.id, "fixture-task");
    assert.equal(context.task.status, "in_progress");
    assert.match(context.task.artifacts["prd.md"].sha256, /^[a-f0-9]{64}$/);
    assert.equal(context.sources.ccg.gitTree, "personal-tree");
    assert.equal(context.models.claude.enabled, true);
  } finally {
    fixture.cleanup();
  }
});

test("canonical context uses the shared Windows py -3 resolver", () => {
  const fixture = createFixture();
  const calls = [];
  const launcher = "C:\\Windows\\py.exe";
  try {
    const runner = (command, args, options) => {
      calls.push([command, args]);
      if (command === "py" && args.join(" ") === "-3 --version") {
        return {
          status: 0,
          stdout: "Python 3.12.4",
          stderr: "",
        };
      }
      if (command === "where.exe" && args[0] === "py") {
        return { status: 0, stdout: `${launcher}\n`, stderr: "" };
      }
      if (
        command === launcher &&
        args[0] === "-3" &&
        args.at(-1) === "current"
      ) {
        return {
          status: 0,
          stdout: fixture.state.taskPath,
          stderr: "",
        };
      }
      return fixture.runner(command, args, options);
    };

    const context = buildCanonicalContext(fixture.repoRoot, {
      runner,
      pythonPlatform: "win32",
    });
    assert.equal(context.task.id, "fixture-task");
    assert.equal(
      calls.some(
        ([command, args]) =>
          command === launcher &&
          args[0] === "-3" &&
          args.at(-1) === "current",
      ),
      true,
    );
  } finally {
    fixture.cleanup();
  }
});

test("clean fixture has no blocking conflicts", async () => {
  const fixture = createFixture();
  try {
    const report = await auditConflicts(fixture.repoRoot, {
      runner: fixture.runner,
      homeDir: fixture.homeDir,
    });
    assert.equal(report.summary.blocking, 0);
    assert.equal(conflictExitCode(report), 0);
    assert.equal(
      report.findings.find((item) => item.id === "ccg-source-tree").status,
      "ok",
    );
  } finally {
    fixture.cleanup();
  }
});

test("Codex plugin cache accepts an owned base-version cachebuster", async () => {
  const fixture = createFixture();
  try {
    const cacheRoot = path.join(
      fixture.homeDir,
      ".codex",
      "plugins",
      "cache",
      "ccg-gptpro-worflow",
      "ccg",
    );
    rmSync(path.join(cacheRoot, "3.3.0"), {
      recursive: true,
      force: true,
    });
    writeJson(
      path.join(
        cacheRoot,
        "3.3.0+codex.20260726153650",
        ".codex-plugin",
        "plugin.json",
      ),
      { name: "ccg", version: "3.3.0+codex.20260726153650" },
    );
    const report = await auditConflicts(fixture.repoRoot, {
      runner: fixture.runner,
      homeDir: fixture.homeDir,
    });
    const finding = report.findings.find(
      (item) => item.id === "ccg-plugin-cache",
    );
    assert.equal(finding.status, "ok");
    assert.equal(
      finding.evidence.actual,
      "3.3.0+codex.20260726153650",
    );
  } finally {
    fixture.cleanup();
  }
});

test("Codex plugin cache accepts valid owner-compatible versions", async () => {
  const fixture = createFixture();
  try {
    const cacheRoot = path.join(
      fixture.homeDir,
      ".codex",
      "plugins",
      "cache",
      "ccg-gptpro-worflow",
      "ccg",
    );
    rmSync(path.join(cacheRoot, "3.3.0"), {
      recursive: true,
      force: true,
    });
    writeJson(
      path.join(
        cacheRoot,
        "3.4.1+codex.1",
        ".codex-plugin",
        "plugin.json",
      ),
      { name: "ccg", version: "3.4.1+codex.1" },
    );
    const report = await auditConflicts(fixture.repoRoot, {
      runner: fixture.runner,
      homeDir: fixture.homeDir,
    });
    const finding = report.findings.find(
      (item) => item.id === "ccg-plugin-cache",
    );
    assert.equal(finding.status, "ok");
    assert.equal(finding.severity, "warning");
    assert.equal(finding.evidence.actual, "3.4.1+codex.1");
    assert.deepEqual(finding.evidence.available, ["3.4.1+codex.1"]);
  } finally {
    fixture.cleanup();
  }
});

test("missing CCG CLI blocks while a missing plugin cache remains visible", async () => {
  const fixture = createFixture();
  try {
    fixture.state.ccgVersion = "";
    rmSync(
      path.join(
        fixture.homeDir,
        ".codex",
        "plugins",
        "cache",
        "ccg-gptpro-worflow",
      ),
      { recursive: true, force: true },
    );
    const report = await auditConflicts(fixture.repoRoot, {
      runner: fixture.runner,
      homeDir: fixture.homeDir,
    });
    const runtime = report.findings.find(
      (item) => item.id === "ccg-runtime-cli",
    );
    const plugin = report.findings.find(
      (item) => item.id === "ccg-plugin-cache",
    );
    assert.equal(runtime.status, "conflict");
    assert.equal(runtime.severity, "blocking");
    assert.equal(plugin.status, "conflict");
    assert.equal(plugin.severity, "warning");
    assert.ok(report.summary.blocking >= 1);
    assert.ok(report.summary.warning >= 1);
  } finally {
    fixture.cleanup();
  }
});

test("deterministic CI skips only user runtime checks", async () => {
  const fixture = createFixture();
  try {
    fixture.state.ccgVersion = "";
    const report = await auditConflicts(fixture.repoRoot, {
      runner: fixture.runner,
      homeDir: fixture.homeDir,
      includeRuntimeState: false,
      includeUserState: false,
    });
    const runtime = report.findings.find(
      (item) => item.id === "ccg-runtime-cli",
    );
    assert.equal(runtime.status, "info");
    assert.equal(runtime.severity, "info");
    assert.equal(report.summary.blocking, 0);

    const ordinary = await auditConflicts(fixture.repoRoot, {
      runner: fixture.runner,
      homeDir: fixture.homeDir,
    });
    assert.equal(
      ordinary.findings.find(
        (item) => item.id === "ccg-runtime-cli",
      ).status,
      "conflict",
    );
  } finally {
    fixture.cleanup();
  }
});

test("Trellis assets under project .claude are blocking conflicts", async () => {
  const fixture = createFixture();
  try {
    writeText(
      path.join(
        fixture.repoRoot,
        ".claude",
        "skills",
        "trellis-check",
        "SKILL.md",
      ),
      "# stale Trellis projection\n",
    );
    const report = await auditConflicts(fixture.repoRoot, {
      runner: fixture.runner,
      homeDir: fixture.homeDir,
    });
    const finding = report.findings.find(
      (item) => item.id === "harness-claude-assets",
    );
    assert.equal(finding.severity, "blocking");
    assert.equal(finding.status, "conflict");
    assert.equal(conflictExitCode(report), 2);
  } finally {
    fixture.cleanup();
  }
});

test("unrelated project .claude content is reported but preserved", async () => {
  const fixture = createFixture();
  try {
    const userFile = path.join(
      fixture.repoRoot,
      ".claude",
      "user-owned.md",
    );
    writeText(userFile, "keep\n");
    const report = await auditConflicts(fixture.repoRoot, {
      runner: fixture.runner,
      homeDir: fixture.homeDir,
    });
    const finding = report.findings.find(
      (item) => item.id === "user-claude-assets",
    );
    assert.equal(finding.severity, "info");
    assert.equal(finding.status, "info");
    assert.equal(conflictExitCode(report), 0);
    assert.equal(readFileSync(userFile, "utf8"), "keep\n");
  } finally {
    fixture.cleanup();
  }
});

test("source, runtime state, provider, and Claude drift are blocking", async () => {
  const fixture = createFixture();
  try {
    fixture.state.tree = "wrong-tree";
    fixture.state.tracked = ".ccg/tasks/runtime.json";
    const contractPath = path.join(
      fixture.repoRoot,
      ".harness",
      "adapter.json",
    );
    const contract = JSON.parse(readFileSync(contractPath, "utf8"));
    contract.providers.openAICompatibleGrok.apiKeyEnv = "XAI_API_KEY";
    writeJson(contractPath, contract);
    const report = await auditConflicts(fixture.repoRoot, {
      runner: fixture.runner,
      homeDir: fixture.homeDir,
      env: { ...process.env, HARNESS_ENABLE_CLAUDE: "true" },
    });
    assert.equal(conflictExitCode(report), 2);
    for (const id of [
      "ccg-source-tree",
      "tracked-runtime-state",
      "provider-separation",
      "model-policy",
    ]) {
      assert.equal(
        report.findings.find((item) => item.id === id).status,
        "conflict",
      );
    }
  } finally {
    fixture.cleanup();
  }
});

test("unguarded duplicate Trellis prompt hooks remain warning-only", async () => {
  const fixture = createFixture();
  try {
    writeJson(path.join(fixture.homeDir, ".codex", "hooks.json"), {
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: "command",
                command:
                  "python /home/user/.codex/hooks/inject-workflow-state.py",
              },
            ],
          },
        ],
      },
    });
    const report = await auditConflicts(fixture.repoRoot, {
      runner: fixture.runner,
      homeDir: fixture.homeDir,
    });
    const overlap = report.findings.find(
      (item) => item.id === "prompt-hook-overlap",
    );
    assert.equal(overlap.severity, "warning");
    assert.equal(overlap.status, "conflict");
    assert.equal(conflictExitCode(report), 0);
  } finally {
    fixture.cleanup();
  }
});

test("guarded global Trellis hook yields to the project hook", async () => {
  const fixture = createFixture();
  try {
    writeJson(path.join(fixture.homeDir, ".codex", "hooks.json"), {
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: "command",
                command:
                  "python /home/user/.codex/hooks/inject-workflow-state.py",
              },
            ],
          },
        ],
      },
    });
    writeText(
      path.join(
        fixture.homeDir,
        ".codex",
        "hooks",
        "inject-workflow-state.py",
      ),
      'PROJECT_LOCAL_HOOK_PRECEDENCE_MARKER = "TRELLIS_PROJECT_HOOK_PRECEDENCE_V1"\n',
    );
    const report = await auditConflicts(fixture.repoRoot, {
      runner: fixture.runner,
      homeDir: fixture.homeDir,
    });
    const overlap = report.findings.find(
      (item) => item.id === "prompt-hook-overlap",
    );
    assert.equal(overlap.status, "ok");
    assert.equal(overlap.evidence.projectLocalPrecedence, true);
    assert.equal(conflictExitCode(report), 0);
  } finally {
    fixture.cleanup();
  }
});

test("an idle repository without an active task remains doctor-safe", async () => {
  const fixture = createFixture();
  try {
    for (const stderr of ["No active task found.", ""]) {
      const runner = (command, args, options) => {
        if (
          (command === "python" || command === "python3") &&
          !args.includes("--version")
        ) {
          return {
            status: 1,
            stdout: "",
            stderr,
          };
        }
        return fixture.runner(command, args, options);
      };
      const report = await auditConflicts(fixture.repoRoot, {
        runner,
        homeDir: fixture.homeDir,
      });
      const taskAuthority = report.findings.find(
        (item) => item.id === "task-authority",
      );
      assert.equal(taskAuthority.severity, "info");
      assert.equal(taskAuthority.status, "info");
      assert.equal(conflictExitCode(report), 0);
    }
  } finally {
    fixture.cleanup();
  }
});

test("Grok probe reports models, chat, and source-backed search", async () => {
  const contract = adapterContract();
  const secret = `sk-${"b".repeat(32)}`;
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith("/v1/models")) {
      return response(200, { data: [{ id: "grok-4.5" }] });
    }
    if (String(url).endsWith("/v1/chat/completions")) {
      return response(200, {
        choices: [{ message: { content: "OK" } }],
      });
    }
    return response(200, {
      output: [
        { type: "web_search_call" },
        {
          type: "message",
          content: [
            {
              text: "Source: https://docs.x.ai/developers/tools/web-search",
              annotations: [{ type: "url_citation" }],
            },
          ],
        },
      ],
    });
  };
  const report = await probeOpenAICompatibleGrok(contract, {
    env: {
      HARNESS_GROK_BASE_URL: "https://example.test/",
      HARNESS_GROK_API_KEY: secret,
      HARNESS_GROK_MODEL: "grok-4.5",
    },
    fetchImpl,
    includeChat: true,
    includeSearch: true,
  });

  assert.equal(report.models.requestedModelAvailable, true);
  assert.equal(report.chat.responded, true);
  assert.equal(report.search.webSearchCallCount, 1);
  assert.equal(report.search.sourceBacked, true);
  assert.equal(JSON.stringify(report).includes(secret), false);
  assert.equal(requests.length, 3);
});

test("Grok probe redacts provider failures and stays optional when unset", async () => {
  const contract = adapterContract();
  const secret = `sk-${"c".repeat(32)}`;
  const failed = await probeOpenAICompatibleGrok(contract, {
    env: {
      HARNESS_GROK_BASE_URL: "https://example.test",
      HARNESS_GROK_API_KEY: secret,
    },
    fetchImpl: async () => {
      throw new Error(`Bearer ${secret} failed`);
    },
  });
  assert.equal(failed.models.ok, false);
  assert.equal(JSON.stringify(failed).includes(secret), false);

  const missing = await probeOpenAICompatibleGrok(contract, { env: {} });
  assert.equal(missing.configured, false);
  assert.equal(missing.optional, true);
  assert.deepEqual(missing.missing, [
    "HARNESS_GROK_BASE_URL",
    "HARNESS_GROK_API_KEY",
  ]);
});
