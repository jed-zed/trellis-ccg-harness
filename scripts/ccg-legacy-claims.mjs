#!/usr/bin/env node
// Fixed-root public entry. No arbitrary trust anchor or archive bypass option.
import { open, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planLegacyCcgClaimRetirement, applyLegacyCcgClaimRetirement,
  inspectLegacyCcgClaimRetirement, recoverLegacyCcgClaimRetirement,
  handoffLegacyCcgClaims } from './lib/ccg-legacy-claim-retirement.mjs';

const FLAGS = new Map([
  ['--owners', 'ownerDeclarationPath'], ['--owners-sha256', 'ownerDeclarationSha256'],
  ['--agents', 'agentDeclarationPath'], ['--agents-sha256', 'agentDeclarationSha256'],
  ['--recipient-plan', 'recipientPlanPath'], ['--recipient-plan-sha256', 'recipientPlanSha256'],
  ['--stage-receipt', 'stageReceiptPath'], ['--baseline-manifest', 'baselineManifestPath'],
  ['--stock-helper', 'stockHelperPath'], ['--stock-helper-sha256', 'stockHelperSha256'],
  ['--python-executable', 'pythonExecutable'], ['--python-sha256', 'pythonSha256'],
  ['--plan', 'planPath'], ['--plan-sha256', 'planSha256'], ['--output', 'outputPath'],
  ['--backup', 'backupPath'], ['--coordinator-root', 'coordinatorRoot'],
]);
const PLAN = ['ownerDeclarationPath', 'ownerDeclarationSha256', 'agentDeclarationPath',
  'agentDeclarationSha256', 'recipientPlanPath', 'recipientPlanSha256', 'stageReceiptPath',
  'baselineManifestPath', 'stockHelperPath', 'stockHelperSha256', 'pythonExecutable', 'pythonSha256'];
const COMMANDS = {
  plan: { required: PLAN, optional: ['outputPath', 'coordinatorRoot'] },
  apply: { required: ['planPath', 'planSha256'], optional: ['coordinatorRoot'] },
  recover: { required: ['planPath', 'planSha256'], optional: ['coordinatorRoot'] },
  status: { required: [], optional: ['planSha256', 'coordinatorRoot'] },
  handoff: { required: ['planSha256', 'backupPath'], optional: ['coordinatorRoot'] },
};

export function parseLegacyClaimArgs(argv) {
  const [command, ...args] = argv;
  if (!COMMANDS[command]) throw new Error('Expected plan|apply|status|recover|handoff. All plan/apply inputs require explicit SHA256 pins.');
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = FLAGS.get(args[index]);
    if (!name || !args[index + 1] || args[index + 1].startsWith('--') || name in result)
      throw new Error('Unknown, missing or duplicate option; no archive bypass is exposed.');
    result[name] = args[index + 1];
  }
  const { required, optional } = COMMANDS[command];
  if (required.some(name => !result[name]) || Object.keys(result).some(name => ![...required, ...optional].includes(name)))
    throw new Error(`Invalid ${command} arguments.`);
  return { command, options: result };
}

async function writeReview(filename, data) {
  if (!path.isAbsolute(filename) || filename.split(/[\\/]/).includes('..')) throw new Error('Review output requires an absolute fresh path.');
  const target = path.resolve(filename);
  let cursor = path.parse(target).root;
  for (const part of path.dirname(target).slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    const info = await lstat(cursor);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Review output ancestor must be a plain directory.');
  }
  if (path.resolve(await realpath(path.dirname(target))).toLowerCase() !== path.dirname(target).toLowerCase())
    throw new Error('Review output physical parent differs.');
  const handle = await open(target, 'wx', 0o600);
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
}

export async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseLegacyClaimArgs(argv);
  if (command === 'plan') {
    const plan = await planLegacyCcgClaimRetirement(options);
    const data = Buffer.from(`${JSON.stringify(plan, null, 2)}\n`);
    const planSha256 = createHash('sha256').update(data).digest('hex');
    if (options.outputPath) {
      await writeReview(options.outputPath, data);
      return { kind: plan.kind, planPath: path.resolve(options.outputPath), planSha256,
        owners: plan.owners.map(x => x.repoRoot), originalReceiptsUnchanged: true,
        currentRuntimeAdopted: false };
    }
    return { planSha256, plan };
  }
  const operations = { apply: applyLegacyCcgClaimRetirement, status: inspectLegacyCcgClaimRetirement,
    recover: recoverLegacyCcgClaimRetirement, handoff: handoffLegacyCcgClaims };
  return operations[command](options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(result => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status === 'held') process.exitCode = 1;
  }).catch(error => {
    process.stderr.write(`Legacy CCG claims held: ${error.message}\n`);
    process.exitCode = 1;
  });
}
