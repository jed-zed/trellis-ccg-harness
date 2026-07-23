#!/usr/bin/env node
// CCG Hook Shared Utilities
// Pure Node.js, zero external dependencies

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function findProjectRoot(startDir) {
  let dir = startDir || process.cwd();
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(dir, '.ccg', 'tasks'))) return dir;
    if (fs.existsSync(path.join(dir, '.ccg'))) return dir;
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Terminal task statuses — a task in any of these is no longer active, so the
// hooks stop injecting its breadcrumb. Matched case-insensitively after trim,
// covering common synonyms the model may write (done/finished/closed/...) so a
// committed-and-finished task is never misjudged as still in progress. The
// canonical write-side value is "completed" (see go.md), but the read side must
// be forgiving because status is free-text written by the model.
const TERMINAL_STATUSES = new Set([
  'completed', 'complete', 'done', 'finished', 'finish',
  'archived', 'archive', 'cancelled', 'canceled', 'closed', 'resolved', 'abandoned'
]);

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(String(status == null ? '' : status).trim().toLowerCase());
}

function getActiveTask(projectRoot) {
  const tasksDir = path.join(projectRoot, '.ccg', 'tasks');
  if (!fs.existsSync(tasksDir)) return null;

  try {
    const dirs = fs.readdirSync(tasksDir)
      .filter(d => {
        if (d === 'archive') return false;
        try {
          const full = path.join(tasksDir, d);
          return fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'task.json'));
        } catch { return false; }
      })
      .sort()
      .reverse();

    for (const dir of dirs) {
      try {
        const taskPath = path.join(tasksDir, dir, 'task.json');
        if (!fs.existsSync(taskPath)) continue; // stale pointer detection
        const raw = fs.readFileSync(taskPath, 'utf-8');
        const task = JSON.parse(raw);
        if (!isTerminalStatus(task.status)) {
          return { dir: path.join(tasksDir, dir), ...task, _stale: false };
        }
      } catch { /* skip malformed */ }
    }
  } catch { /* silent */ }
  return null;
}

function readFileSafe(filePath) {
  try { return fs.readFileSync(filePath, 'utf-8'); } catch { return null; }
}

function readJsonSafe(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return null; }
}

function taskProjectRoot(taskDir) {
  const resolved = path.resolve(taskDir);
  const tasksDir = path.dirname(resolved);
  const ccgDir = path.dirname(tasksDir);
  return path.dirname(ccgDir);
}

function evidencePath(taskDir) {
  return path.join(taskDir, 'evidence.json');
}

function normalizeEvidenceItem(item) {
  const source = item || {};
  const normalized = {
    id: String(source.id || `${source.provider || 'unknown'}-${source.role || 'evidence'}-${source.artifactFile || ''}`),
    provider: String(source.provider || 'unknown'),
    role: String(source.role || 'unknown'),
    policy: String(source.policy || 'optional'),
    available: source.available !== false,
    artifactFile: String(source.artifactFile || source.response_file || ''),
    artifactSha256: String(source.artifactSha256 || source.response_sha256 || ''),
    artifactChars: Number(source.artifactChars ?? source.response_chars ?? 0),
    summary: String(source.summary || ''),
    sessionId: source.sessionId ? String(source.sessionId) : null,
    round: Number(source.round || 1),
    createdAt: String(source.createdAt || source.created_at || new Date().toISOString()),
  };
  const manifestFile = source.manifestFile || source.manifest_file;
  const manifestSha256 = source.manifestSha256 || source.manifest_sha256;
  if (manifestFile) normalized.manifestFile = String(manifestFile);
  if (manifestSha256) normalized.manifestSha256 = String(manifestSha256);
  if (source.localOnly != null) normalized.localOnly = source.localOnly !== false;
  if (source.exported != null) normalized.exported = source.exported === true;
  return normalized;
}

function normalizeEvidence(evidence) {
  const rawItems = Array.isArray(evidence?.items) ? evidence.items : [];
  return {
    schemaVersion: Number(evidence?.schemaVersion || 1),
    items: rawItems.map(normalizeEvidenceItem).sort((a, b) =>
      `${a.provider}|${a.role}|${a.id}`.localeCompare(`${b.provider}|${b.role}|${b.id}`),
    ),
  };
}

