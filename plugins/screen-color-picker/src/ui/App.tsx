import { useEffect, useMemo, useState } from 'react'
import { Copy, Droplets, Pipette, Trash2 } from 'lucide-react'
import { useMulby } from './hooks/useMulby'

type PaletteItem = {
  hex: string
  rgb: string
  hsl: string
  ts: number
}

const PLUGIN_ID = 'screen-color-picker'
const HISTORY_KEY = 'palette-history:v1'
const HISTORY_LIMIT = 24

type EyeDropperLike = {
  open: () => Promise<{ sRGBHex: string }>
}

declare global {
  interface Window {
    EyeDropper?: new () => EyeDropperLike
  }
}

function normalizeHex(hex: string): string {
  const clean = hex.trim().replace('#', '')
  if (clean.length === 3) {
    return `#${clean
      .split('')
      .map((c) => `${c}${c}`)
      .join('')
      .toUpperCase()}`
  }
  return `#${clean.slice(0, 6).toUpperCase()}`
}

function hexToRgb(hex: string) {
  const value = normalizeHex(hex).slice(1)
  const r = Number.parseInt(value.slice(0, 2), 16)
  const g = Number.parseInt(value.slice(2, 4), 16)
  const b = Number.parseInt(value.slice(4, 6), 16)
  return { r, g, b, text: `rgb(${r}, ${g}, ${b})` }
}

function rgbToHsl(r: number, g: number, b: number) {
  const nr = r / 255
  const ng = g / 255
  const nb = b / 255
  const max = Math.max(nr, ng, nb)
  const min = Math.min(nr, ng, nb)
  const delta = max - min
  let h = 0
  if (delta !== 0) {
    if (max === nr) h = ((ng - nb) / delta) % 6
    else if (max === ng) h = (nb - nr) / delta + 2
    else h = (nr - ng) / delta + 4
  }
  h = Math.round(h * 60)
  if (h < 0) h += 360
  const l = (max + min) / 2
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1))
  return { h, s: Math.round(s * 100), l: Math.round(l * 100), text: `hsl(${h}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)` }
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const sn = s / 100
  const ln = l / 100
  const c = (1 - Math.abs(2 * ln - 1)) * sn
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = ln - c / 2
  let rp = 0, gp = 0, bp = 0
  if (h < 60) { rp = c; gp = x }
  else if (h < 120) { rp = x; gp = c }
  else if (h < 180) { gp = c; bp = x }
  else if (h < 240) { gp = x; bp = c }
  else if (h < 300) { rp = x; bp = c }
  else { rp = c; bp = x }
  return {
    r: Math.round((rp + m) * 255),
    g: Math.round((gp + m) * 255),
    b: Math.round((bp + m) * 255)
  }
}

function parseColorValue(raw: string): string | null {
  const input = raw.trim()
  if (!input) return null

  const hexMatch = input.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/)
  if (hexMatch) return normalizeHex(input)

  const rgbMatch = input.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(?:0?\.\d+|1(?:\.0)?|[01]))?\s*\)$/)
  if (rgbMatch) {
    const r = Number(rgbMatch[1])
    const g = Number(rgbMatch[2])
    const b = Number(rgbMatch[3])
    if (r <= 255 && g <= 255 && b <= 255) {
      const hex = [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')
      return `#${hex.toUpperCase()}`
    }
  }

  const hslMatch = input.match(/^hsla?\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%\s*(?:,\s*(?:0?\.\d+|1(?:\.0)?|[01]))?\s*\)$/)
  if (hslMatch) {
    const h = Number(hslMatch[1])
    const s = Number(hslMatch[2])
    const l = Number(hslMatch[3])
    if (h <= 360 && s <= 100 && l <= 100) {
      const { r, g, b } = hslToRgb(h, s, l)
      const hex = [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')
      return `#${hex.toUpperCase()}`
    }
  }

  return null
}

function buildPalette(hexRaw: string): PaletteItem {
  const hex = normalizeHex(hexRaw)
  const rgb = hexToRgb(hex)
  return {
    hex,
    rgb: rgb.text,
    hsl: rgbToHsl(rgb.r, rgb.g, rgb.b).text,
    ts: Date.now()
  }
}

