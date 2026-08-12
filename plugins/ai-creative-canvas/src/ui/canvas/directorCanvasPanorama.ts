import type { Board } from '../types'

export interface DirectorCanvasPanorama {
  id: string
  title: string
  assetUrl: string
  assetLocalPath?: string
  mimeType?: string
  description?: string
}

export function listDirectorCanvasPanoramas(board?: Pick<Board, 'cards'> | null): DirectorCanvasPanorama[] {
  return Object.values(board?.cards || {})
    .filter((card) => card.kind === 'pano' && card.status === 'done' && !!card.assetUrl)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((card) => ({
      id: card.id,
      title: card.title || 'AI 全景',
      assetUrl: card.assetUrl!,
      assetLocalPath: card.assetLocalPath || undefined,
      mimeType: card.mime || undefined,
      description: card.prompt || undefined
    }))
}

export function inferDirectorPanoramaMime(panorama: Pick<DirectorCanvasPanorama, 'assetUrl' | 'mimeType'>): string {
  if (/^image\/(jpe?g|png|webp)$/i.test(panorama.mimeType || '')) return panorama.mimeType!
  if (/\.webp(?:$|\?)/i.test(panorama.assetUrl)) return 'image/webp'
  if (/\.jpe?g(?:$|\?)/i.test(panorama.assetUrl)) return 'image/jpeg'
  return 'image/png'
}
