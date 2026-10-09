#!/usr/bin/env node
// Root-only scheduling ledger. It neither spawns agents nor grants filesystem permissions.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const reserved = new Set(['.git', '.codex', '.ccg', '.trellis', '.harness', '.claude'])
const clone = value => structuredClone(value)
const overlaps = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
const key = value => value.replaceAll('\\', '/').toLowerCase()
const requireThat = (ok, message) => { if (!ok) throw new Error(message) }

// Resolve existing ancestors too: a missing output beneath a symlink is not a new safe path.
function resolved(target) {
  const tail = []
  let cursor = target
  while (true) {
    try {
      fs.lstatSync(cursor)
      break
    }
    catch (error) {
      if (error.code !== 'ENOENT') throw error
      const parent = path.dirname(cursor)
      requireThat(parent !== cursor, `cannot resolve path: ${target}`)
      tail.unshift(path.basename(cursor))
      cursor = parent
    }
  }
  try {
    return path.join(fs.realpathSync.native(cursor), ...tail)
  }
  catch {
    throw new Error(`dangling or unresolved path: ${target}`)
  }
}

function resource(state, input, writing = false, exactFile = false) {
  requireThat(typeof input === 'string' && input.trim(), 'paths must be nonempty strings')
  const relative = input.replaceAll('\\', '/')
  const segments = relative.replace(/\/$/, '').split('/')
  requireThat(!path.posix.isAbsolute(relative) && !path.win32.isAbsolute(input), `absolute path: ${input}`)
  requireThat(!segments.some(part => !part || part === '..' || /[:*?<>|]/.test(part)
    || /[. ]$/.test(part) && part !== '.' || /~\d/.test(part)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)), `ambiguous or escaping path: ${input}`)
  const lexical = path.resolve(state.root, relative)
  const target = resolved(lexical)
  const rootKey = key(state.root)
  const targetKey = key(target)
  requireThat(targetKey === rootKey || targetKey.startsWith(`${rootKey}/`), `path outside task root: ${input}`)
  const relativeKey = targetKey.slice(rootKey.length + 1)
  if (writing) {
    requireThat(targetKey !== rootKey && !relativeKey.split('/').some(part => reserved.has(part)), `protected state path: ${input}`)
    requireThat(!segments.some(part => reserved.has(part.toLowerCase())), `protected state path: ${input}`)
  }
  const stat = fs.existsSync(target) ? fs.statSync(target, { bigint: true }) : null
  requireThat(!exactFile || (!stat || stat.isFile()) && !/[\\/]$/.test(input), `worker writes require exact files; root must expand directory: ${input}`)
  let inode = null
  if (stat?.isFile()) {
    requireThat(!writing || stat.nlink === 1n, `write through hard-link alias requires root handling: ${input}`)
    inode = `${stat.dev}:${stat.ino}`
  }
  return { path: targetKey, inode, directory: stat?.isDirectory() || false }
}

const collides = (a, b) => overlaps(a.path, b.path) || Boolean(a.inode && a.inode === b.inode)

function access(state, work) {
  requireThat(Array.isArray(work.writes), 'unknown writes: root must supply a trusted writes array (use [] for read-only)')
  requireThat(Array.isArray(work.reads), 'unknown reads: root must supply a reads array')
  // A directory may contain unseen links. Widen only its conflict lock, not its declared authority.
  const directoryLock = item => item.directory ? { ...item, path: key(state.root) } : item
  const reads = work.reads.map(item => directoryLock(resource(state, item)))
  const writes = work.writes.map(item => resource(state, item, true, true))
  const shared = writes.length ? state.shared.map(item => directoryLock(resource(state, item))) : []
  for (const output of writes) {
    const authorized = state.allowWrites.some(item => {
      try {
        const grant = resource(state, item, true)
        return output.path === grant.path || output.path.startsWith(`${grant.path}/`)
      }
      catch {
        // An unverifiable entry grants nothing; independent verified grants remain usable.
        return false
      }
    })
    requireThat(authorized, `write outside allowWrites: ${output.path}`)
    requireThat(!shared.some(item => collides(item, output)), `root-owned shared path: ${output.path}`)
  }
  return { reads, writes }
}

function conflict(a, b) {
  return a.writes.some(x => [...b.reads, ...b.writes].some(y => collides(x, y)))
    || b.writes.some(x => a.reads.some(y => collides(x, y)))
}

function locks(state, work) {
  // Keep both admission-time and current identities, even if a path is renamed or retargeted.
  const before = work.lock || { reads: [], writes: [] }
  try {
    const current = access(state, work)
    return { reads: [...before.reads, ...current.reads], writes: [...before.writes, ...current.writes] }
  }
  catch {
    return before
  }
}

