import type { CcgConfig, CollaborationMode, SupportedLang } from '../types'

export interface CliOptions {
  lang?: SupportedLang
  force?: boolean
  skipPrompt?: boolean
  skipMcp?: boolean
  frontend?: string
  backend?: string
  search?: string
  mode?: CollaborationMode
  workflows?: string
  installDir?: string
  intelligence?: boolean
}

export type { CcgConfig, CollaborationMode, SupportedLang }
