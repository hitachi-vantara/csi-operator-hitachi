import { useEffect, useState, type ReactNode } from 'react'
import { useUiMode } from '../state/UiModeContext'

/**
 * Expert fields wrapper.
 * Simple: collapsed — only a toggle (and error if validation fails). No defaults dump.
 * Advanced: children only (today’s look).
 */
export function AdvancedSection({
  title = 'Advanced options',
  error,
  children,
}: {
  title?: string
  /** @deprecated Ignored — Simple mode does not dump defaults in the UI. */
  recap?: ReactNode
  error?: string
  children: ReactNode
}) {
  const { isAdvanced } = useUiMode()
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (error) setExpanded(true)
  }, [error])

  if (isAdvanced) {
    return <>{children}</>
  }

  return (
    <div className="advanced-section">
      {!expanded && error && <p className="error-text advanced-section-error">{error}</p>}
      {!expanded ? (
        <button
          type="button"
          className="advanced-section-toggle"
          onClick={() => setExpanded(true)}
        >
          Show advanced on this step
        </button>
      ) : (
        <>
          {title ? <h4 className="advanced-section-title">{title}</h4> : null}
          {children}
          <button
            type="button"
            className="advanced-section-toggle"
            onClick={() => setExpanded(false)}
          >
            Hide advanced on this step
          </button>
        </>
      )}
    </div>
  )
}
