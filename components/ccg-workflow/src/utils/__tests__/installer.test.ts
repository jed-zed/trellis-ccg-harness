import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, describe, expect, it } from 'vitest'
import fs from 'fs-extra'
import {
  EXPECTED_BINARY_SHA256,
  EXPECTED_BINARY_VERSION,
  getAllCommandIds,
  getWorkflowById,
  getWorkflowConfigs,
  injectConfigVariables,
  buildNodeHookCommand,
  installWorkflows,
  promoteBinaryCandidate,
  uninstallWorkflows,
} from '../installer'

// Helper: find package root
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

const PACKAGE_ROOT = findPackageRoot()
const TEMPLATES_DIR = join(PACKAGE_ROOT, 'templates', 'commands')
const LEGACY_TEMPLATES_DIR = join(PACKAGE_ROOT, 'templates', 'commands-legacy')
const CCG_PLUGIN_DIR = join(PACKAGE_ROOT, 'plugins', 'ccg')

// ─────────────────────────────────────────────────────────────
// A. Workflow registry consistency
// ─────────────────────────────────────────────────────────────
describe('workflow registry', () => {
  it('getAllCommandIds returns at least 20 commands', () => {
    const ids = getAllCommandIds()
    expect(ids.length).toBeGreaterThanOrEqual(20)
  })

  it('every command ID has a matching template file', () => {
    const ids = getAllCommandIds()
    for (const id of ids) {
      const workflow = getWorkflowById(id)
      expect(workflow, `workflow config missing for: ${id}`).toBeDefined()
      for (const cmd of workflow!.commands) {
        const corePath = join(TEMPLATES_DIR, `${cmd}.md`)
        const legacyPath = join(LEGACY_TEMPLATES_DIR, `${cmd}.md`)
        expect(
          fs.existsSync(corePath) || fs.existsSync(legacyPath),
          `template missing: ${cmd}.md (checked commands/ and commands-legacy/)`,
        ).toBe(true)
      }
    }
  })

  it('every template file has a matching workflow config', () => {
    const coreFiles = readdirSync(TEMPLATES_DIR)
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace('.md', ''))
    const legacyFiles = fs.existsSync(LEGACY_TEMPLATES_DIR)
      ? readdirSync(LEGACY_TEMPLATES_DIR).filter(f => f.endsWith('.md')).map(f => f.replace('.md', ''))
      : []
    const allTemplates = [...coreFiles, ...legacyFiles]
    const allCommands = getAllCommandIds()
      .flatMap(id => getWorkflowById(id)!.commands)

    for (const template of allTemplates) {
      expect(
        allCommands.includes(template),
        `template "${template}.md" has no workflow config`,
      ).toBe(true)
    }
  })

  it('getWorkflowConfigs returns sorted by order', () => {
    const configs = getWorkflowConfigs()
    for (let i = 1; i < configs.length; i++) {
      expect(configs[i].order).toBeGreaterThanOrEqual(configs[i - 1].order)
    }
  })

  it('all workflows have both name and nameEn', () => {
    const configs = getWorkflowConfigs()
    for (const config of configs) {
      expect(config.name, `${config.id} missing name`).toBeTruthy()
      expect(config.nameEn, `${config.id} missing nameEn`).toBeTruthy()
    }
  })

  it('all workflow IDs are unique', () => {
    const ids = getAllCommandIds()
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('getWorkflowById returns undefined for unknown id', () => {
    expect(getWorkflowById('nonexistent')).toBeUndefined()
  })
})

describe('Codex plugin unified role-routing parity', () => {
  const readPluginFile = (...segments: string[]) => readFileSync(join(CCG_PLUGIN_DIR, ...segments), 'utf-8')

  const ordinaryParityFiles = [
    ['commands/plan.md', readPluginFile('commands', 'plan.md')],
    ['commands/execute.md', readPluginFile('commands', 'execute.md')],
    ['commands/review.md', readPluginFile('commands', 'review.md')],
    ['skills/ccg-plan/SKILL.md', readPluginFile('skills', 'ccg-plan', 'SKILL.md')],
    ['skills/ccg-executor/SKILL.md', readPluginFile('skills', 'ccg-executor', 'SKILL.md')],
    ['skills/ccg-review/SKILL.md', readPluginFile('skills', 'ccg-review', 'SKILL.md')],
  ] as const

  it('keeps ordinary plan/execute/review files independent from generic Claude runtime paths', () => {
    for (const [relativePath, content] of ordinaryParityFiles) {
      expect(content, `${relativePath} must not depend on .claude`).not.toContain('.claude')
      expect(content, `${relativePath} must keep Codex as final owner`).toMatch(/Codex .*final|final .*Codex|Codex owns/)
      expect(content, `${relativePath} must state the isolated product-manager boundary`).toContain('product-manager')
      expect(content, `${relativePath} must keep Claude out of ordinary delegation`).toMatch(/Claude .*ordinary|Claude is not a generic/)
    }
  })

  it('plans through applicable top-level role providers and records product-manager state', () => {
    const planCommand = readPluginFile('commands', 'plan.md')
    const planSkill = readPluginFile('skills', 'ccg-plan', 'SKILL.md')
    const routingRule = readPluginFile('rules', 'ccg-role-routing.md')

    expect(planCommand).toContain('Planning is an internal phase')
    expect(planSkill).toContain('frontend, backend, and search')
    expect(planSkill).toContain('**职责 Providers**')
    expect(planSkill).toContain('### 职责 Provider 分析')
    expect(routingRule).toContain('ccg routing get frontend --json')
    expect(routingRule).toContain('ccg routing get backend --json')
    expect(routingRule).toContain('ccg routing get search --json')
    expect(planCommand).not.toContain('ccg routing get planning --json')
    expect(planSkill).not.toContain('ccg routing get planning --json')
    expect(planSkill).not.toContain('Gemini participation is mandatory')
    expect(planSkill).toContain('**Claude 产品经理**')
    expect(planSkill).not.toContain('### Claude 分析')
    expect(planSkill).toContain('说明 Claude 产品经理是否由已安装配置选中')
  })

  it('keeps execute contracts tied to risky/M+ triggers with Codex as final owner', () => {
    const executeCommand = readPluginFile('commands', 'execute.md')
    const executeSkill = readPluginFile('skills', 'ccg-executor', 'SKILL.md')

    for (const [relativePath, content] of [
      ['commands/execute.md', executeCommand],
      ['skills/ccg-executor/SKILL.md', executeSkill],
    ] as const) {
      expect(content, `${relativePath} must keep Codex as final owner`).toMatch(/Codex .*final|final .*Codex|Codex owns/)
      expect(content, `${relativePath} must preserve M+ trigger language`).toContain('M+')
      expect(content, `${relativePath} must preserve risky-work trigger language`).toContain('risky')
      expect(content, `${relativePath} must preserve review evidence`).toContain('review')
      expect(content, `${relativePath} must resolve provider routing`).toContain('ccg routing get')
      expect(content, `${relativePath} must keep Claude isolated`).toContain('product-manager')
    }
  })

  it('routes all four formal roles independently', () => {
    const routingRule = readPluginFile('rules', 'ccg-role-routing.md')
    for (const role of ['frontend', 'backend', 'search', 'product-manager'])
      expect(routingRule).toContain(`ccg routing get ${role} --json`)
    for (const phase of ['analysis', 'planning', 'review'])
      expect(routingRule).toContain(`\`${phase}\``)
    expect(routingRule).toContain('not independently configurable provider roles')
  })

  it('reviews through applicable top-level roles with Codex verification', () => {
    const reviewCommand = readPluginFile('commands', 'review.md')
    const reviewSkill = readPluginFile('skills', 'ccg-review', 'SKILL.md')

    expect(reviewCommand).not.toContain('ccg routing get review --json')
    expect(reviewCommand).toContain('Codex verifies findings')
    expect(reviewSkill).not.toContain('ccg routing get review --json')
    expect(reviewSkill).toContain('frontend, backend, search')
    expect(reviewSkill).toContain('Codex verify every finding')
  })

  it('keeps Claude backend allowed in generated Claude Code settings', () => {
    const initCommand = readFileSync(join(PACKAGE_ROOT, 'src', 'commands', 'init.ts'), 'utf-8')
    const menuCommand = readFileSync(join(PACKAGE_ROOT, 'src', 'commands', 'menu.ts'), 'utf-8')

    for (const [relativePath, content] of [
      ['src/commands/init.ts', initCommand],
      ['src/commands/menu.ts', menuCommand],
    ] as const) {
      expect(content, `${relativePath} must allow all codeagent-wrapper command shapes`).toContain('Bash(*codeagent-wrapper*)')
      expect(content, `${relativePath} must explicitly allow Claude backend calls`).toContain('Bash(~/.claude/bin/codeagent-wrapper --backend claude*)')
    }
  })
})

// ─────────────────────────────────────────────────────────────
// B. injectConfigVariables — routing & liteMode
// ─────────────────────────────────────────────────────────────
describe('injectConfigVariables — routing variables', () => {
  it('injects frontend primary model', () => {
    const input = 'primary: {{FRONTEND_PRIMARY}}'
    const result = injectConfigVariables(input, {
      routing: { frontend: { models: ['gemini'], primary: 'gemini' } },
    })
    expect(result).toBe('primary: gemini')
  })

  it('injects backend primary model', () => {
    const input = 'primary: {{BACKEND_PRIMARY}}'
    const result = injectConfigVariables(input, {
      routing: { backend: { models: ['codex'], primary: 'codex' } },
    })
    expect(result).toBe('primary: codex')
  })

  it('injects frontend models as JSON', () => {
    const input = 'models: {{FRONTEND_MODELS}}'
    const result = injectConfigVariables(input, {
      routing: { frontend: { models: ['gemini', 'claude'] } },
    })
    expect(result).toBe('models: ["gemini","claude"]')
  })

  it('injects review models', () => {
    const input = 'review: {{REVIEW_MODELS}}'
    const result = injectConfigVariables(input, {
      routing: { review: { models: ['codex', 'gemini'] } },
    })
    expect(result).toBe('review: ["codex","gemini"]')
  })

  it('injects routing mode', () => {
    const input = 'mode: {{ROUTING_MODE}}'
    const result = injectConfigVariables(input, {
      routing: { mode: 'smart' },
    })
    expect(result).toBe('mode: smart')
  })

  it('defaults to standard routing when not specified', () => {
    const input = '{{FRONTEND_PRIMARY}} / {{BACKEND_PRIMARY}}'
    const result = injectConfigVariables(input, {})
    expect(result).toBe('gemini / codex')
  })
})

describe('injectConfigVariables — liteMode', () => {
  it('injects --lite flag when liteMode is true', () => {
    const input = 'codeagent-wrapper {{LITE_MODE_FLAG}}--backend codex'
    const result = injectConfigVariables(input, { liteMode: true })
    expect(result).toBe('codeagent-wrapper --lite --backend codex')
  })

  it('injects empty string when liteMode is false', () => {
    const input = 'codeagent-wrapper {{LITE_MODE_FLAG}}--backend codex'
    const result = injectConfigVariables(input, { liteMode: false })
    expect(result).toBe('codeagent-wrapper --backend codex')
  })

  it('injects empty string when liteMode is not specified', () => {
    const input = 'codeagent-wrapper {{LITE_MODE_FLAG}}--backend codex'
    const result = injectConfigVariables(input, {})
    expect(result).toBe('codeagent-wrapper --backend codex')
  })
})

// ─────────────────────────────────────────────────────────────
// C. Template variable completeness
// ─────────────────────────────────────────────────────────────
describe('template variable completeness', () => {
  function collectTemplateFiles(dir: string): string[] {
    const files: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        files.push(...collectTemplateFiles(fullPath))
      }
      else if (entry.name.endsWith('.md')) {
        files.push(fullPath)
      }
    }
    return files
  }

  const allTemplates = collectTemplateFiles(TEMPLATES_DIR)

  it('finds template files', () => {
    expect(allTemplates.length).toBeGreaterThan(0)
  })

  for (const file of allTemplates) {
    const relativePath = file.replace(PACKAGE_ROOT + '/', '')

    it(`${relativePath}: no unprocessed {{variables}} after full injection`, () => {
      const content = readFileSync(file, 'utf-8')
      const result = injectConfigVariables(content, {
        routing: {
          mode: 'smart',
          frontend: { models: ['gemini'], primary: 'gemini' },
          backend: { models: ['codex'], primary: 'codex' },
          review: { models: ['codex', 'gemini'] },
        },
        liteMode: false,
        mcpProvider: 'ace-tool',
      })

      // Find any remaining {{ }} template variables
      const remaining = result.match(/\{\{[A-Z_]+\}\}/g) || []
      // Filter out known non-CCG variables (user-facing placeholders like {{项目路径}})
      const ccgVars = remaining.filter(v =>
        !v.includes('项目') && !v.includes('相关') && !v.includes('WORKDIR'),
      )
      expect(ccgVars, `unprocessed variables in ${relativePath}: ${ccgVars.join(', ')}`).toEqual([])
    })
  }
})

