// CCG - Claude + Codex + Gemini Multi-Model Collaboration System
export * from './types'
export * from './commands/addons'
export { init } from './commands/init'
export { showMainMenu } from './commands/menu'
export { update } from './commands/update'
export { i18n, initI18n, changeLanguage } from './i18n'
export {
  readCcgConfig,
  readCcgConfigAt,
  writeCcgConfig,
  createDefaultConfig,
  createDefaultRouting,
  getCcgDir,
  getConfigPath,
  migrateLegacyProductManagerProviderDocument,
} from './utils/config'
export * from './utils/model-routing'
export { configRouting } from './commands/config-routing'
export * from './product-manager/canonical-json'
export * from './product-manager/contracts'
export * from './product-manager/evidence-store'
export * from './product-manager/event-mapping'
export * from './product-manager/invocation'
export * from './product-manager/progress'
export * from './product-manager/provider-registry'
export * from './product-manager/provider-runner'
export * from './product-manager/providers/codex'
export * from './product-manager/providers/gemini'
export * from './product-manager/providers/claude'
export {
  createDefaultRoleRouting,
  isRegisteredModel,
  isRoutingRole,
  normalizeModelRouting,
  setRoleProvider,
} from './utils/model-routing'
export {
  getWorkflowConfigs,
  getWorkflowById,
  installWorkflows,
  installAceTool,
  installAceToolRs,
  installCodexMode,
  recoverCodexMode,
  uninstallCodexMode,
  uninstallWorkflows,
  uninstallAceTool,
} from './utils/installer'
export {
  migrateToV1_4_0,
  needsMigration,
} from './utils/migration'
export {
  getCurrentVersion,
  getLatestVersion,
  checkForUpdates,
  compareVersions,
} from './utils/version'
