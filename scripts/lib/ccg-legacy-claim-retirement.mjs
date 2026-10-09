import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectGlobalPackage, inspectCcgCommandFiles, validateBootstrapOwnership,
  globalPackageSnapshotsEqual, ccgCommandFilesEqual } from './harness-lifecycle.mjs';
import { acquireTransactionLock } from './harness-transaction.mjs';
import { assertLegacyClaimMutationAllowed } from './ccg-legacy-claim-guard.mjs';

const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = '.harness-cache';
const AUTHORITY = 'legacy-ccg-claim-authority.json';
const SIDECAR = 'legacy-ccg-claim-retirement.json';
const SHA = /^[a-f0-9]{64}$/;
const MAX_FILE = 32 * 1024 * 1024;
const SOURCES = ['scripts/ccg-legacy-claims.mjs', 'scripts/lib/ccg-legacy-claim-retirement.mjs',
  'scripts/lib/ccg-legacy-claim-leases.py', 'scripts/lib/ccg-legacy-claim-guard.mjs',
  'scripts/lib/harness-lifecycle.mjs', 'scripts/lib/harness-transaction.mjs',
  'scripts/lib/harness-fs.mjs', 'scripts/harness-lifecycle.mjs', 'scripts/ccg-runtime.mjs'];
const AGENTS = ['agents/ccg-implement.toml', 'agents/ccg-research.toml'];
const encoded = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const digest = value => createHash('sha256').update(value).digest('hex');
const key = value => {
  const resolved = path.resolve(value).replaceAll('\\', '/');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};
const requireThat = (ok, message) => { if (!ok) throw new Error(message); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function exact(value, names, label) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...names].sort().join('\0'), `${label} schema differs`);
}

function absolute(value, label = 'Path') {
  requireThat(typeof value === 'string' && path.isAbsolute(value) && !value.includes('\0')
    && !value.split(/[\\/]/).some(part => part === '..' || part === '.'), `${label} must be an absolute plain path`);
  return path.resolve(value);
}

async function plainDirectory(value) {
  const target = absolute(value);
  const parsed = path.parse(target);
  let cursor = parsed.root;
  for (const item of ['', ...target.slice(parsed.root.length).split(path.sep).filter(Boolean)]) {
    if (item) cursor = path.join(cursor, item);
    const info = await lstat(cursor);
    requireThat(info.isDirectory() && !info.isSymbolicLink(), `Directory link/alias refused: ${cursor}`);
  }
  requireThat(key(await realpath(target)) === key(target), `Physical directory differs: ${target}`);
  return target;
}

async function bytes(value) {
  const target = absolute(value);
  await plainDirectory(path.dirname(target));
  const info = await lstat(target, { bigint: true });
  requireThat(info.isFile() && !info.isSymbolicLink() && info.nlink === 1n
    && info.size <= BigInt(MAX_FILE), `Bounded single-link regular file required: ${target}`);
  const data = await readFile(target);
  const after = await lstat(target, { bigint: true });
  requireThat(info.dev === after.dev && info.ino === after.ino && info.size === after.size
    && info.mtimeNs === after.mtimeNs && data.length === Number(info.size), `File changed during read: ${target}`);
  return data;
}

async function pinFile(value, expected = null) {
  const target = absolute(value);
  const data = await bytes(target);
  const pin = { path: target, bytes: data.length, sha256: digest(data) };
  if (expected !== null) requireThat(SHA.test(expected) && pin.sha256 === expected, `Pinned file differs: ${target}`);
  return pin;
}

async function document(value, expected = null) {
  const pin = await pinFile(value, expected);
  return { pin, value: JSON.parse((await bytes(pin.path)).toString('utf8')) };
}

async function absent(target) {
  try { await lstat(target); } catch (error) { if (error.code === 'ENOENT') return true; throw error; }
  return false;
}

async function identity(target) {
  const info = await lstat(target, { bigint: true });
  return { dev: String(info.dev), ino: String(info.ino), birthtimeNs: String(info.birthtimeNs) };
}

async function codeRoot(options = {}) {
  const root = await plainDirectory(CODE_ROOT);
  if (options.coordinatorRoot !== undefined) {
    requireThat(key(absolute(options.coordinatorRoot)) === key(root), 'Coordinator must equal the fixed executing codeRoot');
    await plainDirectory(options.coordinatorRoot);
  }
  return root;
}

function statePaths(root, hash) {
  const transactionDir = path.join(root, CACHE, 'legacy-ccg-claims', hash);
  return { transactionDir, registry: path.join(root, CACHE, AUTHORITY),
    plan: path.join(transactionDir, 'plan.json'), journal: path.join(transactionDir, 'journal.json'),
    committed: path.join(transactionDir, 'COMMITTED.json'),
    handoffPending: path.join(transactionDir, 'STOCK-HANDOFF-PENDING.json'),
    handoff: path.join(transactionDir, 'STOCK-HANDOFF.json') };
}

