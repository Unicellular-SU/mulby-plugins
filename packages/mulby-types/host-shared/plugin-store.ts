export type PluginStoreIconKind = 'url' | 'emoji'

export interface PluginStoreIcon {
  type: PluginStoreIconKind
  value: string
}

export interface PluginStoreScreenshot {
  url: string
  caption?: string
}

export interface PluginStorePlugin {
  id: string
  name: string
  displayName?: string
  version: string
  author?: string
  publisher?: string
  description: string
  downloadUrl: string
  type?: string
  icon?: PluginStoreIcon
  banner?: string
  screenshots?: PluginStoreScreenshot[]
  details?: string
  tags?: string[]
  categories?: string[]
  license?: string
  homepage?: string
  repository?: string
  sha256?: string
  lastPackageTime?: string
}

export interface PluginStoreIndex {
  version: string
  plugins: PluginStorePlugin[]
}

export type PluginStoreInstallStatus = 'not-installed' | 'installed' | 'updatable'

export interface PluginStoreInstallState {
  status: PluginStoreInstallStatus
  installedVersion?: string
  remoteVersion: string
}

export interface PluginStoreEntry {
  plugin: PluginStorePlugin
  sourceId: string
  sourceName: string
  sourceUrl: string
  sourcePriority: number
  installState: PluginStoreInstallState
}

export interface PluginStoreSourceSyncResult {
  sourceId: string
  sourceName: string
  url: string
  success: boolean
  lastSyncAt: number
  error?: string
}

export interface PluginStoreFetchResult {
  entries: PluginStoreEntry[]
  sources: PluginStoreSourceSyncResult[]
  fetchedAt: number
}

export interface PluginStoreInstallFromUrlInput {
  pluginId?: string
  version?: string
  downloadUrl: string
  sourceId?: string
  sourceName?: string
  sourceUrl?: string
  publisher?: string
  homepage?: string
  repository?: string
  sha256?: string
}

export type PluginStoreIntegrityStatus = 'verified' | 'missing'

export interface PluginStoreInstallResult {
  success: boolean
  pluginName?: string
  pluginId?: string
  action?: 'installed' | 'updated' | 'already-installed' | 'downgrade-blocked'
  isUpdate?: boolean
  oldVersion?: string
  newVersion?: string
  error?: string
  sourceId?: string
  sourceName?: string
  sourceUrl?: string
  integrityStatus?: PluginStoreIntegrityStatus
  integrityDigest?: string
}

export type InstalledPluginUpdateStatus = 'updatable' | 'latest' | 'no-source'

export interface InstalledPluginUpdateInfo {
  pluginId: string
  pluginName: string
  displayName: string
  installedVersion: string
  status: InstalledPluginUpdateStatus
  remoteVersion?: string
  downloadUrl?: string
  sourceId?: string
  sourceName?: string
  sourceUrl?: string
  publisher?: string
  homepage?: string
  repository?: string
  sha256?: string
}

export interface InstalledPluginUpdateResult {
  updates: InstalledPluginUpdateInfo[]
  sources: PluginStoreSourceSyncResult[]
  fetchedAt: number
}

export interface PluginStoreBatchUpdateItemResult {
  pluginId: string
  pluginName: string
  displayName: string
  fromVersion: string
  toVersion: string
  success: boolean
  error?: string
}

export interface PluginStoreBatchUpdateResult {
  results: PluginStoreBatchUpdateItemResult[]
  sources: PluginStoreSourceSyncResult[]
  fetchedAt: number
}
