import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'

/** Click/focus-toggled help popover (hover enhances expand; touch-safe). */
export function HelpTip({ text, diagram }: { text: string; diagram?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const popoverRef = useRef<HTMLSpanElement>(null)
  const tipId = useId()
  const sticky = !!diagram

  useEffect(() => {
    if (!open) {
      setCoords(null)
      return
    }

    const place = () => {
      const wrap = wrapRef.current
      if (!wrap) return
      const rect = wrap.getBoundingClientRect()
      const margin = 8
      const width = sticky
        ? Math.min(680, window.innerWidth - margin * 2)
        : Math.min(280, window.innerWidth * 0.7, window.innerWidth - margin * 2)
      let left = rect.left
      if (left + width > window.innerWidth - margin) {
        left = rect.right - width
      }
      left = Math.max(margin, Math.min(left, window.innerWidth - margin - width))
      let top = rect.bottom + 6
      const pop = popoverRef.current
      const height = pop?.offsetHeight ?? (sticky ? width * 0.55 + 72 : 120)
      if (top + height > window.innerHeight - margin) {
        top = Math.max(margin, rect.top - height - 6)
      }
      setCoords({ top, left, width })
    }

    place()
    const id = requestAnimationFrame(place)

    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      cancelAnimationFrame(id)
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, sticky])

  return (
    <span
      className={`help-tip${open ? ' open' : ''}`}
      ref={wrapRef}
      onMouseEnter={() => {
        if (!sticky) setOpen(true)
      }}
      onMouseLeave={() => {
        if (!sticky) setOpen(false)
      }}
    >
      <button
        type="button"
        className="help-tip-btn"
        aria-label="More information"
        aria-expanded={open}
        aria-controls={tipId}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        onFocus={() => {
          if (!sticky) setOpen(true)
        }}
      >
        ?
      </button>
      {open && (
        <span
          ref={popoverRef}
          className={`help-tip-popover${sticky ? ' has-diagram' : ''}`}
          id={tipId}
          role="tooltip"
          style={
            coords
              ? { top: coords.top, left: coords.left, width: coords.width }
              : { top: 0, left: 0, width: sticky ? 680 : 280, visibility: 'hidden' }
          }
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          {text}
          {diagram ? <div className="help-tip-diagram">{diagram}</div> : null}
        </span>
      )}
    </span>
  )
}

export function PasswordInput({
  value,
  onChange,
  placeholder,
  autoComplete = 'off',
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoComplete?: string
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="password-input">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        autoComplete={autoComplete}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="password-toggle"
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  )
}

export function Field({
  label,
  hint,
  help,
  helpDiagram,
  error,
  warning,
  children,
}: {
  label: string
  hint?: string
  /** Longer “what is this?” shown via HelpTip beside the label */
  help?: string
  helpDiagram?: ReactNode
  error?: string
  warning?: string
  children: ReactNode
}) {
  const showError = Boolean(error)
  const showWarning = Boolean(warning) && !showError
  return (
    <div className={`field${showError ? ' error' : ''}${showWarning ? ' warning' : ''}`}>
      <label>
        {label}
        {help ? <HelpTip text={help} diagram={helpDiagram} /> : null}
      </label>
      {children}
      {hint && !showError && !showWarning && <span className="hint">{hint}</span>}
      {showError && <span className="error-text">{error}</span>}
      {showWarning && <span className="warning-text">{warning}</span>}
    </div>
  )
}

export function Section({
  title,
  help,
  helpDiagram,
  actions,
  children,
}: {
  title: string
  help?: string
  helpDiagram?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="section">
      <div className="section-header">
        <h3>
          {title}
          {help ? <HelpTip text={help} diagram={helpDiagram} /> : null}
        </h3>
        {actions}
      </div>
      {children}
    </div>
  )
}

export function Callout({
  children,
  variant = 'info',
}: {
  children: ReactNode
  variant?: 'info' | 'warn' | 'ok'
}) {
  return <div className={`callout${variant !== 'info' ? ` ${variant}` : ''}`}>{children}</div>
}

export function ChoiceCard({
  title,
  description,
  selected,
  onClick,
  acronym,
  disabled,
}: {
  title: string
  description?: string
  selected?: boolean
  onClick?: () => void
  /** Legacy acronym — shown small and muted, no “aka” wording */
  acronym?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className={`choice-card${selected ? ' selected' : ''}`}
      onClick={onClick}
      disabled={disabled}
      style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
    >
      <h3>
        {title}
        {acronym && <span className="acronym">{acronym}</span>}
      </h3>
      {description && <p>{description}</p>}
    </button>
  )
}

export function ToggleRow({
  checked,
  onChange,
  title,
  description,
  acronym,
  disabled,
  help,
  helpDiagram,
  collapsible,
  defaultExpanded = true,
  children,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  title: string
  description: string
  /** Legacy acronym — shown small and muted, no “aka” wording */
  acronym?: string
  disabled?: boolean
  help?: string
  helpDiagram?: ReactNode
  /** Collapse nested content; open by default */
  collapsible?: boolean
  defaultExpanded?: boolean
  /** Nested options under this row (not dimmed when parent is disabled) */
  children?: ReactNode
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const showBody = !!children && (!collapsible || expanded)

  const main = (
    <label
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.75rem',
        flex: 1,
        ...(disabled && children ? { opacity: 0.55 } : undefined),
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div>
        <strong>
          {title}
          {acronym && <span className="acronym">{acronym}</span>}
          {help && <HelpTip text={help} diagram={helpDiagram} />}
        </strong>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--hv-text-subtle)' }}>
          {description}
        </p>
      </div>
    </label>
  )

  return (
    <div
      className="toggle-row"
      style={{
        ...(disabled && !children ? { opacity: 0.55 } : undefined),
        ...(children
          ? { flexDirection: 'column', alignItems: 'stretch', gap: '0.75rem' }
          : undefined),
      }}
    >
      <div className="toggle-row-head">
        {main}
        {collapsible && children ? (
          <button
            type="button"
            className="toggle-row-collapse"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded ? 'Hide details' : 'Show details'}
          </button>
        ) : null}
      </div>
      {showBody && (
        <div className="toggle-row-body">
          {children}
        </div>
      )}
    </div>
  )
}

