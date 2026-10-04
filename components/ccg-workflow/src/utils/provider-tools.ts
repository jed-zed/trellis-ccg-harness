import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import fs from 'fs-extra'

export type OptionalProvider = 'kimi' | 'opencode'
export const PROVIDER_PACKAGES = {
  kimi: { name: '@moonshot-ai/kimi-code', version: '2.1.1', integrity: 'sha512-xClqcnTQUKgKDbeOGPU78qcwxGzL8wA2rqWuOX3CLpyQ1/NhSX7jAh6hZo/JFwThSX8obkgef3uw/li5JaJNyw==', docs: 'https://moonshotai.github.io/kimi-code/en/guides/getting-started' },
  opencode: { name: 'opencode-ai', version: '1.18.34', integrity: 'sha512-9WUS2T0t4HHDVzXvuwTHF0nvhXvZ9mQ0r+ozCvKdJu0LVoQpOzqAW4qWTC3ygNc5Oedcc7j+Oct24JYlQYnySA==', docs: 'https://opencode.ai/docs/cli/' },
} as const

export interface ProviderToolOptions {
  backend: OptionalProvider
  prefix: string
  shellPath?: string
}
export interface ProviderToolContext {
  platform?: NodeJS.Platform
  arch?: string
  nodeVersion?: string
  env?: NodeJS.ProcessEnv
  npmCli?: string
  run?: typeof spawnSync
}
export interface ProviderToolReport {
  backend: OptionalProvider
  prefix: string
  ok: boolean
  version: string
  authentication: 'not-checked'
  command?: string
  args?: string[]
  issues: string[]
  manualSetup: string
}
interface ProviderReceipt {
  schema: 1
  backend: OptionalProvider
  version: string
  platform: NodeJS.Platform
  arch: string
  shellPath?: string
  files: Record<string, string>
}
const RECEIPT = '.ccg-provider-tool.json'
const MAX_PROBE_OUTPUT = 256 * 1024

export function assertOptionalProvider(value: string): asserts value is OptionalProvider {
  if (value !== 'kimi' && value !== 'opencode')
    throw new Error('backend must explicitly be kimi or opencode')
}

export function providerNativePackage(platform: NodeJS.Platform, arch: string, env: NodeJS.ProcessEnv = process.env): string {
  const supported = (platform === 'win32' && arch === 'x64')
    || ((platform === 'linux' || platform === 'darwin') && ['x64', 'arm64'].includes(arch))
  if (!supported)
    throw new Error(`OpenCode managed installation does not support ${platform}/${arch}; use https://opencode.ai/docs/cli/`)
  const os = platform === 'win32' ? 'windows' : platform
  const musl = platform === 'linux' && env.CCG_OPENCODE_LIBC === 'musl' ? '-musl' : ''
  if (platform === 'linux' && env.CCG_OPENCODE_LIBC && !['musl', 'glibc'].includes(env.CCG_OPENCODE_LIBC))
    throw new Error('CCG_OPENCODE_LIBC must explicitly be glibc or musl')
  return `opencode-${os}-${arch}${arch === 'x64' ? '-baseline' : ''}${musl}`
}

