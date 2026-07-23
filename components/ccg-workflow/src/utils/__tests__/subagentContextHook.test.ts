import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('subagent context hook', () => {
  it('explicitly allows the rewritten Agent input while preserving spawn fields', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'ccg-subagent-hook-'))
    try {
      const taskDir = join(projectRoot, '.ccg', 'tasks', 'active-task')
      mkdirSync(taskDir, { recursive: true })
      writeFileSync(join(taskDir, 'task.json'), JSON.stringify({
        id: 'active-task',
        title: 'Active task',
        status: 'in_progress',
        strategy: 'full-collaborate',
        currentPhase: 'implementation',
      }))

      const hookDir = join(projectRoot, 'installed-hooks')
      mkdirSync(hookDir)
      const hookPath = join(hookDir, 'subagent-context.js')
      copyFileSync(resolve('templates/hooks/subagent-context.js'), hookPath)
      copyFileSync(resolve('templates/hooks/task-utils.js'), join(hookDir, 'task-utils.js'))
      const result = spawnSync(process.execPath, [hookPath], {
        cwd: projectRoot,
        env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot },
        input: JSON.stringify({
          tool_input: {
            team_name: 'active-team',
            name: 'builder-one',
            subagent_type: 'general-purpose',
            model: 'sonnet',
            prompt: 'Implement the assigned files.',
          },
        }),
        encoding: 'utf8',
      })

      expect(result.status).toBe(0)
      const output = JSON.parse(result.stdout)
      expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
      expect(output.hookSpecificOutput.updatedInput).toMatchObject({
        team_name: 'active-team',
        name: 'builder-one',
        subagent_type: 'general-purpose',
        model: 'sonnet',
      })
      expect(output.hookSpecificOutput.updatedInput.prompt).toContain('<ccg-injected-context>')
      expect(output.hookSpecificOutput.updatedInput.prompt).toContain('Implement the assigned files.')
    }
    finally {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })
})