// ─────────────────────────────────────────────────────────────
// D. installWorkflows E2E — contextweaver provider
// ─────────────────────────────────────────────────────────────
describe('installWorkflows E2E — mcpProvider="contextweaver"', () => {
  const tmpDir = join(tmpdir(), `ccg-test-cw-${Date.now()}`)

  afterAll(async () => {
    await fs.remove(tmpDir)
  })

  it('installs all workflows without errors', async () => {
    const result = await installWorkflows(getAllCommandIds(), tmpDir, true, {
      mcpProvider: 'contextweaver',
      skipBinary: true,
    })
    expect(result.success).toBe(true)
    expect(result.errors).toEqual([])
  }, 30_000)

  it('generated command files contain contextweaver references', async () => {
    const planContent = readFileSync(join(tmpDir, 'commands', 'ccg', 'plan.md'), 'utf-8')
    expect(planContent).toContain('mcp__contextweaver__codebase-retrieval')
    expect(planContent).not.toContain('{{MCP_SEARCH_TOOL}}')
    expect(planContent).not.toContain('mcp__ace-tool')
  })

  it('generated agent planner uses contextweaver in tools', async () => {
    const content = readFileSync(join(tmpDir, 'agents', 'ccg', 'planner.md'), 'utf-8')
    expect(content).toContain('mcp__contextweaver__codebase-retrieval')
  })
})