function relativeStockFile(value) {
  requireThat(typeof value === 'string' && value && !/[\\:\x00-\x1f<>"|?*]/.test(value)
    && !value.split('/').some(part => !part || part === '.' || part === '..'
      || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))
    && (['ccg', 'ccg.cmd', 'ccg.ps1'].includes(value) || value.startsWith('node_modules/ccg-workflow/')),
  'Stock plan path is outside the unscoped package/three aliases');
  return value;
}

function validateFileState(value) {
  if (value === null) return;
  exact(value, ['bytes', 'sha256'], 'Stock file state');
  requireThat(Number.isSafeInteger(value.bytes) && value.bytes >= 0 && value.bytes <= MAX_FILE
    && SHA.test(value.sha256), 'Invalid stock file pin');
}

async function treeFiles(root) {
  await plainDirectory(root);
  const files = [], directories = [];
  async function visit(current) {
    directories.push({ path: current, identity: await identity(current) });
    for (const name of (await readdir(current)).sort()) {
      const target = path.join(current, name);
      const info = await lstat(target);
      requireThat(!info.isSymbolicLink(), `Runtime link/reparse refused: ${target}`);
      if (info.isDirectory()) await visit(target);
      else files.push(await pinFile(target));
    }
  }
  await visit(root);
  requireThat(files.length > 0 && files.length <= 50000, 'Runtime file inventory is empty/unbounded');
  return { files, directories };
}

async function noPending(root, { locksHeld = false } = {}) {
  for (const name of ['bootstrap-pending.json', 'transaction-journal.json', ...(!locksHeld ? ['transaction.lock'] : [])]) {
    requireThat(await absent(path.join(root, CACHE, name)), `Pending Harness state refuses retirement: ${root}/${name}`);
  }
}

async function sources(root) {
  return Promise.all(SOURCES.map(name => pinFile(path.join(root, name))));
}

async function readDeclarations(options, root) {
  const ownersDoc = await document(options.ownerDeclarationPath, options.ownerDeclarationSha256);
  exact(ownersDoc.value, ['schemaVersion', 'kind', 'knownSetComplete', 'owners'], 'Known owner declaration');
  requireThat(ownersDoc.value.schemaVersion === 1 && ownersDoc.value.kind === 'legacy-ccg-known-owner-declaration'
    && ownersDoc.value.knownSetComplete === true && ownersDoc.value.owners.length === 2,
  'Exactly the two explicitly known owners must be declared; no machine-wide discovery is implied');
  const owners = [];
  for (const row of ownersDoc.value.owners) {
    exact(row, ['repoRoot', 'ownershipSha256'], 'Declared owner');
    const repoRoot = await plainDirectory(absolute(row.repoRoot));
    requireThat(key(repoRoot) !== key(root), 'Coordinator cannot be one of the archived old roots');
    const ownershipPath = path.join(repoRoot, CACHE, 'ownership.json');
    const owned = await document(ownershipPath, row.ownershipSha256);
    validateBootstrapOwnership(owned.value, repoRoot);
    const selected = owned.value.entries.filter(entry => entry.id === 'ccg-link' && entry.package === 'ccg-workflow');
    requireThat(selected.length === 1 && selected[0].kind === 'npm-global-package', 'Only the historical ordinary unscoped ccg-link claim may retire');
    owners.push({ repoRoot, repoIdentity: await identity(repoRoot), ownershipPath, ownershipSha256: owned.pin.sha256,
      ownershipBytes: owned.pin.bytes, retiredEntryId: 'ccg-link', retiredEntry: selected[0],
      preservedOtherEntryIds: owned.value.entries.filter(entry => entry !== selected[0]).map(entry => entry.id),
      sidecarPath: path.join(repoRoot, CACHE, SIDECAR) });
  }
  owners.sort((a, b) => key(a.repoRoot).localeCompare(key(b.repoRoot)));
  requireThat(new Set(owners.map(x => key(x.repoRoot))).size === 2, 'Duplicate physical/case owner roots refused');
  requireThat(owners.map(x => x.retiredEntry.installedByHarness.version).sort().join(',') === '3.4.12,3.4.15',
    'Reviewed legacy claims must be the original .12 and .15 receipts');
  const agentDoc = await document(options.agentDeclarationPath, options.agentDeclarationSha256);
  exact(agentDoc.value, ['schemaVersion', 'kind', 'codexHome', 'ownershipSha256', 'files'], 'Agent byte declaration');
  requireThat(agentDoc.value.schemaVersion === 1 && agentDoc.value.kind === 'legacy-ccg-current-agent-byte-pins'
    && agentDoc.value.files.length === 2, 'Two explicitly pinned current agent files required');
  const codexHome = await plainDirectory(absolute(agentDoc.value.codexHome));
  const agentOwnership = await pinFile(path.join(codexHome, '.ccg', 'ownership.json'), agentDoc.value.ownershipSha256);
  const agents = [];
  for (const file of agentDoc.value.files) {
    exact(file, ['path', 'sha256', 'bytes'], 'Declared agent');
    requireThat(AGENTS.includes(file.path), 'Only the two selected agent filenames may be read');
    const pin = await pinFile(path.join(codexHome, file.path), file.sha256);
    requireThat(pin.bytes === file.bytes, 'Agent raw byte size differs');
    agents.push(pin);
  }
  requireThat(new Set(agents.map(x => key(x.path))).size === 2, 'Duplicate agent declaration');
  agents.sort((a, b) => key(a.path).localeCompare(key(b.path)));
  return { ownerDeclaration: ownersDoc.pin, agentDeclaration: agentDoc.pin, owners,
    agents: { codexHome, ownership: agentOwnership, files: agents } };
}

