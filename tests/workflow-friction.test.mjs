import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

