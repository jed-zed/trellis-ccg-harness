#!/usr/bin/env node
"use strict";

// CLI works both in this ESM repository and in a copied CommonJS skill directory.
let fs;
let path;

const SECTION_ALIASES = {
  workers: ["Workers", "工作分工"],
  mergeStrategy: ["Merge Strategy", "合并策略"],
  verificationStrategy: ["Verification Strategy", "验证策略"],
  conflictRisks: ["Conflict Risks", "冲突风险"],
};

const CONFLICT_ACTION_PATTERNS = [
  /\breconcile\b/i,
  /\bresolve\b/i,
  /\bowner\b/i,
  /\bmerge\b/i,
  /\bconflict\b/i,
  /负责/,
  /协调/,
  /解决/,
  /收敛/,
  /合并/,
  /冲突/,
];

class CliError extends Error {
  constructor(message, result) {
    super(message);
    this.result = result || null;
  }
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(text) {
  return text.replace(/\r\n/g, "\n");
}

function normalizeHeading(text) {
  return text.trim().toLowerCase();
}

function parseSections(markdown) {
  const text = normalizeText(markdown);
  const lines = text.split("\n");
  const sections = [];
  let current = { heading: "__preamble__", lines: [] };
  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      sections.push(current);
      current = { heading: headingMatch[2].trim(), lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  sections.push(current);
  return sections;
}

function findSection(markdown, aliases) {
  const sections = parseSections(markdown);
  const aliasPatterns = aliases.map((alias) => new RegExp(`^${escapeRegex(alias)}$`, "i"));
  const match = sections.find((section) => aliasPatterns.some((pattern) => pattern.test(section.heading)));
  return match ? match.lines.join("\n").trim() : "";
}

function splitFiles(cell = "") {
  return cell
    .split(/<br\s*\/?>|,|;|\r?\n/g)
    .map((item) => item.trim().replace(/^`|`$/g, ""))
    .map((item) => item.replace(/\\/g, "/"))
    .map((item) => item.replace(/^\.\//, ""))
    .filter((item) => item && !/^(?:-|none|n\/a|无)$/i.test(item));
}

function parseTableRow(line) {
  const cells = line
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell, index, items) => !(index === 0 && cell === "") && !(index === items.length - 1 && cell === ""));
  return cells;
}

function isSeparatorRow(cells) {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function parseWorkerTable(markdown) {
  const section = findSection(markdown, SECTION_ALIASES.workers);
  if (!section) return { valid: false, workers: [] };
  const lines = section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.startsWith("|"));
  if (lines.length < 2) return { valid: false, workers: [] };
  const rows = lines.map(parseTableRow);
  const header = rows[0].map(normalizeHeading);
  const column = (...names) => header.findIndex((name) => names.includes(name));
  const nameColumn = column("worker", "name", "工作者", "子代理");
  const scopeColumn = column("scope", "范围");
  const readsColumn = column("reads", "read", "读取");
  const writesColumn = column("writes", "write", "写入");
  const filesColumn = column("files", "文件");
  const depsColumn = column("deps", "depends on", "dependencies", "依赖");
  const constraintsColumn = column("constraints", "约束");
  if (nameColumn < 0 || scopeColumn < 0 || (writesColumn < 0 && filesColumn < 0) || !isSeparatorRow(rows[1])) {
    return { valid: false, workers: [] };
  }

  const workers = [];
  for (const row of rows.slice(1)) {
    if (isSeparatorRow(row)) continue;
    if (row.length !== header.length) return { valid: false, workers: [] };
    const writes = splitFiles(row[writesColumn >= 0 ? writesColumn : filesColumn]);
    const reads = readsColumn >= 0 ? splitFiles(row[readsColumn]) : [];
    workers.push({
      name: row[nameColumn],
      scope: row[scopeColumn],
      reads,
      writes,
      files: [...new Set([...reads, ...writes])],
      deps: depsColumn >= 0 ? splitFiles(row[depsColumn]) : [],
      constraints: constraintsColumn >= 0 ? row[constraintsColumn] : "",
    });
  }
  return { valid: workers.every((worker) => worker.name), workers };
}

function parseWorkers(markdown) {
  return parseWorkerTable(markdown).workers;
}

function dependsOn(workers, name, target, seen = new Set()) {
  if (seen.has(name)) return false;
  seen.add(name);
  const worker = workers.find((item) => item.name === name);
  return Boolean(worker && worker.deps.some((dep) => dep === target || dependsOn(workers, dep, target, seen)));
}

function findConflicts(workers) {
  const conflicts = [];
  const normalized = (file) => path.posix.normalize(file.replace(/\\/g, "/")).replace(/\/$/, "").toLowerCase();
  const overlap = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
  for (let i = 0; i < workers.length; i++) {
    for (const b of workers.slice(i + 1)) {
      const a = workers[i];
      const pairs = [...a.writes.flatMap((x) => [...b.reads, ...b.writes].map((y) => [x, y])),
        ...b.writes.flatMap((x) => a.reads.map((y) => [x, y]))];
      const seen = new Set();
      for (const [x, y] of pairs) {
        if (!overlap(normalized(x), normalized(y))) continue;
        const file = normalized(x).length <= normalized(y).length ? x : y;
        if (seen.has(normalized(file))) continue;
        seen.add(normalized(file));
        conflicts.push({ file, owners: [a.name, b.name].sort(),
          serialized: dependsOn(workers, a.name, b.name) || dependsOn(workers, b.name, a.name) });
      }
    }
  }
  return conflicts;
}

function extractVerificationCommands(sectionText) {
  return sectionText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("```"))
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter((line) =>
      /^(?:\/ccg:|node\b|python\b|powershell\b|pwsh\b|git\b)/i.test(line) || line.includes("--")
    );
}

function statusPathForPlan(planPath) {
  const normalized = path.resolve(planPath);
  if (path.basename(normalized).toLowerCase() !== "plan.md") return null;
  return path.join(path.dirname(normalized), "status.json");
}

function writeStatus(planPath, result) {
  const statusPath = statusPathForPlan(planPath);
  if (!statusPath) return null;
  const task = path.basename(path.dirname(path.resolve(planPath)));
  const previous = fs.existsSync(statusPath) ? JSON.parse(fs.readFileSync(statusPath, "utf8")) : {};
  const status = {
    ...previous,
    task,
    workers: { ...previous.workers, ...Object.fromEntries(
      result.workers.map((worker) => [
        worker.name,
        {
          status: "planned",
          files: worker.files,
          reads: worker.reads,
          writes: worker.writes,
          ...(previous.workers && previous.workers[worker.name]),
          plan: { reads: worker.reads, writes: worker.writes, deps: worker.deps },
        },
      ])
    ) },
    conflicts: result.same_file_conflicts,
    verification: {
      ...previous.verification,
      required: result.has_verification_strategy,
      commands: extractVerificationCommands(result.verification_strategy_text),
    },
  };
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2) + "\n", "utf8");
  return statusPath;
}