function legacyGeminiEvidence(taskDir) {
  const task = readJsonSafe(path.join(taskDir, 'task.json'));
  const legacy = task?.gemini_evidence || task?.gemini_gate;
  if (!legacy) return [];
  const artifactFile = legacy.response_file || legacy.artifactFile || '';
  return [normalizeEvidenceItem({
    id: `legacy-gemini-${legacy.role || 'gate'}`,
    provider: 'gemini',
    role: legacy.role || 'gate',
    policy: legacy.policy || (legacy.required ? 'required' : 'optional'),
    available: legacy.available !== false,
    artifactFile,
    artifactSha256: legacy.response_sha256 || legacy.artifactSha256 || '',
    artifactChars: legacy.response_chars || legacy.artifactChars || 0,
    summary: legacy.summary || '',
    createdAt: legacy.createdAt || legacy.created_at || new Date().toISOString(),
  })];
}

function readEvidence(taskDir) {
  const filePath = evidencePath(taskDir);
  const evidence = readJsonSafe(filePath);
  if (!evidence) {
    return normalizeEvidence({ schemaVersion: 1, items: legacyGeminiEvidence(taskDir) });
  }
  const normalized = normalizeEvidence(evidence);
  const existingKeys = new Set(normalized.items.map(item => `${item.provider}|${item.role}|${item.artifactFile}`));
  for (const item of legacyGeminiEvidence(taskDir)) {
    const key = `${item.provider}|${item.role}|${item.artifactFile}`;
    if (!existingKeys.has(key)) normalized.items.push(item);
  }
  return normalizeEvidence(normalized);
}

function writeEvidence(taskDir, evidence) {
  const normalized = normalizeEvidence(evidence);
  fs.writeFileSync(evidencePath(taskDir), JSON.stringify(normalized, null, 2) + '\n', 'utf-8');
  return normalized;
}

function appendEvidenceItem(taskDir, item) {
  const evidence = readEvidence(taskDir);
  const normalized = normalizeEvidenceItem(item);
  const key = `${normalized.provider}|${normalized.sessionId || ''}|${normalized.round}|${normalized.id}`;
  evidence.items = evidence.items.filter(existing =>
    `${existing.provider}|${existing.sessionId || ''}|${existing.round}|${existing.id}` !== key,
  );
  evidence.items.push(normalized);
  return writeEvidence(taskDir, evidence);
}

