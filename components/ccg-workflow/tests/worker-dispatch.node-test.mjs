import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { apply, createState, next } from '../plugins/ccg/skills/ccg-team/scripts/worker_dispatch.mjs'

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const helper = path.join(repo, 'plugins/ccg/skills/ccg-team/scripts/worker_dispatch.mjs')
const checker = path.join(path.dirname(helper), 'team_plan_checker.js')
// Synthetic tool IDs below are fixtures, not actual model calls. All child processes run Node locally.
function cleanupTemporary(root) {
  const relative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(root))
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative))
  assert.match(path.basename(root), /^worker-(?:dispatch|outside)-/)
  fs.rmSync(root, { recursive: true, force: true })
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-dispatch-'))
  t.after(() => cleanupTemporary(root))
  fs.mkdirSync(path.join(root, 'src'))
  fs.mkdirSync(path.join(root, 'handoffs'))
  fs.writeFileSync(path.join(root, 'src', 'base.txt'), 'baseline\n')
  return root
}
const pack = (id, reads = [], writes = [], deps = []) => ({ id, reads, writes, deps })
const spec = (root, packages, extra = {}) => ({ task: 'synthetic/task', root, allowWrites: ['src'], packages, ...extra })
const start = (state, id) => apply(state, 'start', { id, handle: `fixture:${id}`, confirmed: true })
const complete = (state, id, handle = `fixture:${id}`) => apply(state, 'complete', { id, handle, stopped: true })
const json = (filename, value) => fs.writeFileSync(filename, `${JSON.stringify(value)}\n`)
function command(script, args, expected = 0) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
  assert.equal(result.status, expected, `${result.stdout}\n${result.stderr}`)
  return JSON.parse(expected ? result.stderr || result.stdout : result.stdout)
}

test('CLI dispatches early and frozen output unlocks only its dependency before unrelated B finishes', (t) => {
  const root = fixture(t)
  const statePath = path.join(root, 'state.json')
  const payload = path.join(root, 'event.json')
  const call = (op, event, code = 0) => {
    if (event !== undefined) json(payload, event)
    return command(helper, [op, statePath, ...(event !== undefined ? [payload] : [])], code)
  }
  const packages = [pack('A', [], ['src/a.txt']), pack('B', [], ['src/b.txt']),    pack('C', ['handoffs/api-v1.json'], ['src/c.txt'], [{ id: 'A', artifact: 'api' }]),    pack('D', [], ['src/d.txt'], ['A'])]
  assert.deepEqual(call('init', spec(root, packages, { slots: 3 })).ready, ['A', 'B'])
  assert.match(call('init', spec(root, []), 1).error, /already exists/)
  call('start', { id: 'A', handle: 'fixture:A', confirmed: true })
  call('start', { id: 'B', handle: 'fixture:B', confirmed: true })
  fs.writeFileSync(path.join(root, 'src', 'a.txt'), 'working input')
  fs.writeFileSync(path.join(root, 'handoffs', 'api-v1.json'), '{"version":1}')
  assert.match(call('partial', { id: 'A', handle: 'fixture:A', artifact: 'api' }, 1).error, /frozen/)
  const partial = { id: 'A', handle: 'fixture:A', artifact: 'api', version: 'fixture-v1',    location: 'handoffs/api-v1.json', frozen: true, rootConfirmed: true }
  assert.deepEqual(call('partial', partial).ready, ['C'])
  assert.match(call('partial', partial, 1).error, /cannot be replaced/)
  call('start', { id: 'C', handle: 'fixture:C', confirmed: true })
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'handoffs', 'api-v1.json'))).version, 1)
  fs.writeFileSync(path.join(root, 'src', 'c.txt'), 'used fixed api-v1\n')
  assert.deepEqual(call('complete', { id: 'A', handle: 'fixture:A', stopped: true }).ready, ['D'])
  const state = JSON.parse(fs.readFileSync(statePath))
  assert.equal(state.packages.find(item => item.id === 'B').status, 'running')
  assert.equal(state.packages.find(item => item.id === 'C').status, 'running')
  assert.equal(state.packages.find(item => item.id === 'A').status, 'completed')
  assert.equal(fs.readFileSync(path.join(root, 'src', 'c.txt'), 'utf8'), 'used fixed api-v1\n')
})

