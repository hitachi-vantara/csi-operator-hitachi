import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { HeaderMoreMenu } from './components/HeaderMoreMenu'
import { ThemeControls } from './components/ThemeControls'
import { UiModeControls } from './components/UiModeControls'
import { WelcomeModal, shouldShowWelcome } from './components/WelcomeModal'
import { useTheme } from './state/ThemeContext'
import { useUiMode } from './state/UiModeContext'
import {
  needsNoReplicationStorageClassConfirm,
  quickstartPvcSizeInvalidFix,
  replicationContinueInvalidFix,
  storageArtifactsContinueInvalidFix,
  storageArtifactsValidForContinue,
  storageSystemsContinueInvalidFix,
  storageSystemsValidForContinue,
  wizardFixCta,
} from './catalog/validation'
import { useWizard } from './state/WizardContext'
import { buildNavEntries, footerStepLabel, type NavEntry } from './state/steps'
import { PlatformStep } from './steps/PlatformStep'
import { ComponentsStep } from './steps/ComponentsStep'
import {
  PrerequisitesChecklistStep,
  PrerequisitesMultipathStep,
} from './steps/PrerequisitesStep'
import { StorageStep } from './steps/StorageStep'
import { StorageClassesStep } from './steps/StorageClassesStep'
import { ReplicationStep } from './steps/ReplicationStep'
import { MetricsStep } from './steps/MetricsStep'
import { ConsolePluginStep } from './steps/ConsolePluginStep'
import { QuickstartStep } from './steps/QuickstartStep'
import { ExportStep } from './steps/ExportStep'

const REPO_ISSUES_URL = 'https://github.com/cmccuistion-hv/HitachiCSIDeploy/issues'