// ─────────────────────────────────────────────────────────────
// E. uninstallWorkflows E2E
// ─────────────────────────────────────────────────────────────
describe('uninstallWorkflows E2E', () => {
  const tmpDir = join(tmpdir(), `ccg-test-uninstall-${Date.now()}`)

  afterAll(async () => {
    await fs.remove(tmpDir)
  })

  it('installs then uninstalls cleanly', async () => {
    // First install
    const installResult = await installWorkflows(getAllCommandIds(), tmpDir, true, {
      mcpProvider: 'ace-tool',
      skipBinary: true,
    })
    expect(installResult.success).toBe(true)

    // Verify files exist
    expect(fs.existsSync(join(tmpDir, 'commands', 'ccg', 'workflow.md'))).toBe(true)

    // Now uninstall
    const uninstallResult = await uninstallWorkflows(tmpDir)
    expect(uninstallResult.success).toBe(true)
    expect(uninstallResult.removedCommands.length).toBeGreaterThan(0)

    // Verify commands directory removed
    expect(fs.existsSync(join(tmpDir, 'commands', 'ccg'))).toBe(false)
  }, 30_000)

  it('uninstall on empty dir succeeds without errors', async () => {
    const emptyDir = join(tmpdir(), `ccg-test-empty-${Date.now()}`)
    const result = await uninstallWorkflows(emptyDir)
    expect(result.success).toBe(true)
    expect(result.errors).toEqual([])
    await fs.remove(emptyDir)
  })
})

