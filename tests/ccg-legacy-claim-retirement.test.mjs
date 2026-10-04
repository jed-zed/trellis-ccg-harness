import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync,
  renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import test from 'node:test';
import { resolvePython } from '../scripts/lib/python-resolver.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PYTHON = process.platform === 'win32' ? realpathSync(process.env.HARNESS_RETIREMENT_PYTHON
  ?? resolvePython().command) : null;
const ACTUAL_STOCK = process.env.HARNESS_RETIREMENT_STOCK_HELPER;
const FILES = ['scripts/ccg-legacy-claims.mjs', 'scripts/lib/ccg-legacy-claim-retirement.mjs',
  'scripts/lib/ccg-legacy-claim-leases.py', 'scripts/lib/ccg-legacy-claim-guard.mjs',
  'scripts/lib/harness-lifecycle.mjs', 'scripts/lib/harness-transaction.mjs',
  'scripts/lib/harness-fs.mjs', 'scripts/harness-lifecycle.mjs', 'scripts/ccg-runtime.mjs'];
const sha = value => createHash('sha256').update(value).digest('hex');
const enc = value => `${JSON.stringify(value, null, 2)}\n`;
const write = (file, data) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, data); };
const json = (file, value) => write(file, enc(value));
const nativeTest = (name, body) => test(name, { skip: process.platform !== 'win32' }, body);

// Portable source tests exercise the explicit external-helper protocol with this
// small private fixture. Set HARNESS_RETIREMENT_STOCK_HELPER for the separately
// pinned real distribution helper; no offline npm/install claim follows from the
// default fixture. The retirement's own native leases are real in both modes.
const STOCK_FIXTURE = String.raw`import argparse,hashlib,json
from pathlib import Path
def sha(data): return hashlib.sha256(data).hexdigest()
def state(path):
 if not path.exists(): return None
 data=path.read_bytes(); return {'bytes':len(data),'sha256':sha(data)}
def put(path,data):
 path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(data)
p=argparse.ArgumentParser(); p.add_argument('command'); p.add_argument('--plan'); p.add_argument('--backup',required=True); p.add_argument('--output'); a=p.parse_args(); backup=Path(a.backup)
if a.command=='apply':
 raw=Path(a.plan).read_bytes(); plan=json.loads(raw); prefix=Path(plan['prefix']); candidate=Path(plan['candidatePrefix']); backup.mkdir()
 for row in plan['rows']:
  assert state(prefix/row['path'])==row['before']
  assert state(candidate/row['path'])==row['after']
 changed=[r for r in plan['rows'] if r['before']!=r['after']]
 for row in changed:
  target=prefix/row['path']
  if row['before']: put(backup/'bytes'/row['path'],target.read_bytes())
  if row['after']: put(target,(candidate/row['path']).read_bytes())
  else: target.unlink()
 receipt={'schemaVersion':1,'kind':'ccg-stock-npm-prefix-transaction','prefix':str(prefix),'planSha256':sha(raw),'completed':True,'rows':changed,'unchangedRows':[r for r in plan['rows'] if r not in changed]}
 put(backup/'receipt.json',(json.dumps(receipt)+'\n').encode()); print(json.dumps({'completed':True}))
else:
 receipt=json.loads((backup/'receipt.json').read_bytes()); prefix=Path(receipt['prefix']); held=[]
 for row in receipt['rows']:
  target=prefix/row['path']
  if state(target)!=row['after']: held.append(row['path']); continue
  if row['before']: put(target,(backup/'bytes'/row['path']).read_bytes())
  else: target.unlink()
 put(Path(a.output),(json.dumps({'preservedUserChanges':held})+'\n').encode()); print(json.dumps({'completed':True}))
`;

