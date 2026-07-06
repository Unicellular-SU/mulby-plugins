import { create } from 'zustand'
import {
  loadAssetHub,
  type AssetHubSnapshot,
  type IdentityAssetUsage,
  type LibraryEntity,
  type MediaAssetUsage,
} from '../services/assetHub'
import type { AssetRecord, Board } from '../services/assetRegistry'
import type { ElementRef } from './assetStore'

interface AssetHubState {
  mediaAssets: AssetRecord[]
  boards: Board[]
  storageUsage: { count: number; bytes: number }
  elements: ElementRef[]
  entities: LibraryEntity[]
  usageByEntity: Record<string, IdentityAssetUsage>
  usageByMedia: Record<string, MediaAssetUsage>
  loading: boolean
  loaded: boolean
  error?: string

  refresh: () => Promise<void>
  getUsage: (entityId: string) => IdentityAssetUsage | undefined
}

function applySnapshot(snapshot: AssetHubSnapshot): Pick<AssetHubState, 'mediaAssets' | 'boards' | 'storageUsage' | 'elements' | 'entities' | 'usageByEntity' | 'usageByMedia'> {
  return {
    mediaAssets: snapshot.mediaAssets,
    boards: snapshot.boards,
    storageUsage: snapshot.storageUsage,
    elements: snapshot.elements,
    entities: snapshot.entities,
    usageByEntity: snapshot.usageByEntity,
    usageByMedia: snapshot.usageByMedia,
  }
}

let refreshInFlight: Promise<void> | null = null
let refreshQueued = false

export const useAssetHubStore = create<AssetHubState>((set, get) => ({
  mediaAssets: [],
  boards: [],
  storageUsage: { count: 0, bytes: 0 },
  elements: [],
  entities: [],
  usageByEntity: {},
  usageByMedia: {},
  loading: false,
  loaded: false,

  refresh: async () => {
    if (refreshInFlight) {
      refreshQueued = true
      return refreshInFlight
    }
    refreshInFlight = (async () => {
      try {
        do {
          refreshQueued = false
          set({ loading: true, error: undefined })
          try {
            const snapshot = await loadAssetHub()
            set({ ...applySnapshot(snapshot), loaded: true })
          } catch (error) {
            set({ loaded: false, error: error instanceof Error ? error.message : String(error) })
          }
        } while (refreshQueued)
      } finally {
        set({ loading: false })
        refreshInFlight = null
      }
    })()
    return refreshInFlight
  },

  getUsage: (entityId) => get().usageByEntity[entityId],
}))
