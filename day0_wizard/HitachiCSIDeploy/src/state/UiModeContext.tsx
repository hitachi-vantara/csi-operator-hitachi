import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type UiMode = 'simple' | 'advanced'

export const UI_MODE_STORAGE_KEY = 'hitachi-csi-wizard-ui-mode'

type UiModeContextValue = {
  uiMode: UiMode
  setUiMode: (mode: UiMode) => void
  isAdvanced: boolean
}

const UiModeContext = createContext<UiModeContextValue | null>(null)

export function parseUiMode(raw: string | null): UiMode {
  if (raw === 'advanced') return 'advanced'
  if (raw === 'simple') return 'simple'
  return 'simple'
}

function readStored(): UiMode {
  try {
    return parseUiMode(localStorage.getItem(UI_MODE_STORAGE_KEY))
  } catch {
    return 'simple'
  }
}

export function UiModeProvider({ children }: { children: ReactNode }) {
  const [uiMode, setUiModeState] = useState<UiMode>(() => {
    if (typeof window === 'undefined') return 'simple'
    return readStored()
  })

  useEffect(() => {
    localStorage.setItem(UI_MODE_STORAGE_KEY, uiMode)
  }, [uiMode])

  const setUiMode = useCallback((mode: UiMode) => {
    setUiModeState(mode)
  }, [])

  const isAdvanced = uiMode === 'advanced'

  const value = useMemo(
    () => ({ uiMode, setUiMode, isAdvanced }),
    [uiMode, setUiMode, isAdvanced],
  )

  return <UiModeContext.Provider value={value}>{children}</UiModeContext.Provider>
}

export function useUiMode() {
  const ctx = useContext(UiModeContext)
  if (!ctx) throw new Error('useUiMode must be used within UiModeProvider')
  return ctx
}