function dependencyIssue(state, work, trail = []) {
  if (trail.includes(work.id)) return `dependency cycle: ${[...trail, work.id].join(' -> ')}`
  for (const dep of work.deps) {
    const id = typeof dep === 'string' ? dep : dep.id
    const upstream = state.packages.find(item => item.id === id)
    if (!upstream) return `unknown dependency: ${id}`
    if (typeof dep === 'object' ? Object.hasOwn(upstream.partials, dep.artifact) : upstream.status === 'completed') continue
    const issue = dependencyIssue(state, upstream, [...trail, work.id])
    if (issue) return issue
  }
  return null
}

function dependencyReason(state, work) {
  const issue = dependencyIssue(state, work)
  if (issue) return issue
  for (const dep of work.deps) {
    const id = typeof dep === 'string' ? dep : dep.id
    const upstream = state.packages.find(item => item.id === id)
    if (!upstream) return `unknown dependency: ${id}`
    if (typeof dep === 'object' && dep.artifact) {
      if (!Object.hasOwn(upstream.partials, dep.artifact)) return `waiting for frozen artifact: ${id}/${dep.artifact}`
    }
    else if (upstream.status !== 'completed') return `waiting for completion: ${id} (${upstream.status})`
  }
  return null
}

export function createState(spec, now = Date.now()) {
  requireThat(spec && typeof spec.task === 'string' && spec.task.trim(), 'task reference is required')
  requireThat(typeof spec.root === 'string' && fs.statSync(spec.root).isDirectory(), 'existing root directory is required')
  requireThat(Array.isArray(spec.allowWrites || []), 'allowWrites must be an array')
  requireThat(Array.isArray(spec.shared || []), 'shared must be an array')
  requireThat(Array.isArray(spec.packages), 'packages must be an array (empty is valid for simple tasks)')
  const slots = spec.slots ?? 2
  requireThat(Number.isInteger(slots) && slots >= 1 && slots <= 4, 'slots must be 1..4')
  const ids = new Set()
  const packages = spec.packages.map(work => {
    requireThat(typeof work.id === 'string' && work.id.trim() && !ids.has(work.id), 'package ids must be unique nonempty strings')
    ids.add(work.id)
    requireThat(Array.isArray(work.deps || []), 'deps must be an array')
    requireThat((work.deps || []).every(dep => typeof dep === 'string' || dep && typeof dep.id === 'string'
      && typeof dep.artifact === 'string' && dep.artifact.trim()), 'deps require an id or {id,artifact}')
    return { ...clone(work), deps: work.deps || [], status: 'pending', handle: null, holds: false, partials: {}, attempt: 0 }
  })
  return {
    version: 1, task: spec.task, root: fs.realpathSync.native(spec.root),
    allowWrites: spec.allowWrites || [], shared: ['AGENTS.md', ...(spec.shared || [])], slots,
    batch: spec.batch || `batch-${now}`, size: packages.length,
    maxStarts: Number.isInteger(spec.maxStarts) && spec.maxStarts >= 0 ? spec.maxStarts : null,
    starts: 0, packages,
  }
}

export function next(state, now = Date.now()) {
  const active = state.packages.filter(work => work.holds)
  let free = state.slots - active.filter(work => work.executor !== 'root').length
  let budget = state.maxStarts === null ? Infinity : state.maxStarts - state.starts
  const selected = []
  const blocked = []
  const attention = active.filter(work => work.status === 'stopping' || work.status === 'failed'
    || work.timeoutMs && now - work.startedAt >= work.timeoutMs)
    .map(work => ({ id: work.id, status: work.status, action: 'root must inspect/cancel and confirm stopped before releasing ownership' }))
  for (const work of state.packages.filter(item => item.status === 'pending')) {
    let reason = dependencyReason(state, work)
    let scope
    try { scope = access(state, work) }
    catch (error) { reason ||= error.message }
    if (!reason) {
      const owner = [...active, ...selected].find(item => conflict(scope, locks(state, item)))
      if (owner) reason = `access conflict with ${owner.id}`
    }
    if (!reason && free <= 0) reason = 'worker capacity reached'
    if (!reason && budget <= 0) reason = 'worker start budget reached; root may explicitly take over'
    if (reason) blocked.push({ id: work.id, reason })
    else { selected.push(work); free--; budget-- }
  }
  return { task: state.task, ready: selected.map(work => work.id), blocked, attention,
    active: active.map(work => ({ id: work.id, handle: work.handle, status: work.status, executor: work.executor })),
    fallback: state.packages.filter(work => ['failed', 'stopped'].includes(work.status) && !work.holds).map(work => work.id) }
}

