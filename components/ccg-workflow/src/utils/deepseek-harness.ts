import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import fs from 'fs-extra'
import { PACKAGE_ROOT } from './installer-template'

export const DEEPSEEK_PLUGIN_NAME = 'ccg-deepseek-compat'
const SOURCE_FILES = ['package.json', 'src/index.js', 'src/core.js', 'README.md'] as const
const OWNED_FILES = [...SOURCE_FILES, 'cordis.patch.yml', 'route.json', 'profile-package.before']
const PEERS = ['@deepseek-ai/schemastery', '@deepseek-ai/dsh-tool-subagent']
const execFileAsync = promisify(execFile)

export interface DeepseekLauncher {
  command: string
  args: string[]
}

export interface DeepseekRunOptions {
  cwd: string
  env: NodeJS.ProcessEnv
  timeout: number
}

export type DeepseekRunner = (launcher: DeepseekLauncher, args: string[], options: DeepseekRunOptions) => Promise<void>

export interface DeepseekHarnessOptions {
  dshHome: string
  profile: string
  prefix: string
  provider?: string
  model?: string
  /** Actual Node launcher or executable. Batch/shell launchers are refused. */
  dshCli?: string
  dryRun?: boolean
  sourceDir?: string
  run?: DeepseekRunner
}

export interface DeepseekHarnessResult {
  success: boolean
  state: 'planned' | 'ready' | 'declared-but-unlinked' | 'not-installed' | 'rolled-back' | 'error'
  profile: string
  target?: string
  message?: string
  changes?: string[]
  missingDependencies?: string[]
  /** Metadata checks do not prove a native Harness boot or a provider request. */
  runtimeVerified: false
}

interface Receipt {
  format: 1
  owner: typeof DEEPSEEK_PLUGIN_NAME
  profile: string
  manifest: string
  target: string
  beforeHash: string
  afterHash: string
  files: Record<string, string>
  state: 'ready' | 'declared-but-unlinked'
}

interface Context {
  home: string
  manifest: string
  profileDir: string
  target: string
  receipt: string
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function context(options: DeepseekHarnessOptions): Context {
  if (!options.profile || !/^[\w-]+$/.test(options.profile) || options.profile === 'node_modules') {
    throw new Error('An explicit single profile name containing letters, numbers, underscores or hyphens is required')
  }
  if (!isAbsolute(options.dshHome || '') || !isAbsolute(options.prefix || '')) {
    throw new Error('Explicit absolute --dsh-home and --prefix paths are required; no home or all-profile fallback is used')
  }
  const home = resolve(options.dshHome)
  const profiles = join(home, 'profiles')
  const prefix = resolve(options.prefix)
  const prefixFromProfiles = relative(profiles, prefix)
  const outsideProfiles = prefixFromProfiles === '..' || prefixFromProfiles.startsWith(`..${sep}`) || isAbsolute(prefixFromProfiles)
  if (!outsideProfiles) {
    throw new Error('The plugin prefix must be outside the profiles directory')
  }
  const profileDir = join(profiles, options.profile)
  const target = join(prefix, DEEPSEEK_PLUGIN_NAME, options.profile)
  return { home, profileDir, manifest: join(profileDir, 'package.json'), target, receipt: join(target, 'ownership.json') }
}

async function noLinks(path: string): Promise<void> {
  let current = resolve(path)
  while (true) {
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`Refusing a symbolic link or junction: ${current}`)
    }
    catch (error: any) {
      if (error?.code !== 'ENOENT') throw error
    }
    const parent = dirname(current)
    if (parent === current) return
    current = parent
  }
}

async function regularBytes(path: string): Promise<Buffer> {
  await noLinks(path)
  const stat = await fs.lstat(path)
  if (!stat.isFile() || stat.nlink !== 1) throw new Error(`Refusing a non-regular or multiply linked file: ${path}`)
  return fs.readFile(path)
}

function parseProfile(bytes: Buffer): Record<string, any> {
  const pkg = JSON.parse(bytes.toString('utf8'))
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)
    || !Array.isArray(pkg?.dsh?.profile?.bundles)
    || !pkg.dsh.profile.bundles.every((value: unknown) => typeof value === 'string')) {
    throw new Error('The selected profile must already have a valid package.json and dsh.profile.bundles array')
  }
  if (pkg.dependencies !== undefined && (!pkg.dependencies || typeof pkg.dependencies !== 'object' || Array.isArray(pkg.dependencies))) {
    throw new Error('The profile dependencies field is malformed')
  }
  return pkg
}

