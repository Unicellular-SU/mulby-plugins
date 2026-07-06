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

function applySnapshot(snapshot: AssetHubSnapshot): Pick<AssetHubState, 'mediaAssets' | 'boards' | 'elements' | 'entities' | 'usageByEntity' | 'usageByMedia'> {
  return {
    mediaAssets: snapshot.mediaAssets,
    boards: snapshot.boards,
    elements: snapshot.elements,
    entities: snapshot.entities,
    usageByEntity: snapshot.usageByEntity,
    usageByMedia: snapshot.usageByMedia,
  }
}

export const useAssetHubStore = create<AssetHubState>((set, get) => ({
  mediaAssets: [],
  boards: [],
  elements: [],
  entities: [],
  usageByEntity: {},
  usageByMedia: {},
  loading: false,
  loaded: false,

  refresh: async () => {
    if (get().loading) return
    set({ loading: true, error: undefined })
    try {
      const snapshot = await loadAssetHub()
      set({ ...applySnapshot(snapshot), loading: false, loaded: true })
    } catch (error) {
      set({ loading: false, loaded: false, error: error instanceof Error ? error.message : String(error) })
    }
  },

  getUsage: (entityId) => get().usageByEntity[entityId],
}))
