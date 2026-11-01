import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolvePython } from "../scripts/lib/python-resolver.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the actual workflow hook loads automatic task management and shared approval breadcrumbs", () => {
  const python = resolvePython();
  const result = spawnSync(python.command, [...python.argsPrefix, "-c", [
    "import importlib.util, json, pathlib, sys",
    "spec = importlib.util.spec_from_file_location('hook', sys.argv[1])",
    "hook = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(hook)",
    "templates = hook.load_breadcrumbs(pathlib.Path(sys.argv[2]))",
    "print(json.dumps({status: hook.build_breadcrumb(None, status, templates) for status in ['no_task', 'planning', 'planning-inline', 'in_progress-inline']}))",
  ].join("\n"), path.join(ROOT, ".codex/hooks/inject-workflow-state.py"), ROOT], {
    encoding: "utf8", shell: false, windowsHide: true, timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr);
  const breadcrumbs = JSON.parse(result.stdout);
  assert.match(breadcrumbs.no_task, /automatically reuse\/create/);
  assert.match(breadcrumbs.no_task, /user opted out/);
  assert.doesNotMatch(breadcrumbs.no_task, /ask.*task-creation consent/i);
  for (const status of ["planning", "planning-inline"]) {
    assert.match(breadcrumbs[status], /Shared plan approval/);
    assert.match(breadcrumbs[status], /without asking again/);
  }
  assert.match(breadcrumbs["in_progress-inline"], /Only `pm respond`/);
  assert.match(breadcrumbs["in_progress-inline"], /Optional unavailable advice without a gate/);
});

test("Trellis entry points share approval authority while retaining original CCG gates", () => {
  for (const name of ["start", "brainstorm", "continue"]) {
    const skill = readFileSync(path.join(ROOT, `.agents/skills/trellis-${name}/SKILL.md`), "utf8");
    assert.match(skill, /workflow\.md#shared-plan-approval/);
    assert.doesNotMatch(skill, /at least once after the initial request|Only a subsequent user message/);
  }
  const command = readFileSync(path.join(ROOT, ".gemini/commands/trellis/continue.toml"), "utf8");
  assert.match(command, /workflow\.md#shared-plan-approval/);
  const workflow = readFileSync(path.join(ROOT, ".trellis/workflow.md"), "utf8");
  assert.match(workflow, /direct-fix adds no plan approval/);
  assert.match(workflow, /quick-implement requires its compact-plan approval/);
  assert.match(workflow, /guided\/full retain their analysis, plan\/mode, review and quality gates/);
  assert.match(workflow, /Task management and plan approval never authorize unapproved paid\/network actions/);
});

test("the documented Python task entry imports without a syntax error", () => {
  const python = resolvePython();
  const result = spawnSync(python.command, [...python.argsPrefix, path.join(ROOT, ".trellis/scripts/task.py"), "--help"], {
    encoding: "utf8", shell: false, windowsHide: true, timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
});

test("task lifecycle and journal preserve dirty files and the index without committing", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "trellis-closeout-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(path.join(ROOT, ".trellis/scripts"), path.join(root, ".trellis/scripts"), { recursive: true });
  mkdirSync(path.join(root, ".codex"));
  writeFileSync(path.join(root, ".trellis/config.yaml"), "codex:\n  dispatch_mode: inline\ncontext_injection:\n  max_file_bytes: 8\n");
  const python = resolvePython();
  const env = { ...process.env, TRELLIS_CONTEXT_ID: "closeout-fixture", PYTHONIOENCODING: "utf-8" };
  const run = (command, args, expected = 0) => {
    const result = spawnSync(command, args, { cwd: root, env, encoding: "utf8", shell: false, windowsHide: true, timeout: 10_000 });
    assert.equal(result.status, expected, result.stderr || result.stdout);
    return result.stdout;
  };
  const script = (name, args, expected = 0) => run(python.command, [...python.argsPrefix, path.join(root, ".trellis/scripts", name), ...args], expected);
  run("git", ["init", "--quiet"]);
  writeFileSync(path.join(root, "unrelated.txt"), "Already staged work\n");
  run("git", ["add", "--", "unrelated.txt"]);
  const originalIndex = readFileSync(path.join(root, ".git/index"));
  const code = "print('uncommitted task work')\n";
  writeFileSync(path.join(root, "change.py"), code);
  script("init_developer.py", ["fixture"]);
  script("task.py", ["create", "Closeout fixture", "--slug", "closeout", "--base-branch", "main", "--description", "Isolated regression"]);
  const current = JSON.parse(script("task.py", ["current", "--json"]));
  const taskPath = current.current_task.dir;
  script("task.py", ["add-context", taskPath, "implement", "change.py", "warning regression"]);
  const warnings = script("task.py", ["validate", taskPath]);
  assert.match(warnings, /looks like a code file/);
  assert.match(warnings, /exceeds context_injection/);
  script("task.py", ["start", taskPath]);
  const archivePath = script("task.py", ["archive", taskPath, "--no-commit"]).trim();
  assert.equal(JSON.parse(readFileSync(path.join(root, archivePath, "task.json"), "utf8")).status, "completed");
  script("task.py", ["current"], 1);
  script("add_session.py", ["--title", "Uncommitted closeout", "--commit", "-", "--summary", "Validated fixture; changes remain uncommitted", "--no-commit"]);
  assert.equal(readFileSync(path.join(root, "change.py"), "utf8"), code);
  assert.deepEqual(readFileSync(path.join(root, ".git/index")), originalIndex);
  run("git", ["rev-parse", "--verify", "HEAD"], 128);
  assert.match(readFileSync(path.join(root, ".trellis/workspace/fixture/journal-1.md"), "utf8"), /changes remain uncommitted/);
});