function resolveArtifactPath(taskDir, artifactFile) {
  if (!artifactFile) return null;
  const projectRoot = path.resolve(taskProjectRoot(taskDir));
  if (/^[A-Za-z]:[\\/]/.test(artifactFile) && !path.isAbsolute(artifactFile)) return null;
  const portableArtifactFile = artifactFile.replace(/\\/g, '/');
  let candidate;
  if (path.isAbsolute(artifactFile)) candidate = path.resolve(artifactFile);
  else if (portableArtifactFile.startsWith('.ccg/') || portableArtifactFile.startsWith('.codex/')) {
    candidate = path.resolve(projectRoot, portableArtifactFile);
  } else candidate = path.resolve(taskDir, artifactFile);
  const relativePath = path.relative(projectRoot, candidate);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return null;
  if (fs.existsSync(candidate)) {
    try {
      const canonicalRoot = fs.realpathSync(projectRoot);
      const canonicalCandidate = fs.realpathSync(candidate);
      const canonicalRelative = path.relative(canonicalRoot, canonicalCandidate);
      if (!canonicalRelative || canonicalRelative.startsWith('..') || path.isAbsolute(canonicalRelative)) return null;
      return canonicalCandidate;
    } catch { return null; }
  }
  return candidate;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function evidenceTimestamp(item) {
  const timestamp = Date.parse(item.createdAt || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareEvidenceAge(a, b) {
  const roundA = Number.isFinite(Number(a.round)) ? Number(a.round) : 0;
  const roundB = Number.isFinite(Number(b.round)) ? Number(b.round) : 0;
  if (roundA !== roundB) return roundA - roundB;
  const timeA = evidenceTimestamp(a);
  const timeB = evidenceTimestamp(b);
  if (timeA !== timeB) return timeA - timeB;
  return `${a.sessionId || ''}|${a.id || ''}`.localeCompare(`${b.sessionId || ''}|${b.id || ''}`);
}

function validateEvidenceArtifact(taskDir, item, policy) {
  if (!item.available) {
    return policy === 'required'
      ? { ok: false, reason: 'required_evidence_unavailable', item }
      : { ok: true, reason: 'optional_evidence_unavailable', item };
  }
  const artifactPath = resolveArtifactPath(taskDir, item.artifactFile);
  if (!artifactPath || !fs.existsSync(artifactPath)) {
    return { ok: false, reason: 'artifact_missing', item };
  }
  try {
    if (!fs.statSync(artifactPath).isFile()) return { ok: false, reason: 'artifact_unreadable', item };
  } catch { return { ok: false, reason: 'artifact_unreadable', item }; }
  const text = fs.readFileSync(artifactPath, 'utf-8').trim();
  if (policy === 'required' && !text) {
    return { ok: false, reason: 'artifact_empty', item };
  }
  if (item.artifactSha256 && sha256File(artifactPath) !== item.artifactSha256) {
    return { ok: false, reason: 'artifact_hash_mismatch', item };
  }
  if (item.manifestFile) {
    const manifestPath = resolveArtifactPath(taskDir, item.manifestFile);
    if (!manifestPath || !fs.existsSync(manifestPath)) {
      return { ok: false, reason: 'manifest_missing', item };
    }
    try {
      if (!fs.statSync(manifestPath).isFile()) return { ok: false, reason: 'manifest_unreadable', item };
    } catch { return { ok: false, reason: 'manifest_unreadable', item }; }
    if (item.manifestSha256 && sha256File(manifestPath) !== item.manifestSha256) {
      return { ok: false, reason: 'manifest_hash_mismatch', item };
    }
  } else if (item.manifestSha256) {
    return { ok: false, reason: 'manifest_missing', item };
  }
  return { ok: true, item };
}

function validateEvidence(taskDir, requirement) {
  const req = requirement || {};
  const provider = String(req.provider || '');
  const role = String(req.role || '');
  const policy = String(req.policy || 'required');
  const evidence = readEvidence(taskDir);
  const matches = evidence.items.filter(item =>
    (!provider || item.provider === provider) && (!role || item.role === role),
  );
  if (matches.length === 0) {
    return policy === 'required'
      ? { ok: false, reason: 'missing_required_evidence' }
      : { ok: true, reason: 'optional_evidence_missing' };
  }
  const validations = matches.map(item => ({ item, validation: validateEvidenceArtifact(taskDir, item, policy) }));
  const validMatches = validations.filter(({ validation }) => validation.ok);
  if (validMatches.length > 0) {
    validMatches.sort((a, b) => compareEvidenceAge(a.item, b.item));
    return validMatches[validMatches.length - 1].validation;
  }
  validations.sort((a, b) => compareEvidenceAge(a.item, b.item));
  return validations[validations.length - 1].validation;
}

function composeEvidenceSummary(taskDir, filter) {
  const evidence = readEvidence(taskDir);
  const provider = filter?.provider;
  const role = filter?.role;
  return evidence.items
    .filter(item => (!provider || item.provider === provider) && (!role || item.role === role))
    .map(item => `- ${item.provider}/${item.role}: ${item.available ? 'available' : 'unavailable'} - ${item.summary || item.artifactFile}`)
    .join('\n');
}

function readContextJsonl(taskDir) {
  const jsonlPath = path.join(taskDir, 'context.jsonl');
  if (!fs.existsSync(jsonlPath)) return [];
  try {
    return fs.readFileSync(jsonlPath, 'utf-8')
      .split('\n')
      .filter(line => line.trim())
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(entry => entry && entry.file);
  } catch { return []; }
}

function detectTechStack(projectRoot) {
  const indicators = [
    { file: 'package.json', stack: 'Node.js' },
    { file: 'go.mod', stack: 'Go' },
    { file: 'pyproject.toml', stack: 'Python' },
    { file: 'Cargo.toml', stack: 'Rust' },
    { file: 'pom.xml', stack: 'Java' },
    { file: 'build.gradle', stack: 'Java/Kotlin' },
  ];
  const found = [];
  for (const { file, stack } of indicators) {
    if (fs.existsSync(path.join(projectRoot, file))) found.push(stack);
  }
  return found.length > 0 ? found.join(' + ') : 'Unknown';
}

function getGitInfo(projectRoot) {
  try {
    const { execSync } = require('child_process');
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectRoot, stdio: 'pipe' }).toString().trim();
    const status = execSync('git status --porcelain', { cwd: projectRoot, stdio: 'pipe' }).toString().trim();
    const dirtyCount = status ? status.split('\n').length : 0;
    return { branch, dirtyCount };
  } catch { return { branch: 'unknown', dirtyCount: 0 }; }
}

// outputHook(event, additionalContext)           → inject context into the CALLING session
// outputHook(event, null, { updatedInput, ... })  → rewrite the tool input before it runs
//   `extra` is merged into hookSpecificOutput, so it can carry updatedInput /
//   permissionDecision / permissionDecisionReason. Pass additionalContext = null
//   to omit it. Back-compatible: existing 2-arg calls behave exactly as before.
function outputHook(eventName, additionalContext, extra) {
  const hookSpecificOutput = { hookEventName: eventName };
  if (additionalContext != null && additionalContext !== '') {
    hookSpecificOutput.additionalContext = additionalContext;
  }
  if (extra && typeof extra === 'object') {
    Object.assign(hookSpecificOutput, extra);
  }
  console.log(JSON.stringify({ hookSpecificOutput }));
}

function archiveTask(taskDir, projectRoot) {
  try {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const archiveDir = path.join(projectRoot, '.ccg', 'tasks', 'archive', month);
    if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
    const name = path.basename(taskDir);
    const dest = path.join(archiveDir, name);
    fs.renameSync(taskDir, dest);
    return dest;
  } catch { return null; }
}

function autoCommitTask(projectRoot, message) {
  try {
    const { execSync } = require('child_process');
    execSync('git add .ccg/tasks/', { cwd: projectRoot, stdio: 'pipe' });
    const diff = execSync('git diff --cached --quiet', { cwd: projectRoot, stdio: 'pipe' }).toString();
    return false; // nothing to commit
  } catch {
    try {
      const { execSync } = require('child_process');
      execSync(`git commit -m "${message || 'chore: archive ccg task'}"`, { cwd: projectRoot, stdio: 'pipe' });
      return true;
    } catch { return false; }
  }
}

function seedContextJsonl(taskDir, projectRoot) {
  const jsonlPath = path.join(taskDir, 'context.jsonl');
  if (fs.existsSync(jsonlPath)) return;
  const specDir = path.join(projectRoot, '.ccg', 'spec');
  const lines = ['{"_example": "Fill with {\\\"file\\\": \\\"path\\\", \\\"reason\\\": \\\"why\\\"}. One entry per line. Seed rows (with _example key) are skipped."}'];
  if (fs.existsSync(specDir)) {
    try {
      const walk = (dir, prefix) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const rel = prefix ? `${prefix}/${e.name}` : e.name;
          if (e.isDirectory()) walk(path.join(dir, e.name), rel);
          else if (e.name.endsWith('.md')) lines.push(JSON.stringify({ file: `.ccg/spec/${rel}`, reason: 'project spec' }));
        }
      };
      walk(specDir, '');
    } catch { /* silent */ }
  }
  try { fs.writeFileSync(jsonlPath, lines.join('\n') + '\n', 'utf-8'); } catch { /* silent */ }
}

