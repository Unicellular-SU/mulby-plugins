/**
 * Sprite SVG 净化与校验工具。
 * 目标：阻止恶意子窗口或被劫持插件经 `sprites-updated` 注入可执行内容。
 *
 * 策略：
 * 1) 字符串层先做 schema/长度白名单。
 * 2) 用 DOMParser 解析为独立文档，只保留 SVG 白名单元素与属性。
 * 3) 返回 sanitized HTMLElement 节点（调用方 appendChild），不再使用 innerHTML。
 */

import { ALL_EXPRESSIONS, ALL_POSES, type PetSpriteKey, type PetSpriteSet } from './pet-standard'

const MAX_SPRITE_BYTES = 50 * 1024
const VALID_KEYS = new Set<string>(
  ALL_POSES.flatMap(pose => ALL_EXPRESSIONS.map(expr => `${pose}_${expr}`))
)

/** 仅保留这些 SVG 元素，其余全部丢弃。 */
const ALLOWED_SVG_TAGS = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'title',
  'desc',
  'metadata',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'textpath',
  'lineargradient',
  'radialgradient',
  'stop',
  'pattern',
  'clippath',
  'mask',
  'filter',
  'fegaussianblur',
  'feoffset',
  'femerge',
  'femergenode',
  'fecolormatrix',
  'fecomposite',
  'feblend',
  'feflood',
  'feimage',
  'fedropshadow',
  'animate',
  'animatetransform',
  'animatemotion',
  'mpath',
])

/** 危险元素直接整棵子树丢弃。 */
const DANGEROUS_TAGS = new Set([
  'script',
  'foreignobject',
  'iframe',
  'object',
  'embed',
  'audio',
  'video',
  'image', // SVG <image> 可加载远程资源，安全起见禁用
  'use',   // <use href="external.svg#x"> 可能引外部资源
  'a',     // <a href="..."> 也禁掉
  'style', // 内联 style 可能含 url(javascript:...)
  'link',
])

/** 允许的属性（小写）；不在此列表的属性一律剥离。 */
const ALLOWED_ATTRS = new Set([
  'id',
  'class',
  'd',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'opacity',
  'transform',
  'viewbox',
  'width',
  'height',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'points',
  'preserveaspectratio',
  'xmlns',
  'version',
  'shape-rendering',
  'image-rendering',
  'text-anchor',
  'font-size',
  'font-family',
  'font-weight',
  'letter-spacing',
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientunits',
  'gradienttransform',
  'spreadmethod',
  'cliprule',
  'clip-path',
  'mask',
  'mask-type',
  'filter',
  'in',
  'in2',
  'result',
  'stddeviation',
  'flood-color',
  'flood-opacity',
  'lighting-color',
  'values',
  'mode',
  'operator',
  'k1',
  'k2',
  'k3',
  'k4',
  'dx',
  'dy',
  'attributename',
  'attributetype',
  'from',
  'to',
  'dur',
  'begin',
  'end',
  'repeatcount',
  'keytimes',
  'keysplines',
  'calcmode',
  'type',
])

/** 这些 URL/href 协议不允许 */
const URL_ATTR_NAMES = new Set(['href', 'xlink:href'])

const FORBIDDEN_PROTOCOLS = /^(\s*)(javascript|data|vbscript|file):/i

function isSafeUrl(value: string): boolean {
  if (!value) return true
  return !FORBIDDEN_PROTOCOLS.test(value)
}

/** 递归净化节点：返回 true 表示节点被保留，false 表示需要被父节点剔除 */
function sanitizeNode(node: Element): boolean {
  const tag = node.tagName.toLowerCase()

  if (DANGEROUS_TAGS.has(tag)) return false
  if (!ALLOWED_SVG_TAGS.has(tag)) return false

  for (const attr of Array.from(node.attributes)) {
    const name = attr.name.toLowerCase()

    if (name.startsWith('on')) {
      node.removeAttributeNode(attr)
      continue
    }

    if (URL_ATTR_NAMES.has(name)) {
      if (!isSafeUrl(attr.value)) {
        node.removeAttributeNode(attr)
      }
      continue
    }

    if (name === 'style') {
      node.removeAttributeNode(attr)
      continue
    }

    if (!ALLOWED_ATTRS.has(name) && !name.startsWith('xmlns')) {
      node.removeAttributeNode(attr)
      continue
    }

    if (name === 'fill' || name === 'stroke' || name === 'filter' || name === 'mask' || name === 'clip-path') {
      const url = /url\(\s*(['"]?)(.*?)\1\s*\)/i.exec(attr.value)
      if (url && !isSafeUrl(url[2])) {
        node.removeAttributeNode(attr)
        continue
      }
    }
  }

  for (const child of Array.from(node.children)) {
    if (!sanitizeNode(child)) {
      node.removeChild(child)
    }
  }

  return true
}

/**
 * 把一个 sprite SVG 字符串解析为安全的 SVG Element。
 * 解析失败、含恶意标签或体积过大 → 返回 null。
 */
export function sanitizeSvgString(svg: string): SVGSVGElement | null {
  if (typeof svg !== 'string') return null
  if (svg.length === 0 || svg.length > MAX_SPRITE_BYTES) return null
  const trimmed = svg.trim()
  if (!trimmed.startsWith('<svg')) return null

  let parsed: Document
  try {
    parsed = new DOMParser().parseFromString(trimmed, 'image/svg+xml')
  } catch {
    return null
  }
  if (parsed.querySelector('parsererror')) return null

  const root = parsed.documentElement
  if (!root || root.tagName.toLowerCase() !== 'svg') return null

  if (!sanitizeNode(root)) return null

  return root as unknown as SVGSVGElement
}

/**
 * 校验从子窗口收到的 sprite-set 数据：
 * - sprites 必须是对象
 * - 每个 key 必须在 CORE_SPRITES 范围内
 * - 每个 value 必须是合法 SVG 字符串（用 sanitizeSvgString 验证可解析性）
 * - 必须存在 stand_neutral
 */
export function validateSpriteSet(raw: unknown): PetSpriteSet | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const sprites = o.sprites
  if (!sprites || typeof sprites !== 'object') return null

  const safeSprites: Partial<Record<PetSpriteKey, string>> = {}
  for (const [key, value] of Object.entries(sprites as Record<string, unknown>)) {
    if (!VALID_KEYS.has(key)) continue
    if (typeof value !== 'string') continue
    if (value.length > MAX_SPRITE_BYTES) continue
    if (!sanitizeSvgString(value)) continue
    safeSprites[key as PetSpriteKey] = value
  }

  if (!safeSprites['stand_neutral']) return null

  const id = typeof o.id === 'string' ? o.id.slice(0, 64) : 'custom'
  const name = typeof o.name === 'string' ? o.name.slice(0, 80) : '自定义外观'
  const description = typeof o.description === 'string' ? o.description.slice(0, 200) : ''
  const createdAt = typeof o.createdAt === 'number' && Number.isFinite(o.createdAt) ? o.createdAt : Date.now()

  return { id, name, description, sprites: safeSprites, createdAt }
}
