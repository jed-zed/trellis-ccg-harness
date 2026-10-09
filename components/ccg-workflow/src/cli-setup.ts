import type { CAC } from 'cac'
import type { DoctorOptions } from './commands/doctor'
import type { ProductManagerCommandOptions } from './commands/product-manager'
import ansis from 'ansis'
import { version } from '../package.json'
import { showCompanionAddons } from './commands/addons'
import { configRouting } from './commands/config-routing'
import { doctor } from './commands/doctor'
import { productManagerCommand } from './commands/product-manager'
import { providers } from './commands/providers'
import { deepseekHarness } from './commands/deepseek-harness'
import { runCodexRoute } from './commands/route'
import { runWrapper } from './commands/wrapper'
import { i18n, initI18n } from './i18n'
import { installCodexMode, recoverCodexMode, uninstallCodexMode } from './utils/installer'
import { planAgentPreservationAt } from './utils/codex-mode'

function customizeHelp(sections: any[]): any[] {
  sections.unshift({ title: '', body: ansis.cyan.bold(`Personal CCG for Codex v${version}`) })
  sections.push({ title: 'Host isolation', body: 'Personal runtime: Codex only. Claude uses upstream CCG and the separate ccg-gptpro-bridge plugin.\nLegacy Claude init, menu, MCP configuration and uninstall are unavailable here.' })
  return sections
}

export function assertPersonalCliRequest(args: readonly string[], environment: NodeJS.ProcessEnv = process.env): void {
  const command = args[0] || ''
  if (environment.CCG_HOST === 'claude' || environment.CLAUDECODE === '1')
    throw new Error('Personal CCG is Codex-only. Use upstream CCG in Claude and the separate ccg-gptpro-bridge plugin.')
  if (['init', 'i', 'uninstall', 'config', 'diagnose-mcp', 'fix-mcp', 'grok'].includes(command))
    throw new Error(`Legacy Claude command "${command}" is disabled in the Codex-only personal CLI. Use ccg-codex codex-mode for managed Codex lifecycle; upstream CCG owns Claude.`)
  if (command === 'doctor' && args.some((arg, index) => arg === '--platform=claude' || (arg === '--platform' && args[index + 1] === 'claude')))
    throw new Error('Claude diagnosis belongs to upstream CCG. Personal doctor is Codex-only.')
  if (command === 'doctor' && args.some(arg => ['--grok', '--grok-live', '--grok-cleanup'].includes(arg)))
    throw new Error('Legacy Claude Grok doctor actions are unavailable in the Codex-only personal CLI.')
}

export function isCodexModeHelpRequest(args: readonly string[]): boolean {
  if (args[0] !== 'codex-mode')
    return false

  const actionArgs = args.slice(1)
  return actionArgs.length === 0
    || actionArgs.some(arg => arg === 'help' || arg === '--help' || arg === '-h')
}

export function printCodexModeHelp(): void {
  console.log([
    ansis.cyan.bold(`CCG Codex-Led mode v${version}`),
    '',
    'Usage:',
    '  ccg-codex codex-mode <install|uninstall|recover>',
    '  ccg-codex codex-mode install --wrapper-file <absolute-local-artifact>',
    '  ccg-codex codex-mode plan-agent-preservation --baseline-dir <absolute-old-agents> --agent-model <model> --agent-reasoning <effort> --json',
    '  ccg-codex codex-mode install --agent-preservation-plan <absolute-reviewed-plan> --agent-preservation-plan-sha256 sha256:<reviewed-sha256>',
    '',
    'Actions:',
    '  install    Install the managed Codex runtime under ~/.codex.',
    '  uninstall  Remove only CCG-managed Codex runtime files.',
    '  recover    Recover an interrupted Codex mode transaction.',
    '  plan-agent-preservation  Read-only plan for the two additive user model overrides.',
    '',
    'This command is non-interactive and only manages Codex-owned paths.',
    'Local artifacts must match the fixed SHA-256 and native version for this build.',
  ].join('\n'))
}

export function isCodexNativeRequest(args: readonly string[]): boolean {
  if (args[0] === 'doctor' && args.some((arg, index) => arg === '--platform=claude' || (arg === '--platform' && args[index + 1] === 'claude')))
    return false
  return ['', 'route', 'routing', 'wrapper', 'codex-mode', 'product-manager', 'providers', 'deepseek-harness', 'addons', 'status', 'doctor'].includes(args[0] || '')
}