function route(options: DeepseekHarnessOptions): { provider: string, model: string } {
  const provider = options.provider?.trim() ?? ''
  const model = options.model?.trim() ?? ''
  if (!provider || !model || /[\r\n\0]/.test(provider + model)) {
    throw new Error('Explicit non-empty --provider and --model are required; credentials and deployment-default fallback are not accepted')
  }
  return { provider, model }
}

async function assets(options: DeepseekHarnessOptions): Promise<Record<string, Buffer>> {
  const source = options.sourceDir ?? join(PACKAGE_ROOT, 'templates', 'deepseek-harness-compat')
  const bytes: Record<string, Buffer> = {}
  for (const file of SOURCE_FILES) bytes[file] = await regularBytes(join(source, file))
  const configuredRoute = route(options)
  bytes['route.json'] = Buffer.from(`${JSON.stringify(configuredRoute, null, 2)}\n`)
  bytes['cordis.patch.yml'] = Buffer.from(`- insert:\n    - id: ${DEEPSEEK_PLUGIN_NAME}\n      name: ${DEEPSEEK_PLUGIN_NAME}\n      config: ${JSON.stringify(configuredRoute)}\n`)
  return bytes
}

async function readReceipt(ctx: Context): Promise<Receipt> {
  const receipt = JSON.parse((await regularBytes(ctx.receipt)).toString('utf8')) as Receipt
  if (receipt.format !== 1 || receipt.owner !== DEEPSEEK_PLUGIN_NAME || receipt.profile !== ctx.profileDir.split(/[\\/]/).pop()
    || receipt.target !== ctx.target || receipt.manifest !== ctx.manifest
    || !['ready', 'declared-but-unlinked'].includes(receipt.state)
    || !/^[a-f0-9]{64}$/.test(receipt.beforeHash) || !/^[a-f0-9]{64}$/.test(receipt.afterHash)
    || !receipt.files || Object.keys(receipt.files).sort().join('\n') !== [...OWNED_FILES].sort().join('\n')
    || !Object.values(receipt.files).every(value => /^[a-f0-9]{64}$/.test(value))) {
    throw new Error('Invalid ownership receipt; refusing to claim or remove files')
  }
  return receipt
}

async function inventory(dir: string, prefix = ''): Promise<string[]> {
  const found: string[] = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isSymbolicLink()) throw new Error(`User change detected: ${name} is a link`)
    if (entry.isDirectory()) {
      found.push(`${name}/`)
      found.push(...await inventory(join(dir, entry.name), name))
    }
    else found.push(name)
  }
  return found.sort()
}

async function verifyOwned(ctx: Context, receipt: Receipt): Promise<void> {
  const expected = [...OWNED_FILES, 'ownership.json', 'src/'].sort()
  if ((await inventory(ctx.target)).join('\n') !== expected.join('\n')) throw new Error('User change detected in the plugin directory; no files were overwritten or removed')
  for (const file of OWNED_FILES) {
    if (sha256(await regularBytes(join(ctx.target, file))) !== receipt.files[file]) throw new Error(`User change detected: ${file}; no files were overwritten or removed`)
  }
  if (sha256(await regularBytes(ctx.manifest)) !== receipt.afterHash) throw new Error('User change detected in the profile manifest; no files were overwritten or removed')
  const before = await regularBytes(join(ctx.target, 'profile-package.before'))
  if (sha256(before) !== receipt.beforeHash) throw new Error('The profile backup does not match the ownership receipt')
  const original = parseProfile(before)
  if (original.dependencies?.[DEEPSEEK_PLUGIN_NAME] !== undefined || original.dsh.profile.bundles.includes(DEEPSEEK_PLUGIN_NAME)) {
    throw new Error('The profile backup already contained this bundle; refusing rollback')
  }
}

async function removeStage(stage: string, content: Record<string, Buffer>, receiptBytes: Buffer): Promise<void> {
  // Never recursively remove a computed path. Check each regular file against
  // the bytes this invocation created before unlinking only that file.
  for (const [file, bytes] of [...Object.entries(content), ['ownership.json', receiptBytes]] as Array<[string, Buffer]>) {
    const path = join(stage, file)
    if (await fs.pathExists(path)) {
      if (sha256(await regularBytes(path)) !== sha256(bytes)) throw new Error('The staging payload changed; retained it for inspection')
    }
  }
  for (const file of [...Object.keys(content), 'ownership.json']) {
    const path = join(stage, file)
    if (await fs.pathExists(path)) await fs.unlink(path)
  }
  if (await fs.pathExists(join(stage, 'src'))) await fs.rmdir(join(stage, 'src'))
  await fs.rmdir(stage)
}

