import { execFile as execFileCallback, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { resolvePython } from "./python-resolver.mjs";

const execFile = promisify(execFileCallback);
let python;

// FILETIME uses 100 ns units since 1601; existing locks use .NET ticks since 0001.
const query = String.raw`
import ctypes
from ctypes import wintypes
import sys

pid = int(sys.argv[1])
if not 0 < pid <= 0xFFFFFFFF:
    raise ValueError("Invalid process identifier")
kernel = ctypes.WinDLL("kernel32", use_last_error=True)
kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
kernel.OpenProcess.restype = wintypes.HANDLE
kernel.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
kernel.GetProcessTimes.restype = wintypes.BOOL
kernel.CloseHandle.argtypes = [wintypes.HANDLE]
kernel.CloseHandle.restype = wintypes.BOOL
handle = kernel.OpenProcess(0x1000, False, pid)
if not handle:
    raise ctypes.WinError(ctypes.get_last_error())
try:
    creation, exited, kernel_time, user_time = [wintypes.FILETIME() for _ in range(4)]
    if not kernel.GetProcessTimes(handle, *map(ctypes.byref, (creation, exited, kernel_time, user_time))):
        raise ctypes.WinError(ctypes.get_last_error())
    ticks = (creation.dwHighDateTime << 32) | creation.dwLowDateTime
    print(ticks + 504911232000000000)
finally:
    kernel.CloseHandle(handle)
`;

export async function readWindowsProcessIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 0xFFFFFFFF) return null;
  const deadline = performance.now() + 5_000;
  const remaining = () => {
    const milliseconds = Math.ceil(deadline - performance.now());
    if (milliseconds <= 0) throw new Error("Windows process identity query timed out");
    return milliseconds;
  };
  try {
    python ??= resolvePython({
      runner: (command, args) => spawnSync(command, args, {
        encoding: "utf8", shell: false, windowsHide: true,
        timeout: remaining(), maxBuffer: 4_096,
      }),
    });
    const { stdout } = await execFile(
      python.command,
      [...python.argsPrefix, "-I", "-S", "-c", query, String(pid)],
      { shell: false, windowsHide: true, timeout: remaining(), maxBuffer: 4_096 },
    );
    const ticks = stdout.trim();
    return /^\d+$/.test(ticks) ? `win32:${pid}:${ticks}` : undefined;
  } catch {
    // Missing runtime, denied access and query failures cannot prove owner death.
    return undefined;
  }
}