export default function App() {
  const { clipboard, notification, screen, storage, window: mulbyWindow } = useMulby(PLUGIN_ID)
  const [activeColor, setActiveColor] = useState<PaletteItem>(buildPalette('#4F46E5'))
  const [history, setHistory] = useState<PaletteItem[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const initialTheme = (params.get('theme') as 'light' | 'dark') || 'light'
    document.documentElement.classList.toggle('dark', initialTheme === 'dark')
    window.mulby?.onThemeChange?.((newTheme) => {
      document.documentElement.classList.toggle('dark', newTheme === 'dark')
    })
    window.mulby?.onPluginInit?.((data) => {
      if (data.featureCode === 'recognize-color' && data.input) {
        const hex = parseColorValue(data.input)
        if (hex) {
          const color = buildPalette(hex)
          setActiveColor(color)
          setHistory((prev) => [color, ...prev.filter((item) => item.hex !== color.hex)].slice(0, HISTORY_LIMIT))
          clipboard.writeText(color.hex)
          notification.show(`已识别颜色 ${color.hex}，并复制到剪贴板。`, 'success')
        } else {
          notification.show('无法识别的颜色值，请选中 HEX / RGB / HSL 格式的颜色值。', 'warning')
        }
      }
    })
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const raw = await storage.get(HISTORY_KEY)
        if (!Array.isArray(raw)) return
        const parsed = raw
          .filter((item): item is PaletteItem => Boolean(item && typeof item === 'object' && typeof (item as PaletteItem).hex === 'string'))
          .slice(0, HISTORY_LIMIT)
        setHistory(parsed)
      } catch {
        // ignore storage read failure
      }
    })()
  }, [storage])

  async function saveHistory(next: PaletteItem[]) {
    setHistory(next)
    await storage.set(HISTORY_KEY, next).catch(() => undefined)
  }

  async function pickColor() {
    if (busy) return
    setBusy(true)
    mulbyWindow.hide()
    try {
      let pickedHex = ''
      let pickedFrom: 'mulby' | 'eyedropper' | 'none' = 'none'
      const picked = await screen.colorPick().catch((error: unknown) => {
        console.warn('[screen-color-picker] Mulby colorPick failed:', error)
        return null
      })
      if (picked?.hex) {
        pickedHex = picked.hex
        pickedFrom = 'mulby'
        console.info('[screen-color-picker] color source: Mulby API', picked.hex)
      } else if (window.EyeDropper) {
        const eyeDropper = new window.EyeDropper()
        const result = await eyeDropper.open()
        pickedHex = result.sRGBHex
        pickedFrom = 'eyedropper'
        console.info('[screen-color-picker] color source: EyeDropper', result.sRGBHex)
      }

      if (!pickedHex) {
        console.warn('[screen-color-picker] no available color picker (Mulby/EyeDropper unsupported)')
        notification.show('当前环境不支持取色，请升级 Mulby 或系统。', 'warning')
        return
      }

      const color = buildPalette(pickedHex)
      setActiveColor(color)
      const next = [color, ...history.filter((item) => item.hex !== color.hex)].slice(0, HISTORY_LIMIT)
      await saveHistory(next)
      await clipboard.writeText(color.hex)
      console.info('[screen-color-picker] pick success:', { source: pickedFrom, hex: color.hex })
      notification.show(`已取色 ${color.hex}，并复制到剪贴板。`, 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      console.error('[screen-color-picker] pick failed:', error)
      if (message.toLowerCase().includes('abort')) {
        notification.show('已取消取色。', 'info')
      } else {
        notification.show('取色失败，请重试。', 'error')
      }
    } finally {
      mulbyWindow.show()
      setBusy(false)
    }
  }

  async function copyValue(value: string, label: string) {
    await clipboard.writeText(value)
    notification.show(`${label} 已复制`, 'success')
  }

  async function clearHistory() {
    await saveHistory([])
    notification.show('历史色板已清空', 'info')
  }

  const previewStyle = useMemo(
    () => ({ background: activeColor.hex }),
    [activeColor.hex]
  )

  return (
    <div className="app">
      <header className="header">
        <h1><Pipette size={18} /> 屏幕取色器</h1>
        <p>点击开始后在屏幕任意位置拾取颜色，支持 HEX / RGB / HSL 一键复制。</p>
      </header>

      <section className="panel">
        <div className="preview" style={previewStyle} />
        <div className="meta">
          <div className="line"><strong>HEX</strong><code>{activeColor.hex}</code></div>
          <div className="line"><strong>RGB</strong><code>{activeColor.rgb}</code></div>
          <div className="line"><strong>HSL</strong><code>{activeColor.hsl}</code></div>
        </div>
        <div className="actions">
          <button className="primary" disabled={busy} type="button" onClick={() => void pickColor()}>
            <Droplets size={15} />
            {busy ? '等待取色...' : '开始屏幕取色'}
          </button>
          <button type="button" onClick={() => void copyValue(activeColor.hex, 'HEX')}>
            <Copy size={14} /> 复制 HEX
          </button>
          <button type="button" onClick={() => void copyValue(activeColor.rgb, 'RGB')}>
            <Copy size={14} /> 复制 RGB
          </button>
          <button type="button" onClick={() => void copyValue(activeColor.hsl, 'HSL')}>
            <Copy size={14} /> 复制 HSL
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="history-header">
          <h2>历史色板</h2>
          <button type="button" className="ghost" disabled={history.length === 0} onClick={() => void clearHistory()}>
            <Trash2 size={14} /> 清空
          </button>
        </div>
        {history.length === 0 ? (
          <p className="empty">还没有历史颜色，先拾取一个试试。</p>
        ) : (
          <ul className="history-list">
            {history.map((item) => (
              <li key={`${item.hex}-${item.ts}`}>
                <button
                  type="button"
                  className="history-item"
                  onClick={() => setActiveColor(item)}
                  title="点击设为当前颜色"
                >
                  <span className="dot" style={{ background: item.hex }} />
                  <span className="history-text">
                    <strong>{item.hex}</strong>
                    <small>{item.rgb}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
