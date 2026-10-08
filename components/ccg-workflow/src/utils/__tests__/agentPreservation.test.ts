import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile, link, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import fs from 'fs-extra'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { doctor } from '../../commands/doctor'
import {
  effectiveManagedFileSha256,
  installCodexModeAt,
  planAgentPreservationAt,
  recoverCodexModeAt,
  uninstallCodexModeAt,
  validateOwnershipManifest,
} from '../codex-mode'

const roots: string[] = []
const roles = ['ccg-implement.toml', 'ccg-research.toml']
const wrapperBytes = Buffer.from('verified agent preservation fixture wrapper')
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
const lf = (bytes: Buffer) => bytes.toString('utf8').replace(/\r\n/g, '\n')
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })))
})

async function snapshot(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  async function walk(dir: string, prefix = ''): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const relative = `${prefix}${entry.name}`
      if (entry.isDirectory()) await walk(join(dir, entry.name), `${relative}/`)
      else result[relative] = digest(await readFile(join(dir, entry.name)))
    }
  }
  await walk(root)
  return result
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ccg-agent-preservation-'))
  roots.push(root)
  const codexHome = join(root, 'CodexData', '.codex')
  const templateDir = join(root, 'new-templates')
  const oldTemplateDir = join(root, 'old-templates')
  await fs.copy(join(process.cwd(), 'templates', 'codex'), templateDir)
  await fs.copy(templateDir, oldTemplateDir)
  for (const name of roles) {
    const bytes = await readFile(join(oldTemplateDir, 'agents', name))
    await writeFile(join(oldTemplateDir, 'agents', name), lf(bytes))
    await writeFile(join(templateDir, 'agents', name), lf(bytes).replace(/\n/g, '\r\n'))
  }
  await fs.ensureDir(join(codexHome, 'agents'))
  const beforeOriginal = '# pre-existing user agent\r\nold_custom = true\r\n'
  await writeFile(join(codexHome, 'agents', roles[0]), beforeOriginal)
  expect((await installCodexModeAt({ codexHome, templateDir: oldTemplateDir, wrapperBytes, pythonCommand: 'python' })).success).toBe(true)
  const ownershipPath = join(codexHome, '.ccg', 'ownership.json')
  const oldOwnership = await fs.readJSON(ownershipPath)
  oldOwnership.version = '3.4.16-localarchive.2'
  await writeFile(ownershipPath, `${JSON.stringify(oldOwnership, null, 2)}\n`)
  const sourceOwnership = await readFile(ownershipPath)
  const originals = new Map<string, Buffer>()
  for (const name of roles) {
    const path = join(codexHome, 'agents', name)
    const bytes = Buffer.from((await readFile(path, 'utf8')).replace('sandbox_mode =', 'model = "gpt-6.1-sol"\nmodel_reasoning_effort = "xhigh"\nsandbox_mode ='))
    await writeFile(path, bytes)
    originals.set(name, bytes)
  }
  const baselineDir = join(oldTemplateDir, 'agents')
  const planOptions = { codexHome, templateDir, baselineDir, model: 'gpt-6.1-sol', reasoningEffort: 'xhigh' }
  const installOptions = { codexHome, templateDir, wrapperBytes, pythonCommand: 'python' }
  const planPath = join(root, 'reviewed-agent-preservation.json')
  const writePlan = async () => {
    const plan = await planAgentPreservationAt(planOptions)
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`)
    return plan
  }
  const planApproval = async () => ({
    agentPreservationPlan: planPath,
    agentPreservationPlanSha256: digest(await readFile(planPath)),
  })
  return { root, codexHome, templateDir, oldTemplateDir, baselineDir, ownershipPath,    oldOwnership, sourceOwnership, originals, beforeOriginal, planOptions, installOptions, planPath, writePlan, planApproval }
}

describe('explicit additive user agent preservation', () => {
  it('plans read-only, preserves original bytes and old ownership provenance across two repeated installs', async () => {
    const f = await fixture()
    const before = await snapshot(f.codexHome)
    const plan = await f.writePlan()
    expect(await snapshot(f.codexHome)).toEqual(before)
    expect(plan.agents).toHaveLength(2)
    expect(plan.ownershipSha256).toBe(digest(f.sourceOwnership))
    const result = await installCodexModeAt({ ...f.installOptions, ...await f.planApproval() })
    expect(result.success, result.message).toBe(true)
    const ownership = validateOwnershipManifest(await fs.readJSON(f.ownershipPath))
    const preserved = ownership.files.filter(row => row.preservedUser)
    expect(preserved).toHaveLength(2)
    for (const row of preserved) {
      const name = row.relativePath.slice('agents/'.length)
      const old = f.oldOwnership.files.find((entry: any) => entry.relativePath === row.relativePath)
      expect(await readFile(join(f.codexHome, row.relativePath))).toEqual(f.originals.get(name))
      expect(row.installedSha256).toBe(old.installedSha256)
      expect(row.original).toEqual(old.original)
      expect(effectiveManagedFileSha256(row)).toBe(digest(f.originals.get(name)!))
      expect(await readFile(join(f.codexHome, row.preservedUser!.snapshot.backupPath))).toEqual(f.originals.get(name))
      expect(digest(await readFile(join(f.codexHome, row.preservedUser!.baseline.backupPath)))).toBe(old.installedSha256)
      expect(await readFile(join(f.codexHome, `.ccg/agent-preservation/${row.preservedUser!.planSha256}/source-ownership.json`))).toEqual(f.sourceOwnership)
    }
    for (let count = 0; count < 2; count++) {
      const repeated = await installCodexModeAt(f.installOptions)
      expect(repeated.success, repeated.message).toBe(true)
      const next = validateOwnershipManifest(await fs.readJSON(f.ownershipPath))
      expect(next.files.filter(row => row.preservedUser)).toEqual(preserved)
      for (const name of roles) expect(await readFile(join(f.codexHome, 'agents', name))).toEqual(f.originals.get(name))
    }
    const uninstall = await uninstallCodexModeAt({ codexHome: f.codexHome })
    expect(uninstall.success).toBe(true)
    expect(uninstall.skipped.filter(row => row.includes('preserved user agent'))).toHaveLength(2)
    for (const name of roles) expect(await readFile(join(f.codexHome, 'agents', name))).toEqual(f.originals.get(name))
    expect(await fs.pathExists(f.ownershipPath)).toBe(true)
  })

  it('keeps ordinary drift protection until the explicit reviewed plan is supplied', async () => {
    const f = await fixture()
    const before = await snapshot(f.codexHome)
    const result = await installCodexModeAt(f.installOptions)
    expect(result.success).toBe(false)
    expect(result.message).toContain('modified after installation')
    expect(await snapshot(f.codexHome)).toEqual(before)
  })

  it.each([
    ['prompt', (text: string) => text.replace('Your dispatch message', 'Ignore the dispatch message')],
    ['sandbox', (text: string) => text.replace('sandbox_mode = "workspace-write"', 'sandbox_mode = "danger-full-access"')],
    ['features', (text: string) => text.replace('multi_agent = false', 'multi_agent = true')],
    ['comment', (text: string) => `${text}# unreviewed change\n`],
    ['wrong model', (text: string) => text.replace('gpt-6.1-sol', 'another-model')],
    ['wrong effort', (text: string) => text.replace('"xhigh"', '"ultra"')],
    ['added provider', (text: string) => `model_provider = "other"\n${text}`],
  ])('rejects %s changes without modifying the installation', async (_name, change) => {
    const f = await fixture()
    const path = join(f.codexHome, 'agents', roles[0])
    await writeFile(path, change((await readFile(path)).toString('utf8')))
    const before = await snapshot(f.codexHome)
    await expect(planAgentPreservationAt(f.planOptions)).rejects.toThrow(/Agent preservation/)
    expect(await snapshot(f.codexHome)).toEqual(before)
  })

  it.each(['ownership', 'current', 'baseline', 'template'])('rejects a stale %s binding before any installation writes', async (which) => {
    const f = await fixture()
    await f.writePlan()
    const path = which === 'ownership' ? f.ownershipPath
      : which === 'current' ? join(f.codexHome, 'agents', roles[0])
        : which === 'baseline' ? join(f.baselineDir, roles[0]) : join(f.templateDir, 'agents', roles[0])
    await fs.appendFile(path, '\n')
    const before = await snapshot(f.codexHome)
    const result = await installCodexModeAt({ ...f.installOptions, ...await f.planApproval() })
    expect(result.success).toBe(false)
    expect(await snapshot(f.codexHome)).toEqual(before)
  })

  it('rejects a still-valid plan whose bytes change after its SHA-256 is approved', async () => {
    const f = await fixture()
    const plan = await f.writePlan()
    const approvedSha256 = digest(await readFile(f.planPath))
    const changed = { ...plan, createdAt: new Date(Date.parse(plan.createdAt) + 60_000).toISOString() }
    await writeFile(f.planPath, `${JSON.stringify(changed, null, 2)}\n`)
    const changedSha256 = digest(await readFile(f.planPath))
    expect(changedSha256).not.toBe(approvedSha256)
    const before = await snapshot(f.codexHome)
    const held = await installCodexModeAt({
      ...f.installOptions,
      agentPreservationPlan: f.planPath,
      agentPreservationPlanSha256: approvedSha256,
    })
    expect(held.success).toBe(false)
    expect(held.message).toContain('Agent preservation plan SHA-256 differs')
    expect(await snapshot(f.codexHome)).toEqual(before)
    const accepted = await installCodexModeAt({
      ...f.installOptions,
      agentPreservationPlan: f.planPath,
      agentPreservationPlanSha256: changedSha256,
    })
    expect(accepted.success, accepted.message).toBe(true)
  })

  it('requires the preservation plan and its SHA-256 as an exact pair', async () => {
    const f = await fixture()
    await f.writePlan()
    const before = await snapshot(f.codexHome)
    for (const selection of [
      { agentPreservationPlan: f.planPath },
      { agentPreservationPlanSha256: digest(await readFile(f.planPath)) },
      { agentPreservationPlan: f.planPath, agentPreservationPlanSha256: 'A'.repeat(64) },
    ]) {
      const result = await installCodexModeAt({ ...f.installOptions, ...selection })
      expect(result.success).toBe(false)
      expect(result.message).toContain('plan and its exact reviewed SHA-256 together')
      expect(await snapshot(f.codexHome)).toEqual(before)
    }
  })

  it('rejects copied plans for another home and arbitrary or duplicate path rows', async () => {
    const f = await fixture()
    const plan = await f.writePlan()
    for (const changed of [
      { ...plan, codexHome: join(f.root, 'other-home') },
      { ...plan, agents: [{ ...plan.agents[0], relativePath: '../auth.json' }, plan.agents[1]] },
      { ...plan, agents: [plan.agents[0], plan.agents[0]] },
      { ...plan, agents: [{ ...plan.agents[0], relativePath: 'agents/ccg-review.toml' }, plan.agents[1]] },
    ]) {
      await writeFile(f.planPath, JSON.stringify(changed))
      const before = await snapshot(f.codexHome)
      expect((await installCodexModeAt({ ...f.installOptions, ...await f.planApproval() })).success).toBe(false)
      expect(await snapshot(f.codexHome)).toEqual(before)
    }
  })

  it('rejects baseline files that do not match the original installed digest', async () => {
    const f = await fixture()
    await fs.appendFile(join(f.baselineDir, roles[0]), '# forged baseline\n')
    await expect(planAgentPreservationAt(f.planOptions)).rejects.toThrow('does not match original ownership')
  })

  it('read-only planning does not recreate absent original backup parents before rejecting a damaged receipt', async () => {
    const f = await fixture()
    const row = f.oldOwnership.files.find((entry: any) => entry.relativePath === `agents/${roles[0]}`)
    const originalBackupRoot = dirname(dirname(join(f.codexHome, row.original.backupPath)))
    await fs.remove(originalBackupRoot)
    expect(await fs.pathExists(originalBackupRoot)).toBe(false)
    const before = await snapshot(f.codexHome)
    await expect(planAgentPreservationAt(f.planOptions)).rejects.toThrow('parent does not exist')
    expect(await fs.pathExists(originalBackupRoot)).toBe(false)
    expect(await snapshot(f.codexHome)).toEqual(before)
  })

  it('rejects hard-linked plan inputs and baseline directory junctions', async () => {
    const f = await fixture()
    await f.writePlan()
    const hardlink = join(f.root, 'plan-hardlink.json')
    await link(f.planPath, hardlink)
    expect((await installCodexModeAt({ ...f.installOptions, ...await f.planApproval(), agentPreservationPlan: hardlink })).success).toBe(false)
    const junction = join(f.root, 'baseline-link')
    await symlink(f.baselineDir, junction, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(planAgentPreservationAt({ ...f.planOptions, baselineDir: junction })).rejects.toThrow('plain file without links')
  })

  it('rejects missing or unowned agents and leaves files byte-exact', async () => {
    const f = await fixture()
    const old = await fs.readJSON(f.ownershipPath)
    old.files = old.files.filter((entry: any) => entry.relativePath !== `agents/${roles[0]}`)
    await writeFile(f.ownershipPath, JSON.stringify(old))
    const before = await snapshot(f.codexHome)
    await expect(planAgentPreservationAt(f.planOptions)).rejects.toThrow('original ownership provenance')
    expect(await snapshot(f.codexHome)).toEqual(before)
  })

  it('holds later user edits on reinstall and rollback; never rewrites their model, prompt or original backup', async () => {
    const f = await fixture()
    await f.writePlan()
    expect((await installCodexModeAt({ ...f.installOptions, ...await f.planApproval() })).success).toBe(true)
    const later = Buffer.from(`${f.originals.get(roles[0])!.toString('utf8')}# later user modification\n`)
    await writeFile(join(f.codexHome, 'agents', roles[0]), later)
    const before = await snapshot(f.codexHome)
    const update = await installCodexModeAt(f.installOptions)
    expect(update.success).toBe(false)
    expect(update.message).toContain('preserved user bytes or target template changed')
    expect(await snapshot(f.codexHome)).toEqual(before)
    const uninstall = await uninstallCodexModeAt({ codexHome: f.codexHome })
    expect(uninstall.success).toBe(true)
    expect(await readFile(join(f.codexHome, 'agents', roles[0]))).toEqual(later)
    const receipt = validateOwnershipManifest(await fs.readJSON(f.ownershipPath))
    const original = receipt.files.find(row => row.relativePath === `agents/${roles[0]}`)!.original!
    expect(await readFile(join(f.codexHome, original.backupPath), 'utf8')).toBe(f.beforeOriginal)
  })

  it('rejects target template changes and tampered immutable provenance on repeat installation', async () => {
    const f = await fixture()
    await f.writePlan()
    expect((await installCodexModeAt({ ...f.installOptions, ...await f.planApproval() })).success).toBe(true)
    const row = validateOwnershipManifest(await fs.readJSON(f.ownershipPath)).files.find(row => row.preservedUser)!
    const template = join(f.templateDir, row.relativePath)
    const bytes = await readFile(template)
    await fs.appendFile(template, '# changed template\n')
    expect((await installCodexModeAt(f.installOptions)).success).toBe(false)
    await writeFile(template, bytes)
    const source = join(f.codexHome, `.ccg/agent-preservation/${row.preservedUser!.planSha256}/source-ownership.json`)
    await fs.appendFile(source, '\n')
    const before = await snapshot(f.codexHome)
    const result = await installCodexModeAt(f.installOptions)
    expect(result.success).toBe(false)
    expect(result.message).toContain('original ownership snapshot is corrupt')
    expect(await snapshot(f.codexHome)).toEqual(before)
  })

  it('rejects receipt SHA rebasing and preservation on other managed files', async () => {
    const f = await fixture()
    await f.writePlan()
    expect((await installCodexModeAt({ ...f.installOptions, ...await f.planApproval() })).success).toBe(true)
    const manifest = await fs.readJSON(f.ownershipPath)
    const selected = manifest.files.find((row: any) => row.preservedUser)
    selected.installedSha256 = selected.preservedUser.sha256
    expect(() => validateOwnershipManifest(manifest)).toThrow('provenance')
    selected.installedSha256 = selected.preservedUser.baseline.sha256
    selected.relativePath = 'config.toml'
    delete selected.original
    expect(() => validateOwnershipManifest(manifest)).toThrow('not supported')
  })

  it('prints a machine-readable read-only CLI plan and rejects applying preservation options to uninstall', async () => {
    const f = await fixture()
    const before = await snapshot(f.codexHome)
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: f.root, USERPROFILE: f.root,      CODEX_HOME: f.codexHome, CCG_HOST: 'codex', NODE_ENV: 'production', NO_COLOR: '1', I18NEXT_NO_SUPPORT_NOTICE: '1' }
    delete env.CLAUDECODE
    const run = (args: string[]) => spawnSync(process.execPath,      ['--import', 'tsx', join(process.cwd(), 'src/cli.ts'), 'codex-mode', ...args],      { cwd: process.cwd(), env, encoding: 'utf8', timeout: 30_000, windowsHide: true })
    const plan = run(['plan-agent-preservation', '--baseline-dir', f.baselineDir,      '--agent-model', 'gpt-6.1-sol', '--agent-reasoning', 'xhigh', '--json'])
    expect(plan.status, plan.stderr).toBe(0)
    const parsed = JSON.parse(plan.stdout)
    expect(parsed.ownershipSha256).toBe(digest(f.sourceOwnership))
    expect(parsed.agents.map((row: any) => row.relativePath)).toEqual(roles.map(role => `agents/${role}`))
    const invalid = run(['uninstall', '--agent-preservation-plan', f.planPath])
    expect(invalid.status).not.toBe(0)
    expect(invalid.stderr).toContain('only for install')
    const missingDigest = run(['install', '--agent-preservation-plan', f.planPath])
    expect(missingDigest.status).not.toBe(0)
    expect(missingDigest.stderr).toContain('plan and its exact reviewed SHA-256 together')
    const missingPlan = run(['install', '--agent-preservation-plan-sha256', '0'.repeat(64)])
    expect(missingPlan.status).not.toBe(0)
    expect(missingPlan.stderr).toContain('plan and its exact reviewed SHA-256 together')
    await f.writePlan()
    const wrongDigest = run(['install', '--agent-preservation-plan', f.planPath, '--agent-preservation-plan-sha256', `sha256:${'0'.repeat(64)}`])
    expect(wrongDigest.status).not.toBe(0)
    expect(wrongDigest.stderr).toContain('Agent preservation plan SHA-256 differs')
    expect(await snapshot(f.codexHome)).toEqual(before)
  })

  it('doctor verifies preserved user bytes and the immutable original provenance without repairing it', async () => {
    const f = await fixture()
    // Doctor validates the shipped bytes. Git archives may use LF while a
    // Windows checkout uses CRLF; retain the other fixtures' CRLF migration cases.
    for (const name of roles)
      await fs.copy(join(process.cwd(), 'templates', 'codex', 'agents', name), join(f.templateDir, 'agents', name))
    await f.writePlan()
    expect((await installCodexModeAt({ ...f.installOptions, ...await f.planApproval() })).success).toBe(true)
    vi.stubEnv('CODEX_HOME', f.codexHome)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const before = await snapshot(f.codexHome)
    const checked = await doctor({ platform: 'codex' })
    const ownership = checked.checks.find(check => check.label === 'Codex ownership')!
    expect(checked.failures.map(check => check.label)).not.toContain('Codex ownership')
    expect(ownership.detail).toContain('explicitly preserved user agent')
    expect(await snapshot(f.codexHome)).toEqual(before)
    const row = validateOwnershipManifest(await fs.readJSON(f.ownershipPath)).files.find(row => row.preservedUser)!
    await fs.appendFile(join(f.codexHome, row.preservedUser!.snapshot.backupPath), '# damaged private provenance\n')
    const damaged = await snapshot(f.codexHome)
    const report = await doctor({ platform: 'codex' })
    expect(report.failures.map(check => check.label)).toContain('Codex ownership')
    expect(report.checks.find(check => check.label === 'Codex ownership')!.detail).toContain('provenance invalid')
    expect(await snapshot(f.codexHome)).toEqual(damaged)
  })

  it('recovery never snapshots or restores preserved agents, including a user edit after interruption', async () => {
    const f = await fixture()
    await f.writePlan()
    expect((await installCodexModeAt({ ...f.installOptions, ...await f.planApproval() })).success).toBe(true)
    const runner = join(f.root, 'crash-repeat.mjs')
    await writeFile(runner, [
      `import { installCodexModeAt } from ${JSON.stringify(pathToFileURL(join(process.cwd(), 'src/utils/codex-mode.ts')).href)};`,
      `await installCodexModeAt({codexHome:${JSON.stringify(f.codexHome)},templateDir:${JSON.stringify(f.templateDir)},pythonCommand:'python',wrapperBytes:Buffer.from(${JSON.stringify(wrapperBytes.toString('base64'))},'base64')});`,
    ].join('\n'))
    const child = spawnSync(process.execPath, ['--import', 'tsx', runner], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
      env: { ...process.env, NODE_ENV: 'test', CCG_CODEX_MODE_TEST_CRASH_AFTER_MUTATION: '1' },
    })
    expect(child.status).not.toBe(0)
    const journal = await fs.readJSON(join(f.codexHome, '.ccg/transaction.json'))
    expect(journal.snapshots.some((row: any) => roles.some(role => row.relativePath === `agents/${role}`))).toBe(false)
    const later = Buffer.from(`${f.originals.get(roles[0])!.toString('utf8')}# user edit during interruption\n`)
    await writeFile(join(f.codexHome, 'agents', roles[0]), later)
    const recovered = await recoverCodexModeAt({ codexHome: f.codexHome })
    expect(recovered.success, recovered.message).toBe(true)
    expect(await readFile(join(f.codexHome, 'agents', roles[0]))).toEqual(later)
  })
})