async function fixture(t) {
  const top = mkdtempSync(path.join(tmpdir(), 'lc-'));
  t.after(() => {
    assert.ok(path.resolve(top).startsWith(path.resolve(tmpdir()) + path.sep)
      && path.basename(top).startsWith('lc-'));
    rmSync(top, { recursive: true, force: true });
  });
  const root = path.join(top, 'code'), prefix = path.join(top, 'npm'), candidate = path.join(top, 'stage');
  const owners = [path.join(top, 'old15'), path.join(top, 'old12')], codexHome = path.join(top, 'codex');
  for (const dir of [root, prefix, candidate, codexHome, ...owners]) mkdirSync(dir);
  for (const file of FILES) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    cpSync(path.join(ROOT, file), path.join(root, file));
  }
  write(path.join(root, 'package.json'), '{"type":"module"}\n');
  const stockHelper = ACTUAL_STOCK ? path.resolve(ACTUAL_STOCK) : path.join(top, 'private-stock-helper.py');
  if (!ACTUAL_STOCK) write(stockHelper, STOCK_FIXTURE);
  const mod = await import(pathToFileURL(path.join(root, 'scripts/lib/ccg-legacy-claim-retirement.mjs')).href);
  const lifecycle = await import(pathToFileURL(path.join(root, 'scripts/lib/harness-lifecycle.mjs')).href);
  const guard = await import(pathToFileURL(path.join(root, 'scripts/lib/ccg-legacy-claim-guard.mjs')).href);
  const transaction = await import(pathToFileURL(path.join(root, 'scripts/lib/harness-transaction.mjs')).href);
  const pkg = path.join(prefix, 'node_modules/ccg-workflow');
  const bin = path.join(pkg, 'bin/ccg.mjs');
  const manifest = version => ({ name: 'ccg-workflow', version, bin: { ccg: 'bin/ccg.mjs' } });
  write(bin, '// private fixture runtime, never executed\n');
  for (const name of ['ccg', 'ccg.cmd', 'ccg.ps1']) write(path.join(prefix, name), `fixture alias ${name}\n`);
  const trellis = path.join(prefix, 'node_modules/@mindfoldhq/trellis');
  json(path.join(trellis, 'package.json'), { name: '@mindfoldhq/trellis', version: '0.6.16' });
  const trellisSnapshot = await lifecycle.inspectGlobalPackage(path.join(prefix, 'node_modules'), '@mindfoldhq/trellis');
  for (const [index, version] of ['3.4.15', '3.4.12'].entries()) {
    json(path.join(pkg, 'package.json'), manifest(version));
    const installed = await lifecycle.inspectGlobalPackage(path.join(prefix, 'node_modules'), 'ccg-workflow');
    json(path.join(owners[index], '.harness-cache/ownership.json'), {
      schemaVersion: 2, repoRoot: owners[index], updatedAt: '2026-10-04T00:00:00Z', entries: [
        { id: 'ccg-link', kind: 'npm-global-package', package: 'ccg-workflow',
          originalBeforeFirstManagement: null, installedByHarness: installed },
        { id: 'trellis-global', kind: 'npm-global-package', package: '@mindfoldhq/trellis',
          originalBeforeFirstManagement: null, installedByHarness: trellisSnapshot },
      ],
    });
  }
  json(path.join(pkg, 'package.json'), manifest('3.4.16-localarchive.2'));
  const agents = ['agents/ccg-implement.toml', 'agents/ccg-research.toml'];
  for (const name of agents) write(path.join(codexHome, name), 'model = "user-choice"\nmodel_reasoning_effort = "xhigh"\n# preserved user bytes\n');
  json(path.join(codexHome, '.ccg/ownership.json'), {
    schemaVersion: 2, files: agents.map(name => ({ path: name, installedSha256: sha(Buffer.from('original installed baseline\n')) })),
  });
  const baseline = [];
  for (const relative of ['ccg', 'ccg.cmd', 'ccg.ps1', 'node_modules/ccg-workflow/package.json', 'node_modules/ccg-workflow/bin/ccg.mjs']) {
    const raw = readFileSync(path.join(prefix, relative)); baseline.push({ path: relative, bytes: raw.length, sha256: sha(raw) });
    write(path.join(candidate, relative), relative.endsWith('package.json') ? enc(manifest('3.6.7'))
      : relative.endsWith('ccg.mjs') ? '// private stock fixture\n' : raw);
  }
  const candidateFiles = baseline.map(row => { const raw = readFileSync(path.join(candidate, row.path)); return { path: row.path, bytes: raw.length, sha256: sha(raw) }; });
  const baselinePath = path.join(top, 'baseline.json'), stagePath = path.join(top, 'stage.json');
  json(baselinePath, { files: baseline });
  json(stagePath, { passed: true, networkMode: 'offline', lifecycleScriptsExecuted: false, targetPrefix: candidate, files: candidateFiles });
  const recipientPath = path.join(top, 'recipient.json');
  json(recipientPath, { schemaVersion: 1, kind: 'ccg-stock-npm-prefix-file-plan', prefix, candidatePrefix: candidate,
    stageReceiptSha256: sha(readFileSync(stagePath)), baselineManifestSha256: sha(readFileSync(baselinePath)), previousReceiptSha256: null,
    rows: baseline.map((old, index) => { const next = candidateFiles[index]; const before = { bytes: old.bytes, sha256: old.sha256 }, after = { bytes: next.bytes, sha256: next.sha256 }; return { path: old.path, before, after, action: before.sha256 === after.sha256 ? 'unchanged' : 'replace' }; }),
    foreignFilesPolicy: 'leave unlisted paths byte-for-byte; refuse candidate collision',
    scope: 'node_modules/ccg-workflow/** and ccg/ccg.cmd/ccg.ps1 only', dailyConfigCredentialsPermissions: 'untouched' });
  const ownerDeclarationPath = path.join(top, 'owners.json'), agentDeclarationPath = path.join(top, 'agents.json');
  json(ownerDeclarationPath, { schemaVersion: 1, kind: 'legacy-ccg-known-owner-declaration', knownSetComplete: true,
    owners: owners.map(repoRoot => ({ repoRoot, ownershipSha256: sha(readFileSync(path.join(repoRoot, '.harness-cache/ownership.json'))) })) });
  json(agentDeclarationPath, { schemaVersion: 1, kind: 'legacy-ccg-current-agent-byte-pins', codexHome,
    ownershipSha256: sha(readFileSync(path.join(codexHome, '.ccg/ownership.json'))),
    files: agents.map(name => { const raw = readFileSync(path.join(codexHome, name)); return { path: name, bytes: raw.length, sha256: sha(raw) }; }) });
  const options = { ownerDeclarationPath, ownerDeclarationSha256: sha(readFileSync(ownerDeclarationPath)),
    agentDeclarationPath, agentDeclarationSha256: sha(readFileSync(agentDeclarationPath)),
    recipientPlanPath: recipientPath, recipientPlanSha256: sha(readFileSync(recipientPath)),
    stageReceiptPath: stagePath, baselineManifestPath: baselinePath, stockHelperPath: stockHelper,
    stockHelperSha256: sha(readFileSync(stockHelper)), pythonExecutable: PYTHON, pythonSha256: sha(readFileSync(PYTHON)) };
  const protectedFiles = [...owners.map(x => path.join(x, '.harness-cache/ownership.json')),
    ...agents.map(x => path.join(codexHome, x)), path.join(codexHome, '.ccg/ownership.json'),
    ...baseline.map(x => path.join(prefix, x.path)), path.join(trellis, 'package.json')];
  const before = new Map(protectedFiles.map(file => [file, readFileSync(file)]));
  const unchanged = () => { for (const [file, original] of before) assert.deepEqual(readFileSync(file), original, file); };
  async function review() {
    const plan = await mod.planLegacyCcgClaimRetirement(options);
    const planPath = path.join(top, 'plan.json');
    write(planPath, enc(plan));
    return { plan, planPath, planSha256: sha(readFileSync(planPath)) };
  }
  return { top, root, prefix, candidate, owners, codexHome, pkg, bin, trellis, mod, lifecycle, guard,
    transaction, options, review, unchanged, before, agents, protectedFiles, stockHelper };
}

