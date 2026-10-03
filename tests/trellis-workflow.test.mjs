import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolvePython } from "../scripts/lib/python-resolver.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const python = resolvePython();
const read = (relative) => readFileSync(path.join(root, relative), "utf8");

test("the real Trellis task CLI imports the retained project modules", () => {
  // The 0.6.16 update once preserved an older task_context.py: AST checks passed,
  // but task.py could not import curated_entry_count. Exercise that actual seam.
  const result = spawnSync(python.command, [
    ...python.argsPrefix, path.join(root, ".trellis/scripts/task.py"), "--help",
  ], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 15000 });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  assert.match(result.stdout, /Task Management Script/);
});

test("the no-task hook delivers fast-lane and escalation rules without task mutation", (t) => {
  const fixture = mkdtempSync(path.join(tmpdir(), "harness-fast-lane-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  // A real empty project avoids Trellis's existing single-session fallback
  // borrowing the developer's active task from this checkout.
  const tasks = path.join(fixture, ".trellis/tasks");
  mkdirSync(tasks, { recursive: true });
  for (const entry of ["scripts", "workflow.md", "config.yaml"]) {
    cpSync(path.join(root, ".trellis", entry), path.join(fixture, ".trellis", entry), { recursive: true });
  }
  const before = readdirSync(tasks).sort();
  const env = { ...process.env, TRELLIS_HOOKS: "1", TRELLIS_DISABLE_HOOKS: "0" };
  for (const key of Object.keys(env)) {
    if (key === "TRELLIS_CONTEXT_ID" || key.endsWith("_PROJECT_DIR")) delete env[key];
  }
  const cases = [
    ["解释这段文字", /simple conversation/i],
    ["只读查看这个文件的导出", /read-only local inspection/],
    ["修正说明里的一个错别字", /known local low-risk edits/],
    ["把系统改好", /Unknown impact or ambiguous requests enter the structured lane/],
    ["修改登录授权并迁移用户数据", /Authentication\/authorization.*data migration\/loss/],
  ];
  for (const [prompt, expectedGuidance] of cases) {
    const result = spawnSync(python.command, [
      ...python.argsPrefix, path.join(root, ".codex/hooks/inject-workflow-state.py"),
    ], {
      cwd: fixture, env, encoding: "utf8", windowsHide: true, timeout: 15000,
      input: JSON.stringify({ cwd: fixture, session_id: randomUUID(), prompt }),
    });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    assert.match(context, /Status: no_task/);
    assert.match(context, expectedGuidance, prompt);
    assert.match(context, /Do not ask a task-creation question/);
    assert.match(context, /trigger fact -> required output -> stop condition/);
    assert.doesNotMatch(context, /ask only whether this turn should create|read the `trellis-start` skill once/);
  }
  assert.deepEqual(readdirSync(tasks).sort(), before);
});

test("structured breadcrumbs restore complex artifacts and planning approval while keeping hard gates", () => {
  const workflow = read(".trellis/workflow.md");
  for (const status of ["planning-inline", "in_progress-inline"]) {
    const body = workflow.match(new RegExp(`^\\[workflow-state:${status}\\]\\r?\\n([\\s\\S]*?)^\\[/workflow-state:${status}\\]`, "m"))?.[1];
    assert.ok(body, status);
    assert.match(body, /trigger fact -> required output -> stop condition/);
    assert.match(body, /currentGate.status=awaiting_user_acceptance/);
    assert.match(body, /fresh explicit response/);
  }
  assert.match(workflow, /one authoritative plan/);
  assert.match(workflow, /Complex tasks must have `prd\.md`, `design\.md`, and `implement\.md`/);
  assert.match(workflow, /After presenting the completed plan, wait for explicit user approval before `task\.py start`/);
  assert.match(workflow, /reproduced fault, accepted contract, or actual trust\/data boundary/);
  for (const name of ["start", "continue", "before-dev", "brainstorm", "check", "finish-work"]) {
    const skill = read(`.agents/skills/trellis-${name}/SKILL.md`);
    assert.match(skill, /workflow\.md/);
    assert.doesNotMatch(skill, /Return to workflow Phase 3\.4 to commit/);
  }
  const check = read(".agents/skills/trellis-check/SKILL.md");
  assert.match(check, /Run the project's lint, type-check, and test commands/);
  assert.match(check, /New function → unit test added/);
  assert.match(check, /Bug fix → regression test added/);
  assert.match(check, /Changed behavior → existing tests updated/);
  for (const name of ["continue", "finish-work"]) {
    const command = read(`.gemini/commands/trellis/${name}.toml`);
    assert.match(command, /workflow\.md/);
    assert.match(command, /Fast-lane requests/);
    assert.doesNotMatch(command, /complex returns to|Code commits are NOT done here|Final git log order/);
  }
});

test("compact workflow still serves phase context and actionable step details", () => {
  for (const [step, expected] of [
    [null, /Request Triage/],
    ["1.3", /--allow-empty-context/],
    ["2.2", /lint, type-check, and test commands/],
    ["3.5", /archive.*--no-commit/],
  ]) {
    const args = [
      ...python.argsPrefix, path.join(root, ".trellis/scripts/get_context.py"),
      "--mode", "phase", "--platform", "codex",
      ...(step ? ["--step", step] : []),
    ];
    const result = spawnSync(python.command, args, {
      cwd: root, encoding: "utf8", windowsHide: true, timeout: 15000,
    });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    assert.match(result.stdout, expected, step ?? "phase index");
  }
});

test("the real Codex hook distinguishes broken task records and retains the product-manager gate", (t) => {
  const fixture = mkdtempSync(path.join(tmpdir(), "harness-task-error-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  for (const entry of ["scripts", "workflow.md", "config.yaml"]) {
    cpSync(path.join(root, ".trellis", entry), path.join(fixture, ".trellis", entry), { recursive: true });
  }
  const taskDir = path.join(fixture, ".trellis/tasks/broken-record");
  mkdirSync(taskDir, { recursive: true });
  const sessionId = randomUUID();
  const env = { ...process.env, TRELLIS_HOOKS: "1", TRELLIS_DISABLE_HOOKS: "0" };
  for (const key of Object.keys(env)) {
    if (key === "TRELLIS_CONTEXT_ID" || key.endsWith("_PROJECT_DIR") || key.endsWith("_THREAD_ID") || key.endsWith("_SESSION_ID")) delete env[key];
  }
  env.CODEX_THREAD_ID = sessionId;
  const binding = spawnSync(python.command, [...python.argsPrefix, "-c", [
    "import pathlib, sys",
    "root = pathlib.Path.cwd()",
    "sys.path.insert(0, str(root / '.trellis/scripts'))",
    "from common.active_task import set_active_task",
    "assert set_active_task('.trellis/tasks/broken-record', root, {'session_id': sys.argv[1]}, platform='codex') is not None",
  ].join("\n"), sessionId], { cwd: fixture, env, encoding: "utf8", windowsHide: true, timeout: 15000 });
  assert.equal(binding.status, 0, binding.stderr || String(binding.error));
  for (const content of [null, "{broken", "[]", "{}", '{"status":0}']) {
    if (content !== null) writeFileSync(path.join(taskDir, "task.json"), content);
    const result = spawnSync(python.command, [...python.argsPrefix, path.join(root, ".codex/hooks/inject-workflow-state.py")], {
      cwd: fixture, env, encoding: "utf8", windowsHide: true, timeout: 15000,
      input: JSON.stringify({ cwd: fixture, session_id: sessionId, prompt: "继续" }),
    });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    assert.match(context, /Task: broken-record \(task_error\)/, String(content));
    assert.match(context, /Do not create or activate another task/);
    assert.doesNotMatch(context, /Status: no_task|<trellis-bootstrap>/);
  }
  writeFileSync(path.join(taskDir, "task.json"), JSON.stringify({ id: "broken-record", status: "in_progress" }));
  writeFileSync(path.join(taskDir, "product-manager.json"), JSON.stringify({ currentGate: { status: "awaiting_user_acceptance", checkpointId: "M1", pmVerdict: "needs_user_decision" } }));
  const valid = spawnSync(python.command, [...python.argsPrefix, path.join(root, ".codex/hooks/inject-workflow-state.py")], {
    cwd: fixture, env, encoding: "utf8", windowsHide: true, timeout: 15000,
    input: JSON.stringify({ cwd: fixture, session_id: sessionId, prompt: "继续" }),
  });
  assert.equal(valid.status, 0, valid.stderr || String(valid.error));
  assert.match(JSON.parse(valid.stdout).hookSpecificOutput.additionalContext, /<product-manager-gate>[\s\S]*HARD STOP/);
  assert.equal(JSON.parse(readFileSync(path.join(taskDir, "task.json"), "utf8")).status, "in_progress");
  // A vanished task directory keeps its stale-session identity and the same
  // four-field hook contract used by the product-manager path.
  rmSync(taskDir, { recursive: true });
  const stale = spawnSync(python.command, [...python.argsPrefix, path.join(root, ".codex/hooks/inject-workflow-state.py")], {
    cwd: fixture, env, encoding: "utf8", windowsHide: true, timeout: 15000,
    input: JSON.stringify({ cwd: fixture, session_id: sessionId, prompt: "继续" }),
  });
  assert.equal(stale.status, 0, stale.stderr || String(stale.error));
  assert.match(JSON.parse(stale.stdout).hookSpecificOutput.additionalContext, /Task: broken-record \(stale_session\)/);
});

test("platform-specific variables win over the Claude alias and Codex keeps its native path", () => {
  const program = [
    "import importlib.util, os, sys",
    "spec = importlib.util.spec_from_file_location('workflow_hook', sys.argv[1])",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "for key in list(os.environ):",
    "    if key.endswith('_PROJECT_DIR'): del os.environ[key]",
    "os.environ['CLAUDE_PROJECT_DIR'] = '/compat'",
    "for key, expected in [('CODEBUDDY_PROJECT_DIR', 'codebuddy'), ('TRAE_PROJECT_DIR', 'trae'), ('ZCODE_PROJECT_DIR', 'zcode')]:",
    "    os.environ[key] = '/native'",
    "    assert module._detect_platform({}) == expected, key",
    "    del os.environ[key]",
    "assert module._detect_platform({}) == 'claude'",
    "del os.environ['CLAUDE_PROJECT_DIR']",
    "sys.argv[0] = sys.argv[1]",
    "assert module._detect_platform({}) == 'codex'",
  ].join("\n");
  const result = spawnSync(python.command, [...python.argsPrefix, "-c", program, path.join(root, ".codex/hooks/inject-workflow-state.py")], {
    cwd: root, encoding: "utf8", windowsHide: true, timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
});