// ─────────────────────────────────────────────────────────────
// F. Binary installation
// ─────────────────────────────────────────────────────────────
describe('installWorkflows — binary installation', () => {
  const tmpDir = join(tmpdir(), `ccg-test-bin-${Date.now()}`)

  afterAll(async () => {
    await fs.remove(tmpDir)
  })

  it('keeps installer and wrapper source versions synchronized without a release-network dependency', () => {
    const source = readFileSync(join(PACKAGE_ROOT, 'codeagent-wrapper', 'main.go'), 'utf8')
    const sourceVersion = /\bversion\s*=\s*"([^"]+)"/.exec(source)?.[1]
    expect(sourceVersion).toBe(EXPECTED_BINARY_VERSION)
  })

  it('keeps release binaries independent of the branch, commit, and checkout path', () => {
    const workflow = readFileSync(
      join(PACKAGE_ROOT, '.github', 'workflows', 'build-binaries.yml'),
      'utf8',
    )
    expect(workflow).toContain(`- '.github/workflows/build-binaries.yml'`)
    expect(workflow).toContain(`go-version: '1.21.13'`)
    expect(workflow).toContain(
      'go build -buildvcs=false -trimpath -ldflags="-s -w"',
    )
  })

  it('defines every wrapper acquisition or verification failure as fatal', async () => {
    const installer = await import('../installer')
    const source = readFileSync(join(PACKAGE_ROOT, 'src', 'utils', 'installer.ts'), 'utf8')
    expect(installer.BINARY_INSTALL_FAILURE_POLICY).toBe('fatal')
    expect(source).not.toContain('Binary verification failed (non-blocking)')
    expect(source).not.toContain('Failed to install codeagent-wrapper (non-blocking)')
    expect(source).toContain('recordFatalBinaryFailure')
  })

  it('pins a trusted SHA-256 digest for every personal release asset', () => {
    expect(Object.keys(EXPECTED_BINARY_SHA256).sort()).toEqual([
      'codeagent-wrapper-darwin-amd64',
      'codeagent-wrapper-darwin-arm64',
      'codeagent-wrapper-linux-amd64',
      'codeagent-wrapper-linux-arm64',
      'codeagent-wrapper-windows-amd64.exe',
      'codeagent-wrapper-windows-arm64.exe',
    ])
    for (const digest of Object.values(EXPECTED_BINARY_SHA256)) {
      expect(digest).toMatch(/^[a-f0-9]{64}$/)
    }
  })

  it('rejects a downloaded candidate by digest before executing its version command', async () => {
    const candidateDir = join(tmpDir, 'candidate-digest-mismatch')
    const binaryName = process.platform === 'win32' ? 'candidate.exe' : 'candidate'
    const candidatePath = join(candidateDir, binaryName)
    const installedPath = join(candidateDir, 'installed-binary')

    await fs.ensureDir(candidateDir)
    await fs.copy(process.execPath, candidatePath)
    await fs.writeFile(installedPath, 'known-good-installed-binary')

    const result = await promoteBinaryCandidate(
      candidatePath,
      installedPath,
      process.version,
      '0'.repeat(64),
    )

    expect(result.promoted).toBe(false)
    expect(result.actualVersion).toBeNull()
    expect(result.reason).toBe('integrity-mismatch')
    expect(await fs.readFile(installedPath, 'utf8')).toBe('known-good-installed-binary')
    expect(await fs.pathExists(candidatePath)).toBe(false)
  }, 20_000)
})

