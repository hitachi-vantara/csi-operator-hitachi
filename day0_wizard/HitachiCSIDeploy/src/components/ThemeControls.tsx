import { useEffect, useId, useRef, useState } from 'react'
import type { ThemeMode, ThemePalette } from '../state/ThemeContext'

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M12 2.5v2.2M12 19.3v2.2M4.7 4.7l1.6 1.6M17.7 17.7l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.7 19.3l1.6-1.6M17.7 6.3l1.6-1.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M18.5 14.2A7.3 7.3 0 0 1 9.8 5.5 7.4 7.4 0 1 0 18.5 14.2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        d="M5 12.5 10 17.5 19 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function ThemeControls({
  palette,
  mode,
  onPalette,
  onMode,
}: {
  palette: ThemePalette
  mode: ThemeMode
  onPalette: (palette: ThemePalette) => void
  onMode: (mode: ThemeMode) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const chooseMode = (next: ThemeMode) => {
    onMode(next)
    setOpen(false)
  }

  const choosePalette = (next: ThemePalette) => {
    onPalette(next)
    setOpen(false)
  }

  return (
    <div className="theme-controls" ref={rootRef}>
      <button
        type="button"
        className={`theme-icon-btn${open ? ' active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        title="Theme"
        aria-label="Theme"
        onClick={() => setOpen((value) => !value)}
      >
        {mode === 'dark' ? <SunIcon /> : <MoonIcon />}
      </button>

      {open ? (
        <div className="theme-menu" id={menuId} role="menu" aria-label="Theme">
          <div className="theme-menu-section" role="group" aria-label="Appearance">
            <button
              type="button"
              role="menuitemradio"
              aria-checked={mode === 'light'}
              className={`theme-menu-item${mode === 'light' ? ' active' : ''}`}
              onClick={() => chooseMode('light')}
            >
              <span className="theme-menu-check" aria-hidden="true">
                {mode === 'light' ? <CheckIcon /> : null}
              </span>
              <SunIcon />
              <span>Light</span>
            </button>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={mode === 'dark'}
              className={`theme-menu-item${mode === 'dark' ? ' active' : ''}`}
              onClick={() => chooseMode('dark')}
            >
              <span className="theme-menu-check" aria-hidden="true">
                {mode === 'dark' ? <CheckIcon /> : null}
              </span>
              <MoonIcon />
              <span>Dark</span>
            </button>
          </div>

          <div className="theme-menu-divider" role="separator" />

          <div className="theme-menu-section" role="group" aria-label="Color">
            <button
              type="button"
              role="menuitemradio"
              aria-checked={palette === 'coe'}
              className={`theme-menu-item${palette === 'coe' ? ' active' : ''}`}
              onClick={() => choosePalette('coe')}
            >
              <span className="theme-menu-check" aria-hidden="true">
                {palette === 'coe' ? <CheckIcon /> : null}
              </span>
              <span className="theme-swatch theme-swatch-coe" />
              <span>Red</span>
            </button>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={palette === 'blue'}
              className={`theme-menu-item${palette === 'blue' ? ' active' : ''}`}
              onClick={() => choosePalette('blue')}
            >
              <span className="theme-menu-check" aria-hidden="true">
                {palette === 'blue' ? <CheckIcon /> : null}
              </span>
              <span className="theme-swatch theme-swatch-blue" />
              <span>Blue</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