function HeaderIcon({
  children,
}: {
  children: ReactNode
}) {
  return (
    <svg
      className="header-action-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

function renderSidebarNav(
  navEntries: NavEntry[],
  visibleSteps: { id: string }[],
  setStepIndex: (i: number) => void,
): ReactNode[] {
  const nodes: ReactNode[] = []
  let i = 0
  while (i < navEntries.length) {
    const entry = navEntries[i]
    if (entry.kind === 'parent') {
      const children: Extract<NavEntry, { kind: 'step' }>[] = []
      i += 1
      while (i < navEntries.length) {
        const next = navEntries[i]
        if (next.kind !== 'step' || !next.nested) break
        children.push(next)
        i += 1
      }
      nodes.push(
        <li key={`group-${entry.major}`} className="step-group-block">
          <div
            className={`step-item step-item-parent${entry.childActive ? ' child-active' : ''}${
              entry.done ? ' done' : ''
            }`}
            aria-hidden="true"
          >
            <span className="step-num">{entry.major}</span>
            <span className="step-label">
              <strong>{entry.title}</strong>
            </span>
          </div>
          <ol className="step-sublist">
            {children.map((child) => (
              <li key={visibleSteps[child.stepIndex]?.id ?? child.stepIndex}>
                <button
                  type="button"
                  className={`step-item nested${child.active ? ' active' : ''}${child.done ? ' done' : ''}`}
                  onClick={() => setStepIndex(child.stepIndex)}
                >
                  <span className="step-num">{child.label}</span>
                  <span className="step-label">
                    <strong>{child.title}</strong>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </li>,
      )
      continue
    }

    nodes.push(
      <li key={visibleSteps[entry.stepIndex]?.id ?? entry.stepIndex}>
        <button
          type="button"
          className={`step-item${entry.active ? ' active' : ''}${entry.done ? ' done' : ''}`}
          onClick={() => setStepIndex(entry.stepIndex)}
        >
          <span className="step-num">{entry.label}</span>
          <span className="step-label">
            <strong>{entry.title}</strong>
            <span>{entry.description}</span>
          </span>
        </button>
      </li>,
    )
    i += 1
  }
  return nodes
}

function StepBody({ id }: { id: string }) {
  switch (id) {
    case 'platform':
      return <PlatformStep />
    case 'components':
      return <ComponentsStep />
    case 'prerequisites-multipath':
      return <PrerequisitesMultipathStep />
    case 'prerequisites-checklist':
      return <PrerequisitesChecklistStep />
    case 'storage':
      return <StorageStep />
    case 'storageclasses':
      return <StorageClassesStep />
    case 'replication':
      return <ReplicationStep />
    case 'metrics':
      return <MetricsStep />
    case 'console':
      return <ConsolePluginStep />
    case 'quickstart':
      return <QuickstartStep />
    case 'export':
      return <ExportStep />
    default:
      return null
  }
}

export default function App() {
  const { state, visibleSteps, stepIndex, setStepIndex, exportConfig, importConfig, reset, goToFix } = useWizard()
  const { palette, mode, setPalette, setMode, headerLight } = useTheme()
  const { uiMode, setUiMode } = useUiMode()
  const current = visibleSteps[stepIndex]
  const importRef = useRef<HTMLInputElement>(null)
  const mainScrollRef = useRef<HTMLDivElement>(null)
  const noReplicationScRef = useRef<HTMLDialogElement>(null)
  const resetDialogRef = useRef<HTMLDialogElement>(null)
  const importErrorRef = useRef<HTMLDialogElement>(null)
  const stepPickerDialogRef = useRef<HTMLDialogElement>(null)
  const [welcomeOpen, setWelcomeOpen] = useState(() => shouldShowWelcome())
  const [noReplicationScOpen, setNoReplicationScOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [stepPickerOpen, setStepPickerOpen] = useState(false)
  const [sidebarInert, setSidebarInert] = useState(false)

  const navEntries = useMemo(
    () => buildNavEntries(visibleSteps, stepIndex),
    [visibleSteps, stepIndex],
  )
  const footerLabel = footerStepLabel(navEntries, stepIndex)
  const storageContinueBlocked =
    (current?.id === 'storageclasses' && !storageArtifactsValidForContinue(state)) ||
    (current?.id === 'storage' && !storageSystemsValidForContinue(state))
  const replicationContinueFix =
    current?.id === 'replication' ? replicationContinueInvalidFix(state) : null
  const replicationContinueBlocked = !!replicationContinueFix
  const quickstartContinueFix =
    current?.id === 'quickstart' ? quickstartPvcSizeInvalidFix(state) : null
  const continueBlocked =
    storageContinueBlocked || replicationContinueBlocked || !!quickstartContinueFix
  const isLastStep = stepIndex >= visibleSteps.length - 1
  const continueFix = continueBlocked
    ? current?.id === 'storage'
      ? storageSystemsContinueInvalidFix(state)
      : current?.id === 'storageclasses'
        ? storageArtifactsContinueInvalidFix(state)
        : current?.id === 'replication'
          ? replicationContinueFix
          : current?.id === 'quickstart'
            ? quickstartContinueFix
            : null
    : null

  useEffect(() => {
    const el = noReplicationScRef.current
    if (!el) return
    if (noReplicationScOpen) {
      if (!el.open) el.showModal()
    } else if (el.open) {
      el.close()
    }
  }, [noReplicationScOpen])

  useEffect(() => {
    const el = resetDialogRef.current
    if (!el) return
    if (resetOpen) {
      if (!el.open) el.showModal()
    } else if (el.open) {
      el.close()
    }
  }, [resetOpen])

  useEffect(() => {
    const el = importErrorRef.current
    if (!el) return
    if (importError) {
      if (!el.open) el.showModal()
    } else if (el.open) {
      el.close()
    }
  }, [importError])

  useEffect(() => {
    const el = stepPickerDialogRef.current
    if (!el) return
    if (stepPickerOpen) {
      if (!el.open) el.showModal()
    } else if (el.open) {
      el.close()
    }
  }, [stepPickerOpen])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 720px)')
    const syncSidebarInert = () => setSidebarInert(mq.matches)
    syncSidebarInert()
    mq.addEventListener('change', syncSidebarInert)
    return () => mq.removeEventListener('change', syncSidebarInert)
  }, [])

  const onPickStep = (index: number) => {
    setStepIndex(index)
    setStepPickerOpen(false)
  }

  const footerStepText =
    footerLabel ||
    `Step ${stepIndex + 1} of ${visibleSteps.length}${current ? ` — ${current.title}` : ''}`

  useEffect(() => {
    const el = mainScrollRef.current
    if (el) el.scrollTop = 0
    window.scrollTo(0, 0)
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
  }, [stepIndex, current?.id])

  const onImportFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        importConfig(String(reader.result || ''))
        setStepIndex(0)
      } catch {
        setImportError(
          'Could not import that file. Choose a hitachi-csi-wizard-config.json export from Save config or from a generated ZIP.',
        )
      }
    }
    reader.onerror = () => setImportError('Could not read the selected file.')
    reader.readAsText(file)
  }

  const logoSrc = headerLight
    ? './hitachi-vantara-logo.svg'
    : './hitachi-vantara-logo-white.svg'

  const onSaveConfig = () => {
    const blob = new Blob([exportConfig()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'hitachi-csi-wizard-config.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <img
            className="brand-logo"
            src={logoSrc}
            alt="Hitachi Vantara"
            width={201}
            height={28}
          />
          <span className="brand-divider" aria-hidden="true" />
          <div className="brand-product">
            <h1>CSI Deployment Wizard</h1>
          </div>
        </div>
        <div className="header-actions">
          <UiModeControls uiMode={uiMode} onUiMode={setUiMode} />
          <ThemeControls
            palette={palette}
            mode={mode}
            onPalette={setPalette}
            onMode={setMode}
          />
          <HeaderMoreMenu
            onAbout={() => setWelcomeOpen(true)}
            onImport={() => importRef.current?.click()}
            onSave={onSaveConfig}
            onReset={() => setResetOpen(true)}
            issuesUrl={REPO_ISSUES_URL}
          />
          <button
            type="button"
            className="btn btn-ghost header-action-desktop"
            title="About this wizard"
            aria-label="About this wizard"
            onClick={() => setWelcomeOpen(true)}
          >
            <HeaderIcon>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 10.5v6" />
              <circle cx="12" cy="7.5" r="0.85" fill="currentColor" stroke="none" />
            </HeaderIcon>
            <span className="header-action-label">About</span>
          </button>
          <a
            className="btn btn-ghost header-action-desktop"
            href={REPO_ISSUES_URL}
            target="_blank"
            rel="noopener noreferrer"
            title="Report issue"
            aria-label="Report issue"
          >
            <HeaderIcon>
              <path d="M7 8h10M7 12h7" />
              <path d="M6 4h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-5l-4 3v-3H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
            </HeaderIcon>
            <span className="header-action-label">Report issue</span>
          </a>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) onImportFile(file)
            }}
          />
          <button
            type="button"
            className="btn btn-ghost header-action-desktop"
            title="Import config"
            aria-label="Import config"
            onClick={() => importRef.current?.click()}
          >
            <HeaderIcon>
              <path d="M12 3v10" />
              <path d="m8 9 4 4 4-4" />
              <path d="M5 18h14" />
            </HeaderIcon>
            <span className="header-action-label">Import config</span>
          </button>
          <button
            type="button"
            className="btn btn-ghost header-action-desktop"
            title="Save config"
            aria-label="Save config"
            onClick={onSaveConfig}
          >
            <HeaderIcon>
              <path d="M12 15V5" />
              <path d="m8 9 4-4 4 4" />
              <path d="M5 18h14" />
            </HeaderIcon>
            <span className="header-action-label">Save config</span>
          </button>
          <button
            type="button"
            className="btn btn-ghost header-action-desktop"
            title="Reset wizard"
            aria-label="Reset wizard"
            onClick={() => setResetOpen(true)}
          >
            <HeaderIcon>
              <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
              <path d="M4.5 4.5v5h5" />
            </HeaderIcon>
            <span className="header-action-label">Reset wizard</span>
          </button>
        </div>
      </header>

      <aside className="app-sidebar" inert={sidebarInert || undefined}>
        <ol className="step-list">{renderSidebarNav(navEntries, visibleSteps, setStepIndex)}</ol>
      </aside>

      <main className="app-main">
        <div className="main-scroll" ref={mainScrollRef}>
          {current && <StepBody id={current.id} />}
        </div>
        <footer className="footer-bar">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={stepIndex === 0}
            onClick={() => setStepIndex(stepIndex - 1)}
          >
            Back
          </button>
          <div className="footer-center">
            {continueFix ? (
              <button
                type="button"
                className="footer-fix"
                onClick={() => goToFix(continueFix)}
              >
                {continueFix.message}
                <span className="footer-fix-cta">{wizardFixCta(continueFix)}</span>
              </button>
            ) : (
              <>
                <span className="footer-label-desktop">{footerStepText}</span>
                <button
                  type="button"
                  className="footer-step-picker"
                  onClick={() => setStepPickerOpen(true)}
                >
                  {footerStepText}
                </button>
              </>
            )}
          </div>
          {!isLastStep ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={continueBlocked}
              onClick={() => {
                if (
                  current?.id === 'storageclasses' &&
                  needsNoReplicationStorageClassConfirm(state)
                ) {
                  setNoReplicationScOpen(true)
                  return
                }
                setStepIndex(stepIndex + 1)
              }}
            >
              Continue
            </button>
          ) : null}
        </footer>
      </main>

      <WelcomeModal open={welcomeOpen} onClose={() => setWelcomeOpen(false)} />

      <dialog
        ref={stepPickerDialogRef}
        className="welcome-dialog step-picker-dialog"
        aria-labelledby="step-picker-title"
        onCancel={(e) => {
          e.preventDefault()
          setStepPickerOpen(false)
        }}
        onClick={(e) => {
          if (e.target === stepPickerDialogRef.current) setStepPickerOpen(false)
        }}
        onClose={() => setStepPickerOpen(false)}
      >
        <div className="welcome-dialog-body step-picker-dialog-body">
          <h2 id="step-picker-title">Choose a step</h2>
          <ol className="step-list">
            {renderSidebarNav(navEntries, visibleSteps, onPickStep)}
          </ol>
        </div>
      </dialog>

      <dialog
        ref={noReplicationScRef}
        className="welcome-dialog"
        aria-labelledby="no-replication-sc-title"
        onCancel={(e) => {
          e.preventDefault()
          setNoReplicationScOpen(false)
        }}
        onClick={(e) => {
          if (e.target === noReplicationScRef.current) setNoReplicationScOpen(false)
        }}
        onClose={() => setNoReplicationScOpen(false)}
      >
        <div className="welcome-dialog-body">
          <h2 id="no-replication-sc-title">No StorageClass marked for Replication</h2>
          <p>
            You enabled Replication, but no StorageClass has <strong>Use this StorageClass for
            Replication</strong> checked.
          </p>
          <p>
            The package will still install the Replication operator (and Disaster Recovery) on both
            sites. Without a StorageClass used for Replication on both sites — same name and filesystem
            type, each pointing at that site’s array — you cannot create replicated volumes from this
            package. You can add matching StorageClasses later, or go back and check the box on a
            standard StorageClass now.
          </p>
          <div className="welcome-actions" style={{ gap: '0.65rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setNoReplicationScOpen(false)}
            >
              Go back
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setNoReplicationScOpen(false)
                setStepIndex(stepIndex + 1)
              }}
            >
              Continue anyway
            </button>
          </div>
        </div>
      </dialog>

      <dialog
        ref={resetDialogRef}
        className="welcome-dialog"
        aria-labelledby="reset-wizard-title"
        onCancel={(e) => {
          e.preventDefault()
          setResetOpen(false)
        }}
        onClick={(e) => {
          if (e.target === resetDialogRef.current) setResetOpen(false)
        }}
        onClose={() => setResetOpen(false)}
      >
        <div className="welcome-dialog-body">
          <h2 id="reset-wizard-title">Reset wizard?</h2>
          <p>
            This clears your answers in this browser and returns to Platform. Download ZIP or Save
            config first if you still need this configuration.
          </p>
          <div className="welcome-actions" style={{ gap: '0.65rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setResetOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setResetOpen(false)
                reset()
              }}
            >
              Reset wizard
            </button>
          </div>
        </div>
      </dialog>

      <dialog
        ref={importErrorRef}
        className="welcome-dialog"
        aria-labelledby="import-error-title"
        onCancel={(e) => {
          e.preventDefault()
          setImportError(null)
        }}
        onClick={(e) => {
          if (e.target === importErrorRef.current) setImportError(null)
        }}
        onClose={() => setImportError(null)}
      >
        <div className="welcome-dialog-body">
          <h2 id="import-error-title">Could not import config</h2>
          <p>{importError}</p>
          <div className="welcome-actions" style={{ gap: '0.65rem' }}>
            <button type="button" className="btn btn-primary" onClick={() => setImportError(null)}>
              Close
            </button>
          </div>
        </div>
      </dialog>
    </div>
  )
}