async function writeProfile(ctx: Context, bytes: Buffer, expectedHash: string): Promise<void> {
  const temporary = `${ctx.manifest}.ccg-${randomUUID()}`
  const mode = (await fs.stat(ctx.manifest)).mode & 0o777
  await fs.writeFile(temporary, bytes, { flag: 'wx', mode })
  try {
    if (sha256(await regularBytes(ctx.manifest)) !== expectedHash) throw new Error('The profile changed before replacement; its manifest was not overwritten')
    await fs.rename(temporary, ctx.manifest)
  }
  finally {
    await removeProfileTemporary(temporary, bytes)
  }
}

async function removeProfileTemporary(temporary: string, bytes: Buffer): Promise<void> {
  if (!await fs.pathExists(temporary)) return
  if (sha256(await regularBytes(temporary)) !== sha256(bytes)) throw new Error('The temporary profile changed; retained it for inspection')
  await fs.unlink(temporary)
}

export const runDeepseek: DeepseekRunner = async (launcher, args, options) => {
  await execFileAsync(launcher.command, [...launcher.args, ...args], {
    ...options,
    shell: false,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  })
}

async function nodeLauncher(file: string): Promise<DeepseekLauncher> {
  if (!isAbsolute(file)) throw new Error('--dsh-cli must be an absolute path to the actual Node launcher or executable')
  await regularBytes(file)
  if (/\.(?:cmd|bat|ps1|sh)$/i.test(file)) throw new Error('Shell/batch launchers are not accepted; pass the actual DSH Node .js/.mjs/.cjs file or native executable')
  return /\.(?:mjs|cjs|js)$/i.test(file) ? { command: process.execPath, args: [file] } : { command: file, args: [] }
}

async function findLauncher(configured?: string): Promise<DeepseekLauncher> {
  if (configured) return nodeLauncher(configured)
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const executable = join(dir, process.platform === 'win32' ? 'dsh.exe' : 'dsh')
    if (await fs.pathExists(executable)) return nodeLauncher(executable)
    // npm's Windows batch shim cannot be execFile'd without a shell. Resolve
    // its official package launcher, keeping profile names out of shell text.
    const manifest = join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
    if (await fs.pathExists(manifest)) {
      const pkg = JSON.parse((await regularBytes(manifest)).toString('utf8'))
      const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.dsh
      if (pkg.name === '@deepseek-ai/dsh' && typeof bin === 'string') {
        const launcher = resolve(dirname(manifest), bin)
        const relativeLauncher = relative(dirname(manifest), launcher)
        if (!relativeLauncher.startsWith('..') && !isAbsolute(relativeLauncher)) return nodeLauncher(launcher)
      }
    }
  }
  throw new Error('DeepSeek Harness launcher is missing. Install/configure DSH separately, then pass --dsh-cli to its actual launcher; this command does not install DSH or create profiles')
}

