/**
 * 界面偏好：主题（亮色 / 暗色）。
 * - 默认跟随 Mulby 宿主（启动 ?theme= 参数 + onThemeChange）。
 * - 用户手动切换后以其选择为准（持久化，宿主主题变更不再覆盖）。
 */
import { create } from 'zustand'

const PLUGIN_ID = 'ai-film-studio'
const KEY_THEME = 'theme'

export type Theme = 'light' | 'dark'

function apply(theme: Theme) {
  document.documentElement.classList.toggle('light', theme === 'light')
}

interface UiState {
  theme: Theme
  manual: boolean
  loadTheme: () => Promise<void>
  setTheme: (t: Theme) => void
  toggleTheme: () => void
  applyHostTheme: (t: Theme) => void
}

export const useUiStore = create<UiState>((set, get) => ({
  theme: 'dark',
  manual: false,

  loadTheme: async () => {
    let theme: Theme = 'dark'
    let manual = false
    try {
      const stored = await window.mulby?.storage?.get(KEY_THEME, PLUGIN_ID)
      if (stored === 'light' || stored === 'dark') {
        theme = stored
        manual = true
      } else {
        const q = new URLSearchParams(window.location.search).get('theme')
        theme = q === 'light' ? 'light' : 'dark'
      }
    } catch {
      // 忽略
    }
    set({ theme, manual })
    apply(theme)
  },

  setTheme: (t) => {
    set({ theme: t, manual: true })
    apply(t)
    void window.mulby?.storage?.set(KEY_THEME, t, PLUGIN_ID)
  },

  toggleTheme: () => get().setTheme(get().theme === 'light' ? 'dark' : 'light'),

  applyHostTheme: (t) => {
    if (get().manual) return // 用户已手动选择，宿主主题不再覆盖
    set({ theme: t })
    apply(t)
  },
}))