function validatePlan(planPath, options = {}) {
  if (!planPath) throw new CliError("plan path is required");
  if (!fs.existsSync(planPath)) throw new CliError(`plan does not exist: ${planPath}`);
  const markdown = fs.readFileSync(planPath, "utf8");
  const table = parseWorkerTable(markdown);
  const workers = table.workers;
  const mergeStrategyText = findSection(markdown, SECTION_ALIASES.mergeStrategy);
  const verificationStrategyText = findSection(markdown, SECTION_ALIASES.verificationStrategy);
  const conflictRisksText = findSection(markdown, SECTION_ALIASES.conflictRisks);
  const sameFileConflicts = findConflicts(workers);

  const blockingReasons = [];
  if (!table.valid) blockingReasons.push("workers table is missing or malformed (an empty valid table is allowed)");
  if (new Set(workers.map((worker) => worker.name)).size !== workers.length) blockingReasons.push("duplicate worker names");
  if (!mergeStrategyText) blockingReasons.push("missing Merge Strategy section");
  if (!verificationStrategyText) blockingReasons.push("missing Verification Strategy section");
  if (!conflictRisksText) blockingReasons.push("missing Conflict Risks section");

  for (const conflict of sameFileConflicts) {
    if (!conflict.serialized) {
      blockingReasons.push(`same file conflict requires ordered Deps or separate ownership: ${conflict.file}`);
    }
  }
  for (const worker of workers) {
    if (dependsOn(workers, worker.name, worker.name)) blockingReasons.push(`dependency cycle: ${worker.name}`);
    for (const dep of worker.deps) {
      if (!workers.some((item) => item.name === dep)) blockingReasons.push(`unknown dependency: ${dep}`);
    }
  }

  const result = {
    plan_path: path.resolve(planPath),
    workers,
    same_file_conflicts: sameFileConflicts,
    has_merge_strategy: Boolean(mergeStrategyText),
    has_verification_strategy: Boolean(verificationStrategyText),
    has_conflict_risks: Boolean(conflictRisksText),
    can_execute: blockingReasons.length === 0,
    blocking_reasons: blockingReasons,
    merge_strategy_text: mergeStrategyText,
    verification_strategy_text: verificationStrategyText,
    conflict_risks_text: conflictRisksText,
  };

  result.status_path = options.writeStatus === false ? null : writeStatus(planPath, result);
  result.status_written = Boolean(result.status_path);
  return result;
}