test('read/read parallelism and case-insensitive write/read and write/write conflicts serialize', (t) => {
  const root = fixture(t)
  let state = createState(spec(root, [pack('R1', ['src/base.txt']), pack('R2', ['SRC/base.txt']),    pack('W', [], ['src/base.txt']), pack('D', [], ['src/base.txt'])], { slots: 4 }))
  assert.deepEqual(next(state).ready, ['R1', 'R2'])
  state = start(start(state, 'R1'), 'R2')
  assert.throws(() => start(state, 'W'), /conflict/)
  state = complete(state, 'R1')
  assert.deepEqual(next(state).ready, [])
  state = complete(state, 'R2')
  assert.deepEqual(next(state).ready, ['W'])
  state = start(state, 'W')
  assert.throws(() => start(state, 'D'), /conflict/)
  state = complete(state, 'W')
  assert.deepEqual(next(state).ready, ['D'])
})

test('completion starts C while B is running; no batch barrier', (t) => {
  const root = fixture(t)
  let state = createState(spec(root, [pack('A'), pack('B'), pack('C', [], ['src/c'], ['A'])]))
  state = start(start(state, 'A'), 'B')
  state = complete(state, 'A')
  assert.deepEqual(next(state).ready, ['C'])
  assert.equal(state.packages.find(item => item.id === 'B').status, 'running')
})

test('failure leaves independent branches ready and root takeover is explicit', (t) => {
  const root = fixture(t)
  let state = createState(spec(root, [pack('A', [], ['src/a']), pack('B'), pack('C', [], [], ['A'])]))
  state = start(state, 'A')
  state = apply(state, 'fail', { id: 'A', handle: 'fixture:A', reason: 'fixture unavailable tool', stopped: true })
  assert.deepEqual(next(state).ready, ['B'])
  assert.deepEqual(next(state).fallback, ['A'])
  assert.equal(state.packages[0].status, 'failed')
  state = apply(state, 'fallback', { id: 'A', reason: 'root can finish this small leaf' })
  assert.equal(state.starts, 1)
  assert.equal(state.packages[0].executor, 'root')
  fs.writeFileSync(path.join(root, 'src', 'a'), 'root recovered\n')
  state = complete(state, 'A', state.packages[0].handle)
  assert.deepEqual(next(state).ready, ['B', 'C'])
})

test('cancel/failure without confirmed stop retains ownership; late results cannot overwrite successor', (t) => {
  const root = fixture(t)
  let state = createState(spec(root, [pack('A', [], ['src/a']), pack('B', [], ['src/a']), pack('C')]))
  state = start(state, 'A')
  state = apply(state, 'fail', { id: 'A', handle: 'fixture:A', reason: 'timeout', stopped: false })
  assert.deepEqual(next(state).ready, ['C'])
  assert.equal(next(state).attention[0].id, 'A')
  state = apply(state, 'cancel', { id: 'A', handle: 'fixture:A' })
  assert.throws(() => apply(state, 'fallback', { id: 'A', reason: 'too early' }), /not available/)
  assert.throws(() => complete(state, 'A'), /terminal/)
  state = apply(state, 'stopped', { id: 'A', handle: 'fixture:A', confirmed: true })
  state = start(state, 'B')
  assert.throws(() => complete(state, 'A'), /stale handle/)
  assert.throws(() => apply(state, 'fallback', { id: 'A', reason: 'B now owns file' }), /conflict/)
})

test('each root takeover gets a new handle and rejects the previous takeover result', (t) => {
  const root = fixture(t)
  let state = createState(spec(root, [pack('A', [], ['src/a']), pack('B', [], ['src/a'], ['A'])]))
  state = apply(state, 'fallback', { id: 'A', reason: 'root handles first attempt' })
  const oldHandle = state.packages[0].handle
  state = apply(state, 'fail', { id: 'A', handle: oldHandle, reason: 'retry required', stopped: true })
  state = apply(state, 'fallback', { id: 'A', reason: 'root retries leaf' })
  const newHandle = state.packages[0].handle
  assert.notEqual(newHandle, oldHandle)
  assert.throws(() => complete(state, 'A', oldHandle), /stale handle/)
  assert.equal(state.packages[0].holds, true)
  assert.deepEqual(next(state).ready, [])
  state = complete(state, 'A', newHandle)
  assert.deepEqual(next(state).ready, ['B'])
})