async function linkage(ctx: Context): Promise<string[]> {
  const require = createRequire(ctx.manifest)
  const missing: string[] = []
  for (const name of [DEEPSEEK_PLUGIN_NAME, ...PEERS]) {
    try {
      const entry = require.resolve(name)
      if (PEERS.includes(name)) {
        const version = await peerVersion(entry, name)
        const schemaVersion = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
        const supported = name === '@deepseek-ai/dsh-tool-subagent'
          ? version === '0.1.0-rc.6'
          : schemaVersion !== null && Number(schemaVersion[1]) === 3 && (Number(schemaVersion[2]) > 18 || (Number(schemaVersion[2]) === 18 && Number(schemaVersion[3]) >= 1))
        if (!supported) missing.push(`${name}: unsupported version ${version || 'unknown'}`)
      }
      if (name === DEEPSEEK_PLUGIN_NAME) {
        // pnpm may link a file: dependency through its virtual store, and npm
        // may copy it. Verify its payload rather than requiring a symlink.
        const linkedRoot = dirname(dirname(await fs.realpath(entry)))
        for (const file of [...SOURCE_FILES, 'cordis.patch.yml', 'route.json']) {
          if (sha256(await fs.readFile(join(linkedRoot, file))) !== sha256(await regularBytes(join(ctx.target, file)))) {
            missing.push(`${name}: linked payload differs (${file})`)
            break
          }
        }
      }
    }
    catch { missing.push(name) }
  }
  if (missing.length === 0) {
    try {
      const entry = pathToFileURL(require.resolve(DEEPSEEK_PLUGIN_NAME)).href
      // Import only: no apply(), Harness process, provider or model request.
      // This catches missing transitive peers hidden by require.resolve().
      await execFileAsync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(entry)})`], {
        cwd: ctx.profileDir,
        shell: false,
        windowsHide: true,
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
      })
    }
    catch { missing.push(`${DEEPSEEK_PLUGIN_NAME}: module import failed (missing or incompatible peer closure)`) }
  }
  return missing
}

async function peerVersion(entry: string, name: string): Promise<string> {
  let dir = dirname(await fs.realpath(entry))
  for (let depth = 0; depth < 6; depth++) {
    const manifest = join(dir, 'package.json')
    if (await fs.pathExists(manifest)) {
      const pkg = await fs.readJson(manifest)
      if (pkg.name === name) return typeof pkg.version === 'string' ? pkg.version : ''
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return ''
}

function result(options: DeepseekHarnessOptions, state: DeepseekHarnessResult['state'], details: Partial<DeepseekHarnessResult> = {}): DeepseekHarnessResult {
  return { success: state === 'planned' || state === 'ready' || state === 'rolled-back', state, profile: options.profile, runtimeVerified: false, ...details }
}

function errorResult(options: DeepseekHarnessOptions, error: unknown): DeepseekHarnessResult {
  return result(options, 'error', { message: error instanceof Error ? error.message : String(error) })
}

export async function planDeepseekHarness(options: DeepseekHarnessOptions): Promise<DeepseekHarnessResult> {
  try {
    const ctx = context(options)
    const pkg = parseProfile(await regularBytes(ctx.manifest))
    await noLinks(ctx.target)
    const content = await assets(options)
    if (await fs.pathExists(ctx.target)) {
      const receipt = await readReceipt(ctx)
      await verifyOwned(ctx, receipt)
      for (const [file, bytes] of Object.entries(content)) {
        if (sha256(bytes) !== receipt.files[file]) throw new Error('Changing a route or plugin version requires rolling back the owned installation first')
      }
    }
    else if (pkg.dependencies?.[DEEPSEEK_PLUGIN_NAME] !== undefined || pkg.dsh.profile.bundles.includes(DEEPSEEK_PLUGIN_NAME)) {
      throw new Error('The selected profile already declares this bundle without our receipt; refusing to overwrite user configuration')
    }
    return result(options, 'planned', {
      target: ctx.target,
      changes: [`Stage ${DEEPSEEK_PLUGIN_NAME} at ${ctx.target}`, `Append only its dependency and bundle to ${ctx.manifest}`, `Link only profile ${options.profile} using DSH's package manager; do not start DSH or call a model`],
    })
  }
  catch (error) { return errorResult(options, error) }
}

export async function doctorDeepseekHarness(options: DeepseekHarnessOptions): Promise<DeepseekHarnessResult> {
  try {
    const ctx = context(options)
    parseProfile(await regularBytes(ctx.manifest))
    await noLinks(ctx.target)
    if (!await fs.pathExists(ctx.receipt)) return result(options, 'not-installed', { target: ctx.target, message: 'This explicitly selected profile has no owned compatibility installation' })
    const receipt = await readReceipt(ctx)
    await verifyOwned(ctx, receipt)
    const missing = await linkage(ctx)
    return result(options, missing.length ? 'declared-but-unlinked' : 'ready', {
      target: ctx.target,
      missingDependencies: missing,
      message: missing.length ? 'The bundle is declared but its plugin/peer dependencies are not linked' : 'Owned files and module resolution verified; native Harness boot/provider execution have not been tested',
    })
  }
  catch (error) { return errorResult(options, error) }
}