async function readRecipient(options) {
  const stock = await document(options.recipientPlanPath, options.recipientPlanSha256);
  const value = stock.value;
  requireThat(value.schemaVersion === 1 && value.kind === 'ccg-stock-npm-prefix-file-plan'
    && value.scope === 'node_modules/ccg-workflow/** and ccg/ccg.cmd/ccg.ps1 only'
    && value.dailyConfigCredentialsPermissions === 'untouched'
    && value.previousReceiptSha256 === null && Array.isArray(value.rows) && value.rows.length > 0
    && value.rows.length <= 50000, 'Only the pinned positive first stock install plan is accepted');
  const prefix = await plainDirectory(absolute(value.prefix));
  const candidatePrefix = await plainDirectory(absolute(value.candidatePrefix));
  requireThat(key(prefix) !== key(candidatePrefix), 'Stock candidate and prefix must differ');
  const stage = await document(options.stageReceiptPath, value.stageReceiptSha256);
  requireThat(stage.value.passed === true && stage.value.networkMode === 'offline'
    && stage.value.lifecycleScriptsExecuted === false && key(stage.value.targetPrefix) === key(candidatePrefix),
  'Stock stage/prefix or accepted offline installation identity differs');
  const baseline = await document(options.baselineManifestPath, value.baselineManifestSha256);
  requireThat(Array.isArray(baseline.value.files), 'Stock baseline file manifest required');
  const pins = [], before = new Map(), seen = new Set();
  for (const row of value.rows) {
    exact(row, ['path', 'before', 'after', 'action'], 'Stock plan row');
    const relative = relativeStockFile(row.path);
    requireThat(!seen.has(relative.toLowerCase()), 'Duplicate stock row'); seen.add(relative.toLowerCase());
    validateFileState(row.before); validateFileState(row.after);
    requireThat(row.action === (same(row.before, row.after) ? 'unchanged'
      : row.before && row.after ? 'replace' : row.after ? 'add' : 'remove'), 'Stock row action differs');
    before.set(relative, row.before);
    if (row.after !== null) {
      const pin = await pinFile(path.join(candidatePrefix, ...relative.split('/')), row.after.sha256);
      requireThat(pin.bytes === row.after.bytes, 'Stock candidate file size differs'); pins.push(pin);
    }
  }
  const baselineRows = new Map();
  for (const file of baseline.value.files) {
    const relative = relativeStockFile(file.path);
    validateFileState({ bytes: file.bytes, sha256: file.sha256 });
    requireThat(!baselineRows.has(relative), 'Duplicate baseline row');
    baselineRows.set(relative, { bytes: file.bytes, sha256: file.sha256 });
  }
  for (const [name, state] of before) requireThat(same(state, baselineRows.get(name) ?? null), 'Stock before state differs from sealed baseline');
  requireThat([...baselineRows.keys()].every(name => before.has(name)), 'Stock plan omits a legacy baseline file');
  const helper = await pinFile(options.stockHelperPath, options.stockHelperSha256);
  return { document: stock.pin, prefix, candidatePrefix, stageReceipt: stage.pin,
    baselineManifest: baseline.pin, helper, candidateFiles: pins, beforeRows: [...before] };
}

