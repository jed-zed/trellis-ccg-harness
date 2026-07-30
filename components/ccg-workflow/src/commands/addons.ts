import ansis from 'ansis'
import { i18n } from '../i18n'
import { npmExecutableSource } from '../utils/third-party-sources'

export type CompanionAddonActionStatus = 'ccg-managed' | 'manual-pending'

export interface CompanionAddonSource {
  repository?: string
  commit?: string
  gitTree?: string
  release?: string
  package?: string
  version?: string
  selector?: string
  integrity?: string
  endpoint?: string
  documentation?: string
  apiKeys?: string
}

export interface CompanionAddonEffects {
  writes: boolean
  scripts: boolean
  hooks: boolean
  executables: boolean
  network: boolean
  dataEgress: string
}

export interface CompanionAddonCandidate {
  id: string
  name: string
  kind: string
  purpose: string
  recommended: boolean
  selected: false
  source?: CompanionAddonSource
  dependencies: string[]
  effects: CompanionAddonEffects
  action: {
    status: CompanionAddonActionStatus
    command?: string
    guidance: string
  }
}

export interface CompanionAddonReport {
  schemaVersion: 1
  defaultAction: 'skip'
  operation: {
    mode: 'read-only'
    writes: false
    executes: false
    network: false
  }
  notice: string
  candidates: CompanionAddonCandidate[]
}

function catalogNpmSource(packageName: string): CompanionAddonSource {
  const source = npmExecutableSource(packageName)
  return {
    package: source.package,
    version: source.version,
    selector: source.selector,
    integrity: source.integrity,
  }
}

