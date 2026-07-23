import { spawnSync } from 'node:child_process'

function defaultTaskkill(args) {
  const result = spawnSync('taskkill.exe', args, { windowsHide: true, stdio: 'ignore', shell: false })
  if (result.error)
    throw result.error
}

export function signalProcessTree(child, signal, {
  platform = process.platform,
  treeEnabled = false,
  killGroup = (pid, requestedSignal) => process.kill(pid, requestedSignal),
  runTaskkill = defaultTaskkill,
} = {}) {
  if (!child || child.exitCode != null || child.signalCode != null)
    return
  const pid = Number(child.pid)
  if (treeEnabled && Number.isInteger(pid) && pid > 0) {
    if (platform === 'win32') {
      runTaskkill(['/PID', String(pid), '/T', '/F'])
      return
    }
    try {
      killGroup(-pid, signal)
      return
    }
    catch {}
  }
  child.kill(signal)
}
