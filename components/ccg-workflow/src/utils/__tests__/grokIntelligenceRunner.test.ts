import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error Runtime template modules intentionally ship as plain ESM.
import { buildExactGrokEnvironment } from '../../../templates/engine/tools/grok-intelligence/lib/exact-env.mjs'
// @ts-expect-error Runtime template modules intentionally ship as plain ESM.
import { createPrivateRunRoots, removePrivateRunRoot, securePrivateDirectory } from '../../../templates/engine/tools/grok-intelligence/lib/private-temp.mjs'
// @ts-expect-error Runtime template modules intentionally ship as plain ESM.
import { assertGrokDiagnostics, parseGrokModelInventory, runGrokDiagnostics } from '../../../templates/engine/tools/grok-intelligence/lib/process.mjs'
// @ts-expect-error Runtime template modules intentionally ship as plain ESM.
import { createFocusedSnapshot } from '../../../templates/engine/tools/grok-intelligence/lib/snapshot.mjs'
// @ts-expect-error Runtime template modules intentionally ship as plain ESM.
import { pathsShareIdentity } from '../../../templates/engine/tools/grok-intelligence/lib/path-safety.mjs'
// @ts-expect-error Runtime template modules intentionally ship as plain ESM.
import { runGrokIntelligence } from '../../../templates/engine/tools/grok-intelligence/runner.mjs'

function searchNotifications(url = 'https://docs.x.ai/build/cli/reference', finalText?: string) {
  return [
    {
      method: 'session/update',
      params: { update: { sessionUpdate: 'user_message_chunk', content: { text: 'Verify.' }, _meta: { modelId: 'grok-4.5' } } },
    },
    {
      method: 'session/update',
      params: { update: { sessionUpdate: 'tool_call', toolCallId: 'search-1', kind: 'search', rawInput: { variant: 'WebSearch', backend: true } } },
    },
    {
      method: 'session/update',
      params: { update: { sessionUpdate: 'tool_call_update', toolCallId: 'search-1', status: 'completed', rawOutput: { action: { query: 'Grok CLI official docs', sources: [{ type: 'url', url }] } } } },
    },
    {
      method: 'session/update',
      params: { update: { sessionUpdate: 'agent_message_chunk', content: { text: finalText || `Evidence collected.\nCCG_CLAIMS_JSON:{"schemaVersion":1,"claims":[{"id":"claim-1","claim":"The current contract is documented by an observed source.","status":"verified","severity":"info","applies_to":["src/feature.ts"],"urls":["${url}"]}]}` } } },
    },
    {
      method: 'session/update',
      params: { update: { sessionUpdate: 'turn_completed', stop_reason: 'end_turn', usage: { modelUsage: { 'grok-4.5-build': { modelCalls: 1 } } } } },
    },
  ]
}

