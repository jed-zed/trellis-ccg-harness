import { spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// @ts-expect-error Runtime template modules intentionally ship as plain ESM.
import { GROK_INTELLIGENCE_SYSTEM_PROMPT, buildGrokAcpArgs, createExclusiveCapture, createGrokAcpClient, selectAcpAuthMethod, selectAcpPermissionOption, validatePrivateDirectory, validateWorkingDirectory, withCredentialHomeLease } from '../../../templates/engine/tools/grok-intelligence/lib/acp-client.mjs'
// @ts-expect-error Runtime template modules intentionally ship as plain ESM.
import * as grokAcp from '../../../templates/engine/tools/grok-intelligence/lib/acp-client.mjs'
// @ts-expect-error Runtime template modules intentionally ship as plain ESM.
import { INTELLIGENCE_ENV_ALLOWLIST, buildExactGrokEnvironment } from '../../../templates/engine/tools/grok-intelligence/lib/exact-env.mjs'
// @ts-expect-error Runtime template modules intentionally ship as plain ESM.
import { signalProcessTree } from '../../../templates/engine/tools/grok-intelligence/lib/process-tree.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

const fakeAcpChild = String.raw`
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import readline from 'node:readline'

const mode = process.argv[2]
const receivedArgs = process.argv.slice(3)
const rl = readline.createInterface({ input: process.stdin })
let promptRequestId = null

const send = value => process.stdout.write(JSON.stringify(value) + '\n')
const respond = (id, result = {}) => send({ jsonrpc: '2.0', id, result })
const sendTurnCompleted = () => send({
  method: '_x.ai/session/update',
  params: { update: { sessionUpdate: 'turn_completed', stop_reason: 'end_turn', usage: {} } },
})

function createRunArtifacts() {
  for (const [directory, file] of [['sessions/run-new', 'events.jsonl'], ['logs', 'run-new.log'], ['memtrace', 'run-new.jsonl']]) {
    const target = join(process.env.GROK_HOME, directory)
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, file), 'ephemeral')
  }
}

rl.on('line', line => {
  const message = JSON.parse(line)

  if (message.method === 'initialize') {
    if (mode === 'malformed-response') {
      send({ jsonrpc: '2.0', id: message.id })
      return
    }
    if (mode === 'unknown-response')
      respond(999, {})
    const authMethods = mode === 'missing-cached-auth' || mode === 'api-auth'
      ? [{ id: 'xai.api_key' }]
      : [{ id: 'cached_token' }, { id: 'xai.api_key' }]
    respond(message.id, {
      authMethods,
      agentCapabilities: { sessionCapabilities: { close: true } },
      observedCapabilities: message.params.clientCapabilities,
    })
    return
  }

  if (message.method === 'authenticate') {
    respond(message.id, { methodId: message.params.methodId })
    return
  }

  if (message.method === 'session/new') {
    createRunArtifacts()
    respond(message.id, { sessionId: 'fake-session', observedSession: message.params })
    send({
      method: '_x.ai/mcp/servers_updated',
      params: { mcpServers: mode === 'nonempty-mcp' ? [{ name: 'evil' }] : [] },
    })
    send({
      method: '_x.ai/mcp_initialized',
      params: { mcpToolCount: mode === 'mcp-tool' ? 1 : 0 },
    })
    return
  }

  if (message.method === 'session/prompt') {
    if (mode === 'timeout' || mode === 'timeout-ignore')
      return
    if (mode === 'invalid-model') {
      send({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'invalid model' } })
      return
    }
    if (mode === 'truncated') {
      process.stdout.write('{"jsonrpc":"2.0"')
      setTimeout(() => process.exit(2), 5)
      return
    }
    if (mode === 'malformed') {
      process.stdout.write('{malformed-json\n')
      return
    }
    if (mode === 'oversize-line') {
      send({ method: 'session/update', params: { data: 'x'.repeat(1100000) } })
      return
    }
    if (mode === 'unknown-after-prompt') {
      respond(7331, {})
      return
    }
    if (mode === 'secret-stderr')
      process.stderr.write('fatal token=' + process.env.XAI_API_KEY + ' proxy=' + process.env.HTTPS_PROXY + '\n')

    promptRequestId = message.id
    send({
      jsonrpc: '2.0',
      id: 900,
      method: 'session/request_permission',
      params: {
        sessionId: 'fake-session',
        toolCall: { title: 'native tool' },
        options: [
          { optionId: 'once', kind: 'allow_once', name: 'Allow once' },
          { optionId: 'always', kind: 'allow_always', name: 'Always allow' },
          { optionId: 'reject', kind: 'reject_once', name: 'Reject' },
        ],
      },
    })
    return
  }

  if (message.id === 900 && !message.method) {
    const promptResult = {
      permissionResponse: message.result,
      receivedArgs,
      envKeys: Object.keys(process.env).sort(),
      sawApiKey: Boolean(process.env.XAI_API_KEY),
    }
    if (mode === 'no-turn') {
      respond(promptRequestId, promptResult)
    }
    else if (mode === 'delayed-turn') {
      respond(promptRequestId, promptResult)
      setTimeout(sendTurnCompleted, 50)
    }
    else {
      sendTurnCompleted()
      respond(promptRequestId, promptResult)
    }
    return
  }

  if (message.method === 'session/close') {
    respond(message.id, { closed: true })
    setTimeout(() => process.exit(0), 5)
    return
  }

  if (message.method === 'session/cancel' && mode !== 'timeout-ignore')
    setTimeout(() => process.exit(0), 5)
})
`

describe('Grok intelligence ACP transport', () => {
  let root: string
  let cwd: string
  let rawEventsDir: string
  let neutralHome: string
  let grokHome: string
  let fakeChildPath: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ccg-grok-acp-'))
    cwd = join(root, 'snapshot')
    rawEventsDir = join(root, 'raw')
    neutralHome = join(root, 'neutral-home')
    grokHome = join(root, 'grok-home')
    fakeChildPath = join(root, 'fake-acp-child.mjs')
    await Promise.all([
      mkdir(cwd),
      mkdir(rawEventsDir),
      mkdir(neutralHome),
      mkdir(grokHome),
    ])
    await Promise.all([
      chmod(root, 0o700),
      chmod(cwd, 0o700),
      chmod(rawEventsDir, 0o700),
      chmod(neutralHome, 0o700),
      chmod(grokHome, 0o700),
      writeFile(fakeChildPath, fakeAcpChild),
      writeFile(join(grokHome, 'auth.json'), '{"refresh":"preserve-me"}'),
      writeFile(join(grokHome, 'config.toml'), 'write_file = false'),
      writeFile(join(grokHome, 'models_cache.json'), '{}'),
    ])
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  function makeClient(mode = 'success', extra: Record<string, unknown> = {}) {
    return createGrokAcpClient({
      command: process.execPath,
      prefixArgs: [fakeChildPath, mode],
      validatePrivateDirectory: async (path: string) => path,
      terminateProcess: terminateFixtureChild,
      ...extra,
    })
  }

  function runOptions(overrides: Record<string, unknown> = {}) {
    return {
      prompt: 'Find one official source.',
      cwd,
      allowedCwdRoots: [root],
      rawEventsDir,
      rawEventsMaxBytes: 2 * 1024 * 1024,
      rawEventsMaxEvents: 100,
      // This is integration-fixture scheduling headroom, not the production
      // timeout contract. Loaded Windows runs spawn many fake child processes
      // in parallel across the full suite.
      timeoutMs: 8000,
      neutralHome,
      grokHome,
      authMode: 'browser_oauth',
      sourceEnv: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        ComSpec: process.env.ComSpec,
        PATHEXT: process.env.PATHEXT,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        GITHUB_TOKEN: 'must-not-leak',
        OPENAI_API_KEY: 'must-not-leak',
        CCG_PRIVATE_TOKEN: 'must-not-leak',
      },
      ...overrides,
    }
  }

  async function terminateFixtureChild(child: ReturnType<typeof spawn>) {
    if (child.exitCode == null && child.signalCode == null) {
      child.kill('SIGKILL')
      await new Promise(resolvePromise => child.once('close', resolvePromise))
    }
  }

  it('leaves the generic codeagent-wrapper Grok backend unchanged', async () => {
    const backend = await readFile(join(repoRoot, 'codeagent-wrapper', 'backend.go'), 'utf8')
    expect(backend).toContain('args = append(args, "-p", targetArg)')
    expect(backend).toContain('args := []string{"--always-approve", "--output-format", "streaming-json"}')
  })

  it('builds the native-permission agent-stdio command and never uses one-shot prompt mode', () => {
    const args = buildGrokAcpArgs({ maxTurns: 6 })
    expect(args.slice(-2)).toEqual(['agent', 'stdio'])
    expect(args).not.toContain('--model')
    expect(buildGrokAcpArgs({ maxTurns: 6, model: 'grok-4.5' }).slice(-4)).toEqual(['agent', '--model', 'grok-4.5', 'stdio'])
    expect(args).not.toContain('-p')
    expect(args).toContain('--always-approve')
    expect(args).not.toContain('--no-auto-update')
    expect(args).toContain('--verbatim')
    expect(args).toContain('--system-prompt-override')
    expect(args).toContain(GROK_INTELLIGENCE_SYSTEM_PROMPT)
    expect(args).toContain('6')
    expect(args).not.toContain('--tools')
    expect(args).not.toContain('--disallowed-tools')
    expect(args).not.toContain('--deny')
    expect(() => buildGrokAcpArgs({ maxTurns: 7 })).toThrow(/maxTurns/i)
    expect(() => buildGrokAcpArgs({ maxTurns: 6, model: 'bad\nmodel' })).toThrow(/model/i)
  })

  it('targets the complete child process tree on Unix and Windows', () => {
    const directSignals: string[] = []
    const child = { pid: 4321, kill: (signal: string) => directSignals.push(signal) }
    const groupSignals: any[] = []
    signalProcessTree(child, 'SIGTERM', { platform: 'linux', treeEnabled: true, killGroup: (pid: number, signal: string) => groupSignals.push([pid, signal]) })
    expect(groupSignals).toEqual([[-4321, 'SIGTERM']])
    const taskkill: any[] = []
    signalProcessTree(child, 'SIGKILL', { platform: 'win32', treeEnabled: true, runTaskkill: (args: string[]) => taskkill.push(args) })
    expect(taskkill).toEqual([['/PID', '4321', '/T', '/F']])
    expect(directSignals).toEqual([])
  })

  it('builds child env from an allowlist without forcing provider capabilities off', () => {
    const env = buildExactGrokEnvironment({
      sourceEnv: {
        PATH: 'safe-path',
        HTTPS_PROXY: 'https://proxy.invalid',
        GITHUB_TOKEN: 'secret',
        OPENAI_API_KEY: 'secret',
        ANTHROPIC_API_KEY: 'secret',
        GEMINI_API_KEY: 'secret',
        DATABASE_URL: 'secret',
        NPM_TOKEN: 'secret',
        CCG_PRIVATE: 'secret',
        XAI_API_KEY: 'ambient-must-not-pass',
      },
      neutralHome,
      grokHome,
      apiKey: undefined,
      platform: process.platform,
    })

    expect(env.PATH).toBe('safe-path')
    expect(env.HOME).toBe(neutralHome)
    expect(env.USERPROFILE).toBe(neutralHome)
    expect(env.GROK_HOME).toBe(grokHome)
    expect(env.HTTPS_PROXY).toBe('https://proxy.invalid')
    expect(env.XAI_API_KEY).toBeUndefined()
    expect(Object.keys(env).every(key => INTELLIGENCE_ENV_ALLOWLIST.includes(key))).toBe(true)
    expect(env.GROK_DISABLE_AUTOUPDATER).toBeUndefined()
    expect(JSON.stringify(env)).not.toMatch(/GITHUB|OPENAI|ANTHROPIC|GEMINI|DATABASE|NPM_TOKEN|CCG_PRIVATE/)

    const explicitlyDisabled = buildExactGrokEnvironment({
      sourceEnv: { GROK_DISABLE_AUTOUPDATER: '1' },
      neutralHome,
      grokHome,
      platform: process.platform,
    })
    expect(explicitlyDisabled.GROK_DISABLE_AUTOUPDATER).toBe('1')
  })

  it('selects cached browser auth first and API-key auth only when explicit', () => {
    const methods = [{ id: 'xai.api_key' }, { id: 'cached_token' }]
    expect(selectAcpAuthMethod(methods, { authMode: 'browser_oauth', hasApiKey: false })).toBe('cached_token')
    expect(selectAcpAuthMethod(methods, { authMode: 'api_key', hasApiKey: true })).toBe('xai.api_key')
    expect(() => selectAcpAuthMethod([{ id: 'xai.api_key' }], { authMode: 'browser_oauth', hasApiKey: false })).toThrow(/cached_token/i)
    expect(() => selectAcpAuthMethod(methods, { authMode: 'api_key', hasApiKey: false })).toThrow(/API key/i)
  })

  it('prefers persistent ACP approval and falls back to one-shot approval', () => {
    expect(selectAcpPermissionOption([
      { optionId: 'once', kind: 'allow_once' },
      { optionId: 'always', kind: 'allow_always' },
    ])).toBe('always')
    expect(selectAcpPermissionOption([{ optionId: 'once', kind: 'allow_once' }])).toBe('once')
    expect(() => selectAcpPermissionOption([{ optionId: 'reject', kind: 'reject_once' }])).toThrow(/allow option/i)
  })

  it('keeps client-hosted capabilities bounded and lets Grok load its native MCP configuration', async () => {
    let spawnedEnvironment: Record<string, string> | undefined
    const result = await makeClient('success', {
      spawnProcess: (...spawnArgs: Parameters<typeof spawn>) => {
        spawnedEnvironment = spawnArgs[2]?.env as Record<string, string>
        return spawn(...spawnArgs)
      },
    }).run(runOptions())
    expect(result.initializeResult.observedCapabilities).toEqual({
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
    })
    expect(result.sessionResult.observedSession).toEqual({ cwd: await realpath(cwd), mcpServers: [] })
    expect(result.promptResult.permissionResponse).toEqual({ outcome: { outcome: 'selected', optionId: 'always' } })
    expect(result.authMethod).toBe('cached_token')
    expect(result.promptResult.receivedArgs).toEqual(buildGrokAcpArgs({ maxTurns: 6 }))
    const unexpectedEnvironmentKeys = Object.keys(spawnedEnvironment || {}).filter(key => !INTELLIGENCE_ENV_ALLOWLIST.includes(key))
    expect(unexpectedEnvironmentKeys).toEqual([])
    expect(result.promptResult.envKeys).not.toContain('GITHUB_TOKEN')
    expect(result.capture.path).toMatch(/[a-f0-9-]{36}\.jsonl$/i)
    await expect(stat(result.capture.path)).rejects.toThrow()
  })

  it('waits for a delayed turn_completed notification after session/prompt responds', async () => {
    // Keep the production timeout contract unchanged while giving the spawned
    // fixture enough startup headroom on loaded Windows CI hosts.
    const result = await makeClient('delayed-turn').run(runOptions({ timeoutMs: 8000 }))
    expect(result.notifications.some((message: any) => (
      message.method === '_x.ai/session/update'
      && message.params?.update?.sessionUpdate === 'turn_completed'
    ))).toBe(true)
  })

  it('accepts the correlated session/prompt response when the optional turn notification is absent', async () => {
    // Keep runtime behavior unchanged while giving this integration fixture
    // enough scheduling headroom on loaded Windows CI hosts.
    const result = await makeClient('no-turn').run(runOptions({ timeoutMs: 8000 }))
    expect(result.completion).toEqual({ promptResponse: true, turnCompleted: false })
  })

  it('supports a local-only doctor handshake without sending session/prompt', async () => {
    const result = await makeClient('success').run(runOptions({ handshakeOnly: true, prompt: undefined }))
    expect(result.authMethod).toBe('cached_token')
    expect(result.promptResult).toBeNull()
    expect(result.notifications.some((message: any) => message.method === 'session/request_permission')).toBe(false)
  })

  it('supports explicit API-key auth without returning or logging the secret', async () => {
    const secret = 'xai-test-secret-value'
    const proxySecret = 'https://proxy-user:proxy-password@proxy.invalid'
    const result = await makeClient('secret-stderr').run(runOptions({
      authMode: 'api_key',
      apiKey: secret,
      sourceEnv: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        ComSpec: process.env.ComSpec,
        PATHEXT: process.env.PATHEXT,
        HTTPS_PROXY: proxySecret,
      },
    }))
    expect(result.authMethod).toBe('xai.api_key')
    expect(result.promptResult.envKeys).toContain('XAI_API_KEY')
    expect(result.promptResult.sawApiKey).toBe('[REDACTED]')
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(JSON.stringify(result)).not.toContain(proxySecret)
    expect(result.stderr.join('\n')).toContain('[REDACTED]')
  })

  it.each([
    ['missing-cached-auth', /cached_token/i],
    ['malformed', /malformed JSON-RPC/i],
    ['unknown-after-prompt', /unknown response/i],
    ['invalid-model', /invalid model/i],
    ['truncated', /truncated JSON-RPC/i],
    ['malformed-response', /exactly one of result or error/i],
  ])('fails closed for %s', async (mode, error) => {
    await expect(makeClient(mode).run(runOptions())).rejects.toThrow(error)
  }, 15_000)

  it.each(['nonempty-mcp', 'mcp-tool'])('does not reject configured provider capability event %s', async (mode) => {
    const result = await makeClient(mode).run(runOptions())
    expect(result.promptResult.permissionResponse).toEqual({ outcome: { outcome: 'selected', optionId: 'always' } })
  })

  it('rejects unknown response correlation during initialization', async () => {
    await expect(makeClient('unknown-response').run(runOptions())).rejects.toThrow(/unknown response/i)
  })

  it('enforces total-byte, event-count, and per-line caps', async () => {
    await expect(makeClient().run(runOptions({ rawEventsMaxBytes: 120 }))).rejects.toThrow(/byte cap/i)
    await expect(makeClient().run(runOptions({ rawEventsMaxEvents: 1 }))).rejects.toThrow(/event cap/i)
    await expect(makeClient('oversize-line').run(runOptions())).rejects.toThrow(/line.*cap/i)
  })

  it('owns an exclusive random capture file and refuses collisions', async () => {
    const collision = join(rawEventsDir, 'feedface.jsonl')
    await writeFile(collision, 'existing')
    await expect(createExclusiveCapture(rawEventsDir, {
      randomName: () => 'feedface.jsonl',
      validateDirectory: async (path: string) => path,
    })).rejects.toThrow(/exclusive capture/i)
    expect(await readFile(collision, 'utf8')).toBe('existing')
  })

  it('rejects relative, symlinked, and non-owner-only directories', async () => {
    await expect(validateWorkingDirectory('relative', [root])).rejects.toThrow(/absolute/i)
    const linked = join(root, 'linked')
    try {
      await symlink(cwd, linked, process.platform === 'win32' ? 'junction' : 'dir')
      await expect(validateWorkingDirectory(linked, [root])).rejects.toThrow(/link|reparse|real path/i)
    }
    catch (error: any) {
      if (!['EPERM', 'EACCES'].includes(error?.code))
        throw error
    }

    await expect(validatePrivateDirectory(rawEventsDir, {
      platform: 'win32',
      inspectWindowsAcl: async () => ({
        current: 'MACHINE\\owner',
        owner: 'MACHINE\\owner',
        access: [{ identity: 'BUILTIN\\Users', inherited: false, type: 'Allow' }],
      }),
    })).rejects.toThrow(/owner-only/i)

    await expect(validatePrivateDirectory(rawEventsDir, {
      platform: 'win32',
      inspectWindowsAcl: async () => ({
        current: 'MACHINE\\owner',
        owner: 'MACHINE\\owner',
        access: [{ identity: 'MACHINE\\owner', inherited: true, type: 'Allow' }],
      }),
    })).resolves.toBe(await realpath(rawEventsDir))

    await expect(validatePrivateDirectory(rawEventsDir, {
      platform: 'win32',
      inspectWindowsAcl: async () => ({
        current: 'MACHINE\\owner',
        currentSid: 'S-1-5-21-1000',
        currentOwnerSid: 'S-1-5-32-544',
        owner: 'BUILTIN\\Administrators',
        ownerSid: 'S-1-5-32-544',
        access: [{ identity: 'MACHINE\\owner', identitySid: 'S-1-5-21-1000', inherited: false, type: 'Allow' }],
      }),
    })).resolves.toBe(await realpath(rawEventsDir))
  })

  it('validates capture bounds before spawning', async () => {
    await expect(makeClient().run(runOptions({ rawEventsMaxBytes: 0 }))).rejects.toThrow(/rawEventsMaxBytes/i)
    await expect(makeClient().run(runOptions({ rawEventsMaxBytes: 8388609 }))).rejects.toThrow(/rawEventsMaxBytes/i)
    await expect(makeClient().run(runOptions({ rawEventsMaxEvents: 20001 }))).rejects.toThrow(/rawEventsMaxEvents/i)
    await expect(makeClient().run(runOptions({ timeoutMs: 0 }))).rejects.toThrow(/timeoutMs/i)
  })

  it('rejects missing API-key configuration before spawning a child', async () => {
    let spawned = false
    await expect(makeClient('api-auth', {
      onSpawn: () => { spawned = true },
    }).run(runOptions({ authMode: 'api_key', apiKey: undefined }))).rejects.toThrow(/API key/i)
    expect(spawned).toBe(false)
  })

  it('cancels and terminates the child on timeout and explicit abort', async () => {
    let timeoutPid: number | undefined
    const timeoutClient = makeClient('timeout-ignore', {
      onSpawn: (child: { pid?: number }) => { timeoutPid = child.pid },
    })
    await expect(timeoutClient.run(runOptions({ timeoutMs: 150 }))).rejects.toThrow(/timed out/i)
    if (timeoutPid) {
      expect(() => process.kill(timeoutPid!, 0)).toThrow()
    }

    const controller = new AbortController()
    const abortRun = makeClient('timeout-ignore').run(runOptions({ signal: controller.signal, timeoutMs: 3000 }))
    setTimeout(() => controller.abort(), 50)
    await expect(abortRun).rejects.toThrow(/cancelled/i)
  })

  it('cleans run-created credential artifacts while preserving login and pinned config', async () => {
    await makeClient().run(runOptions())
    expect(await readFile(join(grokHome, 'auth.json'), 'utf8')).toContain('preserve-me')
    expect(await readFile(join(grokHome, 'config.toml'), 'utf8')).toContain('write_file = false')
    expect(await readFile(join(grokHome, 'models_cache.json'), 'utf8')).toBe('{}')
    await expect(stat(join(grokHome, 'sessions', 'run-new'))).rejects.toThrow()
    await expect(stat(join(grokHome, 'logs', 'run-new.log'))).rejects.toThrow()
    await expect(stat(join(grokHome, 'memtrace', 'run-new.jsonl'))).rejects.toThrow()
  })

  it('preserves the primary error and completes cleanup when child termination also fails', async () => {
    const terminationError = new Error('synthetic child termination cleanup failure')
    const client = makeClient('invalid-model', {
      terminateProcess: async (child: ReturnType<typeof spawn>) => {
        if (child.exitCode == null && child.signalCode == null) {
          child.kill('SIGKILL')
          await new Promise(resolvePromise => child.once('close', resolvePromise))
        }
        throw terminationError
      },
    })

    let caught: any
    try {
      await client.run(runOptions())
    }
    catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(Error)
    expect(caught.message).toMatch(/ACP session\/prompt failed: invalid model/i)
    expect(caught.cleanupErrors).toContain(terminationError)
    expect(Object.keys(caught)).not.toContain('cleanupErrors')
    expect(await readdir(rawEventsDir)).toEqual([])
    expect(await readFile(join(grokHome, 'auth.json'), 'utf8')).toContain('preserve-me')
    await expect(stat(join(grokHome, 'sessions', 'run-new'))).rejects.toThrow()
    await expect(stat(join(grokHome, '.ccg-intelligence-lease'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('fails closed when child termination is the only failure', async () => {
    const terminationError = new Error('synthetic child termination cleanup failure')
    const client = makeClient('success', {
      terminateProcess: async (child: ReturnType<typeof spawn>) => {
        if (child.exitCode == null && child.signalCode == null) {
          child.kill('SIGKILL')
          await new Promise(resolvePromise => child.once('close', resolvePromise))
        }
        throw terminationError
      },
    })

    await expect(client.run(runOptions())).rejects.toBe(terminationError)
    expect(await readdir(rawEventsDir)).toEqual([])
    await expect(stat(join(grokHome, 'sessions', 'run-new'))).rejects.toThrow()
    await expect(stat(join(grokHome, '.ccg-intelligence-lease'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('purges historical volatile credential artifacts without deleting persistent login state', async () => {
    await Promise.all([
      mkdir(join(grokHome, 'sessions', 'stale-session'), { recursive: true }),
      mkdir(join(grokHome, 'logs'), { recursive: true }),
      mkdir(join(grokHome, 'memtrace'), { recursive: true }),
    ])
    await Promise.all([
      writeFile(join(grokHome, 'sessions', 'stale-session', 'prompt.json'), '{"prompt":"private"}'),
      writeFile(join(grokHome, 'logs', 'unified.jsonl'), '{"key_prefix":"must-be-removed"}\n'),
      writeFile(join(grokHome, 'memtrace', 'trace.jsonl'), '{}\n'),
      writeFile(join(grokHome, 'active_sessions.json'), '{}\n'),
    ])
    const purge = (grokAcp as any).clearCredentialHomeVolatileState
    expect(purge).toBeTypeOf('function')
    await purge(grokHome, { validateDirectory: async (path: string) => path })
    for (const name of ['sessions', 'logs', 'memtrace', 'active_sessions.json'])
      await expect(stat(join(grokHome, name))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(grokHome, 'auth.json'), 'utf8')).toContain('preserve-me')
    expect(await readFile(join(grokHome, 'config.toml'), 'utf8')).toContain('write_file = false')
    expect(await readFile(join(grokHome, 'models_cache.json'), 'utf8')).toBe('{}')
  })

  it('serializes shared credential-home mutations with a bounded global lease', async () => {
    let active = 0
    let maximum = 0
    const action = () => withCredentialHomeLease(grokHome, async () => {
      active++
      maximum = Math.max(maximum, active)
      await new Promise(resolvePromise => setTimeout(resolvePromise, 30))
      active--
    }, { validateDirectory: async (path: string) => path, retryMs: 5, timeoutMs: 1000 })
    await Promise.all([action(), action()])
    expect(maximum).toBe(1)
    expect(await stat(grokHome)).toBeDefined()
  })

  it('preserves the action error when shared lease release also fails', async () => {
    const primaryError = new Error('synthetic primary lease action failure')
    let caught: any
    try {
      await withCredentialHomeLease(grokHome, async () => {
        const ownerPath = join(grokHome, '.ccg-intelligence-lease', 'owner.json')
        const owner = JSON.parse(await readFile(ownerPath, 'utf8'))
        await writeFile(ownerPath, `${JSON.stringify({ ...owner, owner: 'changed-owner' })}\n`)
        throw primaryError
      }, { validateDirectory: async (path: string) => path })
    }
    catch (error) {
      caught = error
    }

    expect(caught).toBe(primaryError)
    expect(caught.cleanupErrors).toHaveLength(1)
    expect(caught.cleanupErrors[0].message).toMatch(/ownership changed/i)
    expect(Object.keys(caught)).not.toContain('cleanupErrors')
  })

  it('recovers a credential-home lease whose owner process was terminated', async () => {
    const leasePath = join(grokHome, '.ccg-intelligence-lease')
    await mkdir(leasePath)
    await writeFile(join(leasePath, 'owner.json'), `${JSON.stringify({
      owner: 'terminated-owner',
      pid: 999999,
      created_at: '2026-01-01T00:00:00.000Z',
    })}\n`)

    let ran = false
    await withCredentialHomeLease(grokHome, async () => {
      ran = true
    }, {
      validateDirectory: async (path: string) => path,
      processIsAlive: () => false,
      retryMs: 5,
      timeoutMs: 100,
    })

    expect(ran).toBe(true)
    await expect(stat(leasePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
