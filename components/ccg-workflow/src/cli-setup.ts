import type { CAC } from 'cac'
import type { CliOptions } from './types'
import ansis from 'ansis'
import { version } from '../package.json'
import { homedir } from 'node:os'
import { join } from 'pathe'
import { configMcp } from './commands/config-mcp'
import { doctor, status } from './commands/doctor'
import { grokAccount } from './commands/grok'
import { diagnoseMcp, fixMcp } from './commands/diagnose-mcp'
import { init } from './commands/init'
import { showMainMenu } from './commands/menu'
import { i18n, initI18n } from './i18n'
import { readCcgConfig, resolveCliIntelligenceFlag } from './utils/config'
import { installCodexMode, recoverCodexMode, uninstallCodexMode, uninstallWorkflows } from './utils/installer'

function customizeHelp(sections: any[]): any[] {
  sections.unshift({
    title: '',
    body: ansis.cyan.bold(`CCG - Claude + Codex + Gemini v${version}`),
  })

  sections.push({
    title: ansis.yellow(i18n.t('cli:help.commands')),
    body: [
      `  ${ansis.cyan('ccg')}              ${i18n.t('cli:help.commandDescriptions.showMenu')}`,
      `  ${ansis.cyan('ccg init')} | ${ansis.cyan('i')}     ${i18n.t('cli:help.commandDescriptions.initConfig')}`,
      `  ${ansis.cyan('ccg config mcp')}   ${i18n.t('cli:help.commandDescriptions.configMcp')}`,
      `  ${ansis.cyan('ccg diagnose-mcp')} ${i18n.t('cli:help.commandDescriptions.diagnoseMcp')}`,
      `  ${ansis.cyan('ccg fix-mcp')}      ${i18n.t('cli:help.commandDescriptions.fixMcp')}`,
      `  ${ansis.cyan('ccg doctor')}       Check installation health`,
      `  ${ansis.cyan('ccg grok login')}   Sign in to the isolated Grok intelligence profile`,
      `  ${ansis.cyan('ccg status')}       Show installation overview`,
      `  ${ansis.cyan('ccg codex-mode')}   Install/uninstall/recover Codex-Led mode`,
      `  ${ansis.cyan('ccg uninstall')}    Uninstall CCG (non-interactive)`,
      '',
      ansis.gray(`  ${i18n.t('cli:help.shortcuts')}`),
      `  ${ansis.cyan('ccg i')}            ${i18n.t('cli:help.shortcutDescriptions.quickInit')}`,
    ].join('\n'),
  })

  sections.push({
    title: ansis.yellow(i18n.t('cli:help.options')),
    body: [
      `  ${ansis.green('--lang, -l')} <lang>         ${i18n.t('cli:help.optionDescriptions.displayLanguage')} (zh-CN, en)`,
      `  ${ansis.green('--force, -f')}               ${i18n.t('cli:help.optionDescriptions.forceOverwrite')}`,
      `  ${ansis.green('--help, -h')}                ${i18n.t('cli:help.optionDescriptions.displayHelp')}`,
      `  ${ansis.green('--version, -v')}             ${i18n.t('cli:help.optionDescriptions.displayVersion')}`,
      '',
      ansis.gray(`  ${i18n.t('cli:help.nonInteractiveMode')}`),
      `  ${ansis.green('--skip-prompt, -s')}         ${i18n.t('cli:help.optionDescriptions.skipAllPrompts')}`,
      `  ${ansis.green('--frontend, -F')} <models>   ${i18n.t('cli:help.optionDescriptions.frontendModels')}`,
      `  ${ansis.green('--backend, -B')} <models>    ${i18n.t('cli:help.optionDescriptions.backendModels')}`,
      `  ${ansis.green('--mode, -m')} <mode>         ${i18n.t('cli:help.optionDescriptions.collaborationMode')}`,
      `  ${ansis.green('--workflows, -w')} <list>    ${i18n.t('cli:help.optionDescriptions.workflows')}`,
      `  ${ansis.green('--install-dir, -d')} <path>  ${i18n.t('cli:help.optionDescriptions.installDir')}`,
      `  ${ansis.green('--intelligence')}            ${i18n.t('cli:help.optionDescriptions.enableIntelligence')}`,
      `  ${ansis.green('--no-intelligence')}         ${i18n.t('cli:help.optionDescriptions.disableIntelligence')}`,
    ].join('\n'),
  })

  sections.push({
    title: ansis.yellow(i18n.t('cli:help.examples')),
    body: [
      ansis.gray(`  # ${i18n.t('cli:help.exampleDescriptions.showInteractiveMenu')}`),
      `  ${ansis.cyan('npx ccg')}`,
      '',
      ansis.gray(`  # ${i18n.t('cli:help.exampleDescriptions.runFullInitialization')}`),
      `  ${ansis.cyan('npx ccg init')}`,
      `  ${ansis.cyan('npx ccg i')}`,
      '',
      ansis.gray(`  # ${i18n.t('cli:help.exampleDescriptions.customModels')}`),
      `  ${ansis.cyan('npx ccg i --frontend gemini,codex --backend codex,gemini')}`,
      '',
      ansis.gray(`  # ${i18n.t('cli:help.exampleDescriptions.parallelMode')}`),
      `  ${ansis.cyan('npx ccg i --mode parallel')}`,
      '',
    ].join('\n'),
  })

  return sections
}

