import type { CcgConfig, CollaborationMode, SupportedLang } from '../types'

export interface CliOptions {
  kimiModel?: string
  opencodeModel?: string
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
