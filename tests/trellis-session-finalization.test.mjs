import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolvePython } from "../scripts/lib/python-resolver.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PYTHON = resolvePython();
const TITLE = "Repeated session";
const SUMMARY = "Same bounded evidence.";
const FINALIZED = "<!-- trellis-session-finalized -->";

function runPython(value, args) {
  return spawnSync(PYTHON.command, [...PYTHON.argsPrefix, ...args], {
    cwd: value.repoRoot,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 30_000,
  });
}

function git(value, args) {
  const result = spawnSync("git", args, {
    cwd: value.repoRoot, encoding: "utf8", shell: false, windowsHide: true,
    timeout: 15_000,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture(t, { configCommit = true, ignored = false } = {}) {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "trellis-session-finalization-"));
  const trellisRoot = path.join(repoRoot, ".trellis");
  const scriptsRoot = path.join(trellisRoot, "scripts");
  mkdirSync(trellisRoot, { recursive: true });
  cpSync(path.join(ROOT, ".trellis", "scripts"), scriptsRoot, { recursive: true });
  writeFileSync(path.join(trellisRoot, "config.yaml"), `session_auto_commit: ${configCommit}\n`);
  const value = { repoRoot, trellisRoot, scriptsRoot };
  t.after(() => {
    assert.equal(path.dirname(path.resolve(repoRoot)), path.resolve(tmpdir()));
    rmSync(repoRoot, { recursive: true, force: true });
  });
  git(value, ["-c", "init.templateDir=", "init", "--initial-branch=main"]);
  git(value, ["config", "user.name", "Session regression"]);
  git(value, ["config", "user.email", "session-regression@example.invalid"]);
  git(value, ["config", "commit.gpgsign", "false"]);
  git(value, ["config", "core.autocrlf", "false"]);
  const hooks = path.join(repoRoot, "empty-hooks");
  mkdirSync(hooks);
  git(value, ["config", "core.hooksPath", hooks]);
  const initialized = runPython(value, [path.join(scriptsRoot, "init_developer.py"), "regression"]);
  assert.equal(initialized.status, 0, initialized.stderr);
  if (ignored) writeFileSync(path.join(repoRoot, ".gitignore"), ".trellis/workspace/\n");
  git(value, ["add", ".trellis", ...(ignored ? [".gitignore"] : [])]);
  git(value, ["commit", "-m", "Initialize isolated session fixture"]);
  value.journal = path.join(trellisRoot, "workspace", "regression", "journal-1.md");
  value.index = path.join(trellisRoot, "workspace", "regression", "index.md");
  return value;
}

function args({ noCommit = false, key } = {}) {
  return ["--title", TITLE, "--summary", SUMMARY, "--branch", "main",
    ...(noCommit ? ["--no-commit"] : []), ...(key ? ["--idempotency-key", key] : [])];
}

function add(value, options) {
  return runPython(value, [path.join(value.scriptsRoot, "add_session.py"), ...args(options)]);
}

function patchedAdd(value, options, patch) {
  const program = [
    "import sys",
    `sys.path.insert(0, ${JSON.stringify(value.scriptsRoot)})`,
    "import add_session as session",
    patch,
    `sys.argv = ["add_session.py", *${JSON.stringify(args(options))}]`,
    "raise SystemExit(session.main())",
  ].join("\n");
  return runPython(value, ["-c", program]);
}

function check(value, sessions, finalized) {
  const journal = readFileSync(value.journal, "utf8");
  assert.equal([...journal.matchAll(/^## Session \d+:/gm)].length, sessions);
  assert.equal(journal.split(FINALIZED).length - 1, finalized);
  const markers = [...journal.matchAll(/^<!-- trellis-session:.* -->$/gm)].map((m) => m[0]);
  assert.equal(new Set(markers).size, markers.length, "each session has its own marker");
  return journal;
}

function concurrentAdd(value, { phase = "finalize", samePayload = false, key, interrupt = false } = {}) {
  const program = String.raw`
import errno
import json
import os
import queue
import subprocess
import sys
import threading

worker = r"""
import errno
import json
import os
import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import add_session as session
role, phase = sys.argv[3:5]
if role == "A":
    original_write = session.write_text_atomic
    paused = False
    def pause_snapshot(path, text):
        global paused
        if (not paused and path.name == "journal-1.md"
                and (phase == "append" or "<!-- trellis-session-finalized -->" in text)):
            paused = True
            print("READY", flush=True)
            assert sys.stdin.readline().strip() == "release"
        return original_write(path, text)
    session.write_text_atomic = pause_snapshot
else:
    reported = False
    if os.name == "nt":
        import msvcrt
        owner, attribute = msvcrt, "locking"
    else:
        import fcntl
        owner, attribute = fcntl, "flock"
    original_lock = getattr(owner, attribute)
    def observe_lock(*args):
        global reported
        try:
            return original_lock(*args)
        except OSError as exc:
            if exc.errno in (errno.EACCES, errno.EAGAIN) and not reported:
                reported = True
                print("CONTENDED", flush=True)
            raise
    setattr(owner, attribute, observe_lock)
sys.argv = ["add_session.py", *json.loads(sys.argv[2])]
result = session.main()
print("DONE", flush=True)
raise SystemExit(result)
"""

scripts, supplied, phase, same, interrupt = sys.argv[1:6]
a_args = json.loads(supplied)
b_args = list(a_args)
if same != "true":
    b_args[b_args.index("--title") + 1] = "Concurrent second window"
children = []
def start(role, arguments):
    child = subprocess.Popen(
        [sys.executable, "-B", "-c", worker, scripts, json.dumps(arguments), role, phase],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding="utf-8", shell=False,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    children.append(child)
    output = queue.Queue()
    def read_lines():
        for line in child.stdout:
            if line.strip() in ("READY", "CONTENDED", "DONE"):
                output.put(line.strip())
        output.put("EOF")
    threading.Thread(target=read_lines, daemon=True).start()
    return child, output

try:
    a, a_output = start("A", a_args)
    ready = a_output.get(timeout=10)
    assert ready == "READY", a.stderr.read() if ready == "EOF" else ready
    b, b_output = start("B", b_args)
    # The OS lock reports contention, or the old unlocked implementation
    # finishes B while A still holds its stale write snapshot. No timing race.
    observed = b_output.get(timeout=10)
    assert observed in ("CONTENDED", "DONE"), observed
    if interrupt == "true":
        assert observed == "CONTENDED", "the transaction must hold a native lock"
        a.terminate()
    else:
        a.stdin.write("release\n")
        a.stdin.flush()
    a.stdin.close()
    a.wait(timeout=10)
    b.stdin.close()
    b.wait(timeout=10)
    assert a.returncode != 0 if interrupt == "true" else a.returncode == 0, a.stderr.read()
    assert b.returncode == 0, b.stderr.read()
    print(json.dumps({"observed": observed, "a": a.returncode, "b": b.returncode}))
finally:
    for child in children:
        if child.poll() is None:
            child.kill()
        child.wait(timeout=5)
        for stream in (child.stdin, child.stdout, child.stderr):
            stream.close()
`;
  const result = runPython(value, ["-B", "-c", program, value.scriptsRoot,
    JSON.stringify(args({ noCommit: true, key })), phase, String(samePayload), String(interrupt)]);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

for (const mode of ["no-commit", "config-false"]) {
  const options = { noCommit: mode === "no-commit" };
  const fixtureOptions = { configCommit: mode !== "config-false" };

  test(`${mode}: identical completed prose records distinct later sessions`, (t) => {
    const value = fixture(t, fixtureOptions);
    const head = git(value, ["rev-parse", "HEAD"]);
    for (let i = 1; i <= 3; i += 1) {
      const result = add(value, options);
      assert.equal(result.status, 0, result.stderr);
    }
    check(value, 3, 3);
    assert.equal(git(value, ["rev-parse", "HEAD"]), head);
  });

  test(`${mode}: explicit retry key is idempotent after completion`, (t) => {
    const value = fixture(t, fixtureOptions);
    const keyed = { ...options, key: "session-1" };
    const first = add(value, keyed);
    assert.equal(first.status, 0, first.stderr);
    const journal = readFileSync(value.journal, "utf8");
    const index = readFileSync(value.index, "utf8");
    const retry = add(value, keyed);
    assert.equal(retry.status, 0, retry.stderr);
    assert.equal(readFileSync(value.journal, "utf8"), journal);
    assert.equal(readFileSync(value.index, "utf8"), index);
    assert.equal(add(value, { ...options, key: "session-2" }).status, 0);
    check(value, 2, 2);
  });

  test(`${mode}: interrupted index update resumes the original entry`, (t) => {
    const value = fixture(t, fixtureOptions);
    const first = patchedAdd(value, options, "session.update_index = lambda *a, **kw: False");
    assert.equal(first.status, 1, first.stderr);
    check(value, 1, 0);
    const retry = add(value, options);
    assert.equal(retry.status, 0, retry.stderr);
    assert.match(retry.stderr, /RESUME/);
    check(value, 1, 1);
    assert.equal(add(value, options).status, 0);
    check(value, 2, 2);
  });

  test(`${mode}: failed durable finalization remains resumable`, (t) => {
    const value = fixture(t, fixtureOptions);
    const first = patchedAdd(value, options, String.raw`
original_write = session.write_text_atomic
def fail_finalization(path, text):
    if "<!-- trellis-session-finalized -->" in text:
        return False
    return original_write(path, text)
session.write_text_atomic = fail_finalization
`);
    assert.equal(first.status, 1, first.stderr);
    check(value, 1, 0);
    assert.equal(add(value, options).status, 0);
    check(value, 1, 1);
    assert.equal(add(value, options).status, 0);
    check(value, 2, 2);
  });
}

test("normal auto-commit keeps distinct sessions and keyed retries", (t) => {
  const value = fixture(t);
  const originalHead = git(value, ["rev-parse", "HEAD"]);
  for (let i = 1; i <= 2; i += 1) {
    const result = add(value);
    assert.equal(result.status, 0, result.stderr);
    check(value, i, 0);
  }
  assert.notEqual(git(value, ["rev-parse", "HEAD"]), originalHead);
  const result = add(value, { key: "committed-retry" });
  assert.equal(result.status, 0, result.stderr);
  const head = git(value, ["rev-parse", "HEAD"]);
  assert.equal(add(value, { key: "committed-retry" }).status, 0);
  assert.equal(git(value, ["rev-parse", "HEAD"]), head);
  check(value, 3, 0);
});

for (const keyed of [false, true]) {
  test(`failed auto-commit resumes without duplicate (${keyed ? "keyed" : "implicit"})`, (t) => {
    const value = fixture(t);
    const options = keyed ? { key: "pending-commit" } : {};
    const first = patchedAdd(value, options, "session._auto_commit_workspace = lambda *a: session.COMMIT_FAILED");
    assert.equal(first.status, 1, first.stderr);
    check(value, 1, 0);
    const retry = add(value, options);
    assert.equal(retry.status, 0, retry.stderr);
    assert.match(retry.stderr, /RESUME/);
    check(value, 1, 0);
    assert.equal(add(value, options).status, 0);
    check(value, keyed ? 1 : 2, 0);
  });
}

test("claimed commit success without HEAD evidence remains pending", (t) => {
  const value = fixture(t);
  const first = patchedAdd(value, {}, "session._auto_commit_workspace = lambda *a: session.COMMIT_DONE");
  assert.equal(first.status, 1, first.stderr);
  check(value, 1, 0);
  assert.equal(add(value).status, 0);
  check(value, 1, 0);
});

test("retry of a later generation resumes across a date rollover", (t) => {
  const value = fixture(t, { configCommit: false });
  assert.equal(add(value).status, 0);
  const first = patchedAdd(value, {}, String.raw`
from datetime import datetime as RealDatetime
class EarlierDate:
    @staticmethod
    def now():
        return RealDatetime(2026, 9, 27)
session.datetime = EarlierDate
session.update_index = lambda *a, **kw: False
`);
  assert.equal(first.status, 1, first.stderr);
  check(value, 2, 1);
  assert.equal(add(value).status, 0);
  check(value, 2, 2);
});

test("legacy pending marker is recovered and finalized across a date rollover", (t) => {
  const value = fixture(t);
  const first = patchedAdd(value, {}, String.raw`
from datetime import datetime as RealDatetime
class EarlierDate:
    @staticmethod
    def now():
        return RealDatetime(2026, 9, 27)
session.datetime = EarlierDate
session._auto_commit_workspace = lambda *a: session.COMMIT_FAILED
`);
  assert.equal(first.status, 1, first.stderr);
  const program = String.raw`
import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import add_session as session
path = Path(sys.argv[2])
payload = session._fingerprint_payload("regression", "Repeated session",
    "Same bounded evidence.", None, "main", [], None, None, None, None, None)
marker = session.render_marker(session.compute_record_fingerprint(payload))
legacy = session.render_legacy_marker(session.compute_legacy_fingerprint(payload, "2026-09-27"))
text = path.read_text(encoding="utf-8")
assert text.count(marker) == 1
path.write_text(text.replace(marker, legacy), encoding="utf-8")
`;
  const converted = runPython(value, ["-c", program, value.scriptsRoot, value.journal]);
  assert.equal(converted.status, 0, converted.stderr);
  const retry = add(value, { noCommit: true });
  assert.equal(retry.status, 0, retry.stderr);
  check(value, 1, 1);
  assert.equal(add(value, { noCommit: true }).status, 0);
  check(value, 2, 2);
});

test("completed keyed record survives a commit-setting change", (t) => {
  const value = fixture(t);
  assert.equal(add(value, { noCommit: true, key: "completed" }).status, 0);
  const head = git(value, ["rev-parse", "HEAD"]);
  assert.equal(add(value, { key: "completed" }).status, 0);
  check(value, 1, 1);
  assert.equal(git(value, ["rev-parse", "HEAD"]), head);
});

test("finalized flag does not bypass repair of a missing index row", (t) => {
  const value = fixture(t, { configCommit: false });
  const options = { key: "repair-index" };
  assert.equal(add(value, options).status, 0);
  writeFileSync(value.index, readFileSync(value.index, "utf8").replace(/^\|\s*1\s*\|.*\r?\n/gm, ""));
  const retry = add(value, options);
  assert.equal(retry.status, 0, retry.stderr);
  assert.match(readFileSync(value.index, "utf8"), /^\|\s*1\s*\|/m);
  check(value, 1, 1);
});

test("gitignored workspace is a completed configured skip", (t) => {
  const value = fixture(t, { ignored: true });
  for (let i = 1; i <= 2; i += 1) {
    const result = add(value);
    assert.equal(result.status, 0, result.stderr);
    check(value, i, i);
  }
});

test("ambiguous pending markers still fail closed", (t) => {
  const value = fixture(t);
  const first = patchedAdd(value, {}, "session._auto_commit_workspace = lambda *a: session.COMMIT_FAILED");
  assert.equal(first.status, 1, first.stderr);
  const journal = readFileSync(value.journal, "utf8");
  const duplicate = journal + journal.slice(journal.indexOf("## Session 1:"));
  writeFileSync(value.journal, duplicate);
  const retry = add(value);
  assert.equal(retry.status, 1, retry.stderr);
  assert.match(retry.stderr, /Refusing to guess/);
  assert.equal(readFileSync(value.journal, "utf8"), duplicate);
});

test("finalization writer is atomic, idempotent, and requires one exact marker", (t) => {
  const value = fixture(t);
  const program = String.raw`
import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import add_session as session
path = Path(sys.argv[2])
marker = session.render_marker("0123456789abcdef")
path.write_text("unrelated journal\n", encoding="utf-8")
assert not session.finalize_record(path, marker)
assert path.read_text(encoding="utf-8") == "unrelated journal\n"
path.write_text(marker + "\n", encoding="utf-8")
assert session.finalize_record(path, marker)
first = path.read_bytes()
assert session.finalize_record(path, marker)
assert path.read_bytes() == first
path.write_text(marker + "\n" + marker + "\n", encoding="utf-8")
assert not session.finalize_record(path, marker)
assert path.read_text(encoding="utf-8") == marker + "\n" + marker + "\n"
`;
  const result = runPython(value, ["-c", program, value.scriptsRoot, path.join(value.repoRoot, "unit-journal.md")]);
  assert.equal(result.status, 0, result.stderr);
});

test("concurrent finalization preserves both successful windows", (t) => {
  const value = fixture(t);
  const result = concurrentAdd(value);
  const journal = check(value, 2, 2);
  assert.equal(result.observed, "CONTENDED");
  assert.match(journal, /## Session 1: Repeated session/);
  assert.match(journal, /## Session 2: Concurrent second window/);
  const index = readFileSync(value.index, "utf8");
  assert.match(index, /^\|\s*1\s*\|.*Repeated session/m);
  assert.match(index, /^\|\s*2\s*\|.*Concurrent second window/m);
});

test("concurrent identical unkeyed calls allocate distinct sessions before append", (t) => {
  const value = fixture(t, { configCommit: false });
  const result = concurrentAdd(value, { phase: "append", samePayload: true });
  check(value, 2, 2);
  assert.equal(result.observed, "CONTENDED");
});

test("concurrent completed-key retries remain one session", (t) => {
  const value = fixture(t);
  const result = concurrentAdd(value, { samePayload: true, key: "two-window-retry" });
  check(value, 1, 1);
  assert.equal(result.observed, "CONTENDED");
});

test("terminated lock owner releases the pending transaction for keyed recovery", (t) => {
  const value = fixture(t);
  concurrentAdd(value, { samePayload: true, key: "terminated-retry", interrupt: true });
  check(value, 1, 1);
  assert.equal(add(value, { noCommit: true, key: "terminated-retry" }).status, 0);
  check(value, 1, 1);
});

for (const error of ["EIO", "EACCES"]) {
  test(`workspace lock ${error === "EACCES" ? "timeout" : "failure"} changes no journal or index`, (t) => {
    const value = fixture(t);
    const journal = readFileSync(value.journal, "utf8");
    const index = readFileSync(value.index, "utf8");
    const result = patchedAdd(value, { noCommit: true }, String.raw`
import errno
import os
session.SESSION_LOCK_TIMEOUT = 0
def deny_lock(*args):
    raise OSError(getattr(errno, "${error}"), "injected lock acquisition error")
if os.name == "nt":
    import msvcrt
    msvcrt.locking = deny_lock
else:
    import fcntl
    fcntl.flock = deny_lock
`);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /workspace session transaction failed/);
    assert.equal(readFileSync(value.journal, "utf8"), journal);
    assert.equal(readFileSync(value.index, "utf8"), index);
    assert.equal(add(value, { noCommit: true }).status, 0);
    check(value, 1, 1);
  });
}