const CANDIDATES: readonly CompanionAddonCandidate[] = [
  {
    id: 'grill-me',
    name: 'grill-me + grilling',
    kind: 'skill-bundle',
    purpose: 'One-question-at-a-time requirements and design interviews.',
    recommended: true,
    selected: false,
    source: {
      repository: 'https://github.com/mattpocock/skills.git',
      commit: 'ed37663cc5fbef691ddfecd080dff42f7e7e350d',
      gitTree: '04b0fcb78e3de7c58744fcba2528354cc64ab988',
    },
    dependencies: [],
    effects: {
      writes: true,
      scripts: false,
      hooks: false,
      executables: false,
      network: true,
      dataEgress: 'Fetches only the pinned Git source when an approved installer is used.',
    },
    action: {
      status: 'manual-pending',
      guidance: 'Use an owner-approved Skill installer or the Harness pnpm addons transaction.',
    },
  },
  {
    id: 'caveman',
    name: 'Caveman communication Skill',
    kind: 'skill',
    purpose: 'Compress routine prose while preserving technical evidence and higher-priority rules.',
    recommended: true,
    selected: false,
    source: {
      repository: 'https://github.com/JuliusBrussee/caveman.git',
      commit: '0d95a81d35a9f2d123a5e9430d1cfc43d55f1bb0',
      gitTree: '867418a8efea2c92b3885b8efd99d73d7c58af11',
      release: 'v1.9.1',
    },
    dependencies: [],
    effects: {
      writes: true,
      scripts: false,
      hooks: false,
      executables: false,
      network: true,
      dataEgress: 'Fetches only the pinned Git source when an approved installer is used.',
    },
    action: {
      status: 'manual-pending',
      guidance: 'Use an owner-approved Skill installer or the Harness pnpm addons transaction.',
    },
  },
  {
    id: 'ponytail.install',
    name: 'Ponytail plugin',
    kind: 'codex-plugin',
    purpose: 'Provide Ponytail implementation minimization modes and bundled commands.',
    recommended: true,
    selected: false,
    source: {
      repository: 'https://github.com/DietrichGebert/ponytail.git',
      commit: 'bc9ee949d5f439e8b9f3bb92c6d6d3d1e6ebd324',
      gitTree: '2b3486c779084a0442ac530affd85fb864499827',
      release: '4.8.4',
    },
    dependencies: [],
    effects: {
      writes: true,
      scripts: true,
      hooks: false,
      executables: true,
      network: true,
      dataEgress: 'Git source acquisition only; plugin execution is local.',
    },
    action: {
      status: 'manual-pending',
      guidance: 'Review the pinned plugin source, then use an owner-approved Codex host or Harness transaction.',
    },
  },
  {
    id: 'ponytail.hooks',
    name: 'Ponytail lifecycle hooks',
    kind: 'codex-hook-trust',
    purpose: 'Trust Ponytail lifecycle hooks after separately reviewing their Node.js commands.',
    recommended: true,
    selected: false,
    source: {
      repository: 'https://github.com/DietrichGebert/ponytail.git',
      commit: 'bc9ee949d5f439e8b9f3bb92c6d6d3d1e6ebd324',
      gitTree: '2b3486c779084a0442ac530affd85fb864499827',
      release: '4.8.4',
    },
    dependencies: ['ponytail.install'],
    effects: {
      writes: true,
      scripts: true,
      hooks: true,
      executables: true,
      network: false,
      dataEgress: 'None declared; approved hooks execute local Node.js scripts.',
    },
    action: {
      status: 'manual-pending',
      guidance: 'Approve only after Ponytail is installed and the exact hook digest is reviewed.',
    },
  },
  {
    id: 'ponytail.default-full',
    name: 'Ponytail global full default',
    kind: 'codex-plugin-default',
    purpose: 'Set Ponytail full mode as the global implementation default.',
    recommended: true,
    selected: false,
    source: {
      repository: 'https://github.com/DietrichGebert/ponytail.git',
      commit: 'bc9ee949d5f439e8b9f3bb92c6d6d3d1e6ebd324',
      gitTree: '2b3486c779084a0442ac530affd85fb864499827',
      release: '4.8.4',
    },
    dependencies: ['ponytail.install'],
    effects: {
      writes: true,
      scripts: false,
      hooks: false,
      executables: false,
      network: false,
      dataEgress: 'None.',
    },
    action: {
      status: 'manual-pending',
      guidance: 'Approve the global configuration write separately after Ponytail is installed.',
    },
  },
  {
    id: 'fast-context',
    name: 'fast-context MCP',
    kind: 'mcp',
    purpose: 'Semantic repository search using Windsurf Fast Context.',
    recommended: true,
    selected: false,
    source: catalogNpmSource('fast-context-mcp'),
    dependencies: [],
    effects: {
      writes: true,
      scripts: true,
      hooks: false,
      executables: true,
      network: true,
      dataEgress: 'Repository search queries and selected repository context may be sent to Windsurf.',
    },
    action: {
      status: 'ccg-managed',
      command: 'ccg init',
      guidance: 'Select fast-context in the existing CCG MCP step after reviewing its data-egress behavior.',
    },
  },
  {
    id: 'context7',
    name: 'Context7 MCP',
    kind: 'mcp',
    purpose: 'Retrieve current library documentation.',
    recommended: true,
    selected: false,
    source: catalogNpmSource('@upstash/context7-mcp'),
    dependencies: [],
    effects: {
      writes: true,
      scripts: true,
      hooks: false,
      executables: true,
      network: true,
      dataEgress: 'Documentation queries and library identifiers are sent to the Context7 service.',
    },
    action: {
      status: 'ccg-managed',
      command: 'ccg config mcp',
      guidance: 'Select Context7 after reviewing that documentation queries and library identifiers leave the machine.',
    },
  },
  {
    id: 'playwright',
    name: 'Playwright MCP',
    kind: 'mcp',
    purpose: 'Automate and inspect browser sessions for testing and development.',
    recommended: true,
    selected: false,
    source: catalogNpmSource('@playwright/mcp'),
    dependencies: [],
    effects: {
      writes: true,
      scripts: true,
      hooks: false,
      executables: true,
      network: true,
      dataEgress: 'Browser pages, interactions, and selected local browser state may be exposed; browser downloads require separate approval.',
    },
    action: {
      status: 'ccg-managed',
      command: 'ccg config mcp',
      guidance: 'Select Playwright only after reviewing browser, file, site, and download permissions.',
    },
  },
  {
    id: 'deepwiki',
    name: 'DeepWiki MCP',
    kind: 'remote-mcp',
    purpose: 'Query official DeepWiki documentation for public repositories.',
    recommended: true,
    selected: false,
    source: {
      endpoint: 'https://mcp.deepwiki.com/mcp',
      documentation: 'https://docs.devin.ai/work-with-devin/deepwiki-mcp',
    },
    dependencies: [],
    effects: {
      writes: true,
      scripts: false,
      hooks: false,
      executables: false,
      network: true,
      dataEgress: 'Repository identifiers and DeepWiki queries are sent to the official public DeepWiki service.',
    },
    action: {
      status: 'ccg-managed',
      command: 'ccg config mcp',
      guidance: 'Configure the official free, no-auth Streamable HTTP endpoint; the legacy SSE endpoint is not used.',
    },
  },
  {
    id: 'exa',
    name: 'Exa MCP',
    kind: 'remote-or-local-mcp',
    purpose: 'Search and fetch web content through Exa.',
    recommended: true,
    selected: false,
    source: {
      ...catalogNpmSource('exa-mcp-server'),
      endpoint: 'https://mcp.exa.ai/mcp',
      documentation: 'https://exa.ai/docs/reference/exa-mcp',
      apiKeys: 'https://dashboard.exa.ai/api-keys',
    },
    dependencies: [],
    effects: {
      writes: true,
      scripts: true,
      hooks: false,
      executables: true,
      network: true,
      dataEgress: 'Search queries and requested URLs are sent to Exa; local key mode stores only a secret-backed launcher reference.',
    },
    action: {
      status: 'ccg-managed',
      command: 'ccg config mcp',
      guidance: 'Use the hosted free tier without a key, or obtain a key from the official dashboard for the local production mode.',
    },
  },
  {
    id: 'codegraph',
    name: 'CodeGraph MCP',
    kind: 'mcp',
    purpose: 'Local symbol relationships, call paths, and impact analysis.',
    recommended: true,
    selected: false,
    source: catalogNpmSource('@colbymchenry/codegraph'),
    dependencies: [],
    effects: {
      writes: true,
      scripts: true,
      hooks: false,
      executables: true,
      network: true,
      dataEgress: 'Package acquisition uses the npm registry; indexing and queries are local.',
    },
    action: {
      status: 'ccg-managed',
      command: 'ccg init',
      guidance: 'Select CodeGraph in the existing CCG MCP step; project indexing remains a separate user action.',
    },
  },
]