async function freshPlan(options, { locksHeld = false } = {}) {
  const root = await codeRoot(options);
  const declared = await readDeclarations(options, root);
  const recipient = await readRecipient(options);
  const roots = [root, ...declared.owners.map(x => x.repoRoot), declared.agents.codexHome, recipient.prefix, recipient.candidatePrefix];
  for (let a = 0; a < roots.length; a++) for (let b = a + 1; b < roots.length; b++) {
    requireThat(key(roots[a]) !== key(roots[b]) && !key(roots[a]).startsWith(`${key(roots[b])}/`)
      && !key(roots[b]).startsWith(`${key(roots[a])}/`), 'Coordinator/owners/agents/runtime/stage must be disjoint physical roots');
  }
  for (const owner of declared.owners) {
    await noPending(owner.repoRoot, { locksHeld });
    requireThat(key(owner.retiredEntry.installedByHarness.entryPath) === key(path.join(recipient.prefix, 'node_modules', 'ccg-workflow')),
      'Both selected owners must claim the same physical npm prefix');
  }
  await noPending(root, { locksHeld });
  const runtime = await inspectGlobalPackage(path.join(recipient.prefix, 'node_modules'), 'ccg-workflow');
  requireThat(runtime && runtime.sourcePath === undefined && runtime.version === '3.4.16-localarchive.2',
    'Current runtime must be the observed ordinary .2, never adopted as old ownership');
  const inventory = await treeFiles(runtime.entryPath);
  const commandFiles = await inspectCcgCommandFiles(runtime.entryPath, 'ccg-workflow');
  requireThat(commandFiles.length === 3 && commandFiles.every(x => x.kind === 'file'), 'Three plain Windows ccg aliases required');
  const aliases = await Promise.all(commandFiles.map(x => pinFile(x.path, x.sha256)));
  const before = new Map(recipient.beforeRows);
  for (const file of [...inventory.files, ...aliases]) {
    const relative = path.relative(recipient.prefix, file.path).split(path.sep).join('/');
    requireThat(same(before.get(relative), { bytes: file.bytes, sha256: file.sha256 }),
      'Recipient must CAS every actual .2 file and alias from the complete baseline');
  }
  requireThat([...before].filter(([, value]) => value !== null).length === inventory.files.length + 3,
    'Recipient before inventory must exactly cover actual .2 and aliases');
  const pythonPath = await realpath(absolute(options.pythonExecutable));
  const python = await pinFile(pythonPath, options.pythonSha256);
  return { schemaVersion: 1, kind: 'legacy-ccg-claim-retirement-plan', codeRoot: root,
    codeRootIdentity: await identity(root), ...declared,
    recipient, actualRuntime: runtime, commandFiles, runtimeFiles: inventory.files, aliases,
    runtimeDirectories: inventory.directories, pythonExecutable: python, sourcePins: await sources(root),
    scope: 'retire selected unscoped ccg-link claims only; preserve all original receipts and files',
    knownOwnerSet: 'exactly the two explicitly declared roots, not machine-wide discovery',
    originalOwnershipRewritten: false, currentRuntimeAdopted: false,
    agentsCredentialsPermissionsWritten: false, historicalExecutorsGuarded: false };
}

function optionsFromPlan(plan) {
  return { coordinatorRoot: plan.codeRoot,
    ownerDeclarationPath: plan.ownerDeclaration.path, ownerDeclarationSha256: plan.ownerDeclaration.sha256,
    agentDeclarationPath: plan.agentDeclaration.path, agentDeclarationSha256: plan.agentDeclaration.sha256,
    recipientPlanPath: plan.recipient.document.path, recipientPlanSha256: plan.recipient.document.sha256,
    stageReceiptPath: plan.recipient.stageReceipt.path, baselineManifestPath: plan.recipient.baselineManifest.path,
    stockHelperPath: plan.recipient.helper.path, stockHelperSha256: plan.recipient.helper.sha256,
    pythonExecutable: plan.pythonExecutable.path, pythonSha256: plan.pythonExecutable.sha256 };
}

export async function planLegacyCcgClaimRetirement(options) {
  requireThat(process.platform === 'win32', 'This reviewed retirement contract is Windows-only');
  const root = await codeRoot(options);
  await assertLegacyClaimMutationAllowed(root);
  requireThat(await absent(path.join(root, CACHE, AUTHORITY)), 'An existing authority requires status/recovery, not a new plan');
  return freshPlan(options);
}

