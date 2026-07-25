import { spawnSync } from "node:child_process";

function parseVersion(value) {
  return (
    /\bPython\s+(\d+\.\d+\.\d+)\b/i.exec(value)?.[1] ??
    /\b(\d+\.\d+\.\d+)\b/.exec(value)?.[1] ??
    null
  );
}

function isSupported(version) {
  const [major, minor] = version.split(".").map(Number);
  return major > 3 || (major === 3 && minor >= 9);
}

function defaultRunner(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 10_000,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

function locate(command, platform, runner) {
  const result = runner(
    platform === "win32" ? "where.exe" : "which",
    [command],
  );
  const first = String(result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return result.status === 0 && first ? first : command;
}

export function resolvePython(options = {}) {
  const platform = options.platform ?? process.platform;
  const runner = options.runner ?? defaultRunner;
  const configuredCommand = String(
    options.configuredCommand ?? "",
  ).trim();
  const defaults = platform === "win32"
    ? [
        { command: "py", argsPrefix: ["-3"] },
        { command: "python", argsPrefix: [] },
        { command: "python3", argsPrefix: [] },
      ]
    : [
        { command: "python3", argsPrefix: [] },
        { command: "python", argsPrefix: [] },
      ];
  const configured = configuredCommand
    ? [{ command: configuredCommand, argsPrefix: [] }]
    : [];
  const candidates = options.candidates ?? [...configured, ...defaults];

  for (const candidate of candidates) {
    const result = runner(candidate.command, [
      ...candidate.argsPrefix,
      "--version",
    ]);
    const version = parseVersion(
      `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
    if (result.status === 0 && version && isSupported(version)) {
      return {
        command: locate(candidate.command, platform, runner),
        argsPrefix: candidate.argsPrefix,
        version,
      };
    }
  }
  throw new Error(
    "Python 3.9 or newer is required, but python3, python, and py -3 all failed.",
  );
}

export function resolvePythonFromSystem() {
  return resolvePython();
}
