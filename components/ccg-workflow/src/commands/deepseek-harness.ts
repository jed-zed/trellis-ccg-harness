import {
  doctorDeepseekHarness,
  installDeepseekHarness,
  planDeepseekHarness,
  rollbackDeepseekHarness,
} from '../utils/deepseek-harness'
import type { DeepseekHarnessOptions } from '../utils/deepseek-harness'

export async function deepseekHarness(action: string, options: DeepseekHarnessOptions & { json?: boolean }): Promise<void> {
  const actions = { plan: planDeepseekHarness, install: installDeepseekHarness, doctor: doctorDeepseekHarness, rollback: rollbackDeepseekHarness }
  const handler = actions[action as keyof typeof actions]
  if (!handler) {
    console.error('Unknown DeepSeek Harness action. Use plan, install, doctor or rollback.')
    process.exitCode = 1
    return
  }
  const result = await handler(options)
  if (options.json) console.log(JSON.stringify(result, null, 2))
  else {
    console.log(`DeepSeek Harness compatibility: ${result.state} (${result.profile})`)
    if (result.target) console.log(`Target: ${result.target}`)
    if (result.message) console.log(result.message)
    for (const change of result.changes ?? []) console.log(`- ${change}`)
    for (const missing of result.missingDependencies ?? []) console.log(`Missing dependency: ${missing}`)
  }
  if (!result.success) process.exitCode = 1
}