describe('hook settings safety', () => {
  const tmpDir = join(tmpdir(), `ccg hook path 中文 ${Date.now()}`)

  afterAll(async () => {
    await fs.remove(tmpDir)
  })

  it('quotes Windows paths containing spaces and non-ASCII characters', () => {
    const command = buildNodeHookCommand(
      String.raw`C:\Users\Jane Doe\钩子\workflow-state.js`,
      'win32',
    )
    expect(command).toBe(String.raw`node "C:\Users\Jane Doe\钩子\workflow-state.js"`)
  })

  it('installs every generated hook command with a quoted absolute script path', async () => {
    const result = await installWorkflows(['workflow'], tmpDir, true, { skipBinary: true })
    expect(result.success).toBe(true)
    const settings = JSON.parse(await fs.readFile(join(tmpDir, 'settings.json'), 'utf8'))
    const commands = Object.values(settings.hooks)
      .flatMap((groups: any) => groups)
      .flatMap((group: any) => group.hooks)
      .map((hook: any) => hook.command)
    expect(commands).toHaveLength(4)
    for (const command of commands)
      expect(command).toMatch(/^node ".+"$/)
  })

  it('fails closed without replacing malformed settings.json', async () => {
    const installDir = join(tmpdir(), `ccg malformed settings ${Date.now()}`)
    const settingsPath = join(installDir, 'settings.json')
    await fs.ensureDir(installDir)
    await fs.writeFile(settingsPath, '{"hooks":')
    try {
      const result = await installWorkflows(['workflow'], installDir, true, { skipBinary: true })
      expect(result.success).toBe(false)
      expect(result.errors.join('\n')).toMatch(/settings\.json|parse|malformed/i)
      expect(await fs.readFile(settingsPath, 'utf8')).toBe('{"hooks":')
    }
    finally {
      await fs.remove(installDir)
    }
  })
})

