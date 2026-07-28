import type { CcgConfig, IntelligenceConfig, ModelRouting, ProductManagerConfig, SupportedLang } from '../types'
import fs from 'fs-extra'
import { homedir } from 'node:os'
import { join } from 'pathe'
import { parse, stringify } from 'smol-toml'
import { version as packageVersion } from '../../package.json'

// v1.4.0: 配置目录统一到 ~/.claude/.ccg/
const CCG_DIR = join(homedir(), '.claude', '.ccg')
const CONFIG_FILE = join(CCG_DIR, 'config.toml')

export function getCcgDir(): string {
  return CCG_DIR
}

export function getConfigPath(): string {
  return CONFIG_FILE
}

export async function ensureCcgDir(): Promise<void> {
  await fs.ensureDir(CCG_DIR)
}

export async function readCcgConfig(): Promise<CcgConfig | null> {
  return readCcgConfigAt(CONFIG_FILE)
}

export async function readCcgConfigAt(configFile: string): Promise<CcgConfig | null> {
  if (!await fs.pathExists(configFile))
    return null
  const content = await fs.readFile(configFile, 'utf-8')
  const parsed = parse(content) as unknown as CcgConfig
  return {
    ...parsed,
    intelligence: normalizeIntelligenceConfig(parsed.intelligence, { existingInstall: true }),
    product_manager: normalizeProductManagerConfig(parsed.product_manager, { existingInstall: true }),
  }
}

export async function writeCcgConfig(config: CcgConfig): Promise<void> {
  await ensureCcgDir()
  const content = stringify(config as any)
  await fs.writeFile(CONFIG_FILE, content, 'utf-8')
}

const DEFAULT_INTELLIGENCE_CONFIG: IntelligenceConfig = {
  enabled: false,
  auto_route: false,
  provider: 'grok-cli',
  transport: 'acp',
  auth_mode: 'browser_oauth',
  legacy_search_provider: 'grok-search-mcp',
  allow_provider_fallback: false,
  default_model: 'grok-4.5',
  deep_research_model: '',
  deep_research_enabled: false,
  live_checks_on_init: false,
  artifact_root: '.codex/ccg/intelligence',
  max_retries: 2,
  max_bundle_bytes: 16 * 1024 * 1024,
  retention_days: 7,
  exported_retention_days: 30,
  cleanup_credential_artifacts: true,
  require_web_search: true,
  x_search_policy: 'preferred',
}

const DEFAULT_PRODUCT_MANAGER_CONFIG: ProductManagerConfig = {
  enabled: false,
  provider: '',
  contract_version: '1',
  max_retries: 1,
  timeout_ms: 180_000,
  max_output_bytes: 1024 * 1024,
}

export function normalizeProductManagerConfig(
  value: Partial<ProductManagerConfig> | undefined,
  options: { existingInstall: boolean, explicitConsent?: boolean },
): ProductManagerConfig {
  const provider = value?.provider ?? ''
  if (!['', 'codex', 'gemini'].includes(provider))
    throw new TypeError('product_manager.provider must be codex, gemini, or empty')
  if (value?.contract_version != null && value.contract_version !== '1')
    throw new TypeError('product_manager.contract_version must remain "1"')
  const integerField = (
    key: 'max_retries' | 'timeout_ms' | 'max_output_bytes',
    fallback: number,
    minimum: number,
    maximum: number,
  ) => {
    const candidate = value?.[key]
    if (candidate == null)
      return fallback
    if (!Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum)
      throw new RangeError(`product_manager.${key} must be an integer between ${minimum} and ${maximum}`)
    return candidate
  }
  const configuredEnabled = options.existingInstall
    && value?.enabled === true
    && provider !== ''
  const enabled = (options.explicitConsent ?? configuredEnabled) && provider !== ''
  return {
    ...value,
    enabled,
    provider,
    contract_version: '1',
    max_retries: integerField('max_retries', DEFAULT_PRODUCT_MANAGER_CONFIG.max_retries, 0, 2),
    timeout_ms: integerField('timeout_ms', DEFAULT_PRODUCT_MANAGER_CONFIG.timeout_ms, 1_000, 600_000),
    max_output_bytes: integerField('max_output_bytes', DEFAULT_PRODUCT_MANAGER_CONFIG.max_output_bytes, 1_024, 8 * 1024 * 1024),
  }
}