export async function setupCommands(cli: CAC): Promise<void> {
  // Host selection must never read or migrate Claude configuration during startup.
  await initI18n('zh-CN')
  cli.command('', 'Show Codex-only usage').action(() => cli.outputHelp())

  // Companion add-on catalog. This command is deliberately read-only and
  // never treats a recommendation as installation approval.
  cli
    .command('addons', i18n.t('cli:help.commandDescriptions.addons'))
    .option('--json', 'Print the read-only catalog as JSON')
    .option('--lang, -l <lang>', `${i18n.t('cli:help.optionDescriptions.displayLanguage')} (zh-CN, en)`)
    .action(async (options: { json?: boolean, lang?: 'en' | 'zh-CN' }) => {
      if (options.lang)
        await initI18n(options.lang)
      showCompanionAddons({ json: options.json })
    })

  // Doctor: environment health check
  cli
    .command('doctor', 'Check CCG installation health')
    .option('--platform <platform>', 'Check the Codex installation explicitly (codex)')
    .option('--gptpro', 'Require independent GPT Pro sidebar local files (without --platform, check only these files)')
    .action(async (options: DoctorOptions) => {
      // CAC permits options before the command. Enforce the host on parsed
      // values too, before delegating to the preserved upstream library code.
      if (options.platform !== undefined && options.platform !== 'codex')
        throw new Error('Personal doctor is Codex-only. Claude diagnosis belongs to upstream CCG.')
      const result = await doctor({ ...options, platform: options.platform ?? (options.gptpro ? undefined : 'codex') })
      if (!result.ok)
        process.exitCode = 1
    })

  cli
    .command('providers <action>', 'Install, diagnose, or explicitly configure optional Kimi/OpenCode providers')
    .option('--backend <provider>', 'Required optional provider: kimi or opencode')
    .option('--prefix <path>', 'Required absolute private installation prefix')
    .option('--model <model>', 'Explicit provider model; no credentials are collected')
    .option('--role <role>', 'Explicit frontend or backend route for configure')
    .option('--shell-path <path>', 'Kimi Code Git Bash executable on Windows')
    .option('--json', 'Print machine-readable output')
    .action(async (action: string, options: Parameters<typeof providers>[1]) => {
      try {
        await providers(action, options)
      }
      catch (error) {
        console.error(String(error))
        process.exitCode = 1
      }
    })

  cli
    .command('deepseek-harness <action>', 'Manage an optional one-shot DSH compatibility profile')
    .option('--dsh-home <path>', 'Existing DSH home; no profile is created')
    .option('--profile <name>', 'Exactly one existing profile')
    .option('--prefix <path>', 'Absolute directory for CCG-owned compatibility assets')
    .option('--provider <name>', 'Explicit DSH provider; no deployment-default fallback')
    .option('--model <name>', 'Explicit model for the review tool')
    .option('--dsh-cli <path>', 'Actual Node launcher or native executable')
    .option('--dry-run', 'Print the concrete changes without writing')
    .option('--json', 'Print machine-readable output')
    .action(async (action: string, options: Parameters<typeof deepseekHarness>[1]) => {
      try {
        await deepseekHarness(action, options)
      }
      catch (error) {
        console.error(String(error))
        process.exitCode = 1
      }
    })

  cli
    .command('route', 'Run the Codex-native CCG intelligence route')
    .allowUnknownOptions()
    .action(() => {
      const index = process.argv.indexOf('route')
      process.exitCode = runCodexRoute(process.argv.slice(index + 1))
    })

  cli
    .command('wrapper', 'Run the managed codeagent-wrapper')
    .allowUnknownOptions()
    .action(async () => {
      const index = process.argv.indexOf('wrapper')
      try {
        process.exitCode = await runWrapper(process.argv.slice(index + 1))
      }
      catch (error) {
        console.error(String(error))
        process.exitCode = 1
      }
    })

  cli
    .command('product-manager <action>', 'Run the product-manager contract')
    .option('--json', 'Print machine-readable output')
    .option('--input <path>', 'Strict product-manager input JSON')
    .option('--workdir <path>', 'Canonical project workdir for offline snapshot preparation')
    .option('--task-dir <path>', 'Canonical Trellis task directory')
    .option('--response <path>', 'Validate an externally produced response without calling a provider')
    .option('--allowed-providers <providers>', 'Project-allowed provider intersection')
    .option('--allow-provider-call', 'Explicitly authorize this one provider call')
    .option('--workspace-snapshot <path>', 'Validated read-only workspace snapshot root')
    .option('--workspace-manifest <path>', 'Workspace snapshot manifest')
    .option('--claude-transport <transport>', 'Project-selected Claude transport: local or ssh')
    .option('--config <path>', 'Explicit Codex CCG config path')
    .action(async (action: string, options: ProductManagerCommandOptions) => {
      await productManagerCommand(action, options)
    })

  cli
    .command('routing [action] [role] [provider]', 'List or change CCG role-to-provider routing')
    .option('--json', 'Print machine-readable output')
    .action(async (
      action: string | undefined,
      role: string | undefined,
      provider: string | undefined,
      options: { json?: boolean },
    ) => {
      await configRouting(action, role, provider, options)
    })

  // Status: show current installation overview
  cli
    .command('status', 'Show CCG installation status')
    .action(async () => {
      const result = await doctor({ platform: 'codex' })
      if (!result.ok) process.exitCode = 1
    })

  // Codex mode: non-interactive install/uninstall
  cli
    .command('codex-mode <action>', 'Install, uninstall, or recover Codex-Led mode (non-interactive)')
    .option('--wrapper-file <path>', 'Install the pinned native wrapper from an absolute local artifact')
    .option('--agent-preservation-plan <path>', 'Apply an explicit hash-bound agent preservation plan during install')
    .option('--agent-preservation-plan-sha256 <sha256>', 'SHA-256 of the reviewed plan; sha256: prefix preserves all-digit hashes')
    .option('--baseline-dir <path>', 'Read-only original owned agent template directory for preservation planning')
    .option('--agent-model <model>', 'Explicit existing user model to preserve; no model call or model change')
    .option('--agent-reasoning <effort>', 'Explicit existing user reasoning effort to preserve')
    .option('--json', 'Print the preservation plan as JSON')
    .action(async (action: string, options: { wrapperFile?: string, agentPreservationPlan?: string, agentPreservationPlanSha256?: string, baselineDir?: string, agentModel?: string, agentReasoning?: string, json?: boolean }) => {
      if (options.wrapperFile !== undefined && action !== 'install') {
        console.error(ansis.red('--wrapper-file is available only for codex-mode install.'))
        process.exitCode = 1
        return
      }
      if (((options.agentPreservationPlan !== undefined || options.agentPreservationPlanSha256 !== undefined) && action !== 'install')
        || ([options.baselineDir, options.agentModel, options.agentReasoning, options.json].some(value => value !== undefined)
          && action !== 'plan-agent-preservation')) {
        throw new Error('Agent preservation planning options are only for plan-agent-preservation; --agent-preservation-plan and its SHA-256 are only for install.')
      }
      if (action === 'plan-agent-preservation') {
        if (!options.baselineDir || !options.agentModel || !options.agentReasoning || !options.json)
          throw new Error('Agent preservation planning requires --baseline-dir, --agent-model, --agent-reasoning and --json.')
        const plan = await planAgentPreservationAt({ baselineDir: options.baselineDir,          model: options.agentModel, reasoningEffort: options.agentReasoning })
        console.log(JSON.stringify(plan, null, 2))
        return
      }
      if (action === 'install') {
        const reviewedSha256 = typeof options.agentPreservationPlanSha256 === 'string'
          ? options.agentPreservationPlanSha256.replace(/^sha256:/, '')
          : options.agentPreservationPlanSha256
        const result = await installCodexMode({ wrapperFile: options.wrapperFile, agentPreservationPlan: options.agentPreservationPlan, agentPreservationPlanSha256: reviewedSha256 })
        if (result.success) {
          console.log(ansis.green('✓ Codex mode installed'))
          console.log(result.message)
        }
        else {
          console.error(ansis.red(`✗ ${result.message}`))
          process.exitCode = 1
        }
      }
      else if (action === 'uninstall') {
        const result = await uninstallCodexMode()
        if (result.success) {
          console.log(ansis.green('✓ Codex mode uninstalled'))
          if (result.removed.length > 0) console.log(ansis.gray(`  Removed: ${result.removed.join(', ')}`))
          if (result.skipped.length > 0) console.log(ansis.yellow(`  Held: ${result.skipped.join(', ')}`))
        }
        else {
          console.error(ansis.red('✗ Codex mode uninstall failed'))
          process.exitCode = 1
        }
      }
      else if (action === 'recover') {
        const result = await recoverCodexMode()
        if (result.success) {
          console.log(ansis.green(
            result.recovered
              ? '✓ Codex mode transaction recovered'
              : '✓ No Codex mode recovery was needed',
          ))
          console.log(result.message)
        }
        else {
          console.error(ansis.red(`✗ ${result.message}`))
          process.exitCode = 1
        }
      }
      else {
        console.error(ansis.red(`Unknown action: ${action}`))
        printCodexModeHelp()
        process.exitCode = 1
      }
    })

  // Uninstall CCG (Claude Code mode): non-interactive
  cli.help(sections => customizeHelp(sections))
  cli.version(version)
}