test('simple zero-worker task and missing metadata do not gate execution or expand writes', (t) => {
  const root = fixture(t)
  const simple = createState(spec(root, []))
  assert.deepEqual(next(simple).ready, [])
  assert.equal(simple.size, 0)
  const unknown = { id: 'unknown', reads: [] }
  const state = createState(spec(root, [unknown, pack('outside', [], ['elsewhere/file']), pack('R', ['src/base.txt'])]))
  assert.deepEqual(next(state).ready, ['R'])
  assert.match(next(state).blocked.find(item => item.id === 'unknown').reason, /unknown writes/)
  assert.match(next(state).blocked.find(item => item.id === 'outside').reason, /allowWrites/)
  assert.deepEqual(state.allowWrites, ['src'])
  assert.ok(state.batch)
  assert.equal(state.size, 3)
  assert.throws(() => apply(state, 'start', { id: 'R' }), /real tool handle/)
})

test('dynamic capacity and budget are ceilings, and timeout requests root handling without releasing locks', (t) => {
  const root = fixture(t)
  let state = createState(spec(root, [{ ...pack('A'), timeoutMs: 10 }, pack('B'), pack('C'), pack('D')]))
  assert.deepEqual(next(state).ready, ['A', 'B'])
  state = apply(state, 'capacity', { slots: 4 })
  assert.deepEqual(next(state).ready, ['A', 'B', 'C', 'D'])
  assert.throws(() => apply(state, 'capacity', { slots: 5 }), /1..4/)
  state = apply(state, 'start', { id: 'A', handle: 'fixture:A', confirmed: true }, 100)
  assert.equal(next(state, 111).attention[0].id, 'A')
  assert.equal(state.packages[0].holds, true)
  const budget = createState(spec(root, [pack('R')], { maxStarts: 0 }))
  assert.deepEqual(next(budget).ready, [])
  const rootState = apply(budget, 'fallback', { id: 'R', reason: 'no worker budget' })
  assert.equal(rootState.packages[0].status, 'running')
  assert.equal(rootState.starts, 0)
})

test('unknown and cyclic dependencies block only affected branches with actionable reasons', (t) => {
  const root = fixture(t)
  const state = createState(spec(root, [pack('A', [], [], ['B']), pack('B', [], [], ['A']),    pack('missing', [], [], ['absent']), pack('R')]))
  const result = next(state)
  assert.deepEqual(result.ready, ['R'])
  assert.match(result.blocked.find(item => item.id === 'A').reason, /dependency cycle/)
  assert.match(result.blocked.find(item => item.id === 'missing').reason, /unknown dependency: absent/)
})

test('path escape, protected state, shared writes, glob, ADS and ambiguous Windows names are denied locally', (t) => {
  const root = fixture(t)
  const bad = ['../outside', 'C:\\outside', '/outside', 'src/*.js', 'src/a:stream', 'src/NUL',    'src/name.', 'src/SHORT~1', '.codex/status.json', 'src/.trellis/task.json', '.git/config',    '.harness/ownership.json', '.harness/project.json', '.claude/settings.json']
  for (const target of bad) {
    const state = createState(spec(root, [pack('bad', [], [target]), pack('good')]))
    assert.deepEqual(next(state).ready, ['good'], target)
    assert.throws(() => start(state, 'bad'), undefined, target)
  }
  for (const target of ['.harness/ownership.json', '.harness/project.json', '.claude/settings.json']) {
    const state = createState(spec(root, [pack('bad', [], [target]), pack('good')], { allowWrites: [target] }))
    assert.deepEqual(next(state).ready, ['good'], target)
    assert.match(next(state).blocked[0].reason, /protected state path/)
    assert.throws(() => start(state, 'bad'), /protected state path/)
  }
  const shared = createState(spec(root, [pack('bad', [], ['src/base.txt']), pack('R', ['src/base.txt'])], { shared: ['src/base.txt'] }))
  assert.deepEqual(next(shared).ready, ['R'])
  assert.match(next(shared).blocked[0].reason, /root-owned shared/)
})