export function normalizeIntelligenceConfig(
  value: Partial<IntelligenceConfig> | undefined,
  options: { existingInstall: boolean, explicitConsent?: boolean },
): IntelligenceConfig {
  const pinned = {
    provider: 'grok-cli',
    transport: 'acp',
    legacy_search_provider: 'grok-search-mcp',
    allow_provider_fallback: false,
  } as const
  for (const [key, expected] of Object.entries(pinned)) {
    if (value && Object.prototype.hasOwnProperty.call(value, key) && (value as any)[key] !== expected)
      throw new Error(`intelligence.${key} must remain ${JSON.stringify(expected)}`)
  }
  const booleanField = (key: keyof IntelligenceConfig, fallback: boolean) => {
    const candidate = value?.[key]
    if (candidate == null)
      return fallback
    if (typeof candidate !== 'boolean')
      throw new TypeError(`intelligence.${key} must be boolean`)
    return candidate
  }
  const integerField = (key: keyof IntelligenceConfig, fallback: number, minimum: number, maximum: number) => {
    const candidate = value?.[key]
    if (candidate == null)
      return fallback
    if (!Number.isInteger(candidate) || (candidate as number) < minimum || (candidate as number) > maximum)
      throw new RangeError(`intelligence.${key} must be an integer between ${minimum} and ${maximum}`)
    return candidate as number
  }
  const stringField = (key: keyof IntelligenceConfig, fallback: string, allowEmpty = false) => {
    const candidate = value?.[key]
    if (candidate == null)
      return fallback
    if (typeof candidate !== 'string' || (!allowEmpty && !candidate.trim()) || /[\u0000-\u001F\u007F]/.test(candidate))
      throw new TypeError(`intelligence.${key} must be ${allowEmpty ? 'a single-line string' : 'a non-empty single-line string'}`)
    return candidate.trim()
  }
  if (value?.auth_mode != null && !['browser_oauth', 'api_key'].includes(value.auth_mode))
    throw new Error('intelligence.auth_mode must be browser_oauth or api_key')
  if (value?.x_search_policy != null && !['required', 'preferred', 'disabled'].includes(value.x_search_policy))
    throw new Error('intelligence.x_search_policy must be required, preferred, or disabled')
  if (value?.cleanup_credential_artifacts === false)
    throw new Error('intelligence.cleanup_credential_artifacts is a mandatory security invariant and must remain true')
  const artifactRoot = stringField('artifact_root', DEFAULT_INTELLIGENCE_CONFIG.artifact_root)
  const artifactParts = artifactRoot.replace(/\\/g, '/').split('/')
  if (/^(?:[A-Z]:|\/)/i.test(artifactRoot) || artifactParts.some(part => !part || part === '.' || part === '..'))
    throw new Error('intelligence.artifact_root must be a contained relative path without traversal')
  const configuredEnabled = options.existingInstall && value?.enabled === true
  const enabled = options.explicitConsent ?? configuredEnabled
  const authMode = value?.auth_mode || DEFAULT_INTELLIGENCE_CONFIG.auth_mode
  const xSearchPolicy = value?.x_search_policy || DEFAULT_INTELLIGENCE_CONFIG.x_search_policy
  const deepResearchEnabled = booleanField('deep_research_enabled', DEFAULT_INTELLIGENCE_CONFIG.deep_research_enabled)
  const deepResearchModel = stringField('deep_research_model', DEFAULT_INTELLIGENCE_CONFIG.deep_research_model, true)
  if (deepResearchEnabled && !deepResearchModel)
    throw new Error('intelligence.deep_research_model is required when deep research is enabled')

  return {
    ...DEFAULT_INTELLIGENCE_CONFIG,
    default_model: stringField('default_model', DEFAULT_INTELLIGENCE_CONFIG.default_model),
    deep_research_model: deepResearchModel,
    deep_research_enabled: deepResearchEnabled,
    live_checks_on_init: booleanField('live_checks_on_init', DEFAULT_INTELLIGENCE_CONFIG.live_checks_on_init),
    artifact_root: artifactRoot,
    max_retries: integerField('max_retries', DEFAULT_INTELLIGENCE_CONFIG.max_retries, 0, 2),
    max_bundle_bytes: integerField('max_bundle_bytes', DEFAULT_INTELLIGENCE_CONFIG.max_bundle_bytes, 1024, 64 * 1024 * 1024),
    retention_days: integerField('retention_days', DEFAULT_INTELLIGENCE_CONFIG.retention_days, 1, 365),
    exported_retention_days: integerField('exported_retention_days', DEFAULT_INTELLIGENCE_CONFIG.exported_retention_days, 1, 3650),
    cleanup_credential_artifacts: true,
    require_web_search: booleanField('require_web_search', DEFAULT_INTELLIGENCE_CONFIG.require_web_search),
    enabled,
    auto_route: enabled && (options.explicitConsent === true || value?.auto_route === true),
    auth_mode: authMode,
    x_search_policy: xSearchPolicy,
  }
}

