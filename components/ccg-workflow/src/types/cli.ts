import type { CcgConfig, CollaborationMode, SupportedLang } from '../types'

export interface CliOptions {
  lang?: SupportedLang
  force?: boolean
  skipPrompt?: boolean
  skipMcp?: boolean
  frontend?: string
  backend?: string
  mode?: CollaborationMode
  workflows?: string
  installDir?: string
  intelligence?: boolean
  productManager?: '' | 'disabled' | 'codex' | 'gemini'
}

export type { CcgConfig, CollaborationMode, SupportedLang }