function publication(plan, hash, planBytes) {
  const p = statePaths(plan.codeRoot, hash);
  const registry = { schemaVersion: 1, kind: 'legacy-ccg-claim-authority', planSha256: hash,
    transactionDir: p.transactionDir,
    owners: plan.owners.map(x => ({ repoRoot: x.repoRoot, ownershipSha256: x.ownershipSha256 })) };
  const sidecars = plan.owners.map(x => ({ path: x.sidecarPath, value: { schemaVersion: 1,
    kind: 'legacy-ccg-claim-retirement', planSha256: hash, transactionDir: p.transactionDir,
    repoRoot: x.repoRoot, ownershipSha256: x.ownershipSha256, retiredEntryId: 'ccg-link' } }));
  const journal = { schemaVersion: 1, kind: 'legacy-ccg-claim-publication', planSha256: hash,
    owners: registry.owners, sidecars: sidecars.map(x => ({ path: x.path, sha256: digest(encoded(x.value)) })),
    publication: 'registry-first, immutable plan/journal, both sidecars, exclusive COMMITTED last',
    originalFilesWritable: false };
  const committed = { schemaVersion: 1, kind: 'legacy-ccg-claims-committed', planSha256: hash,
    registrySha256: digest(encoded(registry)), journalSha256: digest(encoded(journal)),
    sidecars: sidecars.map((x, index) => ({ repoRoot: plan.owners[index].repoRoot,
      path: x.path, sha256: digest(encoded(x.value)) })), committed: true };
  const rows = [{ path: p.registry, data: encoded(registry), phase: 'registry-published' },
    { path: p.plan, data: planBytes, phase: 'plan-published' },
    { path: p.journal, data: encoded(journal), phase: 'journal-published' },
    ...sidecars.map((x, index) => ({ path: x.path, data: encoded(x.value), phase: `owner-sidecar-${index + 1}-published` })),
    { path: p.committed, data: encoded(committed), phase: 'committed' }];
  return { paths: p, registry, rows };
}

async function persistentInputs(plan) {
  requireThat(plan.schemaVersion === 1 && plan.kind === 'legacy-ccg-claim-retirement-plan'
    && key(plan.codeRoot) === key(await codeRoot()) && plan.owners.length === 2
    && plan.originalOwnershipRewritten === false && plan.currentRuntimeAdopted === false
    && plan.agentsCredentialsPermissionsWritten === false && plan.historicalExecutorsGuarded === false,
  'Stored retirement plan scope differs');
  requireThat(same(await identity(plan.codeRoot), plan.codeRootIdentity), 'Coordinator physical identity changed');
  requireThat(same(plan.sourcePins, await sources(plan.codeRoot)), 'Pinned executing source changed');
  const options = optionsFromPlan(plan);
  const ownerDoc = await document(options.ownerDeclarationPath, options.ownerDeclarationSha256);
  requireThat(ownerDoc.value.kind === 'legacy-ccg-known-owner-declaration' && ownerDoc.value.knownSetComplete === true
    && ownerDoc.value.owners.length === 2, 'Stored known owner declaration differs');
  const selected = ownerDoc.value.owners.map(x => ({ repoRoot: absolute(x.repoRoot), ownershipSha256: x.ownershipSha256 }))
    .sort((a, b) => key(a.repoRoot).localeCompare(key(b.repoRoot)));
  requireThat(same(selected, plan.owners.map(x => ({ repoRoot: x.repoRoot, ownershipSha256: x.ownershipSha256 }))), 'Stored selected owner set differs');
  for (const owner of plan.owners) {
    requireThat(key(owner.ownershipPath) === key(path.join(owner.repoRoot, CACHE, 'ownership.json'))
      && key(owner.sidecarPath) === key(path.join(owner.repoRoot, CACHE, SIDECAR)), 'Stored owner paths differ');
    await plainDirectory(owner.repoRoot);
    requireThat(same(await identity(owner.repoRoot), owner.repoIdentity), 'Archived owner physical identity changed');
    const receipt = await document(owner.ownershipPath, owner.ownershipSha256);
    validateBootstrapOwnership(receipt.value, owner.repoRoot);
    requireThat(same(receipt.value.entries.find(x => x.id === 'ccg-link'), owner.retiredEntry), 'Original retired entry differs');
  }
  for (const pin of [plan.agentDeclaration, plan.recipient.document, plan.recipient.stageReceipt,
    plan.recipient.baselineManifest, plan.recipient.helper]) await pinFile(pin.path, pin.sha256);
}