export function resolveNonInteractiveIntelligenceConsent(
  value: Partial<IntelligenceConfig> | undefined,
  explicitFlag: boolean | undefined,
): boolean {
  return explicitFlag ?? (value?.enabled === true)
}

export function resolveCliIntelligenceFlag(argv: string[]): boolean | undefined {
  let resolved: boolean | undefined
  for (const argument of argv) {
    if (argument === '--intelligence')
      resolved = true
    else if (argument === '--no-intelligence')
      resolved = false
  }
  return resolved
}

export function createDefaultConfig(options: {
  language: SupportedLang
  routing: ModelRouting
  installedWorkflows: string[]
  mcpProvider?: string
  liteMode?: boolean
  skipImpeccable?: boolean
  intelligenceConsent?: boolean
  intelligence?: Partial<IntelligenceConfig>
  existingInstall?: boolean
  productManagerProvider?: ProductManagerConfig['provider']
  productManagerConsent?: boolean
  productManager?: Partial<ProductManagerConfig>
}): CcgConfig {
  return {
    general: {
      version: packageVersion,
      language: options.language,
      createdAt: new Date().toISOString(),
    },
    routing: options.routing,
    workflows: {
      installed: options.installedWorkflows,
    },
    paths: {
      commands: join(homedir(), '.claude', 'commands', 'ccg'),
      prompts: join(CCG_DIR, 'prompts'), // v1.4.0: 移到配置目录
      backup: join(CCG_DIR, 'backup'),
    },
    mcp: {
      provider: options.mcpProvider || 'fast-context',
      setup_url: 'https://augmentcode.com/',
    },
    intelligence: normalizeIntelligenceConfig(options.intelligence, {
      existingInstall: options.existingInstall ?? false,
      explicitConsent: options.intelligenceConsent,
    }),
    product_manager: normalizeProductManagerConfig({
      ...options.productManager,
      provider: options.productManagerProvider ?? options.productManager?.provider ?? '',
    }, {
      existingInstall: options.existingInstall ?? false,
      explicitConsent: options.productManagerConsent,
    }),
    performance: {
      liteMode: options.liteMode || false,
      skipImpeccable: options.skipImpeccable || false,
    },
  }
}

export function createDefaultRouting(): ModelRouting {
  return {
    frontend: {
      models: ['gemini'],
      primary: 'gemini',
      strategy: 'parallel',
    },
    backend: {
      models: ['codex'],
      primary: 'codex',
      strategy: 'parallel',
    },
    review: {
      models: ['codex', 'gemini'],
      strategy: 'parallel',
    },
    mode: 'smart',
  }
}