// ─────────────────────────────────────────────────────────────
// G. Prompts installation
// ─────────────────────────────────────────────────────────────
describe('installWorkflows — prompts installation', () => {
  const tmpDir = join(tmpdir(), `ccg-test-prompts-${Date.now()}`)

  afterAll(async () => {
    await fs.remove(tmpDir)
  })

  it('installs codex, gemini, and claude prompts', async () => {
    const result = await installWorkflows(getAllCommandIds(), tmpDir, true, {
      mcpProvider: 'skip',
      skipBinary: true,
    })
    expect(result.success).toBe(true)
    expect(result.installedPrompts.length).toBeGreaterThan(0)

    // Check model directories exist
    const promptsDir = join(tmpDir, '.ccg', 'prompts')
    expect(fs.existsSync(join(promptsDir, 'codex'))).toBe(true)
    expect(fs.existsSync(join(promptsDir, 'gemini'))).toBe(true)

    // Check at least one prompt per model
    const codexFiles = readdirSync(join(promptsDir, 'codex')).filter(f => f.endsWith('.md'))
    const geminiFiles = readdirSync(join(promptsDir, 'gemini')).filter(f => f.endsWith('.md'))
    expect(codexFiles.length).toBeGreaterThanOrEqual(5)
    expect(geminiFiles.length).toBeGreaterThanOrEqual(5)
    // Grok prompts (v3.2.0): full role set including builder.md
    expect(fs.existsSync(join(promptsDir, 'grok'))).toBe(true)
    const grokFiles = readdirSync(join(promptsDir, 'grok')).filter(f => f.endsWith('.md'))
    expect(grokFiles.length).toBeGreaterThanOrEqual(7)
    expect(grokFiles).toContain('builder.md')
  }, 30_000)
})

