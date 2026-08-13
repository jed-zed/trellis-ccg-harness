import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const UNSAFE_DOM_PROPERTY = ['inner', 'HTML'].join('')
const UNSAFE_UPSTREAM_TASK_RENDERING = String.raw`                    taskEl.${UNSAFE_DOM_PROPERTY} = '<strong>📋 Task:</strong><br>' + session.task.replace(/\n/g, '<br>');`
const SAFE_TASK_RENDERING = `                    const taskLabel = document.createElement('strong');
                    taskLabel.textContent = '📋 Task:';
                    taskEl.appendChild(taskLabel);
                    taskEl.appendChild(document.createElement('br'));
                    const taskText = document.createElement('span');
                    taskText.textContent = session.task;
                    taskEl.appendChild(taskText);`

function findPackageRoot(): string {
  let dir = import.meta.dirname
  for (let i = 0; i < 10; i++) {
    try {
      readFileSync(join(dir, 'package.json'))
      return dir
    }
    catch {
      dir = join(dir, '..')
    }
  }
  throw new Error('Could not find package root')
}

function runPython(
  helperPath: string,
  expression: string,
  envOverrides: Record<string, string> = {},
): string {
  const script = [
    'import importlib.util, pathlib, sys',
    'path = pathlib.Path(sys.argv[1])',
    'spec = importlib.util.spec_from_file_location("gemini_preview_helper", path)',
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    expression,
  ].join('\n')
  const commands = process.platform === 'win32' ? ['python'] : ['python3', 'python']
  const failures: string[] = []
  for (const command of commands) {
    const result = spawnSync(command, ['-B', '-c', script, helperPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        ...envOverrides,
      },
      windowsHide: true,
    })
    if (result.status === 0)
      return result.stdout
    failures.push(`${command}: ${result.stderr || result.error?.message || `exit ${result.status}`}`)
  }
  throw new Error(`Could not render Gemini preview helper:\n${failures.join('\n')}`)
}