function contained(root: string, target: string): boolean {
  const path = relative(root, target)
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

async function checkedPrefix(prefix: string): Promise<string> {
  if (!prefix || !isAbsolute(prefix) || /[\u0000-\u001F\u007F]/.test(prefix))
    throw new Error('prefix must be an explicit absolute private installation directory')
  const target = resolve(prefix)
  const forbidden = [homedir(), dirname(process.execPath), resolve(homedir(), '.local'), resolve(homedir(), 'AppData', 'Roaming', 'npm')]
  if (target === dirname(target) || forbidden.includes(target))
    throw new Error('prefix must be a dedicated private directory; global and home roots are forbidden')
  let ancestor = target
  while (true) {
    if (await fs.pathExists(ancestor)) {
      const info = await fs.lstat(ancestor)
      if (info.isSymbolicLink() || !info.isDirectory())
        throw new Error(`prefix ancestor must be an ordinary directory: ${ancestor}`)
    }
    const parent = dirname(ancestor)
    if (parent === ancestor)
      break
    ancestor = parent
  }
  return target
}

async function treeManifest(prefix: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  async function visit(dir: string): Promise<void> {
    for (const entry of (await fs.readdir(dir)).sort()) {
      const absolute = join(dir, entry)
      const key = relative(prefix, absolute).split(sep).join('/')
      if (key === RECEIPT)
        continue
      const info = await fs.lstat(absolute)
      if (info.isSymbolicLink()) {
        const link = await fs.readlink(absolute)
        if (!contained(prefix, resolve(dirname(absolute), link)))
          throw new Error(`installation link escapes private prefix: ${key}`)
        files[key] = `link:${link}`
      }
      else if (info.isDirectory()) {
        await visit(absolute)
      }
      else if (info.isFile()) {
        files[key] = createHash('sha256').update(await fs.readFile(absolute)).digest('hex')
      }
      else {
        throw new Error(`installation contains a special file: ${key}`)
      }
    }
  }
  await visit(prefix)
  return files
}

async function readReceipt(prefix: string): Promise<ProviderReceipt> {
  const path = join(prefix, RECEIPT)
  const info = await fs.lstat(path)
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error('provider receipt must be an ordinary file')
  return fs.readJSON(path)
}

function nodeSupported(version: string): boolean {
  const parts = version.replace(/^v/, '').split('.').map(Number)
  return parts[0] > 22 || (parts[0] === 22 && parts[1] >= 19)
}

async function kimiShell(options: ProviderToolOptions, env: NodeJS.ProcessEnv): Promise<string> {
  const candidates = [options.shellPath, env.KIMI_SHELL_PATH, env.ProgramFiles && join(env.ProgramFiles, 'Git', 'bin', 'bash.exe')].filter(Boolean) as string[]
  for (const candidate of candidates) {
    if (!isAbsolute(candidate) || !/bash\.exe$/i.test(candidate))
      continue
    try {
      const info = await fs.lstat(candidate)
      if (info.isFile() && !info.isSymbolicLink())
        return candidate
    }
    catch {}
  }
  throw new Error('Kimi on Windows requires Git Bash; pass --shell-path <absolute bash.exe> or set KIMI_SHELL_PATH. WSL is not required.')
}

async function runtimeCommand(options: ProviderToolOptions, context: ProviderToolContext): Promise<{ command: string, args: string[], env: NodeJS.ProcessEnv }> {
  const platform = context.platform || process.platform
  const env = { ...process.env, ...context.env }
  const spec = PROVIDER_PACKAGES[options.backend]
  const packageDir = join(options.prefix, 'node_modules', ...spec.name.split('/'))
  const pkg = await fs.readJSON(join(packageDir, 'package.json'))
  if (pkg.name !== spec.name || pkg.version !== spec.version)
    throw new Error(`expected official ${spec.name}@${spec.version} in the private prefix`)
  const lock = await fs.readJSON(join(options.prefix, 'package-lock.json'))
  const locked = lock.packages?.[`node_modules/${spec.name}`]
  if (locked?.version !== spec.version || locked?.integrity !== spec.integrity || !String(locked?.resolved).startsWith('https://registry.npmjs.org/'))
    throw new Error(`provider lock must match the fixed official integrity for ${spec.name}@${spec.version}`)
  if (options.backend === 'kimi') {
    const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
    if (String(repo).replace(/^git\+/, '').replace(/\.git$/, '').replace(/\/$/, '') !== 'https://github.com/MoonshotAI/kimi-code'
      || pkg.bin?.kimi !== 'dist/main.mjs')
      throw new Error('Kimi package must retain its official repository and bin identity')
    if (!nodeSupported(context.nodeVersion || process.versions.node))
      throw new Error('Kimi 2.1.1 requires Node >=22.19.0; upgrade Node explicitly before installing or running it')
    const entry = join(packageDir, 'dist', 'main.mjs')
    const entryReal = await fs.realpath(entry)
    if (!contained(options.prefix, entryReal))
      throw new Error('Kimi entry escapes private prefix')
    const require = createRequire(entry)
    for (const dependency of ['ws', 'qrcode']) {
      try {
        if (!contained(options.prefix, await fs.realpath(require.resolve(dependency))))
          throw new Error('dependency resolves outside private prefix')
      }
      catch { throw new Error(`Kimi regular runtime dependency is missing or external: ${dependency}; reinstall in a fresh private prefix`) }
    }
    if (platform === 'win32')
      env.KIMI_SHELL_PATH = await kimiShell(options, env)
    return { command: process.execPath, args: [entry, '--help'], env }
  }
  const native = providerNativePackage(platform, context.arch || process.arch, env)
  const nativeDir = join(options.prefix, 'node_modules', native)
  let nativePkg: { name?: string, version?: string }
  try {
    nativePkg = await fs.readJSON(join(nativeDir, 'package.json'))
  }
  catch {
    throw new Error(`OpenCode fixed native dependency is missing: ${native}@${spec.version}; reinstall in a fresh private prefix`)
  }
  if (nativePkg.name !== native || nativePkg.version !== spec.version)
    throw new Error(`OpenCode requires the fixed native package ${native}@${spec.version}`)
  const command = join(nativeDir, 'bin', platform === 'win32' ? 'opencode.exe' : 'opencode')
  const info = await fs.lstat(command)
  if (!info.isFile() || info.isSymbolicLink() || info.size < 64 * 1024 || !contained(options.prefix, await fs.realpath(command)))
    throw new Error('OpenCode native executable is missing or is an npm placeholder')
  return { command, args: ['--version'], env }
}

export async function doctorProviderTool(options: ProviderToolOptions, context: ProviderToolContext = {}): Promise<ProviderToolReport> {
  assertOptionalProvider(options.backend)
  const spec = PROVIDER_PACKAGES[options.backend]
  const report: ProviderToolReport = { backend: options.backend, prefix: options.prefix, ok: false, version: spec.version, authentication: 'not-checked', issues: [], manualSetup: spec.docs }
  try {
    report.prefix = await checkedPrefix(options.prefix)
    const receipt = await readReceipt(report.prefix)
    if (receipt.schema !== 1 || receipt.backend !== options.backend || receipt.version !== spec.version
      || receipt.platform !== (context.platform || process.platform) || receipt.arch !== (context.arch || process.arch))
      throw new Error('private installation receipt does not match the requested provider/version/platform')
    if (JSON.stringify(receipt.files) !== JSON.stringify(await treeManifest(report.prefix)))
      throw new Error('private installation has user changes; keep it intact and use a fresh prefix')
    const launch = await runtimeCommand({ ...options, prefix: report.prefix, shellPath: options.shellPath || receipt.shellPath }, context)
    const probeHome = await fs.mkdtemp(join(tmpdir(), 'ccg-provider-probe-'))
    let result: ReturnType<typeof spawnSync>
    try {
      const probeEnv = { ...launch.env, HOME: probeHome, USERPROFILE: probeHome, XDG_CONFIG_HOME: join(probeHome, 'config'), XDG_DATA_HOME: join(probeHome, 'data'), XDG_CACHE_HOME: join(probeHome, 'cache') }
      result = (context.run || spawnSync)(launch.command, launch.args, { env: probeEnv, encoding: 'utf8', timeout: 15_000, maxBuffer: MAX_PROBE_OUTPUT, windowsHide: true })
    }
    finally { await fs.remove(probeHome) }
    if (result.error || result.status !== 0)
      throw new Error(`provider local startup probe failed: ${result.error?.message || `exit ${result.status}`}`)
    if (options.backend === 'opencode' && !String(result.stdout).trim().split(/\s+/).includes(spec.version))
      throw new Error('OpenCode executable returned an unexpected version')
    report.command = launch.command
    report.args = launch.args.slice(0, -1)
    report.ok = true
  }
  catch (error) { report.issues.push(error instanceof Error ? error.message : String(error)) }
  return report
}

export async function installProviderTool(options: ProviderToolOptions, context: ProviderToolContext = {}): Promise<ProviderToolReport> {
  assertOptionalProvider(options.backend)
  const prefix = await checkedPrefix(options.prefix)
  if (await fs.pathExists(prefix) && (await fs.readdir(prefix)).length) {
    const report = await doctorProviderTool({ ...options, prefix }, context)
    if (!report.ok)
      throw new Error(`refusing to overwrite an existing private directory: ${report.issues.join('; ')}`)
    return report
  }
  const platform = context.platform || process.platform
  const arch = context.arch || process.arch
  const env = { ...process.env, ...context.env }
  let shellPath: string | undefined
  if (options.backend === 'kimi') {
    if (!nodeSupported(context.nodeVersion || process.versions.node))
      throw new Error('Kimi 2.1.1 requires Node >=22.19.0')
    if (platform === 'win32')
      shellPath = await kimiShell(options, env)
  }
  const native = options.backend === 'opencode' ? providerNativePackage(platform, arch, env) : undefined
  const npmCli = context.npmCli || env.npm_execpath || join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (!await fs.pathExists(npmCli))
    throw new Error('npm CLI is missing; install Node/npm explicitly, or provide a trusted npm_cli path')
  await fs.ensureDir(dirname(prefix))
  const stage = join(dirname(prefix), `.ccg-${options.backend}-${randomUUID()}`)
  await fs.mkdir(stage)
  const npmUserConfig = join(stage, '.npmrc')
  await fs.writeFile(npmUserConfig, '', 'utf8')
  const spec = PROVIDER_PACKAGES[options.backend]
  const packages = [`${spec.name}@${spec.version}`, ...(native ? [`${native}@${spec.version}`] : [])]
  try {
    const run = context.run || spawnSync
    const args = [npmCli, 'install', '--global=false', '--prefix', stage, '--cache', join(stage, '.npm-cache'), '--userconfig', npmUserConfig, '--ignore-scripts', '--omit=optional', '--no-audit', '--no-fund', '--save-exact', '--registry=https://registry.npmjs.org', ...packages]
    const result = run(process.execPath, args, { cwd: stage, env, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 600_000, windowsHide: true })
    if (result.error || result.status !== 0)
      throw new Error(`private npm installation failed: ${result.error?.message || `exit ${result.status}`}; previous files were preserved`)
    await fs.remove(join(stage, '.npm-cache'))
    await runtimeCommand({ ...options, prefix: stage, shellPath }, context)
    const bin = join(stage, 'bin')
    await fs.mkdir(bin)
    if (options.backend === 'kimi') {
      const entry = 'node_modules/@moonshot-ai/kimi-code/dist/main.mjs'
      const cmd = '@ECHO off\nGOTO start\n:find_dp0\nSET dp0=%~dp0\nEXIT /b\n:start\nSETLOCAL\nCALL :find_dp0\n\nIF EXIST "%dp0%\\node.exe" (\n  SET "_prog=%dp0%\\node.exe"\n) ELSE (\n  SET "_prog=node"\n  SET PATHEXT=%PATHEXT:;.JS;=;%\n)\n\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\' + entry.replace(/\//g, '\\') + '" %*'
      await fs.writeFile(join(stage, 'kimi.cmd'), cmd.replace(/\n/g, '\r\n'))
      await fs.writeFile(join(stage, 'kimi'), `#!/bin/sh\nexec node "$(dirname "$0")/${entry}" "$@"\n`, { mode: 0o755 })
    }
    else {
      const source = join(stage, 'node_modules', native!, 'bin', platform === 'win32' ? 'opencode.exe' : 'opencode')
      await fs.copyFile(source, join(bin, platform === 'win32' ? 'opencode.exe' : 'opencode'))
      if (platform !== 'win32')
        await fs.chmod(join(bin, 'opencode'), 0o755)
    }
    const receipt: ProviderReceipt = { schema: 1, backend: options.backend, version: spec.version, platform, arch, shellPath, files: await treeManifest(stage) }
    await fs.writeJSON(join(stage, RECEIPT), receipt, { spaces: 2 })
    const stagedReport = await doctorProviderTool({ ...options, prefix: stage, shellPath }, context)
    if (!stagedReport.ok)
      throw new Error(stagedReport.issues.join('; '))
    if (await fs.pathExists(prefix)) {
      if ((await fs.readdir(prefix)).length)
        throw new Error('private prefix changed during installation; refusing to overwrite it')
      await fs.rmdir(prefix)
    }
    await fs.rename(stage, prefix)
    return doctorProviderTool({ ...options, prefix, shellPath }, context)
  }
  catch (error) {
    // stage is a freshly created, fully resolved sibling owned by this invocation.
    if (contained(dirname(prefix), stage) && stage !== prefix)
      await fs.remove(stage)
    throw error
  }
}

export function providerToolEnvironment(backend: OptionalProvider, prefix: string, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (!isAbsolute(prefix) || /[\u0000-\u001F\u007F]/.test(prefix))
    throw new Error('provider prefix must be an absolute single-line path')
  const result: NodeJS.ProcessEnv = { ...env, PATH: `${backend === 'kimi' ? prefix : join(prefix, 'bin')}${delimiter}${dirname(process.execPath)}${delimiter}${env.PATH || env.Path || ''}`, [`CCG_${backend.toUpperCase()}_PREFIX`]: prefix }
  if (backend === 'kimi') {
    if (!result.KIMI_SHELL_PATH) {
      const receipt = fs.readJSONSync(join(prefix, RECEIPT)) as ProviderReceipt
      if (receipt.schema !== 1 || receipt.backend !== 'kimi')
        throw new Error('Kimi prefix does not contain its managed receipt')
      if (receipt.shellPath)
        result.KIMI_SHELL_PATH = receipt.shellPath
    }
  }
  return result
}