export function buildCompanionAddonReport(): CompanionAddonReport {
  return {
    schemaVersion: 1,
    defaultAction: 'skip',
    operation: {
      mode: 'read-only',
      writes: false,
      executes: false,
      network: false,
    },
    notice: 'Recommendations are not selections. CCG addons never installs, downloads, or trusts external add-ons.',
    candidates: CANDIDATES.map(candidate => ({
      ...candidate,
      source: candidate.source ? { ...candidate.source } : undefined,
      dependencies: [...candidate.dependencies],
      effects: { ...candidate.effects },
      action: { ...candidate.action },
    })),
  }
}

export function formatCompanionAddonReportJson(report = buildCompanionAddonReport()): string {
  return `${JSON.stringify(report, null, 2)}\n`
}

export function formatCompanionAddonReport(
  report = buildCompanionAddonReport(),
  language: 'en' | 'zh-CN' = 'en',
): string {
  const isZh = language === 'zh-CN'
  const lines = [
    isZh ? 'CCG 伴生 Add-on（只读目录）' : 'CCG companion add-ons (read-only catalog)',
    isZh
      ? '默认：跳过。推荐不等于选择；此命令不会安装、下载或信任任何第三方组件。'
      : [
          'Default: skip. Recommendations are not selections;',
          'this command never installs, downloads, or trusts third-party components.',
        ].join(' '),
    '',
  ]

  for (const candidate of report.candidates) {
    const sources = [
      candidate.source?.endpoint,
      candidate.source?.selector,
      candidate.source?.commit ? `${candidate.source.repository}@${candidate.source.commit}` : undefined,
    ].filter((source): source is string => Boolean(source))
    const source = sources.length > 0 ? sources.join(' | ') : 'built-in guidance'
    const dependencies = candidate.dependencies.length > 0
      ? candidate.dependencies.join(', ')
      : (isZh ? '无' : 'none')
    lines.push(`${candidate.recommended ? '★' : ' '} ${candidate.name} [${candidate.action.status}]`)
    lines.push(`  id: ${candidate.id}`)
    lines.push(`  source: ${source}`)
    if (candidate.source?.apiKeys)
      lines.push(`  api-keys: ${candidate.source.apiKeys}`)
    lines.push(`  dependencies: ${dependencies}`)
    lines.push([
      `  effects: writes=${candidate.effects.writes}`,
      `scripts=${candidate.effects.scripts}`,
      `hooks=${candidate.effects.hooks}`,
      `executables=${candidate.effects.executables}`,
      `network=${candidate.effects.network}`,
    ].join(', '))
    lines.push(`  data-egress: ${candidate.effects.dataEgress}`)
    const nextCommand = candidate.action.command ? `${candidate.action.command} — ` : ''
    lines.push(`  next: ${nextCommand}${candidate.action.guidance}`)
    lines.push('')
  }

  lines.push(isZh
    ? '需要实际安装时，请使用具备独立审批、ownership 和回滚能力的安装器。'
    : 'For installation, use an installer with separate approval, ownership, and rollback controls.')
  return `${lines.join('\n')}\n`
}

export function printCompanionAddonRecommendation(language?: 'en' | 'zh-CN'): void {
  const lang = language || (i18n.language?.startsWith('zh') ? 'zh-CN' : 'en')
  console.log()
  console.log(ansis.cyan.bold(lang === 'zh-CN' ? '  推荐的 Codex 伴生 Add-on' : '  Recommended Codex companion add-ons'))
  console.log(ansis.gray(lang === 'zh-CN'
    ? '  默认跳过，不会自动安装。运行 ccg addons 查看来源、影响和后续审批路径。'
    : '  Default: skip; nothing is installed automatically. Run ccg addons for sources, effects, and approval paths.'))
}

export function showCompanionAddons(options: { json?: boolean, language?: 'en' | 'zh-CN' } = {}): void {
  const report = buildCompanionAddonReport()
  if (options.json) {
    process.stdout.write(formatCompanionAddonReportJson(report))
    return
  }

  const language = options.language || (i18n.language?.startsWith('zh') ? 'zh-CN' : 'en')
  process.stdout.write(formatCompanionAddonReport(report, language))
}