nativeTest('real private .15/.12 receipts and current .2 produce metadata-only retirement and exact no-op', async t => {
  const f = await fixture(t), p = await f.review();
  assert.equal(existsSync(path.join(f.root, '.harness-cache')), false);
  assert.equal(p.plan.currentRuntimeAdopted, false);
  const result = await f.mod.applyLegacyCcgClaimRetirement(p);
  assert.equal(result.status, 'committed'); assert.equal(result.nativeLeases.capability, 'windows-files-deny-write-delete-directories-deny-delete');
  f.unchanged();
  const registryPath = path.join(f.root, '.harness-cache/legacy-ccg-claim-authority.json');
  const registry = readFileSync(registryPath);
  assert.equal((await f.mod.applyLegacyCcgClaimRetirement(p)).changed, false);
  assert.deepEqual(readFileSync(registryPath), registry); f.unchanged();
  for (const owner of f.owners) await assert.rejects(f.guard.assertLegacyClaimMutationAllowed(owner), /archives|refuse|retirement/i);
  await f.guard.assertLegacyClaimMutationAllowed(f.root);
});

for (const boundary of ['registry-published', 'owner-sidecar-1-published', 'owner-sidecar-2-published', 'before-commit']) {
  nativeTest(`failure at ${boundary} holds both roots and exact metadata recovery commits`, async t => {
    const f = await fixture(t), p = await f.review();
    await assert.rejects(f.mod.applyLegacyCcgClaimRetirement({ ...p,
      onPublicationBoundary: phase => { if (phase === boundary) throw new Error('injected interruption'); } }), /injected interruption/);
    f.unchanged();
    assert.equal((await f.mod.inspectLegacyCcgClaimRetirement()).status, 'held');
    for (const owner of f.owners) await assert.rejects(f.guard.assertLegacyClaimMutationAllowed(owner), /archives|retirement/i);
    await assert.rejects(f.mod.applyLegacyCcgClaimRetirement(p), /recovery|occupied|Retained/i);
    assert.equal((await f.mod.recoverLegacyCcgClaimRetirement(p)).status, 'committed'); f.unchanged();
  });
}

