import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type ThemePalette = 'coe' | 'blue'
export type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'hitachi-csi-wizard-theme'

type StoredTheme = {
  palette: ThemePalette
  mode: ThemeMode
}

type ThemeContextValue = {
  palette: ThemePalette
  mode: ThemeMode
  setPalette: (palette: ThemePalette) => void
  setMode: (mode: ThemeMode) => void
  toggleMode: () => void
  /** True when header uses a light surface (needs dark logo / dark ghost buttons) */
  headerLight: boolean
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function prefersDarkMode(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function systemDefault(): StoredTheme {
  return { palette: 'coe', mode: prefersDarkMode() ? 'dark' : 'light' }
}

function readStored(): StoredTheme | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredTheme>
    const palette = parsed.palette === 'blue' ? 'blue' : 'coe'
    const mode = parsed.mode === 'dark' ? 'dark' : 'light'
    return { palette, mode }
  } catch {
    return null
  }
}

function applyDom(palette: ThemePalette, mode: ThemeMode) {
  const root = document.documentElement
  root.dataset.palette = palette
  root.dataset.mode = mode
  root.style.colorScheme = mode
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [{ palette, mode, explicit }, setTheme] = useState(() => {
    if (typeof window === 'undefined') {
      return { palette: 'coe' as ThemePalette, mode: 'light' as ThemeMode, explicit: false }
    }
    const stored = readStored()
    const initial = stored ?? systemDefault()
    applyDom(initial.palette, initial.mode)
    return { ...initial, explicit: stored !== null }
  })

  useEffect(() => {
    applyDom(palette, mode)
    if (explicit) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ palette, mode }))
    }
  }, [palette, mode, explicit])

  // Follow OS preference until the user makes an explicit theme choice
  useEffect(() => {
    if (explicit) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      setTheme((t) => ({ ...t, mode: mq.matches ? 'dark' : 'light' }))
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [explicit])

  const setPalette = useCallback((next: ThemePalette) => {
    setTheme((t) => ({ ...t, palette: next, explicit: true }))
  }, [])

  const setMode = useCallback((next: ThemeMode) => {
    setTheme((t) => ({ ...t, mode: next, explicit: true }))
  }, [])

  const toggleMode = useCallback(() => {
    setTheme((t) => ({
      ...t,
      mode: t.mode === 'dark' ? 'light' : 'dark',
      explicit: true,
    }))
  }, [])

  const headerLight = mode === 'light' && palette === 'coe'

  const value = useMemo(
    () => ({ palette, mode, setPalette, setMode, toggleMode, headerLight }),
    [palette, mode, setPalette, setMode, toggleMode, headerLight],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