describe('installWorkflows - GPT Pro bridge assets', () => {
  const tmpDir = join(tmpdir(), `ccg-test-gptpro-${Date.now()}`)

  afterAll(async () => {
    await fs.remove(tmpDir)
  }, 30_000)

  it('installs the GPT Pro command family and engine-local bridge files', async () => {
    const result = await installWorkflows(['gptpro-plan', 'gptpro-review', 'gptpro-exc'], tmpDir, true, {
      mcpProvider: 'skip',
      skipBinary: true,
    })
    expect(result.success).toBe(true)
    expect(result.installedCommands).toContain('gptpro-plan')
    expect(result.installedCommands).toContain('gptpro-review')
    expect(result.installedCommands).toContain('gptpro-exc')
    expect(fs.existsSync(join(tmpDir, 'commands', 'ccg', 'gptpro-plan.md'))).toBe(true)
    expect(fs.existsSync(join(tmpDir, 'commands', 'ccg', 'gptpro-review.md'))).toBe(true)
    expect(fs.existsSync(join(tmpDir, 'commands', 'ccg', 'gptpro-exc.md'))).toBe(true)
    expect(fs.existsSync(join(tmpDir, '.ccg', 'engine', 'tools', 'gptpro', 'gptpro_bridge.py'))).toBe(true)
    expect(fs.existsSync(join(tmpDir, '.ccg', 'engine', 'tools', 'gptpro', 'templates', 'plan.md'))).toBe(true)
    expect(fs.existsSync(join(tmpDir, '.ccg', 'engine', 'tools', 'gptpro', 'templates', 'review.md'))).toBe(true)
    expect(fs.existsSync(join(tmpDir, '.ccg', 'engine', 'tools', 'gptpro', 'templates', 'exc.md'))).toBe(true)

    const installedCommands = [
      readFileSync(join(tmpDir, 'commands', 'ccg', 'gptpro-plan.md'), 'utf-8'),
      readFileSync(join(tmpDir, 'commands', 'ccg', 'gptpro-review.md'), 'utf-8'),
      readFileSync(join(tmpDir, 'commands', 'ccg', 'gptpro-exc.md'), 'utf-8'),
    ].join('\n')
    const installedBridgeBase = readFileSync(
      join(tmpDir, '.ccg', 'engine', 'tools', 'gptpro', 'templates', 'base.md'),
      'utf-8',
    )
    const installedBridgeModeTemplates = [
      readFileSync(join(tmpDir, '.ccg', 'engine', 'tools', 'gptpro', 'templates', 'plan.md'), 'utf-8'),
      readFileSync(join(tmpDir, '.ccg', 'engine', 'tools', 'gptpro', 'templates', 'review.md'), 'utf-8'),
      readFileSync(join(tmpDir, '.ccg', 'engine', 'tools', 'gptpro', 'templates', 'exc.md'), 'utf-8'),
    ].join('\n')
    const installedBridgeScript = readFileSync(
      join(tmpDir, '.ccg', 'engine', 'tools', 'gptpro', 'gptpro_bridge.py'),
      'utf-8',
    )

    expect(installedCommands).toMatch(/ordinary\s+`\/ccg:plan`\s+semantics/)
    expect(installedCommands).toMatch(/ordinary\s+`\/ccg:review`\s+semantics/)
    expect(installedCommands).toMatch(/ordinary\s+`\/ccg:execute`\s+semantics/)
    expect(installedCommands).toContain('preflight and routing evidence')
    expect(installedCommands).toContain('--require-routing-evidence')
    expect(installedCommands).toContain('--require-claude-evidence')
    expect(installedCommands).toContain('claudeEvidenceStatus: skipped_by_user')
    expect(installedCommands).toContain('do not omit it for')
    expect(installedCommands).toContain('automatic failure or blocked Claude evidence')
    expect(installedCommands).toContain('risk-triggered')
    expect(installedCommands).toContain('Project Access Context')
    expect(installedCommands).toContain('Blockers')
    expect(installedCommands).toContain('highest-value default use case')
    expect(installedCommands).toContain('Critical')
    expect(installedCommands).toContain('Proceed')
    expect(installedCommands).toContain('advisory / illustrative')
    expect(installedBridgeBase).toContain('ordinary plan/review/execute first')
    expect(installedBridgeBase).toContain('GPT Pro is fourth evidence')
    expect(installedBridgeBase).toContain('do not replace routed models')
    expect(installedBridgeBase).toContain('Project Access Context')
    expect(installedBridgeBase).toContain('repository URL, branch, commit, and local git status')
    expect(installedBridgeBase).toContain('advisory and illustrative')
    expect(installedBridgeModeTemplates).toContain('Task For GPT Pro')
    expect(installedBridgeModeTemplates).toContain('review the current plan for requirement ambiguity')
    expect(installedBridgeModeTemplates).toContain('review the submitted scope for concrete defects')
    expect(installedBridgeModeTemplates).toContain('decide whether the current execution route should proceed')
    expect(installedBridgeScript).toContain('--routing-evidence-file')
    expect(installedBridgeScript).toContain('Base CCG Routing Evidence')
    expect(installedBridgeScript).toContain('Repository URL: {repo_url}')
  }, 30_000)
})

describe('GPT Pro go routing', () => {
  it('documents automatic routing for plan, review, and execution route review', () => {
    const content = readFileSync(join(TEMPLATES_DIR, 'go.md'), 'utf-8')
    expect(content).toContain('/ccg:gptpro-plan')
    expect(content).toContain('/ccg:gptpro-review')
    expect(content).toContain('/ccg:gptpro-exc')
    expect(content).toContain('gptpro-plan')
    expect(content).toContain('gptpro-review')
    expect(content).toContain('gptpro-exc')
  })
})