function copyTextPreservingNewlines(text: string): Promise<void> {
  // Prefer Clipboard API; fall back to a textarea so newlines are not collapsed.
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text)
  }
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    try {
      if (!document.execCommand('copy')) reject(new Error('copy failed'))
      else resolve()
    } catch (e) {
      reject(e)
    } finally {
      document.body.removeChild(ta)
    }
  })
}

export function downloadTextFile(filename: string, content: string, mime = 'text/plain') {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  return (
    <button
      type="button"
      className="btn btn-secondary"
      onClick={async () => {
        try {
          await copyTextPreservingNewlines(text)
        } catch {
          // Clipboard may be blocked (e.g. insecure context / IDE webview) — download instead.
          downloadTextFile('copied.txt', text)
        }
      }}
    >
      {label}
    </button>
  )
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a21.8 21.8 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A10.94 10.94 0 0 1 12 5c7 0 11 7 11 7a21.8 21.8 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 0 1-4.24-4.24" />
      <path d="M1 1l22 22" />
    </svg>
  )
}

function ClipboardIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function flattenCopyText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flattenCopyText).join('')
  return ''
}

/** Code / YAML preview with a top-right copy icon (docs-style). */
export function CodeBlock({
  text,
  children,
  className = 'code-block',
  style,
}: {
  /** Text copied to clipboard. Defaults to string children. */
  text?: string
  children?: ReactNode
  className?: string
  style?: CSSProperties
}) {
  const [copied, setCopied] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const display = children ?? text
  const copyValue = text ?? flattenCopyText(children).trim()

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current)
    }
  }, [])

  const { maxHeight, marginTop, marginBottom, margin, ...restStyle } = style ?? {}
  const wrapStyle: CSSProperties = {
    ...(margin !== undefined ? { margin } : null),
    ...(marginTop !== undefined ? { marginTop } : null),
    ...(marginBottom !== undefined ? { marginBottom } : null),
  }

  return (
    <div className="code-block-wrap" style={Object.keys(wrapStyle).length ? wrapStyle : undefined}>
      <pre
        className={className}
        style={{
          ...restStyle,
          ...(maxHeight !== undefined ? { maxHeight } : null),
        }}
      >
        {display}
      </pre>
      <button
        type="button"
        className={`code-block-copy${copied ? ' copied' : ''}`}
        aria-label={copied ? 'Copied' : 'Copy to clipboard'}
        title={copied ? 'Copied' : 'Copy'}
        disabled={!copyValue}
        onClick={async () => {
          if (!copyValue) return
          try {
            await copyTextPreservingNewlines(copyValue)
          } catch {
            downloadTextFile('copied.txt', copyValue)
          }
          setCopied(true)
          if (resetTimer.current) clearTimeout(resetTimer.current)
          resetTimer.current = setTimeout(() => setCopied(false), 1600)
        }}
      >
        {copied ? <CheckIcon /> : <ClipboardIcon />}
      </button>
    </div>
  )
}

export function DownloadButton({
  filename,
  content,
  label = 'Download',
  mime,
}: {
  filename: string
  content: string
  label?: string
  mime?: string
}) {
  return (
    <button
      type="button"
      className="btn btn-secondary"
      onClick={() => downloadTextFile(filename, content, mime)}
    >
      {label}
    </button>
  )
}