describe('focused Grok snapshot', () => {
  it('accepts alternate path spellings only when filesystem identity is unchanged', () => {
    const directory = () => true
    const file = () => false
    expect(pathsShareIdentity({ dev: 1, ino: 42, isDirectory: directory, isFile: file }, { dev: 1, ino: 42, isDirectory: directory, isFile: file })).toBe(true)
    expect(pathsShareIdentity({ dev: 1, ino: 42, isDirectory: directory, isFile: file }, { dev: 1, ino: 43, isDirectory: directory, isFile: file })).toBe(false)
  })
  let root: string
  let repo: string
  let snapshot: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ccg-grok-snapshot-'))
    repo = join(root, 'repo')
    snapshot = join(root, 'snapshot')
    await mkdir(join(repo, 'src'), { recursive: true })
    await mkdir(snapshot, { recursive: true })
    await chmod(root, 0o700)
    await chmod(snapshot, 0o700)
    await writeFile(join(repo, 'src', 'safe.ts'), 'export const safe = true\n')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('copies only selected files and scopes dirty diffs to copied paths', async () => {
    await writeFile(join(repo, 'src', 'other.ts'), 'export const secret = false\n')
    const result = await createFocusedSnapshot({
      repoRoot: repo,
      snapshotRoot: snapshot,
      selectedPaths: ['src/safe.ts'],
      dirtyDiffs: [
        { path: 'src/safe.ts', patch: '@@ safe patch\n' },
        { path: 'src/other.ts', patch: '@@ other patch\n' },
      ],
    })
    expect(result.files.map((entry: any) => entry.path)).toEqual(['src/safe.ts'])
    expect(await readFile(join(snapshot, 'src', 'safe.ts'), 'utf8')).toContain('safe')
    expect(await readFile(join(snapshot, 'changes.diff'), 'utf8')).toContain('safe patch')
    expect(await readFile(join(snapshot, 'changes.diff'), 'utf8')).not.toContain('other patch')
    expect((await stat(join(snapshot, 'src', 'safe.ts'))).mode & 0o222).toBe(0)
  })

  it.each([
    '.env',
    '.env.local',
    'credentials.json',
    'auth.json',
    'client.key',
    'client.pem',
    'client.crt',
    '.git/config',
    'node_modules/pkg/index.js',
    '.cache/data',
    'AGENTS.md',
    'CLAUDE.md',
    '.claude/settings.json',
    '.codex/config.toml',
    '.grok/settings.json',
    'skills/x/SKILL.md',
    'hooks/pre.js',
    'plugin.json',
    'mcp.json',
    '.mcp.json',
    '.envrc',
    '.ssh/id_rsa',
    '.codex-plugin/plugin.json',
    'service-account.json',
  ])('rejects secret, dependency, VCS, instruction, or extension surface %s', async (relativePath) => {
    const target = join(repo, relativePath)
    await mkdir(resolve(target, '..'), { recursive: true })
    await writeFile(target, 'must-not-leave-repo')
    await expect(createFocusedSnapshot({ repoRoot: repo, snapshotRoot: snapshot, selectedPaths: [relativePath] }))
      .rejects
      .toThrow(/excluded|forbidden|secret|instruction/i)
  })

  it('honors .ccgignore without copying the ignore file', async () => {
    await writeFile(join(repo, '.ccgignore'), 'src/ignored.ts\n*.private.ts\n')
    await writeFile(join(repo, 'src', 'ignored.ts'), 'ignored')
    await writeFile(join(repo, 'src', 'local.private.ts'), 'ignored')
    await expect(createFocusedSnapshot({ repoRoot: repo, snapshotRoot: snapshot, selectedPaths: ['src/ignored.ts'] }))
      .rejects
      .toThrow(/ccgignore|excluded/i)
    await expect(createFocusedSnapshot({ repoRoot: repo, snapshotRoot: snapshot, selectedPaths: ['src/local.private.ts'] }))
      .rejects
      .toThrow(/ccgignore|excluded/i)
    expect(await readdir(snapshot)).toEqual([])
  })

  it('allows only an explicitly bound top-level CCG Markdown plan', async () => {
    const planPath = '.codex/ccg/plans/example.md'
    await mkdir(resolve(repo, '.codex/ccg/plans'), { recursive: true })
    await writeFile(resolve(repo, planPath), '# Plan\n')

    await expect(createFocusedSnapshot({
      repoRoot: repo,
      snapshotRoot: snapshot,
      selectedPaths: [planPath],
    })).rejects.toThrow(/excluded/i)

    for (const disallowed of [
      '.codex/ccg/plans/example.txt',
      '.codex/ccg/plans/nested/example.md',
      '.codex/ccg/plans/AGENTS.md',
    ]) {
      await expect(createFocusedSnapshot({
        repoRoot: repo,
        snapshotRoot: snapshot,
        selectedPaths: [planPath],
        allowedCcgPlanPaths: [disallowed],
      })).rejects.toThrow(/plan|excluded|instruction/i)
    }

    await writeFile(resolve(repo, '.ccgignore'), `${planPath}\n`)
    await expect(createFocusedSnapshot({
      repoRoot: repo,
      snapshotRoot: snapshot,
      selectedPaths: [planPath],
      allowedCcgPlanPaths: [planPath],
    })).rejects.toThrow(/ccgignore/i)
    await writeFile(resolve(repo, '.ccgignore'), '# no exclusions\n')

    await expect(createFocusedSnapshot({
      repoRoot: repo,
      snapshotRoot: snapshot,
      selectedPaths: [planPath],
      allowedCcgPlanPaths: [planPath],
    })).resolves.toMatchObject({ files: [{ path: planPath }] })
  })

  it('rejects traversal, symlink escapes, and hard-linked input', async () => {
    await expect(createFocusedSnapshot({ repoRoot: repo, snapshotRoot: snapshot, selectedPaths: ['../outside.txt'] }))
      .rejects
      .toThrow(/relative|traversal|escape/i)

    const outside = join(root, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'outside.ts'), 'outside')
    await symlink(outside, join(repo, 'src', 'linked'), 'junction')
    await expect(createFocusedSnapshot({ repoRoot: repo, snapshotRoot: snapshot, selectedPaths: ['src/linked/outside.ts'] }))
      .rejects
      .toThrow(/link|reparse/i)

    const hardlink = join(repo, 'src', 'hardlink.ts')
    await link(join(repo, 'src', 'safe.ts'), hardlink)
    await expect(createFocusedSnapshot({ repoRoot: repo, snapshotRoot: snapshot, selectedPaths: ['src/safe.ts', 'src/hardlink.ts'] }))
      .rejects
      .toThrow(/hard.?link/i)
  })

  it('enforces file-count, per-file, and total-byte caps before copying', async () => {
    await writeFile(join(repo, 'src', 'second.ts'), '23456')
    await expect(createFocusedSnapshot({ repoRoot: repo, snapshotRoot: snapshot, selectedPaths: ['src/safe.ts'], limits: { maxFiles: 0, maxFileBytes: 100, maxTotalBytes: 100 } }))
      .rejects
      .toThrow(/file count/i)
    await expect(createFocusedSnapshot({ repoRoot: repo, snapshotRoot: snapshot, selectedPaths: ['src/safe.ts'], limits: { maxFiles: 2, maxFileBytes: 2, maxTotalBytes: 100 } }))
      .rejects
      .toThrow(/per-file/i)
    await expect(createFocusedSnapshot({ repoRoot: repo, snapshotRoot: snapshot, selectedPaths: ['src/safe.ts', 'src/second.ts'], limits: { maxFiles: 2, maxFileBytes: 100, maxTotalBytes: 10 } }))
      .rejects
      .toThrow(/total-byte/i)
  })
})

