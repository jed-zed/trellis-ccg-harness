export function parseDispatchMode(configText) {
  const block = configText.match(
    /^codex:\s*(?:#.*)?\r?\n((?:^[ \t]+.*(?:\r?\n|$))*)/m,
  )?.[1];
  return (
    block
      ?.match(/^\s+dispatch_mode:\s*["']?([^"'#\s]+)["']?/m)?.[1]
      ?.toLowerCase() ?? null
  );
}

export function collectHookCommands(document, eventName) {
  const entries = document?.hooks?.[eventName];
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.flatMap((entry) =>
    Array.isArray(entry?.hooks)
      ? entry.hooks
          .map((hook) => hook?.command)
          .filter((command) => typeof command === "string")
      : [],
  );
}

export function countHookCommands(document, eventName) {
  return collectHookCommands(document, eventName).length;
}

export function truthy(value) {
  return /^(?:1|true|yes|on)$/i.test(String(value ?? "").trim());
}

export function parseCcgVersion(value) {
  return value.match(/\bccg\/(\d+\.\d+\.\d+)\b/i)?.[1] ?? null;
}

export function makeFinding({
  id,
  severity,
  status,
  summary,
  evidence,
  action,
}) {
  const finding = { id, severity, status, summary };
  if (evidence !== undefined) {
    finding.evidence = evidence;
  }
  if (action) {
    finding.action = action;
  }
  return finding;
}

export function summarizeFindings(findings) {
  const counts = { blocking: 0, warning: 0, info: 0, ok: 0 };
  for (const finding of findings) {
    if (finding.status === "ok") {
      counts.ok += 1;
    } else {
      counts[finding.severity] += 1;
    }
  }
  return counts;
}

export function conflictExitCode(report) {
  return report.findings.some(
    (finding) =>
      finding.status === "conflict" && finding.severity === "blocking",
  )
    ? 2
    : 0;
}
