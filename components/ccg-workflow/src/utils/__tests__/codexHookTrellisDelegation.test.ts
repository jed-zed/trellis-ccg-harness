import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { resolvePythonInvocation } from '../python-resolver'

const roots: string[] = []
const hookPath = join(import.meta.dirname, '..', '..', '..', 'templates', 'codex', 'hooks', 'ccg-workflow.py')

async function makeFixture(worktree: boolean): Promise<{ root: string, cwd: string }> {
  const root = await mkdtemp(join(tmpdir(), `ccg trellis ${worktree ? 'worktree' : 'normal'} `))
  roots.push(root)
  const cwd = join(root, 'packages', 'demo')
  await mkdir(join(root, '.trellis'), { recursive: true })
  await mkdir(join(root, '.codex', 'hooks'), { recursive: true })
  await mkdir(join(root, '.ccg', 'tasks', 'must-not-win'), { recursive: true })
  await mkdir(cwd, { recursive: true })
  if (worktree)
    await writeFile(join(root, '.git'), 'gitdir: C:/tmp/worktrees/demo\n')
  else
    await mkdir(join(root, '.git'))
  await writeFile(join(root, '.ccg', 'tasks', 'must-not-win', 'task.json'), JSON.stringify({
    id: 'must-not-win',
    status: 'in_progress',
  }))
  await writeFile(
    join(root, '.codex', 'hooks', 'inject-workflow-state.py'),
    'import json\nprint(json.dumps({"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"<workflow-state>Trellis delegated</workflow-state>"}}))\n',
  )
  return { root, cwd }
}

function runHook(cwd: string) {
  const python = resolvePythonInvocation()
  return spawnSync(
    python.command,
    [...python.argsPrefix, hookPath],
    {
      cwd,
      input: JSON.stringify({ cwd }),
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
    },
  )
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('CCG global Codex hook delegates Trellis lifecycle', () => {
  for (const worktree of [false, true]) {
    it(`delegates without .ccg guidance in a ${worktree ? 'Git worktree' : 'normal repository'}`, async () => {
      const { cwd } = await makeFixture(worktree)
      const result = runHook(cwd)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Trellis delegated')
      expect(result.stdout).not.toContain('.ccg/tasks')
      expect(result.stderr).toBe('')
    })
  }

  it('fails closed to Trellis-only guidance when the project hook is missing', async () => {
    const { root, cwd } = await makeFixture(true)
    await rm(join(root, '.codex', 'hooks', 'inject-workflow-state.py'))
    const result = runHook(cwd)
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/Trellis/i)
    expect(result.stdout).not.toContain('.ccg/tasks')
  })
})
