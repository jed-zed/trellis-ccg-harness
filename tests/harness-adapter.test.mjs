import assert from "node:assert/strict";
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
import { resolvePython } from "../scripts/lib/python-resolver.mjs";

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, value);
}

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
    state: {
      ignoredRuntimePaths: [".ccg", ".codex/ccg"],
      forbiddenTrackedPaths: [".ccg", ".codex/ccg"],
    },
    models: {
      codex: { enabled: true, workspaceWrite: true },
      gemini: { enabled: true, workspaceWrite: false },
      claude: { enabled: false, workspaceWrite: false },
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
    assert.equal(context.models.claude.enabled, false);
  } finally {
    fixture.cleanup();
  }
});

test("clean fixture has no blocking conflicts", () => {
  const fixture = createFixture();
  try {
    const report = auditConflicts(fixture.repoRoot, {
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

test("source, runtime state, provider, and Claude drift are blocking", () => {
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
    const report = auditConflicts(fixture.repoRoot, {
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

test("unguarded duplicate Trellis prompt hooks remain warning-only", () => {
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
    const report = auditConflicts(fixture.repoRoot, {
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

test("guarded global Trellis hook yields to the project hook", () => {
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
    const report = auditConflicts(fixture.repoRoot, {
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

test("an idle repository without an active task remains doctor-safe", () => {
  const fixture = createFixture();
  try {
    const runner = (command, args, options) => {
      if (command === "python" || command === "python3") {
        return {
          status: 1,
          stdout: "",
          stderr: "No active task found.",
        };
      }
      return fixture.runner(command, args, options);
    };
    const report = auditConflicts(fixture.repoRoot, {
      runner,
      homeDir: fixture.homeDir,
    });
    const taskAuthority = report.findings.find(
      (item) => item.id === "task-authority",
    );
    assert.equal(taskAuthority.severity, "info");
    assert.equal(taskAuthority.status, "info");
    assert.equal(conflictExitCode(report), 0);
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