function trackTurn(taskDir, phase, nextAction) {
  const turnsPath = path.join(taskDir, '.turns.json');
  let turns = [];
  try { turns = JSON.parse(fs.readFileSync(turnsPath, 'utf-8')); } catch { /* fresh */ }
  turns.push({ phase: phase || '', next: nextAction || '', ts: Date.now() });
  if (turns.length > 10) turns = turns.slice(-10);
  try { fs.writeFileSync(turnsPath, JSON.stringify(turns), 'utf-8'); } catch { /* silent */ }
  return turns;
}

function detectLoop(turns, threshold) {
  threshold = threshold || 3;
  if (turns.length < threshold) return null;
  const recent = turns.slice(-threshold);
  const key = `${recent[0].phase}|${recent[0].next}`;
  const allSame = recent.every(t => `${t.phase}|${t.next}` === key);
  if (!allSame) return null;
  const elapsed = (recent[recent.length - 1].ts - recent[0].ts) / 1000;
  return { phase: recent[0].phase, nextAction: recent[0].next, count: threshold, elapsedSec: Math.round(elapsed) };
}

module.exports = {
  findProjectRoot,
  getActiveTask,
  isTerminalStatus,
  readFileSafe,
  readJsonSafe,
  readEvidence,
  writeEvidence,
  validateEvidence,
  resolveArtifactPath,
  normalizeEvidenceItem,
  appendEvidenceItem,
  composeEvidenceSummary,
  readContextJsonl,
  detectTechStack,
  getGitInfo,
  outputHook,
  archiveTask,
  autoCommitTask,
  seedContextJsonl,
  trackTurn,
  detectLoop
};
