/**
 * Diagnose MCP configuration issues
 */

import type { McpSmokeReport } from '../utils/mcp-smoke'
import ansis from 'ansis'
import { diagnoseMcpConfig, fixWindowsMcpConfig, readClaudeCodeConfig, writeClaudeCodeConfig } from '../utils/mcp'
import { smokeMcpServer } from '../utils/mcp-smoke'
import { isWindows } from '../utils/platform'

export interface DiagnoseMcpOptions {
  smoke?: boolean
  timeout?: string | number
}

export interface DiagnoseMcpResult {
  success: boolean
  issues: string[]
  smoke: McpSmokeReport[]
}

function printIssue(issue: string): void {
  if (issue.startsWith('✅'))
    console.log(ansis.green(`  ${issue}`))
  else if (issue.startsWith('⚠️'))
    console.log(ansis.yellow(`  ${issue}`))
  else if (issue.startsWith('❌'))
    console.log(ansis.red(`  ${issue}`))
  else
    console.log(`  ${issue}`)
}

function resolveSmokeTimeout(value: DiagnoseMcpOptions['timeout']): number {
  const timeoutMs = value === undefined ? 3_000 : Number(value)
  if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 15_000)
    throw new Error('MCP smoke timeout must be an integer between 50 and 15000 ms.')
  return timeoutMs
}

function printSmokeReport(report: McpSmokeReport): void {
  if (report.status === 'passed') {
    console.log(ansis.green(
      `  ✅ ${report.name}: initialize ${report.protocolVersion} (${report.durationMs}ms)`,
    ))
  }
  else if (report.status === 'skipped') {
    console.log(ansis.yellow(`  ⚠️  ${report.name}: ${report.error}`))
  }
  else {
    console.log(ansis.red(`  ❌ ${report.name}: ${report.error}`))
  }
}

async function runConfiguredMcpSmokes(timeoutMs: number): Promise<McpSmokeReport[]> {
  console.log()
  console.log(ansis.bold('  Opt-in bounded MCP stdio smoke:'))
  console.log(ansis.gray('  Starts each configured stdio server, performs initialize, then terminates it.'))
  const config = await readClaudeCodeConfig()
  const reports: McpSmokeReport[] = []
  for (const [name, server] of Object.entries(config?.mcpServers ?? {})) {
    const report = await smokeMcpServer(name, server, { timeoutMs })
    reports.push(report)
    printSmokeReport(report)
  }
  if (reports.length === 0)
    console.log(ansis.yellow('  ⚠️  No configured MCP servers were available to smoke.'))
  return reports
}

export async function diagnoseMcp(options: DiagnoseMcpOptions = {}): Promise<DiagnoseMcpResult> {
  console.log()
  console.log(ansis.cyan.bold('  🔍 MCP Configuration Diagnostics'))
  console.log()

  // Run diagnostics
  const issues = await diagnoseMcpConfig()

  console.log(ansis.bold('  Diagnostic Results:'))
  console.log()

  issues.forEach(printIssue)

  // Offer to fix Windows issues
  if (isWindows() && issues.some(i => i.includes('not properly wrapped'))) {
    console.log()
    console.log(ansis.yellow('  💡 Tip: Run the following command to fix Windows MCP configuration:'))
    console.log(ansis.gray('     npx ccg fix-mcp'))
  }

  const hasFatalStaticIssue = issues.some(issue => issue.startsWith('❌'))
  if (options.smoke && hasFatalStaticIssue) {
    console.log()
    console.log(ansis.yellow(
      '  ⚠️  MCP smoke skipped because static configuration diagnostics failed.',
    ))
  }
  const smokeReports = options.smoke && !hasFatalStaticIssue
    ? await runConfiguredMcpSmokes(resolveSmokeTimeout(options.timeout))
    : []

  console.log()
  const success = !issues.some(issue => issue.startsWith('❌'))
    && !smokeReports.some(report => report.status === 'failed')
  return { success, issues, smoke: smokeReports }
}

/**
 * Fix Windows MCP configuration issues
 */
export async function fixMcp(): Promise<void> {
  console.log()
  console.log(ansis.cyan.bold('  🔧 Fixing MCP Configuration'))
  console.log()

  if (!isWindows()) {
    console.log(ansis.yellow('  ⚠️  This command is only needed on Windows'))
    console.log()
    return
  }

  try {
    const config = await readClaudeCodeConfig()

    if (!config) {
      console.log(ansis.red('  ❌ No ~/.claude.json found'))
      console.log()
      return
    }

    if (!config.mcpServers || Object.keys(config.mcpServers).length === 0) {
      console.log(ansis.yellow('  ⚠️  No MCP servers configured'))
      console.log()
      return
    }

    // Apply Windows fixes
    const fixedConfig = fixWindowsMcpConfig(config)

    // Write back
    await writeClaudeCodeConfig(fixedConfig)

    console.log(ansis.green('  ✅ Windows MCP configuration fixed'))
    console.log()
    console.log(ansis.gray('  Run diagnostics again to verify:'))
    console.log(ansis.gray('     npx ccg diagnose-mcp'))
    console.log()
  }
  catch (error) {
    console.log(ansis.red(`  ❌ Failed to fix MCP configuration: ${error}`))
    console.log()
  }
}
