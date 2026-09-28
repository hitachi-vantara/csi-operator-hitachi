import type { UiMode } from '../state/UiModeContext'

export function UiModeControls({
  uiMode,
  onUiMode,
}: {
  uiMode: UiMode
  onUiMode: (mode: UiMode) => void
}) {
  return (
    <div className="ui-mode-controls" role="group" aria-label="Wizard view">
      <button
        type="button"
        className={`ui-mode-btn${uiMode === 'simple' ? ' active' : ''}`}
        aria-pressed={uiMode === 'simple'}
        onClick={() => onUiMode('simple')}
      >
        Simple
      </button>
      <button
        type="button"
        className={`ui-mode-btn${uiMode === 'advanced' ? ' active' : ''}`}
        aria-pressed={uiMode === 'advanced'}
        onClick={() => onUiMode('advanced')}
      >
        Advanced
      </button>
    </div>
  )
}