export async function setupCommands(cli: CAC): Promise<void> {
  try {
    const config = await readCcgConfig()
    const defaultLang = config?.general?.language || 'zh-CN'
    await initI18n(defaultLang)
  }
  catch {
    await initI18n('zh-CN')
  }

  // Default command - show menu
  cli
    .command('', i18n.t('cli:help.commandDescriptions.showMenu'))
    .option('--lang, -l <lang>', `${i18n.t('cli:help.optionDescriptions.displayLanguage')} (zh-CN, en)`)
    .action(async (options: CliOptions) => {
      if (options.lang) {
        await initI18n(options.lang)
      }
      await showMainMenu()
    })

  // Init command
  const initCommand = cli
    .command('init', i18n.t('cli:help.commandDescriptions.initConfig'))
    .alias('i')
    .option('--lang, -l <lang>', `${i18n.t('cli:help.optionDescriptions.displayLanguage')} (zh-CN, en)`)
    .option('--force, -f', i18n.t('cli:help.optionDescriptions.forceOverwrite'))
    .option('--skip-prompt, -s', i18n.t('cli:help.optionDescriptions.skipAllPrompts'))
    .option('--skip-mcp', 'Skip MCP configuration (used during update)')
    .option('--frontend, -F <models>', i18n.t('cli:help.optionDescriptions.frontendModels'))
    .option('--backend, -B <models>', i18n.t('cli:help.optionDescriptions.backendModels'))
    .option('--mode, -m <mode>', i18n.t('cli:help.optionDescriptions.collaborationMode'))
    .option('--workflows, -w <workflows>', i18n.t('cli:help.optionDescriptions.workflows'))
    .option('--install-dir, -d <path>', i18n.t('cli:help.optionDescriptions.installDir'))
    .option('--intelligence', i18n.t('cli:help.optionDescriptions.enableIntelligence'))
    .option('--no-intelligence', i18n.t('cli:help.optionDescriptions.disableIntelligence'))
    .action(async (options: CliOptions) => {
      options.intelligence = resolveCliIntelligenceFlag(process.argv.slice(2))
      if (options.lang) {
        await initI18n(options.lang)
      }
      const result = await init(options)
      if (!result.success && !result.cancelled)
        process.exitCode = 1
    })

  // CAC assigns `true` by default to every negated option. Intelligence is
  // intentionally tri-state so an absent flag can preserve an existing
  // explicit choice (and old configs remain disabled).
  const noIntelligenceOption = initCommand.options.find(option => option.rawName === '--no-intelligence')
  if (noIntelligenceOption)
    noIntelligenceOption.config.default = undefined

  // Diagnose MCP command
  cli
    .command('diagnose-mcp', i18n.t('cli:help.commandDescriptions.diagnoseMcp'))
    .option('--smoke', 'Explicitly start configured stdio MCP servers and perform a bounded initialize handshake')
    .option('--timeout <ms>', 'Per-server MCP smoke timeout in milliseconds (50-15000)')
    .action(async (options: { smoke?: boolean, timeout?: string }) => {
      const result = await diagnoseMcp(options)
      if (!result.success)
        process.exitCode = 1
    })

  // Fix MCP command (Windows only)
  cli
    .command('fix-mcp', i18n.t('cli:help.commandDescriptions.fixMcp'))
    .action(async () => {
      await fixMcp()
    })

  // Config MCP command
  cli
    .command('config <subcommand>', i18n.t('cli:help.commandDescriptions.configMcp'))
    .action(async (subcommand: string) => {
      if (subcommand === 'mcp') {
        await configMcp()
      }
      else {
        console.log(ansis.red(i18n.t('common:unknownSubcommand', { subcommand })))
        console.log(ansis.gray(i18n.t('common:availableSubcommands', { list: 'mcp' })))
      }
    })

  // Doctor: environment health check
  cli
    .command('doctor', 'Check CCG installation health')
    .option('--grok', 'Run local-only Grok intelligence diagnostics (no model prompt)')
    .option('--grok-live', 'Run explicit paid Grok Web/X smoke diagnostics')
    .option('--grok-cleanup', 'Remove expired Grok evidence and orphan private roots')
    .action(async (options: { grok?: boolean, grokLive?: boolean, grokCleanup?: boolean }) => {
      const result = await doctor(options)
      if (!result.ok)
        process.exitCode = 1
    })

  cli
    .command('grok <action>', 'Manage the isolated Grok intelligence login')
    .option('--json', 'Print machine-readable status')
    .action(async (action: string, options: { json?: boolean }) => { await grokAccount(action, options) })

  // Status: show current installation overview
  cli
    .command('status', 'Show CCG installation status')
    .action(async () => { await status() })

  // Codex mode: non-interactive install/uninstall
  cli
    .command('codex-mode <action>', 'Install, uninstall, or recover Codex-Led mode (non-interactive)')
    .action(async (action: string) => {
      if (action === 'install') {
        const result = await installCodexMode()
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
        console.log(ansis.gray('Usage: ccg codex-mode <install|uninstall|recover>'))
        process.exitCode = 1
      }
    })

  // Uninstall CCG (Claude Code mode): non-interactive
  cli
    .command('uninstall', 'Uninstall CCG workflows from ~/.claude/ (non-interactive)')
    .action(async () => {
      const installDir = join(homedir(), '.claude')
      const result = await uninstallWorkflows(installDir)
      if (result.success) {
        console.log(ansis.green('✓ CCG uninstalled'))
        if (result.removedCommands.length > 0) console.log(ansis.gray(`  Commands: ${result.removedCommands.length} removed`))
        if (result.removedHooks) console.log(ansis.gray('  Hooks: removed'))
        if (result.removedBin) console.log(ansis.gray('  Binary: removed'))
      }
      else {
        console.error(ansis.red('✗ Uninstall failed'))
        for (const err of result.errors) console.error(ansis.gray(`  ${err}`))
        process.exitCode = 1
      }
    })

  cli.help(sections => customizeHelp(sections))
  cli.version(version)
}