async function committedProof(root, expectedHash = null) {
  const registryDoc = await document(path.join(root, CACHE, AUTHORITY));
  const registry = registryDoc.value;
  exact(registry, ['schemaVersion', 'kind', 'planSha256', 'transactionDir', 'owners'], 'Authority registry');
  requireThat(registry.schemaVersion === 1 && registry.kind === 'legacy-ccg-claim-authority'
    && SHA.test(registry.planSha256) && (expectedHash === null || registry.planSha256 === expectedHash), 'Retirement authority identity differs');
  const hash = registry.planSha256, p = statePaths(root, hash);
  requireThat(key(registry.transactionDir) === key(p.transactionDir), 'Authority transaction path differs');
  const planBytes = await bytes(p.plan);
  requireThat(digest(planBytes) === hash, 'Stored plan raw SHA differs');
  const plan = JSON.parse(planBytes.toString('utf8'));
  await persistentInputs(plan);
  const expected = publication(plan, hash, planBytes);
  for (const row of expected.rows) requireThat((await bytes(row.path)).equals(row.data), `Missing/torn/foreign retirement proof: ${row.path}`);
  return { plan, hash, paths: p, registrySha256: registryDoc.pin.sha256,
    committedSha256: digest(expected.rows.at(-1).data) };
}

export async function inspectLegacyCcgClaimRetirement(options = {}) {
  const root = await codeRoot(options);
  if (await absent(path.join(root, CACHE, AUTHORITY))) {
    const claims = path.join(root, CACHE, 'legacy-ccg-claims');
    const remains = !await absent(claims) && (await readdir(claims)).length > 0;
    return { status: remains ? 'held' : 'absent', retired: false, stockHandoffReady: false,
      reason: remains ? 'Missing authority with retained transaction state' : 'No retirement authority' };
  }
  try {
    const proof = await committedProof(root, options.planSha256 ?? null);
    return { status: 'committed', retired: true, stockHandoffReady: false,
      requiresCurrentHandoffCas: true, planSha256: proof.hash, transactionDir: proof.paths.transactionDir,
      owners: proof.plan.owners.map(x => ({ repoRoot: x.repoRoot, ownershipSha256: x.ownershipSha256 })),
      actualRuntimeRechecked: false, originalReceiptsUnchanged: true, historicalExecutorsGuarded: false };
  } catch (error) {
    return { status: 'held', retired: false, stockHandoffReady: false, reason: error.message };
  }
}

async function loadReviewed(options) {
  await codeRoot(options);
  requireThat(SHA.test(options.planSha256), 'Exact reviewed plan SHA256 required');
  const data = await bytes(options.planPath);
  requireThat(digest(data) === options.planSha256, 'Reviewed plan raw SHA differs');
  const plan = JSON.parse(data.toString('utf8'));
  await codeRoot({ coordinatorRoot: plan.codeRoot });
  return { plan, data, hash: options.planSha256 };
}

async function lockAll(plan, hash) {
  const roots = [plan.codeRoot, ...plan.owners.map(x => x.repoRoot)].sort((a, b) => key(a).localeCompare(key(b)));
  const acquired = [];
  try {
    for (const root of roots) {
      await assertLegacyClaimMutationAllowed(root, { retirementPlanSha256: hash });
      acquired.push(await acquireTransactionLock(root, { retirementPlanSha256: hash }));
      await assertLegacyClaimMutationAllowed(root, { retirementPlanSha256: hash });
    }
    return { release: async () => { for (const lock of acquired.reverse()) await lock.release(); } };
  } catch (error) {
    for (const lock of acquired.reverse()) await lock.release();
    throw error;
  }
}