export function apply(state, operation, event, now = Date.now()) {
  const output = clone(state)
  if (operation === 'capacity') {
    requireThat(Number.isInteger(event.slots) && event.slots >= 1 && event.slots <= 4, 'slots must be 1..4')
    output.slots = event.slots
    return output
  }
  const work = output.packages.find(item => item.id === event.id)
  requireThat(work, `unknown package: ${event.id}`)
  if (operation === 'start' || operation === 'fallback') {
    requireThat(!work.holds && (operation === 'start' ? work.status === 'pending' : ['pending', 'failed', 'stopped'].includes(work.status)), 'package is not available for admission')
    const scope = access(output, work)
    requireThat(!dependencyReason(output, work), dependencyReason(output, work))
    requireThat(!output.packages.some(item => item.holds && conflict(scope, locks(output, item))), 'access conflict: wait for owner to stop')
    work.attempt = (work.attempt ?? 0) + 1
    if (operation === 'start') {
      requireThat(next(output, now).ready.includes(work.id), 'package is not in next.ready')
      requireThat(event.confirmed === true && typeof event.handle === 'string' && event.handle.trim(), 'root must confirm a real tool handle')
      requireThat(!output.packages.some(item => item.handle === event.handle), 'tool handle already used')
      work.handle = event.handle
      work.executor = 'worker'
      output.starts++
    }
    else {
      requireThat(typeof event.reason === 'string' && event.reason.trim(), 'root takeover reason is required')
      work.handle = `root:${output.task}:${work.id}:${work.attempt}`
      work.executor = 'root'
      work.fallbackReason = event.reason
    }
    work.status = 'running'
    work.holds = true
    work.lock = scope
    work.startedAt = now
    return output
  }
  requireThat(work.holds && event.handle === work.handle, 'stale handle or released ownership')
  if (operation === 'partial') {
    requireThat(work.status === 'running', 'only a running owner can hand off partial output')
    requireThat(event.frozen === true && event.rootConfirmed === true, 'root must confirm a frozen/versioned handoff')
    for (const field of ['artifact', 'version', 'location']) requireThat(typeof event[field] === 'string' && event[field].trim(), `${field} is required`)
    requireThat(!Object.hasOwn(work.partials, event.artifact), 'frozen artifact cannot be replaced; use a new artifact name')
    Object.defineProperty(work.partials, event.artifact, { value: { version: event.version, location: event.location, at: now }, enumerable: true, writable: true, configurable: true })
  }
  else if (operation === 'complete') {
    requireThat(work.status === 'running' && event.stopped === true, 'completion requires confirmed terminal execution')
    work.status = 'completed'
    work.holds = false
    work.finishedAt = now
  }
  else if (operation === 'cancel') {
    requireThat(['running', 'failed', 'stopping'].includes(work.status), 'cannot cancel this package')
    work.status = 'stopping'
  }
  else if (operation === 'fail') {
    requireThat(work.status === 'running', 'only a running owner can fail')
    requireThat(typeof event.reason === 'string' && event.reason.trim(), 'failure reason is required')
    work.status = 'failed'
    work.failure = event.reason
    if (event.stopped === true) work.holds = false
  }
  else if (operation === 'stopped') {
    requireThat(['stopping', 'failed'].includes(work.status) && event.confirmed === true, 'confirm tool termination after cancel/failure')
    work.holds = false
    if (work.status !== 'failed') work.status = 'stopped'
  }
  else throw new Error(`unknown operation: ${operation}`)
  return output
}

function readJSON(filename) { return JSON.parse(fs.readFileSync(filename, 'utf8')) }

export function main(argv = process.argv.slice(2)) {
  const [command, statePath, payloadPath] = argv
  requireThat(command && statePath, 'usage: worker_dispatch.mjs init|next|start|partial|complete|fail|cancel|stopped|fallback|capacity <state.json> [spec-or-event.json]')
  if (command === 'next') return next(readJSON(statePath))
  requireThat(payloadPath, 'spec/event JSON file is required')
  // Root is the single ledger writer. Lock prevents accidental concurrent CLI updates.
  const lockPath = `${statePath}.lock`
  const descriptor = fs.openSync(lockPath, 'wx')
  let temporary
  try {
    let state
    if (command === 'init') {
      requireThat(!fs.existsSync(statePath), 'state already exists; refusing to reset execution')
      const spec = readJSON(payloadPath)
      state = createState(spec)
      const relative = path.relative(state.root, path.resolve(statePath))
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) state.shared.push(relative)
    }
    else state = apply(readJSON(statePath), command, readJSON(payloadPath))
    temporary = `${statePath}.${process.pid}.tmp`
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx' })
    fs.renameSync(temporary, statePath)
    temporary = null
    return { state_path: path.resolve(statePath), ...next(state) }
  }
  finally {
    if (temporary && fs.existsSync(temporary)) fs.unlinkSync(temporary)
    fs.closeSync(descriptor)
    fs.unlinkSync(lockPath)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(main(), null, 2)) }
  catch (error) { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1 }
}