export async function installDeepseekHarness(options: DeepseekHarnessOptions): Promise<DeepseekHarnessResult> {
  if (options.dryRun) return planDeepseekHarness(options)
  try {
    const ctx = context(options)
    await noLinks(ctx.target)
    const before = await regularBytes(ctx.manifest)
    const pkg = parseProfile(before)
    const content = await assets(options)
    const launcher = await findLauncher(options.dshCli)
    const run = options.run ?? runDeepseek
    const runOptions = { cwd: ctx.profileDir, env: { ...process.env, DSH_HOME: ctx.home }, timeout: 120_000 }
    await run(launcher, ['--help'], { ...runOptions, timeout: 15_000 })
    let receipt: Receipt
    if (await fs.pathExists(ctx.target)) {
      receipt = await readReceipt(ctx)
      await verifyOwned(ctx, receipt)
      for (const [file, bytes] of Object.entries(content)) {
        if (sha256(bytes) !== receipt.files[file]) throw new Error('Changing a route or plugin version requires rolling back the owned installation first')
      }
    }
    else {
      if (pkg.dependencies?.[DEEPSEEK_PLUGIN_NAME] !== undefined || pkg.dsh.profile.bundles.includes(DEEPSEEK_PLUGIN_NAME)) {
        throw new Error('The selected profile already declares this bundle without our receipt; refusing to overwrite user configuration')
      }
      pkg.dependencies ??= {}
      pkg.dependencies[DEEPSEEK_PLUGIN_NAME] = `file:${ctx.target.replaceAll('\\', '/')}`
      pkg.dsh.profile.bundles.push(DEEPSEEK_PLUGIN_NAME)
      const after = Buffer.from(`${JSON.stringify(pkg, null, 2)}\n`)
      content['profile-package.before'] = before
      receipt = { format: 1, owner: DEEPSEEK_PLUGIN_NAME, profile: options.profile, manifest: ctx.manifest, target: ctx.target, beforeHash: sha256(before), afterHash: sha256(after), files: Object.fromEntries(Object.entries(content).map(([file, bytes]) => [file, sha256(bytes)])), state: 'declared-but-unlinked' }
      await fs.ensureDir(dirname(ctx.target))
      const stage = `${ctx.target}.staging-${randomUUID()}`
      const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`)
      await fs.mkdir(stage, { mode: 0o700 })
      try {
        for (const [file, bytes] of Object.entries(content)) {
          await fs.ensureDir(dirname(join(stage, file)))
          await fs.writeFile(join(stage, file), bytes, { flag: 'wx', mode: 0o600 })
        }
        await fs.writeFile(join(stage, 'ownership.json'), receiptBytes, { flag: 'wx', mode: 0o600 })
        if (sha256(await regularBytes(ctx.manifest)) !== receipt.beforeHash) throw new Error('The profile changed while staging; its manifest was not overwritten')
        if (await fs.pathExists(ctx.target)) throw new Error('The plugin destination appeared while staging; refusing to overwrite it')
        await fs.rename(stage, ctx.target)
      }
      catch (error) {
        await removeStage(stage, content, receiptBytes)
        throw error
      }
      try {
        await writeProfile(ctx, after, receipt.beforeHash)
      }
      catch (error) {
        await removeStage(ctx.target, content, receiptBytes)
        throw error
      }
    }
    try {
      await run(launcher, ['plugin', '--profile', options.profile, 'install'], runOptions)
      // Package managers may rewrite the profile's manifest. Preserve those
      // bytes only when our dependency/bundle and every other field survived.
      const linkedBytes = await regularBytes(ctx.manifest)
      if (sha256(linkedBytes) !== receipt.afterHash) throw new Error('The profile linker changed the manifest unexpectedly; inspect it before continuing')
      const missing = await linkage(ctx)
      if (missing.length) return result(options, 'declared-but-unlinked', { target: ctx.target, missingDependencies: missing, message: 'The linker returned successfully but required module resolution still failed; not ready' })
      receipt.state = 'ready'
      await fs.writeJson(ctx.receipt, receipt, { spaces: 2, mode: 0o600 })
      return result(options, 'ready', { target: ctx.target, message: 'Module linkage verified; no Harness process or provider request was started' })
    }
    catch (error) {
      return result(options, 'declared-but-unlinked', { target: ctx.target, message: `Profile declaration retained for explicit retry or rollback. ${error instanceof Error ? error.message : String(error)}` })
    }
  }
  catch (error) { return errorResult(options, error) }
}

export async function rollbackDeepseekHarness(options: DeepseekHarnessOptions): Promise<DeepseekHarnessResult> {
  try {
    const ctx = context(options)
    const receipt = await readReceipt(ctx)
    await verifyOwned(ctx, receipt)
    if (options.dryRun) return result(options, 'planned', { target: ctx.target, changes: [`Restore the original bytes of ${ctx.manifest}`, 'Remove only unchanged files listed in this installation receipt; keep package-manager caches and dependency directories'] })
    const before = await regularBytes(join(ctx.target, 'profile-package.before'))
    await writeProfile(ctx, before, receipt.afterHash)
    for (const file of OWNED_FILES) await fs.unlink(join(ctx.target, file))
    await fs.unlink(ctx.receipt)
    await fs.rmdir(join(ctx.target, 'src'))
    await fs.rmdir(ctx.target)
    return result(options, 'rolled-back', { target: ctx.target, message: 'Original profile bytes restored and only unchanged owned plugin files removed. Package-manager locks/caches remain for inspection; no global default or credentials changed' })
  }
  catch (error) { return errorResult(options, error) }
}
