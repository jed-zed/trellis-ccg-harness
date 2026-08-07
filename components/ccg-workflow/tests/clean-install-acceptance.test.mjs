import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import fs from 'fs-extra'
import { expect, it } from 'vitest'
import { installCodexModeAt } from '../src/utils/codex-mode.ts'
import { EXPECTED_BINARY_SHA256 } from '../src/utils/installer.ts'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const tsxImport = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href
const acceptance = process.env.CCG_CLEAN_INSTALL_E2E === '1' ? it : it.skip

function platformTarget() {
  const os = { darwin: 'darwin', linux: 'linux', win32: 'windows' }[process.platform]
  if (!os)
    throw new Error(`Unsupported clean-install platform: ${process.platform}`)
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
  const ext = process.platform === 'win32' ? '.exe' : ''
  return { os, arch, ext, asset: `codeagent-wrapper-${os}-${arch}${ext}` }
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true,
    ...options,
  })
}

function expectSuccess(result, label) {
  expect(result.status, `${label}\n${result.stdout || ''}\n${result.stderr || ''}`).toBe(0)
}

acceptance('runs the offline clean-home Codex provider lifecycle', async () => {
  const goExecutable = process.env.CCG_CLEAN_INSTALL_GO
  expect(goExecutable, 'CCG_CLEAN_INSTALL_GO must point to Go 1.21.13').toBeTruthy()

  const root = await mkdtemp(join(tmpdir(), 'ccg clean install '))
  const codexHome = join(root, 'custom-codex')
  const fakeBin = join(root, 'fake-bin')
  const providerLog = join(root, 'providers.jsonl')
  const browserLog = join(root, 'browser.jsonl')
  const workspace = join(root, 'workspace')
  const wrapperAsset = join(root, `wrapper${process.platform === 'win32' ? '.exe' : ''}`)
  const fakeAsset = join(root, `fake-provider${process.platform === 'win32' ? '.exe' : ''}`)
  const target = platformTarget()

  try {
    await fs.ensureDir(fakeBin)
    await fs.ensureDir(workspace)

    const wrapperBuild = run(goExecutable, [
      'build',
      '-buildvcs=false',
      '-trimpath',
      '-ldflags=-s -w',
      '-o',
      wrapperAsset,
      '.',
    ], {
      cwd: join(repoRoot, 'codeagent-wrapper'),
      env: { ...process.env, CGO_ENABLED: '0', GOOS: target.os, GOARCH: target.arch },
    })
    expectSuccess(wrapperBuild, 'build pinned wrapper')
    const wrapperBytes = await readFile(wrapperAsset)
    expect(createHash('sha256').update(wrapperBytes).digest('hex')).toBe(EXPECTED_BINARY_SHA256[target.asset])

    const fakeBuild = run(goExecutable, [
      'build',
      '-buildvcs=false',
      '-trimpath',
      '-o',
      fakeAsset,
      join(repoRoot, 'tests', 'fixtures', 'fake-provider.go'),
    ], {
      env: { ...process.env, CGO_ENABLED: '0', GOOS: target.os, GOARCH: target.arch },
    })
    expectSuccess(fakeBuild, 'build fake providers')

    const executableNames = [
      `agy${target.ext}`,
      `grok${target.ext}`,
      `pi${target.ext}`,
      process.platform === 'darwin' ? 'open' : process.platform === 'linux' ? 'xdg-open' : 'rundll32.exe',
    ]
    for (const name of executableNames) {
      const path = join(fakeBin, name)
      await copyFile(fakeAsset, path)
      if (process.platform !== 'win32')
        await chmod(path, 0o755)
    }

    const installed = await installCodexModeAt({
      codexHome,
      pythonCommand: 'python',
      wrapperBytes,
    })
    expect(installed.success, installed.message).toBe(true)

    const env = {
      ...process.env,
      CODEX_HOME: codexHome,
      HOME: root,
      USERPROFILE: root,
      PATH: `${fakeBin}${delimiter}${process.env.PATH || ''}`,
      NO_COLOR: '1',
      CODEAGENT_POST_MESSAGE_DELAY: '0',
      FAKE_PROVIDER_LOG: providerLog,
      FAKE_BROWSER_LOG: browserLog,
    }
    const cli = (args, input) => run(
      process.execPath,
      ['--import', tsxImport, join(repoRoot, 'src', 'cli.ts'), ...args],
      { env, input },
    )

    for (const [role, provider] of [
      ['frontend', 'antigravity'],
      ['backend', 'pi'],
      ['search', 'grok'],
      ['product-manager', 'codex'],
    ])
      expectSuccess(cli(['routing', 'set', role, provider]), `route ${role}`)

    const antigravity = cli(['wrapper', '--backend', 'antigravity', 'preview prompt', workspace])
    expectSuccess(antigravity, 'Antigravity wrapper')
    expect(antigravity.stdout).toContain('fake antigravity output')
    expect(antigravity.stderr).toMatch(/Web UI: http:\/\/127\.0\.0\.1:\d+/)

    for (let attempt = 0; attempt < 40 && !(await fs.pathExists(browserLog)); attempt++)
      await new Promise(resolve => setTimeout(resolve, 50))
    const opened = (await readFile(browserLog, 'utf8')).trim().split(/\r?\n/u).map(JSON.parse)
    expect(opened.some(entry => entry.args.some(arg => /^http:\/\/127\.0\.0\.1:\d+$/u.test(arg)))).toBe(true)

    const resumed = cli(['wrapper', '--backend', 'grok', 'resume', 'grok-session', 'resume prompt', workspace])
    expectSuccess(resumed, 'Grok resume')
    expect(resumed.stdout).toContain('fake grok output')

    const pi = cli(['wrapper', '--backend', 'pi', 'pi prompt', workspace])
    expectSuccess(pi, 'Pi wrapper')
    expect(pi.stdout).toContain('fake pi output')

    const parallel = cli(['wrapper', '--backend', 'grok', '--parallel'], [
      'id: grok-task',
      'backend: grok',
      '---CONTENT---',
      'parallel grok prompt',
      '---TASK---',
      'id: pi-task',
      'backend: pi',
      '---CONTENT---',
      'parallel pi prompt',
      '',
    ].join('\n'))
    expectSuccess(parallel, 'parallel wrapper')

    const doctor = cli(['doctor', '--platform', 'codex'])
    expectSuccess(doctor, 'Codex doctor')
    expect(doctor.stdout).toContain('All Codex checks passed.')

    const update = cli(['codex-mode', 'install'])
    expectSuccess(update, 'Codex update')
    expectSuccess(cli(['doctor', '--platform', 'codex']), 'doctor after update')

    const crashRunner = join(root, 'crash-install.mjs')
    await writeFile(crashRunner, [
      `import { installCodexModeAt } from ${JSON.stringify(pathToFileURL(join(repoRoot, 'src', 'utils', 'codex-mode.ts')).href)};`,
      `await installCodexModeAt({ codexHome: ${JSON.stringify(codexHome)}, pythonCommand: "python", wrapperBytes: Buffer.from(${JSON.stringify(wrapperBytes.toString('base64'))}, "base64") });`,
      '',
    ].join('\n'))
    const crashed = run(process.execPath, ['--import', tsxImport, crashRunner], {
      env: { ...env, NODE_ENV: 'test', CCG_CODEX_MODE_TEST_CRASH_AFTER_MUTATION: '3' },
    })
    expect(crashed.status).not.toBe(0)
    expect(await fs.pathExists(join(codexHome, '.ccg', 'transaction.json'))).toBe(true)
    expectSuccess(cli(['codex-mode', 'recover']), 'Codex recover')
    expectSuccess(cli(['doctor', '--platform', 'codex']), 'doctor after recover')

    const invocations = (await readFile(providerLog, 'utf8')).trim().split(/\r?\n/u).map(JSON.parse)
    expect(invocations.some(entry => entry.command === 'agy')).toBe(true)
    expect(invocations.some(entry => entry.command === 'grok' && entry.args.includes('-r'))).toBe(true)
    expect(invocations.some(entry => entry.command === 'pi' && entry.stdin.includes('pi prompt'))).toBe(true)
    expect(invocations.filter(entry => entry.command === 'grok' || entry.command === 'pi').length).toBeGreaterThanOrEqual(4)

    expectSuccess(cli(['codex-mode', 'uninstall']), 'Codex uninstall')
    expect(await fs.pathExists(join(codexHome, 'ccg', 'bin', `codeagent-wrapper${target.ext}`))).toBe(false)
    expect(await fs.pathExists(join(root, '.claude'))).toBe(false)
  }
  finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}, 180_000)
