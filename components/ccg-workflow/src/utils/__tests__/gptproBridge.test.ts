import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import fs from 'fs-extra'

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

interface PythonCommand {
  command: string
  prefixArgs: string[]
}

function findPython(): PythonCommand | null {
  for (const candidate of [
    { command: 'python', prefixArgs: [] },
    { command: 'py', prefixArgs: ['-3'] },
  ]) {
    try {
      execFileSync(candidate.command, [...candidate.prefixArgs, '--version'], { stdio: 'pipe' })
      return candidate
    }
    catch {
      // Try next candidate.
    }
  }
  return null
}

function runPython(python: PythonCommand, args: string[], cwd?: string): string {
  return execFileSync(python.command, [...python.prefixArgs, ...args], {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function parseOutputPath(output: string, key: string): string {
  const line = output.split(/\r?\n/).find(item => item.startsWith(`${key}=`))
  if (!line) throw new Error(`Missing output key: ${key}\n${output}`)
  return line.slice(key.length + 1).trim()
}

function sha256(text: string | Buffer): string {
  return createHash('sha256').update(text).digest('hex')
}

function writeSidebarEvidence(
  sidebarDir: string,
  prompt: string,
  response: string,
  threadId = '019fa981-725e-7f02-93a7-bb1e1b7aefd3',
  conversationUrl = 'https://chatgpt.com/c/6a6a1d6a-5df4-83ea-8685-43559f3e47e8',
): void {
  fs.ensureDirSync(sidebarDir)
  const promptBytes = Buffer.from(prompt, 'utf-8')
  const responseBytes = Buffer.from(response, 'utf-8')
  const urlBytes = Buffer.from(conversationUrl, 'utf-8')
  fs.writeFileSync(join(sidebarDir, 'prompt.md'), promptBytes)
  fs.writeFileSync(join(sidebarDir, 'response.md'), responseBytes)
  fs.writeFileSync(join(sidebarDir, 'url.txt'), urlBytes)
  const manifest = `${JSON.stringify({
    schemaVersion: 1,
    tool: 'chatgpt-pro-sidebar',
    transport: 'windows-uia',
    live: true,
    prompt: { file: 'prompt.md', sha256: sha256(promptBytes) },
    response: { file: 'response.md', sha256: sha256(responseBytes), characters: response.length },
    conversation: {
      file: 'url.txt',
      url: conversationUrl,
      sha256: sha256(urlBytes),
      exact: true,
      boundAtSend: conversationUrl,
      matchedBoundUrl: true,
    },
    submission: {
      acknowledged: true,
      invokeAttempted: true,
      invokeReturned: true,
      observationalRecovery: false,
      automaticResendAllowed: false,
    },
    authority: {
      externalOutputIsUntrusted: true,
      codexIsSoleWorkspaceWriter: true,
    },
  }, null, 2)}\n`
  fs.writeFileSync(join(sidebarDir, 'evidence.json'), manifest)
  fs.writeJsonSync(join(sidebarDir, 'state.json'), {
    schemaVersion: 1,
    tool: 'chatgpt-pro-sidebar',
    transport: 'windows-uia',
    live: true,
    phase: 'completed',
    promptFile: 'prompt.md',
    promptSha256: sha256(promptBytes),
    responseFile: 'response.md',
    responseSha256: sha256(responseBytes),
    urlFile: 'url.txt',
    urlSha256: sha256(urlBytes),
    evidenceFile: 'evidence.json',
    evidenceSha256: sha256(manifest),
    conversationUrl,
    conversationUrlBound: conversationUrl,
    automaticResendAllowed: false,
  })
  fs.writeJsonSync(join(sidebarDir, 'watch-event.json'), {
    schemaVersion: 1,
    watcher: 'chatgpt-pro-sidebar-watch',
    watcherId: '90bae6c6-4506-4a68-bae3-3d39600d13d2',
    status: 'completed',
    requiresCodexReview: true,
    automaticResendAllowed: false,
    evidenceDirectory: sidebarDir,
    conversationUrl,
    codexThreadId: threadId,
  })
}

function writeGrokExternalEvidence(
  root: string,
  taskDir: string,
  options: {
    decision?: Record<string, unknown>
    evidence?: Record<string, unknown>
    manifest?: Record<string, unknown>
    item?: Record<string, unknown>
    pointer?: Record<string, unknown>
  } = {},
): { artifactFile: string, manifestFile: string, artifactSha256: string, manifestSha256: string } {
  const evidenceId = 'grok-contract-1'
  const bundleDir = join(root, '.codex', 'ccg', 'intelligence', evidenceId)
  fs.ensureDirSync(bundleDir)
  const createdAt = new Date().toISOString()
  const decision = {
    requirement: 'required',
    status: 'valid',
    action: 'intel',
    investigation_mode: 'contract',
    mode: 'contract',
    depth: 'normal',
    package_status: 'valid',
    verification_outcome: 'verified',
    reason: 'Current external contract evidence validated.',
    created_at: createdAt,
    ...(options.decision || {}),
  }
  const artifact = `${JSON.stringify({
    schemaVersion: 2,
    decision,
    evidence: {
      raw_model_output: 'RAW_DO_NOT_FORWARD',
      claims: [{
        id: 'claim-1',
        claim: 'The current official contract remains supported.',
        status: 'verified',
        severity: 'info',
        source_ids: ['source-1'],
        applies_to: ['package.json'],
      }],
      model: { requested: 'grok-4.5', actual: 'grok-4.5', provenance: 'grok agent --model' },
      action: 'intel',
      investigation_mode: 'contract',
      depth: 'normal',
      effective_x_policy: 'preferred',
      bindings: [],
      registry: {
        sources: [{
          id: 'source-1',
          tool: 'web_search',
          observed_tool: 'web_search',
          canonical_url: 'https://docs.example.test/current-contract',
          publisher: 'Example Maintainer',
          official: true,
          source_tier: 'A',
          independence_key: 'example.test',
          retrieved_at: createdAt,
        }],
      },
      ...(options.evidence || {}),
    },
  }, null, 2)}\n`
  const report = '# Validated Grok evidence\n'
  const raw = '{"private":"RAW_DO_NOT_FORWARD"}\n'
  const artifactFile = `.codex/ccg/intelligence/${evidenceId}/evidence.json`
  const manifestFile = `.codex/ccg/intelligence/${evidenceId}/manifest.json`
  fs.writeFileSync(join(bundleDir, 'evidence.json'), artifact)
  fs.writeFileSync(join(bundleDir, 'report.md'), report)
  fs.writeFileSync(join(bundleDir, 'raw-stream.jsonl'), raw)
  const manifest = `${JSON.stringify({
    schemaVersion: 1,
    evidenceId,
    createdAt,
    localOnly: true,
    exported: false,
    retentionDays: 7,
    action: 'intel',
    investigation_mode: 'contract',
    depth: 'normal',
    requirement: 'required',
    effective_x_policy: 'preferred',
    cli_version: 'grok 0.2.106',
    model: 'grok-4.5',
    prompt_sha256: 'a'.repeat(64),
    git_head: 'unversioned',
    dirty_digest: 'b'.repeat(64),
    bindings: [],
    official_domains: ['docs.example.test'],
    search_counts: { web: 1, x: 0 },
    attempts: 1,
    package_status: 'valid',
    validation_outcome: 'verified',
    verification_outcome: 'verified',
    cache_fingerprint: 'c'.repeat(64),
    cache_contract_versions: { runnerVersion: '2', evidenceSchemaVersion: '2' },
    files: {
      'evidence.json': { sha256: sha256(artifact), bytes: Buffer.byteLength(artifact) },
      'report.md': { sha256: sha256(report), bytes: Buffer.byteLength(report) },
      'raw-stream.jsonl': { sha256: sha256(raw), bytes: Buffer.byteLength(raw) },
    },
    ...(options.manifest || {}),
  }, null, 2)}\n`
  fs.writeFileSync(join(bundleDir, 'manifest.json'), manifest)
  const artifactSha256 = sha256(artifact)
  const manifestSha256 = sha256(manifest)
  const evidencePath = join(taskDir, 'evidence.json')
  const canonical = fs.pathExistsSync(evidencePath) ? fs.readJsonSync(evidencePath) : { schemaVersion: 1, items: [] }
  canonical.items.push({
    id: `grok-external-intelligence-${evidenceId}`,
    provider: 'grok',
    role: 'external-intelligence',
    policy: 'required',
    action: 'intel',
    investigationMode: 'contract',
    depth: 'normal',
    packageStatus: 'valid',
    verificationOutcome: 'verified',
    available: true,
    artifactFile,
    artifactSha256,
    manifestFile,
    manifestSha256,
    summary: 'Validated current external contract evidence.',
    createdAt,
    localOnly: true,
    exported: false,
    ...(options.item || {}),
  })
  fs.writeJsonSync(evidencePath, canonical)
  const taskPath = join(taskDir, 'task.json')
  const task = fs.readJsonSync(taskPath)
  task.intelligence = {
    requirement: 'required',
    status: decision.status,
    action: decision.action,
    investigation_mode: decision.investigation_mode,
    depth: decision.depth,
    package_status: decision.package_status,
    verification_outcome: decision.verification_outcome,
    evidence_id: evidenceId,
    manifest_file: manifestFile,
    manifest_sha256: manifestSha256,
    localOnly: true,
    exported: false,
    ...(options.pointer || {}),
  }
  fs.writeJsonSync(taskPath, task)
  return { artifactFile, manifestFile, artifactSha256, manifestSha256 }
}

function writeGeminiGateEvidence(
  taskDir: string,
  artifactFile: string,
  response: string,
  evidenceFile = 'evidence.json',
): void {
  const evidencePath = join(taskDir, evidenceFile)
  fs.ensureDirSync(dirname(evidencePath))
  const canonical = fs.pathExistsSync(evidencePath) ? fs.readJsonSync(evidencePath) : { schemaVersion: 1, items: [] }
  canonical.items.push({
    id: 'gemini-gate-1',
    provider: 'gemini',
    role: 'gate',
    policy: 'required',
    available: true,
    artifactFile,
    artifactSha256: sha256(response),
    artifactChars: response.length,
    summary: 'Gemini gate evidence is available.',
    createdAt: '2026-01-01T00:00:00.000Z',
  })
  fs.writeJsonSync(evidencePath, canonical)
}

function writeRoutingEvidence(
  evidenceDir: string,
  claudeEvidenceStatus: string | null = 'automatic',
  claudeEvidenceLine?: string,
): { evidenceFile: string, summaryFile: string, content: string, summary: string } {
  const content = [
    'ordinary /ccg:review first',
    'current orchestrator: codex',
    'routed models: codex primary review, gemini gate evidence',
    ...(claudeEvidenceLine ? [claudeEvidenceLine] : (claudeEvidenceStatus ? [`claudeEvidenceStatus: ${claudeEvidenceStatus}`] : [])),
    'ordinary review conclusion: packaging path needs verification',
  ].join('\n')
  const summary = 'Ordinary review route completed with Codex primary review and Gemini gate evidence.'
  const evidenceFile = join(evidenceDir, 'routing.md')
  const summaryFile = join(evidenceDir, 'routing-summary.md')
  writeFileSync(evidenceFile, content, 'utf-8')
  writeFileSync(summaryFile, summary, 'utf-8')
  return { evidenceFile, summaryFile, content, summary }
}

function runPythonFailure(python: PythonCommand, args: string[], cwd?: string): string {
  try {
    runPython(python, args, cwd)
  }
  catch (error: any) {
    return String(error.stderr || error.message || error)
  }
  throw new Error('Expected Python command to fail')
}

const PACKAGE_ROOT = findPackageRoot()
const BRIDGE = join(PACKAGE_ROOT, 'templates', 'engine', 'tools', 'gptpro', 'gptpro_bridge.py')
const PLUGIN_BRIDGE = join(PACKAGE_ROOT, 'plugins', 'ccg', 'skills', 'ccg-gptpro-bridge', 'scripts', 'gptpro_bridge.py')
const TMP_ROOT = join(tmpdir(), `ccg-gptpro-bridge-${Date.now()}`)
const PYTHON = findPython()
const maybeIt = PYTHON ? it : it.skip

afterAll(async () => {
  await fs.remove(TMP_ROOT)
  await fs.remove(join(PACKAGE_ROOT, 'templates', 'engine', 'tools', 'gptpro', '__pycache__'))
  await fs.remove(join(PACKAGE_ROOT, 'plugins', 'ccg', 'skills', 'ccg-gptpro-bridge', 'scripts', '__pycache__'))
})

describe('GPT Pro sidebar bridge', () => {
  maybeIt('passes Python syntax compilation', () => {
    runPython(PYTHON!, ['-m', 'py_compile', BRIDGE])
    runPython(PYTHON!, ['-m', 'py_compile', PLUGIN_BRIDGE])
  })

  it('keeps the Codex plugin bridge on the automated sidebar transport without Claude gates', () => {
    const pluginBridge = readFileSync(PLUGIN_BRIDGE, 'utf-8')
    expect(pluginBridge).toContain('chatgpt-pro-sidebar')
    expect(pluginBridge).toContain('--import-sidebar-evidence')
    expect(pluginBridge).toContain('--expected-codex-thread-id')
    expect(pluginBridge).not.toContain('--require-claude-evidence')
    expect(pluginBridge).not.toContain('claudeEvidenceStatus')
  })

  it('routes every GPT Pro surface through the installed sidebar Skill', () => {
    const surfaces = [
      'docs/gptpro-manual-bridge.md',
      'plugins/ccg/skills/ccg-gptpro-bridge/SKILL.md',
      'plugins/ccg/skills/ccg-gptpro-plan/SKILL.md',
      'plugins/ccg/skills/ccg-gptpro-review/SKILL.md',
      'plugins/ccg/skills/ccg-gptpro-exc/SKILL.md',
      'templates/commands/gptpro-plan.md',
      'templates/commands/gptpro-review.md',
      'templates/commands/gptpro-exc.md',
      'plugins/ccg/commands/gptpro-plan.md',
      'plugins/ccg/commands/gptpro-review.md',
      'plugins/ccg/commands/gptpro-exc.md',
    ]
    for (const relativePath of surfaces) {
      const content = readFileSync(join(PACKAGE_ROOT, ...relativePath.split('/')), 'utf-8')
      expect(content, relativePath).toContain('chatgpt-pro-sidebar')
      expect(content, relativePath).not.toContain('manual_gptpro_waiting')
      expect(content, relativePath).not.toMatch(/^\s*--detach-preview/m)
      expect(content, relativePath).not.toMatch(/^\s*--open-preview/m)
    }
  })

  it('resolves the project sidebar Skill before the global fallback', () => {
    for (const relativePath of [
      'docs/gptpro-manual-bridge.md',
      'plugins/ccg/skills/ccg-gptpro-bridge/SKILL.md',
    ]) {
      const content = readFileSync(join(PACKAGE_ROOT, ...relativePath.split('/')), 'utf-8')
      const projectSkill = '<project-root>/.agents/skills/chatgpt-pro-sidebar/'
      const globalSkill = '~/.codex/skills/chatgpt-pro-sidebar/'
      expect(content, relativePath).toContain(projectSkill)
      expect(content, relativePath).toContain(globalSkill)
      expect(content.indexOf(projectSkill), relativePath).toBeLessThan(content.indexOf(globalSkill))
    }
  })

  it('requires automatic watcher completion and bridge import instead of a manual save gate', () => {
    const surfaces = [
      'templates/commands/gptpro-plan.md',
      'templates/commands/gptpro-review.md',
      'templates/commands/gptpro-exc.md',
      'plugins/ccg/commands/gptpro-plan.md',
      'plugins/ccg/commands/gptpro-review.md',
      'plugins/ccg/commands/gptpro-exc.md',
    ]
    for (const relativePath of surfaces) {
      const content = readFileSync(join(PACKAGE_ROOT, ...relativePath.split('/')), 'utf-8')
      expect(content, relativePath).not.toMatch(/user saves? (?:a )?(?:non-empty )?(?:GPT Pro )?(?:output|response)/i)
      expect(content, relativePath).toMatch(/sidebar watcher reaches a terminal state/i)
      expect(content, relativePath).toMatch(/bridge\s+successfully imports a non-empty\s+GPT Pro response/i)
    }
  })

  maybeIt('imports completed sidebar evidence exactly once and records its provenance', () => {
    const root = join(TMP_ROOT, 'sidebar-import')
    const taskDir = join(root, '.ccg', 'tasks', 'sidebar-task')
    fs.ensureDirSync(taskDir)
    fs.writeJsonSync(join(taskDir, 'task.json'), { id: 'sidebar-task', status: 'in_progress' })
    const createOutput = runPython(PYTHON!, [
      BRIDGE,
      '--mode',
      'exc',
      '--workdir',
      root,
      '--task-dir',
      '.ccg/tasks/sidebar-task',
      '--prompt',
      'Review the automated sidebar import contract.',
      '--gemini-policy',
      'optional',
      '--gemini-evidence-role',
      'frontend-prototype',
    ], root)
    const sessionDir = parseOutputPath(createOutput, 'CCG_GPTPRO_SESSION_DIR')
    const promptFile = parseOutputPath(createOutput, 'CCG_GPTPRO_PROMPT_FILE')
    const statusFile = parseOutputPath(createOutput, 'CCG_GPTPRO_STATUS_FILE')
    const sidebarDir = join(dirname(promptFile), 'sidebar')
    const prompt = readFileSync(promptFile, 'utf-8')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[\r\n]+$/, '')
    const response = 'Automated ChatGPT Pro sidebar response.\n'
    writeSidebarEvidence(sidebarDir, prompt, response)

    const importArgs = [
      BRIDGE,
      '--import-session',
      sessionDir,
      '--import-sidebar-evidence',
      sidebarDir,
      '--expected-codex-thread-id',
      '019fa981-725e-7f02-93a7-bb1e1b7aefd3',
    ]
    const firstImport = runPython(PYTHON!, importArgs, root)
    const secondImport = runPython(PYTHON!, importArgs, root)
    expect(firstImport).toContain('CCG_GPTPRO_SIDEBAR_IMPORTED=1')
    expect(secondImport).toContain('CCG_GPTPRO_SIDEBAR_IMPORTED=1')

    const status = fs.readJsonSync(statusFile)
    expect(status).toMatchObject({
      provider: 'chatgpt-pro-sidebar',
      manual_copy_required: false,
      sidebar_transport_required: true,
      auto_submit: true,
      auto_output_read: true,
      sidebar_response_imported: true,
    })
    expect(status.rounds['round-1']).toMatchObject({
      response_saved: true,
      transport: 'chatgpt-pro-sidebar',
    })
    expect(readFileSync(join(dirname(promptFile), 'response.md'), 'utf-8')).toBe(response)
    expect(fs.readJsonSync(join(sidebarDir, 'watch-continuation-ack.json'))).toMatchObject({
      transport: 'ccg-gptpro-bridge',
      acknowledged: true,
      acknowledgementType: 'ccg-imported',
      codexThreadId: '019fa981-725e-7f02-93a7-bb1e1b7aefd3',
      watcherId: '90bae6c6-4506-4a68-bae3-3d39600d13d2',
    })
    const evidence = fs.readJsonSync(join(taskDir, 'evidence.json'))
    const gptproItems = evidence.items.filter((item: any) => item.provider === 'gptpro')
    expect(gptproItems).toHaveLength(1)
    expect(gptproItems[0]).toMatchObject({
      policy: 'automated-sidebar',
      transport: 'chatgpt-pro-sidebar',
      codexThreadId: '019fa981-725e-7f02-93a7-bb1e1b7aefd3',
      automaticResendAllowed: false,
      externalOutputIsUntrusted: true,
      codexIsSoleWorkspaceWriter: true,
    })

    writeSidebarEvidence(sidebarDir, prompt, 'Different response must not overwrite.\n')
    const overwriteError = runPythonFailure(PYTHON!, importArgs, root)
    expect(overwriteError).toMatch(/already saved with different content/i)
    expect(readFileSync(join(dirname(promptFile), 'response.md'), 'utf-8')).toBe(response)
  })

  maybeIt('imports a custom-GPT conversation with a non-UUID conversation id', () => {
    const root = join(TMP_ROOT, 'sidebar-custom-gpt-import')
    const taskDir = join(root, '.ccg', 'tasks', 'sidebar-custom-gpt-task')
    fs.ensureDirSync(taskDir)
    fs.writeJsonSync(join(taskDir, 'task.json'), { id: 'sidebar-custom-gpt-task', status: 'in_progress' })
    const createOutput = runPython(PYTHON!, [
      BRIDGE,
      '--mode',
      'review',
      '--workdir',
      root,
      '--task-dir',
      '.ccg/tasks/sidebar-custom-gpt-task',
      '--prompt',
      'Import a custom GPT conversation.',
    ], root)
    const sessionDir = parseOutputPath(createOutput, 'CCG_GPTPRO_SESSION_DIR')
    const promptFile = parseOutputPath(createOutput, 'CCG_GPTPRO_PROMPT_FILE')
    const sidebarDir = join(dirname(promptFile), 'sidebar')
    const conversationUrl = 'https://chatgpt.com/g/custom-gpt_1/c/conversation_123'
    const prompt = readFileSync(promptFile, 'utf-8')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[\r\n]+$/, '')
    writeSidebarEvidence(
      sidebarDir,
      prompt,
      'Custom GPT response.\n',
      '019fa981-725e-7f02-93a7-bb1e1b7aefd3',
      conversationUrl,
    )

    const output = runPython(PYTHON!, [
      BRIDGE,
      '--import-session',
      sessionDir,
      '--import-sidebar-evidence',
      sidebarDir,
      '--expected-codex-thread-id',
      '019fa981-725e-7f02-93a7-bb1e1b7aefd3',
    ], root)

    expect(output).toContain('CCG_GPTPRO_SIDEBAR_IMPORTED=1')
    const evidence = fs.readJsonSync(join(taskDir, 'evidence.json'))
    expect(evidence.items.at(-1)).toMatchObject({
      provider: 'gptpro',
      conversationUrl,
    })
  })

  maybeIt('rejects sidebar evidence from another Codex task', () => {
    const root = join(TMP_ROOT, 'sidebar-wrong-thread')
    const taskDir = join(root, '.ccg', 'tasks', 'sidebar-wrong-thread-task')
    fs.ensureDirSync(taskDir)
    fs.writeJsonSync(join(taskDir, 'task.json'), { id: 'sidebar-wrong-thread-task', status: 'in_progress' })
    const createOutput = runPython(PYTHON!, [
      BRIDGE,
      '--mode',
      'exc',
      '--workdir',
      root,
      '--task-dir',
      '.ccg/tasks/sidebar-wrong-thread-task',
      '--prompt',
      'Reject another Codex task.',
      '--gemini-policy',
      'optional',
      '--gemini-evidence-role',
      'frontend-prototype',
    ], root)
    const sessionDir = parseOutputPath(createOutput, 'CCG_GPTPRO_SESSION_DIR')
    const promptFile = parseOutputPath(createOutput, 'CCG_GPTPRO_PROMPT_FILE')
    const sidebarDir = join(dirname(promptFile), 'sidebar')
    writeSidebarEvidence(
      sidebarDir,
      readFileSync(promptFile, 'utf-8'),
      'Wrong task response.\n',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    )

    const stderr = runPythonFailure(PYTHON!, [
      BRIDGE,
      '--import-session',
      sessionDir,
      '--import-sidebar-evidence',
      sidebarDir,
      '--expected-codex-thread-id',
      '019fa981-725e-7f02-93a7-bb1e1b7aefd3',
    ], root)
    expect(stderr).toMatch(/another Codex task/i)
  })

  it('mode templates include explicit GPT Pro task directives', () => {
    const templateDir = join(PACKAGE_ROOT, 'templates', 'engine', 'tools', 'gptpro', 'templates')
    const plan = readFileSync(join(templateDir, 'plan.md'), 'utf-8')
    const review = readFileSync(join(templateDir, 'review.md'), 'utf-8')
    const exc = readFileSync(join(templateDir, 'exc.md'), 'utf-8')

    expect(plan).toContain('## Task For GPT Pro')
    expect(plan).toContain('review the current plan for requirement ambiguity')
    expect(plan).toContain('implementation details that should be added to the plan')
    expect(review).toContain('## Task For GPT Pro')
    expect(review).toContain('review the submitted scope for concrete defects')
    expect(review).toContain('specific tests or verification needed before merge')
    expect(exc).toContain('## Task For GPT Pro')
    expect(exc).toContain('decide whether the current execution route should proceed')
    expect(exc).toContain('supplement the route with')
  })

  it('documents the Trellis task adapter without creating a second lifecycle authority', () => {
    const surfaces = [
      'docs/gptpro-manual-bridge.md',
      'plugins/ccg/skills/ccg-gptpro-bridge/SKILL.md',
      'templates/commands/gptpro-plan.md',
      'templates/commands/gptpro-review.md',
      'templates/commands/gptpro-exc.md',
      'plugins/ccg/commands/gptpro-plan.md',
      'plugins/ccg/commands/gptpro-review.md',
      'plugins/ccg/commands/gptpro-exc.md',
    ]
    for (const relativePath of surfaces) {
      const content = readFileSync(join(PACKAGE_ROOT, ...relativePath.split('/')), 'utf-8')
      expect(content, relativePath).toContain('.trellis/tasks/<task-id>')
      expect(content, relativePath).toContain('.ccg-evidence')
    }
  })

  it('keeps conditional Grok evidence ahead of ordinary GPT Pro workflow routing on every surface', () => {
    const surfaces = [
      ['templates/commands/gptpro-plan.md', 'Run the Grok intelligence decision', 'Then run ordinary `/ccg:plan`'],
      ['templates/commands/gptpro-exc.md', 'Run the Grok intelligence decision', 'Then run ordinary'],
      ['templates/commands/gptpro-review.md', 'Only when a conclusion depends on a current external fact', 'Then run ordinary `/ccg:review`'],
      ['plugins/ccg/commands/gptpro-plan.md', 'Run the Grok intelligence decision', 'Then run ordinary `/ccg:plan`'],
      ['plugins/ccg/commands/gptpro-exc.md', 'Run the Grok intelligence decision', 'Then run ordinary'],
      ['plugins/ccg/commands/gptpro-review.md', 'Only when a conclusion depends on a current external fact', 'Then run ordinary `/ccg:review`'],
      ['plugins/ccg/skills/ccg-gptpro-plan/SKILL.md', 'Before ordinary planning', 'Run ordinary `/ccg:plan`'],
      ['plugins/ccg/skills/ccg-gptpro-exc/SKILL.md', 'Before ordinary execution', 'Preserve the current CCG orchestrator'],
      ['plugins/ccg/skills/ccg-gptpro-review/SKILL.md', 'Only when a conclusion depends on a current external fact', 'Run ordinary `/ccg:review`'],
    ] as const

    for (const [relativePath, grokMarker, ordinaryMarker] of surfaces) {
      const content = readFileSync(join(PACKAGE_ROOT, ...relativePath.split('/')), 'utf8')
      expect(content, relativePath).toContain('--require-external-intelligence')
      expect(content, relativePath).toContain('--expected-intelligence-mode')
      expect(content, relativePath).toContain('--expected-intelligence-depth')
      expect(content, relativePath).toContain('status=valid')
      expect(content, relativePath).toMatch(/waived/i)
      expect(content.indexOf(grokMarker), relativePath).toBeGreaterThanOrEqual(0)
      expect(content.indexOf(grokMarker), relativePath).toBeLessThan(content.indexOf(ordinaryMarker))
      expect(content, relativePath).toMatch(/exit `?2(?:`, `3`, or `4|\/3\/4)/i)
    }
  })

  maybeIt('validates canonical Grok provenance and forwards only concise evidence to GPT Pro', () => {
    const root = join(TMP_ROOT, 'grok-canonical-evidence')
    const taskDir = join(root, '.ccg', 'tasks', 'grok-task')
    fs.ensureDirSync(taskDir)
    fs.writeJsonSync(join(taskDir, 'task.json'), { id: 'grok-task', status: 'in_progress' })
    writeGrokExternalEvidence(root, taskDir)

    const output = runPython(PYTHON!, [
      BRIDGE,
      '--mode',
      'exc',
      '--workdir',
      root,
      '--task-dir',
      '.ccg/tasks/grok-task',
      '--prompt',
      'Review the execution route against current external facts.',
      '--require-external-intelligence',
      '--expected-intelligence-mode',
      'contract',
      '--expected-intelligence-depth',
      'normal',
    ], root)
    const statusFile = parseOutputPath(output, 'CCG_GPTPRO_STATUS_FILE')
    const promptFile = parseOutputPath(output, 'CCG_GPTPRO_PROMPT_FILE')
    const status = fs.readJsonSync(statusFile)
    expect(status.external_intelligence).toMatchObject({
      provider: 'grok',
      role: 'external-intelligence',
      requirement: 'required',
      status: 'valid',
      mode: 'contract',
      evidence_id: 'grok-contract-1',
    })
    const prompt = readFileSync(promptFile, 'utf8')
    expect(prompt).toContain('Validated Grok External Intelligence')
    expect(prompt).toContain('The current official contract remains supported.')
    expect(prompt).toContain('https://docs.example.test/current-contract')
    expect(prompt).not.toContain('RAW_DO_NOT_FORWARD')
  })

  maybeIt('accepts review evidence only when verify semantics bind the current non-empty diff', () => {
    const root = join(TMP_ROOT, 'grok-review-diff-evidence')
    const taskDir = join(root, '.ccg', 'tasks', 'grok-task')
    fs.ensureDirSync(taskDir)
    fs.writeJsonSync(join(taskDir, 'task.json'), { id: 'grok-task', status: 'in_progress' })
    const diff = '+current verified change\n'
    fs.writeFileSync(join(root, 'change.diff'), diff)
    fs.writeFileSync(join(taskDir, 'gemini-review.md'), 'Gemini independently reviewed the current diff.\n')
    const binding = { kind: 'diff', path: 'change.diff', sha256: sha256(diff), bytes: Buffer.byteLength(diff), empty: false }
    writeGrokExternalEvidence(root, taskDir, {
      decision: { action: 'verify' },
      evidence: { action: 'verify', bindings: [binding] },
      manifest: { action: 'verify', bindings: [binding] },
      item: { action: 'verify' },
      pointer: { action: 'verify' },
    })
    writeGeminiGateEvidence(taskDir, 'gemini-review.md', 'Gemini independently reviewed the current diff.\n')
    const output = runPython(PYTHON!, [
      BRIDGE,
      '--mode',
      'review',
      '--workdir',
      root,
      '--task-dir',
      '.ccg/tasks/grok-task',
      '--prompt',
      'Review the bound current diff.',
      '--gemini-response-file',
      join(taskDir, 'gemini-review.md'),
      '--gemini-summary',
      'Gemini review evidence is available.',
      '--require-external-intelligence',
      '--expected-intelligence-mode',
      'contract',
      '--expected-intelligence-depth',
      'normal',
    ], root)
    const status = fs.readJsonSync(parseOutputPath(output, 'CCG_GPTPRO_STATUS_FILE'))
    expect(status.external_intelligence).toMatchObject({ action: 'verify', verification_outcome: 'verified' })
  })

  maybeIt.each([
    ['wrong role', { item: { role: 'review' } }, /missing required grok\/external-intelligence/i],
    ['wrong policy', { item: { policy: 'preferred' } }, /missing required grok\/external-intelligence/i],
    ['path escape', { item: { artifactFile: '../../outside.json' } }, /outside the active task directory|did not validate/i],
    ['artifact hash mismatch', { item: { artifactSha256: '0'.repeat(64) } }, /evidence hash mismatch/i],
    ['manifest hash mismatch', { item: { manifestSha256: '0'.repeat(64) } }, /manifest hash mismatch/i],
    ['nonlocal evidence item', { item: { localOnly: false } }, /local-only and unexported/i],
    ['task pointer drift', { pointer: { manifest_sha256: '0'.repeat(64) } }, /task pointer drift/i],
    ['task locality pointer drift', { pointer: { localOnly: false } }, /task pointer drift/i],
    ['manifest identity drift', { item: { id: 'grok-external-intelligence-other' } }, /does not bind/i],
    ['waiver without user metadata', { decision: { status: 'waived' } }, /explicit user waiver metadata/i],
    ['action drift', { decision: { action: 'verify' } }, /action/i],
    ['caller mode mismatch', {
      decision: { investigation_mode: 'incident', mode: 'incident' },
      evidence: { investigation_mode: 'incident' },
      manifest: { investigation_mode: 'incident' },
      item: { investigationMode: 'incident' },
      pointer: { investigation_mode: 'incident' },
    }, /investigation mode|handoff/i],
    ['unresolved verification outcome', {
      decision: { verification_outcome: 'unresolved' },
      evidence: { claims: [{ id: 'claim-none', claim: 'No applicable fact.', status: 'unresolved', severity: 'info', source_ids: [] }] },
      manifest: { validation_outcome: 'unresolved', verification_outcome: 'unresolved' },
    }, /verification outcome|qualifying claim/i],
    ['stale evidence', {
      decision: { created_at: '2026-01-01T00:00:00.000Z' },
      manifest: { createdAt: '2026-01-01T00:00:00.000Z' },
    }, /stale|freshness/i],
  ])('rejects canonical Grok evidence with %s', (_label, evidenceOptions, expected) => {
    const root = join(TMP_ROOT, `grok-reject-${String(_label).replace(/\s+/g, '-')}`)
    const taskDir = join(root, '.ccg', 'tasks', 'grok-task')
    fs.ensureDirSync(taskDir)
    fs.writeJsonSync(join(taskDir, 'task.json'), { id: 'grok-task', status: 'in_progress' })
    writeGrokExternalEvidence(root, taskDir, evidenceOptions as any)
    const stderr = runPythonFailure(PYTHON!, [
      BRIDGE,
      '--mode',
      'exc',
      '--workdir',
      root,
      '--task-dir',
      '.ccg/tasks/grok-task',
      '--prompt',
      'This bridge must not be created.',
      '--require-external-intelligence',
      '--expected-intelligence-mode',
      'contract',
      '--expected-intelligence-depth',
      'normal',
    ], root)
    expect(stderr).toMatch(expected as RegExp)
    expect(fs.pathExistsSync(join(taskDir, 'gptpro'))).toBe(false)
  })

  maybeIt('recomputes bound file digests before accepting Grok evidence', () => {
    const root = join(TMP_ROOT, 'grok-binding-drift')
    const taskDir = join(root, '.ccg', 'tasks', 'grok-task')
    fs.ensureDirSync(taskDir)
    fs.writeJsonSync(join(taskDir, 'task.json'), { id: 'grok-task', status: 'in_progress' })
    fs.writeFileSync(join(root, 'package.json'), '{"version":1}\n')
    const binding = { kind: 'dependency', path: 'package.json', sha256: sha256('{"version":1}\n'), bytes: Buffer.byteLength('{"version":1}\n') }
    writeGrokExternalEvidence(root, taskDir, {
      evidence: { bindings: [binding] },
      manifest: { bindings: [binding] },
    })
    fs.writeFileSync(join(root, 'package.json'), '{"version":2}\n')
    const stderr = runPythonFailure(PYTHON!, [
      BRIDGE,
      '--mode',
      'exc',
      '--workdir',
      root,
      '--task-dir',
      '.ccg/tasks/grok-task',
      '--prompt',
      'This bridge must reject stale bindings.',
      '--require-external-intelligence',
      '--expected-intelligence-mode',
      'contract',
      '--expected-intelligence-depth',
      'normal',
    ], root)
    expect(stderr).toMatch(/binding|digest|sha256/i)
    expect(fs.pathExistsSync(join(taskDir, 'gptpro'))).toBe(false)
  })

  maybeIt('requires the caller to declare expected Grok mode and depth', () => {
    const root = join(TMP_ROOT, 'grok-missing-expectations')
    const taskDir = join(root, '.ccg', 'tasks', 'grok-task')
    fs.ensureDirSync(taskDir)
    fs.writeJsonSync(join(taskDir, 'task.json'), { id: 'grok-task', status: 'in_progress' })
    writeGrokExternalEvidence(root, taskDir)
    const stderr = runPythonFailure(PYTHON!, [
      BRIDGE,
      '--mode',
      'exc',
      '--workdir',
      root,
      '--task-dir',
      '.ccg/tasks/grok-task',
      '--prompt',
      'This bridge must require explicit expected semantics.',
      '--require-external-intelligence',
    ], root)
    expect(stderr).toMatch(/explicit expected mode and depth/i)
    expect(fs.pathExistsSync(join(taskDir, 'gptpro'))).toBe(false)
  })

  maybeIt('stores bridge evidence in an adapter-owned directory for a Trellis task', () => {
    const root = join(TMP_ROOT, 'trellis-task-root')
    const taskDir = join(root, '.trellis', 'tasks', '07-25-harness-review')
    const evidenceDir = join(taskDir, '.ccg-evidence', 'evidence')
    fs.ensureDirSync(evidenceDir)
    const task = {
      id: '07-25-harness-review',
      title: 'Review the Harness',
      status: 'in_progress',
    }
    fs.writeJsonSync(join(taskDir, 'task.json'), task)
    const geminiResponse = 'Gemini reviewed the current Harness diff.'
    writeFileSync(join(evidenceDir, 'gemini.md'), geminiResponse, 'utf-8')
    writeGeminiGateEvidence(
      taskDir,
      '.ccg-evidence/evidence/gemini.md',
      geminiResponse,
      '.ccg-evidence/evidence.json',
    )

    const output = runPython(PYTHON!, [
      BRIDGE,
      '--mode',
      'review',
      '--workdir',
      root,
      '--task-dir',
      '.trellis/tasks/07-25-harness-review',
      '--prompt',
      'Review the Trellis-owned task without creating CCG task authority.',
      '--gemini-response-file',
      join(evidenceDir, 'gemini.md'),
      '--gemini-summary',
      'Gemini review evidence is available.',
    ], root)

    const statusFile = parseOutputPath(output, 'CCG_GPTPRO_STATUS_FILE')
    const status = fs.readJsonSync(statusFile)
    expect(status.task_dir).toBe('.trellis/tasks/07-25-harness-review')
    expect(status.session_dir).toContain('.trellis/tasks/07-25-harness-review/.ccg-evidence/gptpro/')
    expect(status.evidence_file).toBe('.trellis/tasks/07-25-harness-review/.ccg-evidence/evidence.json')
    expect(fs.readJsonSync(join(taskDir, 'task.json'))).toEqual(task)
    expect(fs.pathExistsSync(join(taskDir, 'evidence.json'))).toBe(false)
    expect(fs.pathExistsSync(join(taskDir, 'gptpro'))).toBe(false)
  })

  maybeIt('rejects an active task directory outside the declared workdir', () => {
    const root = join(TMP_ROOT, 'task-boundary-root')
    const outsideTask = join(TMP_ROOT, 'outside-task')
    fs.ensureDirSync(root)
    fs.ensureDirSync(outsideTask)
    fs.writeJsonSync(join(outsideTask, 'task.json'), { id: 'outside-task', status: 'in_progress' })

    const stderr = runPythonFailure(PYTHON!, [
      BRIDGE,
      '--mode',
      'exc',
      '--workdir',
      root,
      '--task-dir',
      outsideTask,
      '--prompt',
      'This bridge must not escape the workdir.',
    ], root)
    expect(stderr).toMatch(/must be a direct child/i)
    expect(fs.pathExistsSync(join(outsideTask, 'gptpro'))).toBe(false)
  })

  maybeIt('creates task-local review artifacts and records saved response evidence', () => {
    const root = join(TMP_ROOT, 'review-session')
    const taskDir = join(root, '.ccg', 'tasks', 'demo-task')
    const evidenceDir = join(taskDir, 'evidence')
    fs.ensureDirSync(evidenceDir)
    fs.writeJsonSync(join(taskDir, 'task.json'), {
      id: 'demo-task',
      status: 'in_progress',
      currentPhase: 'review',
      nextAction: 'run GPT Pro review',
    })
    const geminiResponse = 'Gemini gate evidence: review the packaging path.'
    writeFileSync(join(evidenceDir, 'gemini.md'), geminiResponse, 'utf-8')
    writeFileSync(join(evidenceDir, 'gemini-summary.md'), 'Gemini says packaging must be checked.', 'utf-8')
    writeGeminiGateEvidence(taskDir, 'evidence/gemini.md', geminiResponse)
    const routing = writeRoutingEvidence(evidenceDir)

    const output = runPython(PYTHON!, [
      BRIDGE,
      '--mode',
      'review',
      '--workdir',
      root,
      '--task-dir',
      '.ccg/tasks/demo-task',
      '--source-command',
      '/ccg:gptpro-review',
      '--prompt',
      'Review this migration.',
      '--slug',
      'demo-task-review',
      '--gemini-policy',
      'required',
      '--gemini-evidence-role',
      'gate',
      '--gemini-response-file',
      join(evidenceDir, 'gemini.md'),
      '--gemini-summary-file',
      join(evidenceDir, 'gemini-summary.md'),
      '--routing-evidence-file',
      routing.evidenceFile,
      '--routing-summary-file',
      routing.summaryFile,
      '--require-routing-evidence',
      '--require-claude-evidence',
    ], root)

    const statusFile = parseOutputPath(output, 'CCG_GPTPRO_STATUS_FILE')
    const promptFile = parseOutputPath(output, 'CCG_GPTPRO_PROMPT_FILE')
    const status = fs.readJsonSync(statusFile)
    expect(status.session_dir).toContain('.ccg/tasks/demo-task/gptpro/')
    expect(status.task_dir).toBe('.ccg/tasks/demo-task')
    expect(status.evidence_file).toBe('.ccg/tasks/demo-task/evidence.json')
    expect(status.source_command).toBe('/ccg:gptpro-review')
    expect(status.routing_evidence).toMatchObject({
      required: true,
      available: true,
      evidence_file: '.ccg/tasks/demo-task/evidence/routing.md',
      evidence_sha256: sha256(routing.content),
      evidence_chars: routing.content.length,
      summary_file: '.ccg/tasks/demo-task/evidence/routing-summary.md',
      summary: routing.summary,
      summary_chars: routing.summary.length,
      claudeEvidenceStatus: 'automatic',
    })
    const promptText = readFileSync(promptFile, 'utf-8')
    expect(promptText).toContain('Project Access Context')
    expect(promptText).toContain('Repository URL: not provided')
    expect(promptText).toContain('Current branch: unknown')
    expect(promptText).toContain('Current commit: unknown')
    expect(promptText).toContain('Local git status: not_git')
    expect(promptText).toContain('High-Value Review Second Opinion')
    expect(promptText).toContain('Task For GPT Pro')
    expect(promptText).toContain('review the submitted scope for concrete defects')
    expect(promptText).toContain('specific tests or verification needed before merge')
    expect(promptText).toContain('Critical')
    expect(promptText).toContain('False Positives')
    expect(promptText).toContain('Required Tests')
    expect(promptText).toContain('Base CCG Routing Evidence')
    expect(promptText).toContain('Routing evidence file: .ccg/tasks/demo-task/evidence/routing.md')
    expect(promptText).toContain('Claude evidence status: automatic')
    expect(promptText).toContain(routing.summary)

    const manualResponse = 'Manual GPT Pro response: 响应\n'
    const saveScript = [
      'import importlib.util, pathlib, sys',
      'spec = importlib.util.spec_from_file_location("gptpro_bridge", sys.argv[1])',
      'mod = importlib.util.module_from_spec(spec)',
      'sys.modules["gptpro_bridge"] = mod',
      'spec.loader.exec_module(mod)',
      'session = mod.load_session(pathlib.Path(sys.argv[2]).parent)',
      `mod.save_response(session, ${JSON.stringify(manualResponse)})`,
    ].join('; ')
    runPython(PYTHON!, ['-c', saveScript, BRIDGE, statusFile], root)

    const updatedStatus = fs.readJsonSync(statusFile)
    const roundStatus = updatedStatus.rounds['round-1']
    expect(roundStatus.response_saved).toBe(true)
    expect(roundStatus.response_chars).toBe(manualResponse.length)
    expect(roundStatus.response_bytes).toBe(Buffer.byteLength(manualResponse, 'utf-8'))
    expect(roundStatus.response_sha256).toMatch(/^[a-f0-9]{64}$/)

    const evidence = fs.readJsonSync(join(taskDir, 'evidence.json'))
    const gptproEvidence = evidence.items.find((item: any) => item.provider === 'gptpro')
    expect(evidence.items).toHaveLength(2)
    expect(gptproEvidence).toMatchObject({
      provider: 'gptpro',
      role: 'review',
      available: true,
      artifactFile: expect.stringContaining('round-1/response.md'),
    })
    expect(gptproEvidence.artifactSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(gptproEvidence.artifactChars).toBe(manualResponse.length)
    expect(gptproEvidence.artifactBytes).toBe(Buffer.byteLength(manualResponse, 'utf-8'))
    expect(gptproEvidence.artifactBytes).toBeGreaterThan(gptproEvidence.artifactChars)
  })

  maybeIt('inherits required routing evidence for follow-up sessions without fresh routing files', () => {
    const root = join(TMP_ROOT, 'routing-followup-session')
    const taskDir = join(root, '.ccg', 'tasks', 'followup-task')
    const evidenceDir = join(taskDir, 'evidence')
    fs.ensureDirSync(evidenceDir)
    fs.writeJsonSync(join(taskDir, 'task.json'), {
      id: 'followup-task',
      status: 'in_progress',
      currentPhase: 'review',
      nextAction: 'run GPT Pro follow-up review',
    })
    const geminiResponse = 'Gemini gate evidence: review follow-up inheritance.'
    writeFileSync(join(evidenceDir, 'gemini.md'), geminiResponse, 'utf-8')
    writeFileSync(join(evidenceDir, 'gemini-summary.md'), 'Gemini says follow-up inheritance is relevant.', 'utf-8')
    writeGeminiGateEvidence(taskDir, 'evidence/gemini.md', geminiResponse)
    const routing = writeRoutingEvidence(evidenceDir)

    const roundOneOutput = runPython(PYTHON!, [
      BRIDGE,
      '--mode',
      'review',
      '--workdir',
      root,
      '--task-dir',
      '.ccg/tasks/followup-task',
      '--prompt',
      'Review round one.',
      '--slug',
      'followup-task-review',
      '--gemini-response-file',
      join(evidenceDir, 'gemini.md'),
      '--gemini-summary-file',
      join(evidenceDir, 'gemini-summary.md'),
      '--routing-evidence-file',
      routing.evidenceFile,
      '--routing-summary-file',
      routing.summaryFile,
      '--require-routing-evidence',
      '--require-claude-evidence',
    ], root)
    const sessionDir = parseOutputPath(roundOneOutput, 'CCG_GPTPRO_SESSION_DIR')

    const roundTwoOutput = runPython(PYTHON!, [
      BRIDGE,
      '--mode',
      'review',
      '--workdir',
      root,
      '--task-dir',
      '.ccg/tasks/followup-task',
      '--prompt',
      'Review round two without fresh routing files.',
      '--followup-session',
      sessionDir,
      '--followup-reason',
      'Re-check after revised review notes.',
      '--require-routing-evidence',
      '--require-claude-evidence',
    ], root)
    const statusFile = parseOutputPath(roundTwoOutput, 'CCG_GPTPRO_STATUS_FILE')
    const promptFile = parseOutputPath(roundTwoOutput, 'CCG_GPTPRO_PROMPT_FILE')
    const status = fs.readJsonSync(statusFile)

    expect(status.current_round).toBe(2)
    expect(status.rounds['round-2']).toBeDefined()
    expect(status.routing_evidence).toMatchObject({
      required: true,
      available: true,
      inherited_from_round: 1,
      evidence_file: '.ccg/tasks/followup-task/evidence/routing.md',
      summary: routing.summary,
      claudeEvidenceStatus: 'automatic',
    })
    const promptText = readFileSync(promptFile, 'utf-8')
    expect(promptText).toContain('Base CCG Routing Evidence')
    expect(promptText).toContain('Routing evidence file: .ccg/tasks/followup-task/evidence/routing.md')
    expect(promptText).toContain('Claude evidence status: automatic')
    expect(promptText).toContain(routing.summary)
  })

  maybeIt('rejects required Claude evidence when routing evidence lacks a valid status', () => {
    const root = join(TMP_ROOT, 'missing-claude-status')
    const taskDir = join(root, '.ccg', 'tasks', 'missing-claude-task')
    const evidenceDir = join(taskDir, 'evidence')
    fs.ensureDirSync(evidenceDir)
    fs.writeJsonSync(join(taskDir, 'task.json'), { id: 'missing-claude-task', status: 'in_progress' })
    const routing = writeRoutingEvidence(evidenceDir, null)

    const stderr = runPythonFailure(PYTHON!, [
      BRIDGE,
      '--mode',
      'exc',
      '--workdir',
      root,
      '--task-dir',
      '.ccg/tasks/missing-claude-task',
      '--prompt',
      'Create a manual GPT Pro execution route review.',
      '--gemini-policy',
      'optional',
      '--gemini-evidence-role',
      'frontend-prototype',
      '--routing-evidence-file',
      routing.evidenceFile,
      '--routing-summary-file',
      routing.summaryFile,
      '--require-routing-evidence',
      '--require-claude-evidence',
    ], root)
    expect(stderr).toContain('claudeEvidenceStatus is required')
  })

  maybeIt('accepts Markdown bullet or backtick Claude evidence status lines', () => {
    const root = join(TMP_ROOT, 'markdown-claude-status')
    const taskDir = join(root, '.ccg', 'tasks', 'markdown-claude-task')
    const evidenceDir = join(taskDir, 'evidence')
    fs.ensureDirSync(evidenceDir)
    fs.writeJsonSync(join(taskDir, 'task.json'), { id: 'markdown-claude-task', status: 'in_progress' })
    const routing = writeRoutingEvidence(evidenceDir, null, '- `claudeEvidenceStatus: manual_handoff`')

    const output = runPython(PYTHON!, [
      BRIDGE,
      '--mode',
      'exc',
      '--workdir',
      root,
      '--task-dir',
      '.ccg/tasks/markdown-claude-task',
      '--prompt',
      'Create a manual GPT Pro execution route review.',
      '--gemini-policy',
      'optional',
      '--gemini-evidence-role',
      'frontend-prototype',
      '--routing-evidence-file',
      routing.evidenceFile,
      '--routing-summary-file',
      routing.summaryFile,
      '--require-routing-evidence',
      '--require-claude-evidence',
    ], root)

    const statusFile = parseOutputPath(output, 'CCG_GPTPRO_STATUS_FILE')
    const promptFile = parseOutputPath(output, 'CCG_GPTPRO_PROMPT_FILE')
    const status = fs.readJsonSync(statusFile)
    expect(status.routing_evidence).toMatchObject({
      available: true,
      claudeEvidenceStatus: 'manual_handoff',
    })
    const promptText = readFileSync(promptFile, 'utf-8')
    expect(promptText).toContain('Claude evidence status: manual_handoff')
  })

  maybeIt('records execution route review metadata while preserving the legacy evidence role', () => {
    const root = join(TMP_ROOT, 'execution-route-review-evidence')
    const taskDir = join(root, '.ccg', 'tasks', 'route-review-task')
    const evidenceDir = join(taskDir, 'evidence')
    fs.ensureDirSync(evidenceDir)
    fs.writeJsonSync(join(taskDir, 'task.json'), { id: 'route-review-task', status: 'in_progress' })
    const routing = writeRoutingEvidence(evidenceDir, 'manual_handoff')

    const output = runPython(PYTHON!, [
      BRIDGE,
      '--mode',
      'exc',
      '--workdir',
      root,
      '--task-dir',
      '.ccg/tasks/route-review-task',
      '--prompt',
      'Create a manual GPT Pro execution route review.',
      '--slug',
      'route-review-task-exc',
      '--gemini-policy',
      'optional',
      '--gemini-evidence-role',
      'frontend-prototype',
      '--routing-evidence-file',
      routing.evidenceFile,
      '--routing-summary-file',
      routing.summaryFile,
      '--require-routing-evidence',
      '--require-claude-evidence',
    ], root)

    const statusFile = parseOutputPath(output, 'CCG_GPTPRO_STATUS_FILE')
    const promptFile = parseOutputPath(output, 'CCG_GPTPRO_PROMPT_FILE')
    const status = fs.readJsonSync(statusFile)
    expect(status.routing_evidence).toMatchObject({
      required: true,
      available: true,
      claudeEvidenceStatus: 'manual_handoff',
    })
    const promptText = readFileSync(promptFile, 'utf-8')
    expect(promptText).toContain('Task For GPT Pro')
    expect(promptText).toContain('decide whether the current execution route should proceed')
    expect(promptText).toContain('supplement the route with')

    const saveScript = [
      'import importlib.util, pathlib, sys',
      'spec = importlib.util.spec_from_file_location("gptpro_bridge", sys.argv[1])',
      'mod = importlib.util.module_from_spec(spec)',
      'sys.modules["gptpro_bridge"] = mod',
      'spec.loader.exec_module(mod)',
      'session = mod.load_session(pathlib.Path(sys.argv[2]).parent)',
      'mod.save_response(session, "Manual GPT Pro execution route review response\\n")',
    ].join('; ')
    runPython(PYTHON!, ['-c', saveScript, BRIDGE, statusFile], root)

    const evidence = fs.readJsonSync(join(taskDir, 'evidence.json'))
    const gptproEvidence = evidence.items.find((item: any) => item.provider === 'gptpro')
    expect(gptproEvidence).toMatchObject({
      provider: 'gptpro',
      role: 'execution-companion',
      displayRole: 'execution-route-review',
      semanticRole: 'route-review',
      implementationOwner: false,
      available: true,
      artifactFile: expect.stringContaining('round-1/response.md'),
    })
    expect(gptproEvidence.summary).toContain('execution route review response saved')
  })

  maybeIt('rejects an empty saved response', () => {
    const root = join(TMP_ROOT, 'empty-response')
    const taskDir = join(root, '.ccg', 'tasks', 'empty-task')
    const evidenceDir = join(taskDir, 'evidence')
    fs.ensureDirSync(evidenceDir)
    fs.writeJsonSync(join(taskDir, 'task.json'), { id: 'empty-task', status: 'in_progress' })
    const geminiResponse = 'Gemini evidence'
    writeFileSync(join(evidenceDir, 'gemini.md'), geminiResponse, 'utf-8')
    writeGeminiGateEvidence(taskDir, 'evidence/gemini.md', geminiResponse)

    const output = runPython(PYTHON!, [
      BRIDGE,
      '--mode',
      'review',
      '--workdir',
      root,
      '--task-dir',
      '.ccg/tasks/empty-task',
      '--prompt',
      'Review this empty response guard.',
      '--gemini-response-file',
      join(evidenceDir, 'gemini.md'),
      '--gemini-summary',
      'Gemini evidence is available.',
    ], root)
    const statusFile = parseOutputPath(output, 'CCG_GPTPRO_STATUS_FILE')
    const emptyScript = [
      'import importlib.util, pathlib, sys',
      'spec = importlib.util.spec_from_file_location("gptpro_bridge", sys.argv[1])',
      'mod = importlib.util.module_from_spec(spec)',
      'sys.modules["gptpro_bridge"] = mod',
      'spec.loader.exec_module(mod)',
      'session = mod.load_session(pathlib.Path(sys.argv[2]).parent)',
      'try:',
      '    mod.save_response(session, "   ")',
      'except ValueError:',
      '    sys.exit(0)',
      'sys.exit(1)',
    ].join('\n')
    runPython(PYTHON!, ['-c', emptyScript, BRIDGE, statusFile], root)
  })

  maybeIt.each(['plan', 'review'] as const)('allows %s sessions without Gemini when routed evidence is present', (mode) => {
    const root = join(TMP_ROOT, `${mode}-without-gemini`)
    const taskId = `${mode}-without-gemini-task`
    const taskDir = join(root, '.ccg', 'tasks', taskId)
    const evidenceDir = join(taskDir, 'evidence')
    fs.ensureDirSync(evidenceDir)
    fs.writeJsonSync(join(taskDir, 'task.json'), { id: taskId, status: 'in_progress' })
    const routing = writeRoutingEvidence(evidenceDir)

    const output = runPython(PYTHON!, [
      PLUGIN_BRIDGE,
      '--mode',
      mode,
      '--workdir',
      root,
      '--task-dir',
      `.ccg/tasks/${taskId}`,
      '--prompt',
      `${mode} using the configured role providers.`,
      '--routing-evidence-file',
      routing.evidenceFile,
      '--routing-summary-file',
      routing.summaryFile,
      '--require-routing-evidence',
    ], root)
    const status = fs.readJsonSync(parseOutputPath(output, 'CCG_GPTPRO_STATUS_FILE'))
    expect(status.gemini_evidence).toMatchObject({
      policy: 'optional',
      role: 'gate',
      available: false,
    })
    expect(status.routing_evidence).toMatchObject({
      required: true,
      available: true,
    })
  })

  maybeIt.each([
    ['engine', BRIDGE],
    ['plugin', PLUGIN_BRIDGE],
  ] as const)('defaults direct %s plan sessions to optional Gemini evidence', (_surface, bridge) => {
    const root = join(TMP_ROOT, `direct-${_surface}-plan-without-gemini`)
    fs.ensureDirSync(root)
    const output = runPython(PYTHON!, [
      bridge,
      '--mode',
      'plan',
      '--workdir',
      root,
      '--output-root',
      join(root, 'sessions'),
      '--prompt',
      'Review this direct bridge plan without requiring Gemini.',
    ], root)
    const status = fs.readJsonSync(parseOutputPath(output, 'CCG_GPTPRO_STATUS_FILE'))
    expect(status.gemini_evidence).toMatchObject({
      policy: 'optional',
      role: 'gate',
      available: false,
    })
  })

  maybeIt('rejects plan/review sessions without canonical Gemini gate evidence', () => {
    const root = join(TMP_ROOT, 'missing-canonical-gemini')
    const taskDir = join(root, '.ccg', 'tasks', 'missing-gate-task')
    const evidenceDir = join(taskDir, 'evidence')
    fs.ensureDirSync(evidenceDir)
    fs.writeJsonSync(join(taskDir, 'task.json'), { id: 'missing-gate-task', status: 'in_progress' })
    writeFileSync(join(evidenceDir, 'gemini.md'), 'Gemini evidence without canonical item', 'utf-8')

    const stderr = runPythonFailure(PYTHON!, [
      BRIDGE,
      '--mode',
      'review',
      '--workdir',
      root,
      '--task-dir',
      '.ccg/tasks/missing-gate-task',
      '--prompt',
      'Review canonical evidence enforcement.',
      '--gemini-response-file',
      join(evidenceDir, 'gemini.md'),
      '--gemini-summary',
      'Gemini evidence is available.',
    ], root)
    expect(stderr).toContain('Canonical Gemini gate evidence file not found')
  })

  maybeIt('rejects required routing evidence when the file is missing', () => {
    const root = join(TMP_ROOT, 'missing-routing-evidence')
    const taskDir = join(root, '.ccg', 'tasks', 'missing-routing-task')
    fs.ensureDirSync(taskDir)
    fs.writeJsonSync(join(taskDir, 'task.json'), { id: 'missing-routing-task', status: 'in_progress' })

    const stderr = runPythonFailure(PYTHON!, [
      BRIDGE,
      '--mode',
      'exc',
      '--workdir',
      root,
      '--task-dir',
      '.ccg/tasks/missing-routing-task',
      '--prompt',
      'Create a manual GPT Pro execution second opinion.',
      '--gemini-policy',
      'optional',
      '--gemini-evidence-role',
      'frontend-prototype',
      '--require-routing-evidence',
    ], root)
    expect(stderr).toContain('Base CCG routing evidence file is required')
  })

  maybeIt('protects preview write endpoints with a token and response size limit', () => {
    const root = join(TMP_ROOT, 'preview-protection')
    const taskDir = join(root, '.ccg', 'tasks', 'preview-task')
    const evidenceDir = join(taskDir, 'evidence')
    fs.ensureDirSync(evidenceDir)
    fs.writeJsonSync(join(taskDir, 'task.json'), { id: 'preview-task', status: 'in_progress' })
    const geminiResponse = 'Gemini gate evidence for preview protection.'
    writeFileSync(join(evidenceDir, 'gemini.md'), geminiResponse, 'utf-8')
    writeGeminiGateEvidence(taskDir, 'evidence/gemini.md', geminiResponse)

    const output = runPython(PYTHON!, [
      BRIDGE,
      '--mode',
      'review',
      '--workdir',
      root,
      '--task-dir',
      '.ccg/tasks/preview-task',
      '--prompt',
      'Review preview protection.',
      '--gemini-response-file',
      join(evidenceDir, 'gemini.md'),
      '--gemini-summary',
      'Gemini evidence is available.',
    ], root)
    const statusFile = parseOutputPath(output, 'CCG_GPTPRO_STATUS_FILE')
    const serverScript = [
      'import http.client, importlib.util, json, pathlib, sys',
      'spec = importlib.util.spec_from_file_location("gptpro_bridge", sys.argv[1])',
      'mod = importlib.util.module_from_spec(spec)',
      'sys.modules["gptpro_bridge"] = mod',
      'spec.loader.exec_module(mod)',
      'session = mod.load_session(pathlib.Path(sys.argv[2]).parent)',
      'server, url = mod.start_server(session, port=0)',
      'port = server.server_address[1]',
      'def post(headers, body):',
      '    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)',
      '    conn.request("POST", "/save-response", body=body, headers=headers)',
      '    response = conn.getresponse()',
      '    print(response.status)',
      '    response.read()',
      '    conn.close()',
      'def post_declared_length(headers, length):',
      '    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)',
      '    conn.putrequest("POST", "/save-response")',
      '    for key, value in headers.items():',
      '        conn.putheader(key, value)',
      '    conn.putheader("Content-Length", str(length))',
      '    conn.endheaders()',
      '    response = conn.getresponse()',
      '    print(response.status)',
      '    response.read()',
      '    conn.close()',
      'try:',
      '    post({"Content-Type": "application/json"}, json.dumps({"response": "spoof"}).encode("utf-8"))',
      '    token = session.status()["preview_token"]',
      '    post_declared_length({"Content-Type": "application/json", "X-CCG-GPTPRO-Token": token}, -1)',
      '    post_declared_length({"Content-Type": "application/json", "X-CCG-GPTPRO-Token": token}, mod.MAX_RESPONSE_BYTES + 1)',
      '    post({"Content-Type": "application/json", "X-CCG-GPTPRO-Token": token}, json.dumps({"response": "Manual response"}).encode("utf-8"))',
      'finally:',
      '    server.shutdown()',
      '    server.server_close()',
    ].join('\n')
    const result = runPython(PYTHON!, ['-c', serverScript, BRIDGE, statusFile], root)
    expect(result.trim().split(/\r?\n/)).toEqual(['403', '400', '413', '200'])
  }, 20_000)
})