async function startLeases(plan, hash, extraPins = []) {
  requireThat(process.platform === 'win32', 'Native Windows held-file leases are required');
  await pinFile(plan.pythonExecutable.path, plan.pythonExecutable.sha256);
  const p = statePaths(plan.codeRoot, hash);
  const files = [plan.ownerDeclaration, plan.agentDeclaration, ...plan.sourcePins,
    plan.pythonExecutable, ...plan.owners.map(x => ({ path: x.ownershipPath, sha256: x.ownershipSha256, bytes: x.ownershipBytes })),
    plan.agents.ownership, ...plan.agents.files, plan.recipient.document,
    plan.recipient.stageReceipt, plan.recipient.baselineManifest, plan.recipient.helper,
    ...plan.recipient.candidateFiles, ...plan.runtimeFiles.map(x => ({ ...x, runtime: true })),
    ...plan.aliases.map(x => ({ ...x, runtime: true })), ...extraPins];
  const child = spawn(plan.pythonExecutable.path,
    ['-I', '-S', '-B', path.join(plan.codeRoot, 'scripts/lib/ccg-legacy-claim-leases.py')],
    { cwd: plan.codeRoot, stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true });
  const lines = createInterface({ input: child.stdout });
  let pending = null, stderr = '', ended = false;
  child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-4096); });
  lines.on('line', line => {
    if (!pending) return;
    const waiter = pending; pending = null;
    try { const response = JSON.parse(line); response.ok ? waiter.resolve(response.result) : waiter.reject(new Error(response.error)); }
    catch (error) { waiter.reject(error); }
  });
  child.on('error', error => { ended = true; pending?.reject(error); pending = null; });
  const exit = new Promise(resolve => child.once('close', (code, signal) => {
    ended = true; pending?.reject(new Error(`Lease helper exited (${code ?? signal}): ${stderr}`)); pending = null; resolve({ code, signal });
  }));
  async function request(value) {
    requireThat(!ended && !pending, 'Lease helper is unavailable or busy');
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      child.stdin.write(`${JSON.stringify(value)}\n`, error => { if (error && pending) { pending.reject(error); pending = null; } });
    });
  }
  const session = {
    request,
    async publish(target, data) { return request({ op: 'publish', path: target, base64: data.toString('base64'), sha256: digest(data) }); },
    async close() {
      if (!ended) { try { await request({ op: 'close' }); } finally { child.stdin.end(); } }
      const result = await exit; lines.close();
      requireThat(result.code === 0, `Lease helper failed (${result.code ?? result.signal}): ${stderr}`);
    },
  };
  try {
    session.capability = await request({ op: 'init', codeRoot: plan.codeRoot, planSha256: hash,
      owners: plan.owners.map(x => x.repoRoot), files,
      directories: [plan.codeRoot, ...plan.owners.map(x => x.repoRoot), plan.agents.codexHome,
        plan.recipient.prefix, plan.recipient.candidatePrefix, ...plan.runtimeDirectories.map(x => x.path)],
      targets: [p.registry, p.plan, p.journal, p.committed, p.handoffPending, p.handoff, ...plan.owners.map(x => x.sidecarPath)],
      absent: [plan.codeRoot, ...plan.owners.map(x => x.repoRoot)].flatMap(root =>
        ['bootstrap-pending.json', 'transaction-journal.json'].map(name => path.join(root, CACHE, name))) });
    return session;
  } catch (error) { await session.close(); throw error; }
}

async function publishRetirement(options, recovering) {
  const reviewed = await loadReviewed(options);
  const { plan, data, hash } = reviewed;
  const current = await inspectLegacyCcgClaimRetirement({ planSha256: hash });
  if (current.status === 'committed') return { ...current, changed: false };
  const p = statePaths(plan.codeRoot, hash);
  if (!recovering) {
    requireThat(current.status === 'absent' && await absent(p.transactionDir)
      && (await Promise.all(plan.owners.map(x => absent(x.sidecarPath)))).every(Boolean),
    'Retained/occupied retirement state requires exact recovery, never replacement');
  }
  requireThat(same(await freshPlan(optionsFromPlan(plan)), plan), 'Reviewed retirement inputs/source/current CAS changed');
  const locks = await lockAll(plan, hash);
  let leases;
  try {
    requireThat(same(await freshPlan(optionsFromPlan(plan), { locksHeld: true }), plan), 'Retirement inputs changed after locks');
    leases = await startLeases(plan, hash, [await pinFile(options.planPath, hash)]);
    requireThat(same(await freshPlan(optionsFromPlan(plan), { locksHeld: true }), plan), 'Held retirement input CAS changed');
    const expected = publication(plan, hash, data);
    for (const row of expected.rows) {
      if (row.phase === 'committed') {
        if (options.onPublicationBoundary) await options.onPublicationBoundary('before-commit');
        requireThat(same(await freshPlan(optionsFromPlan(plan), { locksHeld: true }), plan), 'Final held CAS changed before commit');
      }
      await leases.publish(row.path, row.data);
      if (options.onPublicationBoundary) await options.onPublicationBoundary(row.phase);
    }
    const committed = await committedProof(plan.codeRoot, hash);
    return { status: 'committed', retired: true, planSha256: hash, transactionDir: committed.paths.transactionDir,
      changed: true, recovered: recovering, stockHandoffReady: false, originalReceiptsUnchanged: true,
      runtimeAndAgentsUnchanged: true, nativeLeases: leases.capability, historicalExecutorsGuarded: false };
  } finally {
    try { if (leases) await leases.close(); } finally { await locks.release(); }
  }
}

export const applyLegacyCcgClaimRetirement = options => publishRetirement(options, false);
export const recoverLegacyCcgClaimRetirement = options => publishRetirement(options, true);

function runStock(plan, backupPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(plan.pythonExecutable.path, ['-I', '-S', '-B', plan.recipient.helper.path,
      'apply', '--plan', plan.recipient.document.path, '--backup', backupPath],
    { cwd: plan.codeRoot, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout = (stdout + data.toString()).slice(-8192); });
    child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-8192); });
    child.on('error', reject);
    child.once('exit', (code, signal) => {
      if (code !== 0) reject(new Error(`Pinned stock CAS failed (${code ?? signal}); state retained: ${stderr}`));
      else resolve({ exitCode: code, stdoutSha256: digest(stdout), stderrSha256: digest(stderr) });
    });
  });
}