// ─────────────────────────────────────────────────────────────
// H. Skills namespace isolation (skills/ccg/)
// ─────────────────────────────────────────────────────────────
describe('skills namespace isolation', () => {
  const tmpDir = join(tmpdir(), `ccg-test-skills-${Date.now()}`)

  afterAll(async () => {
    await fs.remove(tmpDir)
  })

  it('installs skills under skills/ccg/ namespace', async () => {
    const result = await installWorkflows(['workflow'], tmpDir, true, {
      mcpProvider: 'skip',
      skipBinary: true,
    })
    expect(result.success).toBe(true)
    expect(result.installedSkills).toBeGreaterThanOrEqual(6)

    // Skills must be under skills/ccg/, not skills/ root
    expect(fs.existsSync(join(tmpDir, 'skills', 'ccg', 'SKILL.md'))).toBe(true)
    expect(fs.existsSync(join(tmpDir, 'skills', 'ccg', 'tools'))).toBe(true)
    expect(fs.existsSync(join(tmpDir, 'skills', 'ccg', 'orchestration'))).toBe(true)
  })

  it('uninstall only removes skills/ccg/, preserves user skills', async () => {
    // Simulate a user-created skill at skills/my-custom-skill/SKILL.md
    const userSkillDir = join(tmpDir, 'skills', 'my-custom-skill')
    await fs.ensureDir(userSkillDir)
    await fs.writeFile(join(userSkillDir, 'SKILL.md'), '# My Custom Skill')

    // Uninstall CCG
    const result = await uninstallWorkflows(tmpDir)
    expect(result.success).toBe(true)
    expect(result.removedSkills.length).toBeGreaterThan(0)

    // CCG skills gone
    expect(fs.existsSync(join(tmpDir, 'skills', 'ccg'))).toBe(false)

    // User skill preserved!
    expect(fs.existsSync(join(userSkillDir, 'SKILL.md'))).toBe(true)

    // Cleanup
    await fs.remove(userSkillDir)
  })

  it('migrates old v1.7.73 layout to skills/ccg/', { timeout: 30_000 }, async () => {
    const migrateDir = join(tmpdir(), `ccg-test-migrate-${Date.now()}`)

    // Simulate old layout: skills/{tools,orchestration,SKILL.md,run_skill.js}
    const oldSkills = join(migrateDir, 'skills')
    await fs.ensureDir(join(oldSkills, 'tools', 'verify-security'))
    await fs.ensureDir(join(oldSkills, 'orchestration', 'multi-agent'))
    await fs.writeFile(join(oldSkills, 'SKILL.md'), '# Old Root')
    await fs.writeFile(join(oldSkills, 'run_skill.js'), '// old')
    await fs.writeFile(join(oldSkills, 'tools', 'verify-security', 'SKILL.md'), '# Old Security')
    await fs.writeFile(join(oldSkills, 'orchestration', 'multi-agent', 'SKILL.md'), '# Old Multi-Agent')

    // Also add a user skill that should NOT be migrated
    await fs.ensureDir(join(oldSkills, 'brainstorming'))
    await fs.writeFile(join(oldSkills, 'brainstorming', 'SKILL.md'), '# User Brainstorming')

    // Install triggers migration
    const result = await installWorkflows(['workflow'], migrateDir, true, {
      mcpProvider: 'skip',
      skipBinary: true,
    })
    expect(result.success).toBe(true)

    // CCG skills moved to skills/ccg/
    expect(fs.existsSync(join(migrateDir, 'skills', 'ccg', 'SKILL.md'))).toBe(true)
    expect(fs.existsSync(join(migrateDir, 'skills', 'ccg', 'tools'))).toBe(true)
    expect(fs.existsSync(join(migrateDir, 'skills', 'ccg', 'orchestration'))).toBe(true)

    // User skill untouched at original location
    expect(fs.existsSync(join(migrateDir, 'skills', 'brainstorming', 'SKILL.md'))).toBe(true)

    // Old CCG items no longer at root level
    expect(fs.existsSync(join(migrateDir, 'skills', 'tools'))).toBe(false)
    expect(fs.existsSync(join(migrateDir, 'skills', 'orchestration'))).toBe(false)

    await fs.remove(migrateDir)
  })
})
