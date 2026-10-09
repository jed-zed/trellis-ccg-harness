import Schema from '@deepseek-ai/schemastery'
import * as ToolSubagent from '@deepseek-ai/dsh-tool-subagent'
import { createCompatibilityPlugin } from './core.js'

const plugin = createCompatibilityPlugin(Schema, ToolSubagent)
export const { name, inject, Config, apply } = plugin