function summarizePlan(planPath, options = {}) {
  const result = validatePlan(planPath, { writeStatus: Boolean(options.writeStatus) });
  return {
    plan_path: result.plan_path,
    worker_count: result.workers.length,
    workers: result.workers,
    files: [...new Set(result.workers.flatMap((worker) => worker.files))].sort(),
    same_file_conflicts: result.same_file_conflicts,
    has_merge_strategy: result.has_merge_strategy,
    has_verification_strategy: result.has_verification_strategy,
    has_conflict_risks: result.has_conflict_risks,
    can_execute: result.can_execute,
    status_path: result.status_path,
    status_written: result.status_written,
  };
}

function conflictsOnly(planPath, options = {}) {
  const result = validatePlan(planPath, { writeStatus: Boolean(options.writeStatus) });
  return {
    plan_path: result.plan_path,
    same_file_conflicts: result.same_file_conflicts,
    merge_strategy_text: result.merge_strategy_text,
    blocking_reasons: result.blocking_reasons.filter((reason) => reason.includes("same file conflict")),
    can_execute: result.can_execute,
    status_path: result.status_path,
    status_written: result.status_written,
  };
}

function formatHuman(result) {
  const lines = [`plan: ${result.plan_path}`];
  if (typeof result.can_execute === "boolean") lines.push(`can_execute: ${result.can_execute}`);
  if (result.worker_count != null) lines.push(`workers: ${result.worker_count}`);
  if (result.same_file_conflicts) lines.push(`same_file_conflicts: ${result.same_file_conflicts.length}`);
  if (result.blocking_reasons && result.blocking_reasons.length) {
    lines.push("blocking_reasons:");
    for (const reason of result.blocking_reasons) lines.push(`- ${reason}`);
  }
  return lines.join("\n");
}

function main(argv = process.argv.slice(2)) {
  const json = argv.includes("--json");
  const args = argv.filter((arg) => arg !== "--json");
  const command = args.shift();
  const planPath = args.shift();
  if (!command) {
    throw new CliError(
      "usage: team_plan_checker.js <validate|summarize|conflicts> <plan.md> [--json] [--write-status|--no-write-status]"
    );
  }
  const writeStatusFlag = args.includes("--write-status");
  const noWriteStatusFlag = args.includes("--no-write-status");
  const shouldWriteStatus = writeStatusFlag || (command === "validate" && !noWriteStatusFlag);

  let result;
  if (command === "validate") result = validatePlan(planPath, { writeStatus: shouldWriteStatus });
  else if (command === "summarize") result = summarizePlan(planPath, { writeStatus: shouldWriteStatus });
  else if (command === "conflicts") result = conflictsOnly(planPath, { writeStatus: shouldWriteStatus });
  else throw new CliError(`unknown command: ${command}`);

  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatHuman(result));

  if (command === "validate" && !result.can_execute) process.exit(1);
}

function runCli() {
  try {
    main();
  } catch (error) {
    const json = process.argv.slice(2).includes("--json");
    if (json && error && error.result) console.log(JSON.stringify(error.result, null, 2));
    else if (json) console.log(JSON.stringify({ error: error.message }, null, 2));
    else console.error(error.message);
    process.exit(1);
  }
}

const api = {
  conflictsOnly,
  parseWorkers,
  summarizePlan,
  validatePlan,
  writeStatus,
};

if (typeof module !== "undefined" && typeof require === "function") {
  fs = require("node:fs");
  path = require("node:path");
  module.exports = api;
  if (require.main === module) runCli();
} else {
  Promise.all([import("node:fs"), import("node:path")]).then(([fsModule, pathModule]) => {
    fs = fsModule.default;
    path = pathModule.default;
    runCli();
  });
}
