import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

function KebabIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="12" cy="5.5" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18.5" r="1.35" fill="currentColor" stroke="none" />
    </svg>
  )
}

function MenuIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      {children}
    </svg>
  )
}

export function HeaderMoreMenu({
  onAbout,
  onImport,
  onSave,
  onReset,
  issuesUrl,
}: {
  onAbout: () => void
  onImport: () => void
  onSave: () => void
  onReset: () => void
  issuesUrl: string
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

  const closeAnd = (action: () => void) => {
    action()
    setOpen(false)
  }

  return (
    <div className="header-more-menu" ref={rootRef}>
      <button
        type="button"
        className={`theme-icon-btn${open ? ' active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        title="More"
        aria-label="More"
        onClick={() => setOpen((value) => !value)}
      >
        <KebabIcon />
      </button>

      {open ? (
        <div className="theme-menu" id={menuId} role="menu" aria-label="More">
          <div className="theme-menu-section">
            <button
              type="button"
              role="menuitem"
              className="theme-menu-item"
              onClick={() => closeAnd(onAbout)}
            >
              <span className="theme-menu-check" aria-hidden="true" />
              <MenuIcon>
                <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.75" />
                <path d="M12 10.5v6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                <circle cx="12" cy="7.5" r="0.85" fill="currentColor" stroke="none" />
              </MenuIcon>
              <span>About</span>
            </button>
            <a
              role="menuitem"
              className="theme-menu-item"
              href={issuesUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
            >
              <span className="theme-menu-check" aria-hidden="true" />
              <MenuIcon>
                <path
                  d="M7 8h10M7 12h7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                />
                <path
                  d="M6 4h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-5l-4 3v-3H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinejoin="round"
                />
              </MenuIcon>
              <span>Report issue</span>
            </a>
            <button
              type="button"
              role="menuitem"
              className="theme-menu-item"
              onClick={() => closeAnd(onImport)}
            >
              <span className="theme-menu-check" aria-hidden="true" />
              <MenuIcon>
                <path d="M12 3v10" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                <path
                  d="m8 9 4 4 4-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path d="M5 18h14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              </MenuIcon>
              <span>Import config</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="theme-menu-item"
              onClick={() => closeAnd(onSave)}
            >
              <span className="theme-menu-check" aria-hidden="true" />
              <MenuIcon>
                <path d="M12 15V5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                <path
                  d="m8 9 4-4 4 4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path d="M5 18h14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              </MenuIcon>
              <span>Save config</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="theme-menu-item"
              onClick={() => closeAnd(onReset)}
            >
              <span className="theme-menu-check" aria-hidden="true" />
              <MenuIcon>
                <path
                  d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                />
                <path
                  d="M4.5 4.5v5h5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </MenuIcon>
              <span>Reset wizard</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
