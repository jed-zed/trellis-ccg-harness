/** Mount only an explicit, one-shot opinion tool. No model request occurs here. */
export const TOOL_NAME = 'ccg_dsh_review'
export const MAX_OUTPUT_TOKENS = 2048
export const REVIEW_TIMEOUT_MS = 120000

function boundedToolSubagent(ToolSubagent) {
  return {
    ...ToolSubagent,
    apply(inner, config) {
      const tools = new Proxy(inner.tools, {
        get(target, property) {
          if (property === 'register') {
            return (tool) => {
              if (tool.name !== TOOL_NAME) throw new Error('ccg-deepseek-compat: refusing an unexpected tool registration')
              // Official dsh-tools ToolRuntime enforces definition.timeoutMs.
              // This changes only the optional opinion tool's definition.
              return target.register({ ...tool, timeoutMs: REVIEW_TIMEOUT_MS })
            }
          }
          const value = Reflect.get(target, property, target)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
      const scoped = new Proxy(inner, {
        get(target, property) {
          if (property === 'tools') return tools
          const value = Reflect.get(target, property, target)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
      return ToolSubagent.apply(scoped, config)
    },
  }
}

export function validateRoute(config, providers) {
  const provider = typeof config?.provider === 'string' ? config.provider.trim() : ''
  const model = typeof config?.model === 'string' ? config.model.trim() : ''
  if (!provider || !model) throw new Error('ccg-deepseek-compat: explicit provider and model are required; deployment-default fallback is disabled')
  if (!Array.isArray(providers) || !providers.some(entry => entry?.provider === provider)) {
    throw new Error(`ccg-deepseek-compat: provider route "${provider}" is not configured; no child was registered`)
  }
  return { provider, model }
}

export function createCompatibilityPlugin(Schema, ToolSubagent) {
  return {
    name: 'ccg-deepseek-compat',
    inject: ['tools', 'llm'],
    Config: Schema.object({ provider: Schema.string(), model: Schema.string() }),
    apply(ctx, config) {
      const llm = ctx.get('llm')
      if (typeof llm?.listConfigurableProviders !== 'function') {
        throw new Error('ccg-deepseek-compat: provider catalog API is unavailable; no child was registered')
      }
      const route = validateRoute(config, llm.listConfigurableProviders())
      return ctx.plugin(boundedToolSubagent(ToolSubagent), {
        provider: 'spawn',
        toolName: TOOL_NAME,
        persona: 'Give an independent opinion on the supplied brief. Codex and Trellis remain the task owner and final writer. Return evidence, uncertainty and suggested changes; do not claim approval or ownership of files.',
        maxDepth: 1,
        backgroundMode: 'one-shot',
        enableRunInBackground: false,
        agentOptions: { ...route, maxTokens: MAX_OUTPUT_TOKENS },
        toolFilter: { allow: [] },
      })
    },
  }
}