describe('private roots and diagnostics', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ccg-grok-runner-'))
    await chmod(root, 0o700)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it.runIf(process.platform === 'win32')('enforces the production owner-only Windows ACL contract once', async () => {
    const privateRoot = join(root, 'windows-private')
    const canonical = await securePrivateDirectory(privateRoot)
    expect(canonical).toBe(await realpath(privateRoot))
  }, 180_000)

  it('reuses post-lock Windows ACL evidence for the private-directory validator', async () => {
    const privateRoot = join(root, 'windows-private-evidence')
    const acl = {
      current: 'MACHINE\\owner',
      currentSid: 'S-1-5-21-1000',
      currentOwnerSid: 'S-1-5-32-544',
      owner: 'BUILTIN\\Administrators',
      ownerSid: 'S-1-5-32-544',
      access: [{ identity: 'MACHINE\\owner', identitySid: 'S-1-5-21-1000', inherited: false, type: 'Allow' }],
    }
    const validateDirectory = vi.fn(async (path: string, options: any) => {
      expect(await options.inspectWindowsAcl(path)).toBe(acl)
      return path
    })
    await expect(securePrivateDirectory(privateRoot, {
      platform: 'win32',
      restrictWindowsAcl: () => acl,
      validateDirectory,
    })).resolves.toBe(privateRoot)
    expect(validateDirectory).toHaveBeenCalledTimes(1)
  })

  it('creates separate owner-only neutral, snapshot, and raw directories', async () => {
    const grokHome = join(root, 'grok-home')
    await mkdir(grokHome)
    await chmod(grokHome, 0o700)
    const roots = await createPrivateRunRoots({
      parent: root,
      grokHome,
      platform: 'linux',
      validateDirectory: async (path: string) => path,
    })
    expect(new Set([roots.neutralHome, roots.snapshotRoot, roots.rawEventsDir]).size).toBe(3)
    for (const path of [roots.runRoot, roots.neutralHome, roots.snapshotRoot, roots.rawEventsDir]) {
      expect((await lstat(path)).isSymbolicLink()).toBe(false)
      if (process.platform !== 'win32')
        expect((await stat(path)).mode & 0o077).toBe(0)
    }
    await roots.cleanup()
    await expect(stat(roots.runRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses recursive cleanup outside the intended private parent', async () => {
    const outside = join(root, 'outside', 'ccg-grok-run-forbidden')
    await mkdir(outside, { recursive: true })
    await expect(removePrivateRunRoot(outside, { allowedParent: root })).rejects.toThrow(/outside/i)
    await expect(stat(outside)).resolves.toBeDefined()
  })

  it('runs local diagnostics with the exact environment without rejecting native configuration', async () => {
    const calls: any[] = []
    const env = buildExactGrokEnvironment({ sourceEnv: { PATH: process.env.PATH, SECRET_SHOULD_DROP: 'no' }, neutralHome: root, grokHome: root })
    const result = await runGrokDiagnostics({
      cwd: root,
      env,
      runProcess: async (command: string, args: string[], options: any) => {
        calls.push({ command, args, env: options.env, timeoutMs: options.timeoutMs })
        if (args.includes('inspect'))
          return { stdout: '{"externalCompat":{"remoteSettingsLoaded":true,"cells":[{"vendor":"claude","surface":"hooks","enabled":true}]}}', stderr: '', exitCode: 0 }
        return { stdout: args.includes('version') ? '0.1.20' : args.includes('models') ? 'grok-4.5' : 'none configured', stderr: '', exitCode: 0 }
      },
    })
    expect(calls.map(call => call.args.slice(-2).join(' '))).toEqual([
      'version',
      'models',
      'inspect --json',
    ])
    expect(calls.every(call => call.env === env)).toBe(true)
    expect(calls.every(call => call.timeoutMs === 30_000)).toBe(true)
    expect(Object.keys(env)).not.toContain('SECRET_SHOULD_DROP')
    expect(result.inspect.externalCompat.remoteSettingsLoaded).toBe(true)
    expect(parseGrokModelInventory('You are not authenticated.\nDefault model: grok-4.5\nAvailable models:\n* grok-4.5 (default)\n* grok-4.5-deep')).toEqual({
      models: ['grok-4.5', 'grok-4.5-deep'],
      defaultModel: 'grok-4.5',
    })

    expect(assertGrokDiagnostics({ externalCompat: { remoteSettingsLoaded: true, cells: [] } }))
      .toMatchObject({ externalCompat: { remoteSettingsLoaded: true } })
    expect(() => assertGrokDiagnostics([])).toThrow(/unsafe_cli_context/i)
  })

  it('exercises the fake Grok executable without a model call', async () => {
    const fakeWrapper = resolve(process.cwd(), 'templates/engine/tools/grok-intelligence/fake-wrapper.mjs')
    const env = buildExactGrokEnvironment({
      sourceEnv: { PATH: process.env.PATH },
      neutralHome: root,
      grokHome: root,
    })
    await expect(runGrokDiagnostics({
      command: process.execPath,
      prefixArgs: [fakeWrapper],
      cwd: root,
      env,
    })).resolves.toMatchObject({ version: '0.1.20' })
    await expect(runGrokDiagnostics({
      command: process.execPath,
      prefixArgs: [fakeWrapper, '--fake-case', 'inspect-pollution'],
      cwd: root,
      env,
    })).resolves.toMatchObject({ version: '0.1.20' })
  }, 40_000)
})

describe('isolated Grok runner lifecycle', () => {
  let root: string
  let repo: string
  let grokHome: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ccg-grok-lifecycle-'))
    await chmod(root, 0o700)
    repo = join(root, 'repo')
    grokHome = join(root, 'grok-home')
    await mkdir(join(repo, 'src'), { recursive: true })
    await mkdir(grokHome)
    await chmod(grokHome, 0o700)
    await writeFile(join(repo, 'src', 'feature.ts'), 'export const feature = true\n')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  function baseOptions(overrides: Record<string, unknown> = {}) {
    return {
      config: {
        enabled: true,
        auth_mode: 'browser_oauth',
        require_web_search: true,
        x_search_policy: 'preferred',
        max_retries: 2,
      },
      consent: true,
      requirement: 'required',
      mode: 'contract',
      task: 'Verify the current contract.',
      officialDomains: ['docs.x.ai'],
      repoRoot: repo,
      selectedPaths: ['src/feature.ts'],
      tempParent: root,
      grokHome,
      sourceEnv: { PATH: process.env.PATH },
      platform: 'linux',
      createPrivateRoots: (args: any) => createPrivateRunRoots({
        ...args,
        validateDirectory: async (path: string) => path,
      }),
      clock: () => new Date('2026-07-21T12:00:00.000Z'),
      runDiagnostics: async () => ({}),
      runAcp: async () => ({ notifications: searchNotifications() }),
      ...overrides,
    }
  }

  it('validates consent, supports a disabled skip, and maps required failures', async () => {
    const rateLimited = async () => {
      throw new Error('rate limit')
    }
    expect((await runGrokIntelligence(baseOptions({ consent: false }))).exitCode).toBe(4)
    expect(await runGrokIntelligence(baseOptions({ requirement: 'disabled' }))).toMatchObject({ exitCode: 0, status: 'skipped' })
    expect((await runGrokIntelligence(baseOptions({ runAcp: rateLimited }))).exitCode).toBe(2)
    expect(await runGrokIntelligence(baseOptions({ requirement: 'preferred', runAcp: rateLimited }))).toMatchObject({ exitCode: 0, status: 'invocation_failed' })
  })

  it('returns a complete response as received_unverified when a search update has no recognized start', async () => {
    const notifications = searchNotifications()
      .filter((message: any) => message.params?.update?.sessionUpdate !== 'tool_call')
    const result = await runGrokIntelligence(baseOptions({
      runAcp: async () => ({ notifications }),
    }))
    expect(result).toMatchObject({ exitCode: 0, status: 'received_unverified' })
    expect(result.evidence.normalized.finalText).toContain('Evidence collected.')
    expect(result.evidence.normalized.unknownEvents).toHaveLength(1)
    expect(result.evidence.registry.sources).toEqual([])
    expect(result.evidence.validation.qualifying_claims).toEqual([])
  })

  it('orders diagnostics before ACP, sends an exact env, and returns validated evidence', async () => {
    const order: string[] = []
    let seenAcpOptions: any
    const result = await runGrokIntelligence(baseOptions({
      sourceEnv: { PATH: process.env.PATH, USER_SECRET: 'must-drop' },
      runDiagnostics: async ({ env }: any) => {
        order.push('diagnostics')
        expect(env.USER_SECRET).toBeUndefined()
        expect(env.GROK_DISABLE_AUTOUPDATER).toBeUndefined()
        return {}
      },
      runAcp: async (options: any) => {
        order.push('acp')
        seenAcpOptions = options
        return { notifications: searchNotifications() }
      },
    }))
    expect(order).toEqual(['diagnostics', 'acp'])
    expect(seenAcpOptions.cwd).toContain('snapshot')
    expect(seenAcpOptions.allowedCwdRoots).toEqual([seenAcpOptions.cwd])
    expect(seenAcpOptions.prompt).toContain('site:x.com')
    expect(seenAcpOptions.prompt).toContain('only when it is useful')
    expect(seenAcpOptions.prompt).toContain('Predeclared official domains: docs.x.ai')
    expect(seenAcpOptions.prompt).toContain('provider-native tools')
    expect(result).toMatchObject({ exitCode: 0, status: 'verified' })
    expect(result.evidence.model).toEqual({
      requested: 'grok-4.5',
      actual: 'grok-4.5',
      provenance: 'ACP session/update user_message_chunk _meta.modelId',
      usage_models: ['grok-4.5-build'],
    })
    expect(result.evidence.validation.valid).toBe(true)
    expect(result.evidence.claims).toEqual([expect.objectContaining({ id: 'claim-1', status: 'verified', source_ids: [expect.stringMatching(/^src-/)] })])
    expect(result.evidence.registry.sources[0].canonical_url).toBe('https://docs.x.ai/build/cli/reference')
    expect(JSON.stringify(result.raw)).not.toContain('USER_SECRET')
    await expect(stat(result.runRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps a required verify response when its claims remain unresolved', async () => {
    const unresolvedText = 'No applicable evidence.\nCCG_CLAIMS_JSON:{"schemaVersion":1,"claims":[{"id":"claim-none","claim":"No applicable fact could be verified.","status":"unresolved","severity":"info","urls":[]}]}'
    const result = await runGrokIntelligence(baseOptions({
      action: 'verify',
      runAcp: async () => ({
        notifications: searchNotifications(undefined, unresolvedText),
      }),
    }))
    expect(result).toMatchObject({
      exitCode: 0,
      status: 'received_unverified',
      evidence: {
        validation: {
          package_status: 'valid',
          verification_outcome: 'unresolved',
          qualifying_claims: [],
        },
      },
    })
  })

  it('retries only transient failures with a fresh ACP call', async () => {
    const runAcp = vi.fn()
      .mockRejectedValueOnce(new Error('429 rate limit'))
      .mockResolvedValueOnce({ notifications: searchNotifications() })
    const result = await runGrokIntelligence(baseOptions({ runAcp }))
    expect(result.exitCode).toBe(0)
    expect(runAcp).toHaveBeenCalledTimes(2)
    expect(runAcp.mock.calls[0][0]).not.toBe(runAcp.mock.calls[1][0])
  })

  it.each([
    ['timeout', new Error('timed out')],
    ['cancellation', new Error('cancelled')],
    ['malformed JSON', new Error('Malformed JSON-RPC line')],
    ['raw cap', new Error('raw event byte cap exceeded')],
  ])('handles %s without leaving an unredacted run directory', async (_name, error) => {
    const fail = async () => {
      throw error
    }
    const result = await runGrokIntelligence(baseOptions({ runAcp: fail }))
    expect(result.exitCode).toBe(2)
    expect((await readdir(root)).filter(name => name.startsWith('ccg-grok-run-'))).toEqual([])
  })

  it('does not reject enabled provider-native configuration', async () => {
    const runAcp = vi.fn()
    const result = await runGrokIntelligence(baseOptions({
      runDiagnostics: async () => ({ inspect: { externalCompat: { remoteSettingsLoaded: true } } }),
      runAcp: runAcp.mockResolvedValue({ notifications: searchNotifications() }),
    }))
    expect(result).toMatchObject({ exitCode: 0, status: 'verified' })
    expect(runAcp).toHaveBeenCalledOnce()
  })

  it('keeps unverified responses while still failing cleanup', async () => {
    const noSearch = searchNotifications().filter((message: any) => !['tool_call', 'tool_call_update'].includes(message.params?.update?.sessionUpdate))
    expect(await runGrokIntelligence(baseOptions({ runAcp: async () => ({ notifications: noSearch }) })))
      .toMatchObject({ exitCode: 0, status: 'received_unverified' })

    const invented = searchNotifications('https://docs.x.ai/build/cli/reference')
    const inventedMessage: any = invented.find((message: any) =>
      message.params?.update?.sessionUpdate === 'agent_message_chunk'
      && typeof message.params?.update?.content?.text === 'string',
    )
    expect(inventedMessage).toBeDefined()
    inventedMessage.params.update.content.text = `Invented https://invented.invalid is not a source.\nCCG_CLAIMS_JSON:{"schemaVersion":1,"claims":[{"id":"claim-1","claim":"Observed contract","status":"verified","urls":["https://docs.x.ai/build/cli/reference"]}]}`
    const inventedResult = await runGrokIntelligence(baseOptions({ runAcp: async () => ({ notifications: invented }) }))
    expect(inventedResult.exitCode).toBe(0)
    expect(inventedResult.evidence.registry.sources.some((source: any) => source.canonical_url.includes('invented.invalid'))).toBe(false)

    const missingClaims = await runGrokIntelligence(baseOptions({
      runAcp: async () => ({ notifications: searchNotifications(undefined, 'Evidence collected.') }),
    }))
    expect(missingClaims).toMatchObject({
      exitCode: 0,
      status: 'received_unverified',
      evidence: { validation: { package_status: 'invalid', verification_outcome: 'unresolved' } },
    })

    const cleanupFailure = await runGrokIntelligence(baseOptions({
      cleanupRunRoots: async () => { throw new Error('cleanup failed') },
    }))
    expect(cleanupFailure).toMatchObject({ exitCode: 3, status: 'cleanup_failed' })
  })
})
