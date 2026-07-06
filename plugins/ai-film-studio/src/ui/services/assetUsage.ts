import { loadIndex, loadProject } from '../domain/persistence'

export interface IdentityAssetProjectUsage {
  projectId: string
  projectName: string
  assetIds: string[]
  assetNames: string[]
}

export interface IdentityAssetUsage {
  entityId: string
  projectCount: number
  assetCount: number
  projects: IdentityAssetProjectUsage[]
}

export async function loadIdentityAssetUsages(): Promise<Record<string, IdentityAssetUsage>> {
  const byEntity: Record<string, IdentityAssetUsage> = {}
  const cards = await loadIndex()
  for (const card of cards) {
    const doc = await loadProject(card.id)
    if (!doc) continue
    const perProject = new Map<string, IdentityAssetProjectUsage>()
    for (const asset of doc.assets ?? []) {
      if (!asset.elementId) continue
      let usage = byEntity[asset.elementId]
      if (!usage) {
        usage = { entityId: asset.elementId, projectCount: 0, assetCount: 0, projects: [] }
        byEntity[asset.elementId] = usage
      }
      let projectUsage = perProject.get(asset.elementId)
      if (!projectUsage) {
        projectUsage = { projectId: doc.meta.id, projectName: doc.meta.name, assetIds: [], assetNames: [] }
        perProject.set(asset.elementId, projectUsage)
        usage.projects.push(projectUsage)
      }
      projectUsage.assetIds.push(asset.id)
      projectUsage.assetNames.push(asset.name)
      usage.assetCount += 1
    }
    for (const entityId of perProject.keys()) {
      const usage = byEntity[entityId]
      if (usage) usage.projectCount = usage.projects.length
    }
  }
  return byEntity
}