test('junction aliases are canonicalized, escapes denied, and hardlinked writes require root handling', (t) => {
  const root = fixture(t)
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-outside-'))
  t.after(() => cleanupTemporary(outside))
  fs.symlinkSync(path.join(root, 'src'), path.join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir')
  fs.symlinkSync(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
  let state = createState(spec(root, [pack('A', [], ['src/base.txt']), pack('B', ['alias/base.txt']), pack('X', [], ['escape/new.txt'])]))
  assert.deepEqual(next(state).ready, ['A'])
  state = start(state, 'A')
  assert.match(next(state).blocked.find(item => item.id === 'B').reason, /conflict/)
  assert.match(next(state).blocked.find(item => item.id === 'X').reason, /outside task root/)
  fs.linkSync(path.join(root, 'src/base.txt'), path.join(root, 'src/linked.txt'))
  const aliases = createState(spec(root, [pack('W', [], ['src/linked.txt']), pack('R', ['src/base.txt'])]))
  assert.deepEqual(next(aliases).ready, ['R'])
  assert.match(next(aliases).blocked[0].reason, /hard-link alias/)
})

test('dangling symlink to a nonexistent outside file is rejected even when allowlisted', (t) => {
  const root = fixture(t)
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-outside-'))
  t.after(() => cleanupTemporary(outside))
  const target = path.join(outside, 'new.txt')
  fs.symlinkSync(target, path.join(root, 'dangling.txt'), 'file')
  assert.equal(fs.existsSync(path.join(root, 'dangling.txt')), false)
  assert.equal(fs.lstatSync(path.join(root, 'dangling.txt')).isSymbolicLink(), true)
  const state = createState(spec(root, [pack('W', [], ['dangling.txt']), pack('R')], { allowWrites: ['dangling.txt'] }))
  assert.deepEqual(next(state).ready, ['R'])
  assert.match(next(state).blocked.find(item => item.id === 'W').reason, /dangling|unresolved/)
  assert.throws(() => start(state, 'W'), /dangling|unresolved/)
  assert.equal(fs.existsSync(target), false)
})

test('invalid allowWrites entry denies its branch without poisoning an independent verified grant', (t) => {
  const root = fixture(t)
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-outside-'))
  t.after(() => cleanupTemporary(outside))
  fs.symlinkSync(path.join(outside, 'new.txt'), path.join(root, 'src', 'dangling.txt'), 'file')
  const state = createState(spec(root, [pack('bad', [], ['src/dangling.txt']), pack('good', [], ['src/good.txt']),    pack('unauthorized', [], ['src/other.txt'])], { allowWrites: ['src/dangling.txt', 'src/good.txt'] }))
  const result = next(state)
  assert.deepEqual(result.ready, ['good'])
  assert.match(result.blocked.find(item => item.id === 'bad').reason, /dangling|unresolved/)
  assert.match(result.blocked.find(item => item.id === 'unauthorized').reason, /outside allowWrites/)
  assert.throws(() => start(state, 'bad'), /dangling|unresolved/)
  assert.equal(start(state, 'good').packages[1].status, 'running')
})

test('directory writes are rejected before a nested junction can alias another writer', (t) => {
  const root = fixture(t)
  fs.mkdirSync(path.join(root, 'lib'))
  fs.writeFileSync(path.join(root, 'lib', 'shared.txt'), 'shared\n')
  fs.symlinkSync(path.join(root, 'lib'), path.join(root, 'src', 'alias'), process.platform === 'win32' ? 'junction' : 'dir')
  const state = createState(spec(root, [pack('A', [], ['src']), pack('B', [], ['lib/shared.txt'])], { allowWrites: ['src', 'lib'] }))
  assert.deepEqual(next(state).ready, ['B'])
  assert.match(next(state).blocked.find(item => item.id === 'A').reason, /exact files/)
  assert.throws(() => start(state, 'A'), /exact files/)
  assert.equal(start(state, 'B').packages[1].status, 'running')
})

test('directory reads use a project-wide conflict lock without expanding declared read scope', (t) => {
  const root = fixture(t)
  fs.mkdirSync(path.join(root, 'lib'))
  fs.writeFileSync(path.join(root, 'lib', 'shared.txt'), 'shared\n')
  fs.symlinkSync(path.join(root, 'lib'), path.join(root, 'src', 'alias'), process.platform === 'win32' ? 'junction' : 'dir')
  let state = createState(spec(root, [pack('R', ['src']), pack('R2', ['src']), pack('W', [], ['lib/shared.txt'])],    { allowWrites: ['lib'], slots: 4 }))
  assert.deepEqual(next(state).ready, ['R', 'R2'])
  state = start(start(state, 'R'), 'R2')
  assert.deepEqual(state.packages[0].reads, ['src'])
  assert.throws(() => start(state, 'W'), /conflict/)
  state = complete(complete(state, 'R'), 'R2')
  assert.deepEqual(next(state).ready, ['W'])
  const shared = createState(spec(root, [pack('W', [], ['lib/shared.txt']), pack('R', ['src'])],    { allowWrites: ['lib'], shared: ['src'] }))
  assert.deepEqual(next(shared).ready, ['R'])
  assert.match(next(shared).blocked.find(item => item.id === 'W').reason, /root-owned shared/)
})

const plan = rows => `# Synthetic team\n## Workers\n${rows}\n## Merge Strategy\nRoot merges/resolves A and B in src/base.txt.\n## Verification Strategy\nnode --test\n## Conflict Risks\nRoot owns integration.\n`
function checkPlan(root, text, expected = 0, script = checker) {
  const planPath = path.join(root, 'plan.md')
  fs.writeFileSync(planPath, text)
  return command(script, ['validate', planPath, '--json'], expected)
}

test('checker runs in source ESM and copied CommonJS installation, accepts zero workers, preserves status', (t) => {
  const root = fixture(t)
  const table = '| Worker | Scope | Reads | Writes | Deps |\n|---|---|---|---|---|\n'
  assert.equal(checkPlan(root, plan(table)).can_execute, true)
  const withReaders = plan(`${table}| A | research | src/base.txt | - | - |\n| B | review | src/base.txt | - | - |`)
  assert.deepEqual(checkPlan(root, withReaders).same_file_conflicts, [])
  const statusPath = path.join(root, 'status.json')
  const saved = JSON.parse(fs.readFileSync(statusPath))
  saved.workers.A = { status: 'running', handle: 'fixture:A', files: ['old-owned.txt'], marker: 1 }
  saved.custom = { rootOwned: true }
  json(statusPath, saved)
  const installed = path.join(root, 'team_plan_checker.js')
  fs.copyFileSync(checker, installed)
  assert.equal(checkPlan(root, withReaders, 0, installed).can_execute, true)
  const preserved = JSON.parse(fs.readFileSync(statusPath))
  assert.equal(preserved.workers.A.status, 'running')
  assert.equal(preserved.workers.A.handle, 'fixture:A')
  assert.deepEqual(preserved.workers.A.files, ['old-owned.txt'])
  assert.deepEqual(preserved.workers.A.plan.reads, ['src/base.txt'])
  assert.deepEqual(preserved.custom, { rootOwned: true })
})

test('checker treats legacy Files as writes and prose merge promises cannot authorize competing writers', (t) => {
  const root = fixture(t)
  const legacy = '| Worker | Scope | Files | Constraints |\n|---|---|---|---|\n| A | edit | src/base.txt | owner |\n| B | edit | SRC/base.txt | merge |'
  const failed = checkPlan(root, plan(legacy), 1)
  assert.equal(failed.can_execute, false)
  assert.match(failed.blocking_reasons[0], /ordered Deps/)
  const table = '| Worker | Scope | Reads | Writes | Deps |\n|---|---|---|---|---|\n'
  const conflict = `${table}| A | edit | - | src | - |\n| B | review | src/base.txt | - | - |`
  assert.equal(checkPlan(root, plan(conflict), 1).same_file_conflicts.length, 1)
  const serial = conflict.replace('src/base.txt | - | - |', 'src/base.txt | - | A |')
  assert.equal(checkPlan(root, plan(serial)).can_execute, true)
  const cycle = serial.replace('| src | - |', '| src | B |')
  assert.ok(checkPlan(root, plan(cycle), 1).blocking_reasons.some(reason => reason.includes('cycle')))
})