export async function handoffLegacyCcgClaims(options) {
  const root = await codeRoot(options);
  requireThat(SHA.test(options.planSha256), 'Exact retirement plan SHA256 required for stock handoff');
  const proof = await committedProof(root, options.planSha256);
  const { plan, hash, paths: p } = proof;
  const backupPath = absolute(options.backupPath, 'Stock backup');
  await plainDirectory(path.dirname(backupPath));
  for (const reserved of [root, ...plan.owners.map(x => x.repoRoot), plan.agents.codexHome,
    plan.recipient.prefix, plan.recipient.candidatePrefix]) {
    requireThat(!key(backupPath).startsWith(`${key(reserved)}/`) && key(backupPath) !== key(reserved), 'Stock backup must be disjoint from source/owners/runtime/agents');
  }
  const pending = { schemaVersion: 1, kind: 'legacy-ccg-stock-handoff-pending', planSha256: hash,
    recipientPlanSha256: plan.recipient.document.sha256, backupPath, committedSha256: proof.committedSha256 };
  const pendingBytes = encoded(pending);
  if (!await absent(p.handoff)) {
    const result = (await document(p.handoff)).value;
    exact(result, ['schemaVersion', 'kind', 'planSha256', 'recipientPlanSha256', 'backupPath',
      'stockReceiptSha256', 'completed', 'retirementRemainsCommitted', 'historicalExecutorsGuarded', 'execution'], 'Stock handoff result');
    requireThat(result.kind === 'legacy-ccg-stock-handoff' && result.planSha256 === hash
      && result.schemaVersion === 1 && result.completed === true && result.retirementRemainsCommitted === true
      && result.historicalExecutorsGuarded === false && result.execution.exitCode === 0
      && result.recipientPlanSha256 === plan.recipient.document.sha256 && result.backupPath === backupPath,
    'Foreign stock handoff result retained');
    requireThat((await bytes(p.handoffPending)).equals(pendingBytes), 'Stock handoff pending/proof chain differs');
    const receipt = await document(path.join(backupPath, 'receipt.json'), result.stockReceiptSha256);
    requireThat(receipt.value.kind === 'ccg-stock-npm-prefix-transaction' && receipt.value.completed === true
      && receipt.value.planSha256 === plan.recipient.document.sha256
      && key(receipt.value.prefix) === key(plan.recipient.prefix), 'Stock completion receipt scope differs');
    return { ...result, changed: false };
  }
  requireThat(same(await freshPlan(optionsFromPlan(plan)), plan), 'Current .2/aliases/agents/recipient differ before stock handoff');
  requireThat(await absent(backupPath), 'Stock backup is occupied; no foreign adoption');
  const locks = await lockAll(plan, hash);
  let leases;
  try {
    await committedProof(root, hash);
    leases = await startLeases(plan, hash);
    requireThat(same(await freshPlan(optionsFromPlan(plan), { locksHeld: true }), plan), 'Held stock handoff preflight CAS changed');
    await leases.publish(p.handoffPending, pendingBytes);
    if (options.beforeStockCas) await options.beforeStockCas({ planSha256: hash, backupPath });
    requireThat(same(await freshPlan(optionsFromPlan(plan), { locksHeld: true }), plan), 'Final stock handoff CAS changed');
    // The unchanged stock helper reacquires its own write leases and checks every
    // positive before/after row. Keep owners, agents, authority and directories
    // held; release only runtime/alias file read leases that would block its CAS.
    await leases.request({ op: 'release-runtime' });
    const execution = await runStock(plan, backupPath);
    const receipt = await document(path.join(backupPath, 'receipt.json'));
    requireThat(receipt.value.kind === 'ccg-stock-npm-prefix-transaction' && receipt.value.completed === true
      && receipt.value.planSha256 === plan.recipient.document.sha256
      && key(receipt.value.prefix) === key(plan.recipient.prefix), 'Stock completion receipt differs from pinned recipient');
    await committedProof(root, hash);
    const result = { schemaVersion: 1, kind: 'legacy-ccg-stock-handoff', planSha256: hash,
      recipientPlanSha256: plan.recipient.document.sha256, backupPath, stockReceiptSha256: receipt.pin.sha256,
      completed: true, retirementRemainsCommitted: true, historicalExecutorsGuarded: false, execution };
    await leases.publish(p.handoff, encoded(result));
    return { ...result, changed: true };
  } finally { try { if (leases) await leases.close(); } finally { await locks.release(); } }
}

export { CODE_ROOT as LEGACY_CCG_RETIREMENT_CODE_ROOT };