nativeTest('lost post-commit success is recovered by exact durable status without republishing', async t => {
  const f = await fixture(t), p = await f.review();
  await assert.rejects(f.mod.applyLegacyCcgClaimRetirement({ ...p,
    onPublicationBoundary: phase => { if (phase === 'committed') throw new Error('lost success'); } }), /lost success/);
  assert.equal((await f.mod.inspectLegacyCcgClaimRetirement()).status, 'committed');
  assert.equal((await f.mod.recoverLegacyCcgClaimRetirement(p)).changed, false); f.unchanged();
});

nativeTest('held Windows leases reject late byte writers and ancestor rename before exclusive commit', async t => {
  const f = await fixture(t), p = await f.review(); let probed = false;
  await f.mod.applyLegacyCcgClaimRetirement({ ...p, onPublicationBoundary: phase => {
    if (phase !== 'before-commit') return;
    for (const file of [f.bin, path.join(f.prefix, 'ccg.cmd'), path.join(f.owners[0], '.harness-cache/ownership.json'), path.join(f.codexHome, f.agents[0])])
      assert.throws(() => writeFileSync(file, 'late foreign writer'), /EPERM|EACCES|EBUSY/);
    assert.throws(() => renameSync(f.prefix, path.join(f.top, 'moved')), /EPERM|EACCES|EBUSY/);
    probed = true;
  } });
  assert.equal(probed, true); f.unchanged();
});

nativeTest('existing shared transaction lock prevents authority publication, then released lock permits it', async t => {
  const f = await fixture(t), p = await f.review();
  const lock = await f.transaction.acquireTransactionLock(f.owners[0]);
  try { await assert.rejects(f.mod.applyLegacyCcgClaimRetirement(p), /Pending|transaction|lock/i); }
  finally { await lock.release(); }
  assert.equal(existsSync(path.join(f.root, '.harness-cache/legacy-ccg-claim-authority.json')), false);
  assert.equal((await f.mod.applyLegacyCcgClaimRetirement(p)).status, 'committed'); f.unchanged();
});

