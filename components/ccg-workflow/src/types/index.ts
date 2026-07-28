// 支持的语言
export type SupportedLang = 'zh-CN' | 'en'

// 模型类型
export type ModelType = 'codex' | 'gemini' | 'claude' | 'antigravity' | 'grok'

// 协作模式
export type CollaborationMode = 'parallel' | 'smart' | 'sequential'

// 路由策略
export type RoutingStrategy = 'parallel' | 'fallback' | 'round-robin'

// 外部情报层配置
export type XSearchPolicy = 'required' | 'preferred' | 'disabled'
export type IntelligenceAuthMode = 'browser_oauth' | 'api_key'

export interface IntelligenceConfig {
  enabled: boolean
  auto_route: boolean
  provider: 'grok-cli'
  transport: 'acp'
  auth_mode: IntelligenceAuthMode
  legacy_search_provider: 'grok-search-mcp'
  allow_provider_fallback: false
  default_model: string
  deep_research_model: string
  deep_research_enabled: boolean
  live_checks_on_init: boolean
  artifact_root: string
  max_retries: number
  max_bundle_bytes: number
  retention_days: number
  exported_retention_days: number
  cleanup_credential_artifacts: boolean
  require_web_search: boolean
  x_search_policy: XSearchPolicy
}

export interface ProductManagerConfig {
  enabled: boolean
  provider: '' | 'codex' | 'gemini'
  contract_version: '1'
  max_retries: number
  timeout_ms: number
  max_output_bytes: number
}

// 模型路由配置
export interface ModelRouting {
  frontend: {
    models: ModelType[]
    primary: ModelType
    strategy: RoutingStrategy
  }
  backend: {
    models: ModelType[]
    primary: ModelType
    strategy: RoutingStrategy
  }
  review: {
    models: ModelType[]
    strategy: 'parallel'
  }
  mode: CollaborationMode
  geminiModel?: string // Gemini 具体型号（默认 gemini-3.1-pro-preview）
  grokModel?: string // Grok 具体型号（默认 grok-4.5，代码任务可选 grok-composer-2.5-fast）
}

// CCG 配置
export interface CcgConfig {
  general: {
    version: string
    language: SupportedLang
    createdAt: string
  }
  routing: ModelRouting
  workflows: {
    installed: string[]
  }
  paths: {
    commands: string
    prompts: string
    backup: string
  }
  mcp: {
    provider: string
    setup_url: string
  }
  intelligence: IntelligenceConfig
  product_manager: ProductManagerConfig
  performance?: {
    liteMode?: boolean // 轻量模式：禁用 Web UI，更快响应
    skipImpeccable?: boolean // 跳过 Impeccable 前端设计命令安装
  }
}

// 工作流定义
export interface WorkflowConfig {
  id: string
  name: string
  nameEn: string
  category: string
  commands: string[]
  defaultSelected: boolean
  order: number
  description?: string
  descriptionEn?: string
}

// 初始化选项
export interface InitOptions {
  lang?: SupportedLang
  skipPrompt?: boolean
  skipMcp?: boolean // 更新时跳过 MCP 配置
  force?: boolean
  // 非交互模式参数
  frontend?: string
  backend?: string
  mode?: CollaborationMode
  workflows?: string
  installDir?: string
  intelligence?: boolean
  productManager?: '' | 'disabled' | 'codex' | 'gemini'
}

// 安装结果
export interface InstallResult {
  success: boolean
  installedCommands: string[]
  installedPrompts: string[]
  installedSkills?: number
  installedSkillCommands?: number
  installedRules?: boolean
  errors: string[]
  configPath: string
  binPath?: string
  binInstalled?: boolean
}

// ace-tool 配置
export interface AceToolConfig {
  baseUrl: string
  token: string
}

// fast-context (Windsurf Fast Context) 配置
export interface FastContextConfig {
  apiKey?: string // WINDSURF_API_KEY (本地装 Windsurf 登录后可自动提取)
  includeSnippets?: boolean // FC_INCLUDE_SNIPPETS — true 返回完整代码片段
}

// Re-export CLI types
export * from './cli'