describe('Codex Gemini preview template', () => {
  const packageRoot = findPackageRoot()
  const helperPath = join(
    packageRoot,
    'plugins',
    'ccg',
    'skills',
    'ccg-executor',
    'scripts',
    'invoke_gemini_preview.py',
  )
  const templatePath = join(
    packageRoot,
    'plugins',
    'ccg',
    'skills',
    'ccg-executor',
    'templates',
    'live-output.upstream.html',
  )

  it('pins the mechanically resolved original-author Live Output page', () => {
    const template = readFileSync(templatePath, 'utf8').replaceAll('\r\n', '\n')
    const doctype = template.indexOf('<!DOCTYPE html>')
    expect(doctype).toBeGreaterThan(0)
    const pinnedPage = template.slice(doctype).replace(/\n$/, '')
    const upstreamPage = pinnedPage.replace(
      SAFE_TASK_RENDERING,
      UNSAFE_UPSTREAM_TASK_RENDERING,
    )

    expect(template).toContain('Commit: 9eaff791de19fe45a1713b1153e65c5c7b607f80')
    expect(template).toContain('Copyright (c) 2025 fengshao1227')
    expect(template).toContain('Permission is hereby granted, free of charge')
    expect(template).toContain('THE SOFTWARE IS PROVIDED "AS IS"')
    expect(pinnedPage).toContain(SAFE_TASK_RENDERING)
    expect(pinnedPage).not.toContain(UNSAFE_UPSTREAM_TASK_RENDERING)
    expect(createHash('sha256').update(upstreamPage).digest('hex'))
      .toBe('f1d29d0e1bd6b8cc3c1f6a8a6e74f7cc03788b85a4b4e3e8319f83e5e0365ab6')
    expect(upstreamPage).toContain(UNSAFE_UPSTREAM_TASK_RENDERING)
    expect(pinnedPage).toBe(
      upstreamPage.replace(UNSAFE_UPSTREAM_TASK_RENDERING, SAFE_TASK_RENDERING),
    )
  })

  it('renders only the approved safety and completion differences', () => {
    const rendered = runPython(
      helperPath,
      'sys.stdout.write(module.render_live_output_html())',
    )

    expect(rendered).toContain('<title>gemini - Live Output</title>')
    expect(rendered).toContain('class="output-area"')
    expect(rendered).toContain('class="panel-icon"')
    expect(rendered).toContain('<div class="title">gemini</div>')
    expect(rendered).toContain('taskText.textContent = session.task')
    expect(rendered).not.toContain(`taskEl.${UNSAFE_DOM_PROPERTY} = '<strong>📋 Task:</strong><br>' + session.task`)
    expect(rendered).toContain('const exitCode = Number(data.exit_code ?? 0)')
    expect(rendered).toContain("case 'replace_message':")
    expect(rendered).toContain("querySelectorAll('.assistant-output')")
    expect(rendered).toContain('`✗ 失败 (exit code $' + '{exitCode})`')
    expect(rendered).toContain('if (ok && autoClose > 0)')
    expect(rendered).toContain("Notification.permission === 'granted'")
    expect(rendered).toContain('window.close()')
  })

  it('prints Unicode responses even when the inherited console encoding is strict ASCII', () => {
    const output = runPython(
      helperPath,
      'module.configure_utf8_stdio(); sys.stdout.write("📋")',
      { PYTHONIOENCODING: 'ascii:strict' },
    )
    expect(output).toBe('📋')
  })

  it('does not leave Python bytecode in a history-free package snapshot', () => {
    const bytecodeCache = join(dirname(helperPath), '__pycache__')
    expect(existsSync(bytecodeCache)).toBe(false)
    runPython(helperPath, 'sys.stdout.write(module.render_live_output_html())')
    expect(existsSync(bytecodeCache)).toBe(false)
  })

  it('retries transient snapshot cleanup locks', () => {
    const calls = Number(runPython(
      helperPath,
      [
        'class FlakySnapshot:',
        '  def __init__(self): self.calls = 0',
        '  def cleanup(self):',
        '    self.calls += 1',
        '    if self.calls < 3: raise PermissionError("locked")',
        'snapshot = FlakySnapshot()',
        'module.time.sleep = lambda _: None',
        'module.cleanup_snapshot(snapshot)',
        'sys.stdout.write(str(snapshot.calls))',
      ].join('\n'),
    ))

    expect(calls).toBe(3)
  })

  it('replays typed history and resumes after the last SSE event id', () => {
    const state = JSON.parse(runPython(
      helperPath,
      [
        'import json',
        'state = module.State()',
        'state.append_content("before-connect")',
        'client, done, exit_code = state.register_client(state.preview_session_id)',
        'first = client.get_nowait()',
        'state.complete(7, "failed")',
        'late_client, late_done, late_exit_code = state.register_client(state.preview_session_id)',
        'resume_client, _, _ = state.register_client(state.preview_session_id, 1)',
        'late_events = [late_client.get_nowait(), late_client.get_nowait()]',
        'resume_events = [resume_client.get_nowait()]',
        'sys.stdout.write(json.dumps({',
        '  "content": state.snapshot()["content"],',
        '  "first": first,',
        '  "done_before": done,',
        '  "exit_before": exit_code,',
        '  "late_events": late_events,',
        '  "resume_events": resume_events,',
        '  "late_done": late_done,',
        '  "late_exit_code": late_exit_code,',
        '}))',
      ].join('\n'),
    ))
    expect(state).toEqual({
      content: 'before-connect',
      first: expect.objectContaining({ _event_id: 1, content: 'before-connect', content_type: 'message' }),
      done_before: false,
      exit_before: null,
      late_events: [
        expect.objectContaining({ _event_id: 1, content: 'before-connect' }),
        expect.objectContaining({ _event_id: 2, done: true, exit_code: 7 }),
      ],
      resume_events: [expect.objectContaining({ _event_id: 2, done: true, exit_code: 7 })],
      late_done: true,
      late_exit_code: 7,
    })
  })

  it('replaces divergent streamed text with the authoritative Gemini result', () => {
    const state = JSON.parse(runPython(
      helperPath,
      [
        'import io, json',
        'module.STATE = module.State()',
        'events = [',
        '  {"type":"message","role":"assistant","content":"draft","delta":True},',
        '  {"type":"result","status":"success","response":"authoritative"},',
        ']',
        'module.stream_output(io.StringIO("".join(json.dumps(event) + "\\n" for event in events)), io.StringIO())',
        'client, _, _ = module.STATE.register_client(module.STATE.preview_session_id)',
        'queued = [client.get_nowait(), client.get_nowait()]',
        'sys.stdout.write(json.dumps({"response": module.STATE.snapshot()["response"], "queued": queued}))',
      ].join('\n'),
    ))
    expect(state.response).toBe('authoritative')
    expect(state.queued).toEqual([
      expect.objectContaining({ content: 'draft', content_type: 'message' }),
      expect.objectContaining({ content: 'authoritative', content_type: 'replace_message' }),
    ])
  })

  it('serves only missing Gemini SSE history after Last-Event-ID', () => {
    const body = runPython(
      helperPath,
      [
        'import threading, urllib.request',
        'module.STATE = module.State()',
        'module.STATE.append_content("first")',
        'module.STATE.append_content("second", "command", response_text=False)',
        'module.STATE.complete(0, "complete")',
        'server = module.ThreadingHTTPServer(("127.0.0.1", 0), module.make_handler())',
        'thread = threading.Thread(target=server.serve_forever, daemon=True)',
        'thread.start()',
        'try:',
        '  url = f"http://127.0.0.1:{server.server_address[1]}/api/stream/{module.STATE.preview_session_id}"',
        '  request = urllib.request.Request(url, headers={"Last-Event-ID": "1"})',
        '  with urllib.request.urlopen(request, timeout=2) as response:',
        '    lines = []',
        '    while True:',
        '      line = response.readline().decode("utf-8")',
        '      if not line:',
        '        break',
        '      lines.append(line)',
        '      if "\\\"done\\\": true" in line:',
        '        break',
        '    sys.stdout.write("".join(lines))',
        'finally:',
        '  server.shutdown()',
        '  server.server_close()',
      ].join('\n'),
    )
    expect(body).not.toContain('"content": "first"')
    expect(body).toMatch(/id: 2\r?\n/)
    expect(body).toContain('"content": "second"')
    expect(body).toContain('"content_type": "command"')
    expect(body).toMatch(/id: 3\r?\n/)
    expect(body).toContain('"done": true')
  })

  it('streams safe Gemini tool and error status without polluting the final response', () => {
    const state = JSON.parse(runPython(
      helperPath,
      [
        'import io, json',
        'module.STATE = module.State()',
        'events = [',
        '  {"type":"init","session_id":"gemini-session"},',
        '  {"type":"message","role":"assistant","content":"Hel","delta":True},',
        '  {"type":"tool_use","tool_name":"read_file","tool_id":"tool-1","parameters":{"path":"secret.txt"}},',
        '  {"type":"tool_result","tool_id":"tool-1","status":"success","output":"secret output"},',
        '  {"type":"error","severity":"warning","message":"secret warning detail"},',
        '  {"type":"result","status":"success","response":"Hello","stats":{"models":{"gemini-runtime-model":{"tokens":1}}}},',
        ']',
        'pipe = io.StringIO("".join(json.dumps(event) + "\\n" for event in events))',
        'output = io.StringIO()',
        'module.stream_output(pipe, output)',
        'snapshot = module.STATE.snapshot()',
        'sys.stdout.write(json.dumps({"content": snapshot["content"], "response": snapshot["response"], "result_seen": snapshot["result_seen"], "result_status": snapshot["result_status"], "actual_models": snapshot["actual_models"], "model": snapshot["model"]}))',
      ].join('\n'),
    ))
    expect(state.content).toContain('Hel')
    expect(state.content).toContain('lo')
    expect(state.content).toContain('tool started: read_file')
    expect(state.content).toContain('tool result: success')
    expect(state.content).toContain('Gemini warning')
    expect(state.content).not.toContain('secret.txt')
    expect(state.content).not.toContain('secret output')
    expect(state.content).not.toContain('secret warning detail')
    expect(state.response).toBe('Hello')
    expect(state.result_seen).toBe(true)
    expect(state.result_status).toBe('success')
    expect(state.actual_models).toEqual(['gemini-runtime-model'])
    expect(state.model).toBe('gemini-runtime-model')
  })

  it('fails closed without a successful Gemini terminal result', () => {
    const exitCodes = JSON.parse(runPython(
      helperPath,
      'import json; sys.stdout.write(json.dumps([module.validated_gemini_exit_code(0, False, ""), module.validated_gemini_exit_code(0, True, "error"), module.validated_gemini_exit_code(0, True, "success"), module.validated_gemini_exit_code(7, True, "success"), module.validated_gemini_exit_code(0, True, "success", "gemini-pinned", ["gemini-other"]), module.validated_gemini_exit_code(0, True, "success", "gemini-pinned", ["gemini-pinned"])]))',
    ))
    expect(exitCodes).toEqual([1, 1, 0, 7, 1, 0])
  })

  it('omits the Gemini model flag unless a model is explicitly pinned', () => {
    const commands = JSON.parse(runPython(
      helperPath,
      [
        'import json',
        'from pathlib import Path',
        'from types import SimpleNamespace',
        'module.resolve_gemini_invocation = lambda: ["gemini"]',
        'base = {"approval_mode":"plan"}',
        'default_cmd = module.build_command(SimpleNamespace(model="", **base), Path("."))',
        'pinned_cmd = module.build_command(SimpleNamespace(model="gemini-pinned", **base), Path("."))',
        'sys.stdout.write(json.dumps([default_cmd, pinned_cmd]))',
      ].join('\n'),
    ))
    expect(commands[0]).not.toContain('-m')
    expect(commands[1]).toContain('-m')
    expect(commands[1]).toContain('gemini-pinned')
  })

  it('keeps the raw-log and response-file contracts outside the page template', () => {
    const helper = readFileSync(
      helperPath,
      'utf8',
    )

    expect(helper).toContain('PREVIEW_TEMPLATE_PATH')
    expect(helper).toContain('render_live_output_html')
    expect(helper).not.toContain('<html lang="zh-CN">')
    expect(helper).toContain('content_events')
    expect(helper).toContain('Last-Event-ID')
    expect(helper).toContain('f"id: {event_id}\\n"')
    expect(helper).not.toContain('backlog')
    expect(helper).not.toContain('Access-Control-Allow-Origin')
    expect(helper).not.toContain('Gemini Preview -')
    expect(helper).not.toContain('Raw stream-json / stderr log')
    expect(helper).toContain('STATE.append_raw(line)')
    expect(helper).toContain('output_file.write(line)')
    expect(helper).toContain('output_file.flush()')
  })
})