nativeTest('concurrent new executors cannot publish conflicting selected-owner state', async t => {
  const f = await fixture(t), p = await f.review();
  const results = await Promise.allSettled([f.mod.applyLegacyCcgClaimRetirement(p), f.mod.applyLegacyCcgClaimRetirement(p)]);
  assert.ok(results.some(x => x.status === 'fulfilled' && x.value.status === 'committed'));
  assert.equal((await f.mod.inspectLegacyCcgClaimRetirement()).status, 'committed'); f.unchanged();
});

nativeTest('runtime, alias, recipient, agent and original receipt tamper each refuse before publication', async t => {
  for (const selected of ['runtime', 'alias', 'recipient', 'agent', 'receipt']) {
    const f = await fixture(t), p = await f.review();
    const targets = { runtime: f.bin, alias: path.join(f.prefix, 'ccg.ps1'), recipient: f.options.recipientPlanPath,
      agent: path.join(f.codexHome, f.agents[0]), receipt: path.join(f.owners[0], '.harness-cache/ownership.json') };
    writeFileSync(targets[selected], readFileSync(targets[selected]).toString() + '\nuser edit\n');
    await assert.rejects(f.mod.applyLegacyCcgClaimRetirement(p));
    assert.equal(existsSync(path.join(f.root, '.harness-cache/legacy-ccg-claim-authority.json')), false);
  }
});

nativeTest('duplicate/cross-prefix declarations and auth-path agent substitutions cannot enter a plan', async t => {
  for (const choice of ['duplicate', 'cross-prefix', 'auth-path']) {
    const f = await fixture(t);
    if (choice === 'auth-path') {
      const data = JSON.parse(readFileSync(f.options.agentDeclarationPath)); data.files[0].path = 'auth.json';
      json(f.options.agentDeclarationPath, data); f.options.agentDeclarationSha256 = sha(readFileSync(f.options.agentDeclarationPath));
    } else {
      const data = JSON.parse(readFileSync(f.options.ownerDeclarationPath));
      if (choice === 'duplicate') data.owners[1] = data.owners[0];
      else {
        const receiptPath = path.join(f.owners[0], '.harness-cache/ownership.json');
        const receipt = JSON.parse(readFileSync(receiptPath)); receipt.entries[0].installedByHarness.entryPath = path.join(f.top, 'other/node_modules/ccg-workflow');
        json(receiptPath, receipt); data.owners[0].ownershipSha256 = sha(readFileSync(receiptPath));
      }
      json(f.options.ownerDeclarationPath, data); f.options.ownerDeclarationSha256 = sha(readFileSync(f.options.ownerDeclarationPath));
    }
    await assert.rejects(f.mod.planLegacyCcgClaimRetirement(f.options));
  }
});

nativeTest('junction aliases and hard-link user files are rejected before claim retirement', async t => {
  const f = await fixture(t);
  const outside = path.join(f.top, 'outside'); mkdirSync(outside);
  rmSync(path.join(f.candidate, 'node_modules/ccg-workflow/bin'), { recursive: true });
  symlinkSync(outside, path.join(f.candidate, 'node_modules/ccg-workflow/bin'), 'junction');
  await assert.rejects(f.mod.planLegacyCcgClaimRetirement(f.options), /link|alias|directory/i);
  f.unchanged();
  const second = await fixture(t);
  linkSync(path.join(second.codexHome, second.agents[0]), path.join(second.top, 'foreign-hardlink.toml'));
  await assert.rejects(second.mod.planLegacyCcgClaimRetirement(second.options), /single-link/i);
});

