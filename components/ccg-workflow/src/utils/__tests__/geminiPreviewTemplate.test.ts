import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const UNSAFE_UPSTREAM_TASK_RENDERING = String.raw`                    taskEl.innerHTML = '<strong>📋 Task:</strong><br>' + session.task.replace(/\n/g, '<br>');`
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
    expect(rendered).not.toContain("taskEl.innerHTML = '<strong>📋 Task:</strong><br>' + session.task")
    expect(rendered).toContain('const exitCode = Number(data.exit_code ?? 0)')
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

  it('keeps final response content without replaying it to later SSE clients', () => {
    const state = JSON.parse(runPython(
      helperPath,
      [
        'import json',
        'state = module.State()',
        'state.append_content("before-connect")',
        'client, done, exit_code = state.register_client(state.preview_session_id)',
        'first_empty_before_complete = client.empty()',
        'state.complete(7, "failed")',
        'late_client, late_done, late_exit_code = state.register_client(state.preview_session_id)',
        'sys.stdout.write(json.dumps({',
        '  "content": state.snapshot()["content"],',
        '  "first_empty": first_empty_before_complete,',
        '  "done_before": done,',
        '  "exit_before": exit_code,',
        '  "late_empty": late_client.empty(),',
        '  "late_done": late_done,',
        '  "late_exit_code": late_exit_code,',
        '}))',
      ].join('\n'),
    ))
    expect(state).toEqual({
      content: 'before-connect',
      first_empty: true,
      done_before: false,
      exit_before: null,
      late_empty: true,
      late_done: true,
      late_exit_code: 7,
    })
  })

  it('keeps the raw-log and response-file contracts outside the page template', () => {
    const helper = readFileSync(
      helperPath,
      'utf8',
    )

    expect(helper).toContain('PREVIEW_TEMPLATE_PATH')
    expect(helper).toContain('render_live_output_html')
    expect(helper).not.toContain('<html lang="zh-CN">')
    expect(helper).not.toContain('content_events')
    expect(helper).not.toContain('backlog')
    expect(helper).not.toContain('Access-Control-Allow-Origin')
    expect(helper).not.toContain('Gemini Preview -')
    expect(helper).not.toContain('Raw stream-json / stderr log')
    expect(helper).toContain('STATE.append_raw(line)')
    expect(helper).toContain('output_file.write(line)')
    expect(helper).toContain('output_file.flush()')
  })
})