nativeTest('missing/changed sidecar and torn authority never authorize handoff or recovery replacement', async t => {
  const f = await fixture(t), p = await f.review(); await f.mod.applyLegacyCcgClaimRetirement(p);
  rmSync(path.join(f.owners[0], '.harness-cache/legacy-ccg-claim-retirement.json'));
  assert.equal((await f.mod.inspectLegacyCcgClaimRetirement()).status, 'held');
  await assert.rejects(f.guard.assertLegacyClaimMutationAllowed(f.owners[0]), /archives|retirement/i);
  const registryPath = path.join(f.root, '.harness-cache/legacy-ccg-claim-authority.json');
  writeFileSync(registryPath, '{"schemaVersion":');
  assert.equal((await f.mod.inspectLegacyCcgClaimRetirement()).status, 'held');
  await assert.rejects(f.mod.recoverLegacyCcgClaimRetirement(p));
  assert.equal(readFileSync(registryPath, 'utf8'), '{"schemaVersion":'); f.unchanged();
});

nativeTest('permanent status survives pinned stock-helper handoff and user-edit-safe rollback without claim revival', async t => {
  const f = await fixture(t), p = await f.review(); await f.mod.applyLegacyCcgClaimRetirement(p);
  write(path.join(f.prefix, 'foreign.txt'), 'foreign stays\n');
  const backupPath = path.join(f.top, 'stock-backup');
  const result = await f.mod.handoffLegacyCcgClaims({ planSha256: p.planSha256, backupPath });
  assert.equal(result.completed, true); assert.equal(result.execution.exitCode, 0);
  assert.equal(JSON.parse(readFileSync(path.join(f.pkg, 'package.json'))).version, '3.6.7');
  assert.equal((await f.mod.inspectLegacyCcgClaimRetirement()).status, 'committed');
  assert.equal((await f.mod.handoffLegacyCcgClaims({ planSha256: p.planSha256, backupPath })).changed, false);
  writeFileSync(f.bin, '// later user edit\n');
  const rollback = spawnSync(PYTHON, ['-I', '-B', f.stockHelper, 'rollback', '--backup', backupPath,
    '--output', path.join(f.top, 'rollback.json')], { encoding: 'utf8', shell: false, windowsHide: true });
  assert.equal(rollback.status, 0, rollback.stderr);
  assert.equal(readFileSync(f.bin, 'utf8'), '// later user edit\n');
  assert.equal(readFileSync(path.join(f.prefix, 'foreign.txt'), 'utf8'), 'foreign stays\n');
  assert.equal((await f.mod.inspectLegacyCcgClaimRetirement()).status, 'committed');
  for (const owner of f.owners) await assert.rejects(f.guard.assertLegacyClaimMutationAllowed(owner), /archives|retirement/i);
  for (const [file, original] of f.before) if (!file.startsWith(f.pkg + path.sep)) assert.deepEqual(readFileSync(file), original);
});

nativeTest('unrelated Trellis claim drift is preserved and ordinary continuity still rejects it', async t => {
  const f = await fixture(t), p = await f.review();
  writeFileSync(path.join(f.trellis, 'package.json'), '{"name":"@mindfoldhq/trellis","version":"0.6.99"}\n');
  await f.mod.applyLegacyCcgClaimRetirement(p);
  const owned = JSON.parse(readFileSync(path.join(f.owners[0], '.harness-cache/ownership.json')));
  const observed = await f.lifecycle.inspectGlobalPackage(path.join(f.prefix, 'node_modules'), '@mindfoldhq/trellis');
  assert.throws(() => f.lifecycle.assertBootstrapOwnershipContinuity(owned,
    { trellis: observed }, { trellis: true }, f.owners[0]), /changed|match|ownership|drift/i);
});

test('public CLI rejects arbitrary anchor/bypass and incomplete retirement SHA arguments', async () => {
  const cli = await import(pathToFileURL(path.join(ROOT, 'scripts/ccg-legacy-claims.mjs')).href);
  assert.throws(() => cli.parseLegacyClaimArgs(['apply', '--retirement-plan-sha256', 'a'.repeat(64)]));
  assert.throws(() => cli.parseLegacyClaimArgs(['status', '--code-root', ROOT]));
  assert.throws(() => cli.parseLegacyClaimArgs(['handoff', '--plan-sha256', 'a'.repeat(64)]));
});
