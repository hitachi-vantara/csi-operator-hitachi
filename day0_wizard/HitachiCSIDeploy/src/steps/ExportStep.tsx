import { useEffect, useState } from 'react'
import JSZip from 'jszip'
import { DOCS, REPO } from '../catalog/components'
import { HELP } from '../catalog/help'
import { PLATFORMS } from '../catalog/platforms'
import {
  airGappedRegistryInvalidFix,
  consolePluginPrometheusWiringInvalidFix,
  quickstartPvcSizeInvalidFix,
  storageArtifactsInvalidFix,
  storageArtifactsValid,
  wizardFixCta,
} from '../catalog/validation'
import { wizardVersion } from '../wizardVersion'
import { buildNextSteps, nextStepsToMarkdown } from '../generator/nextSteps'
import { generateAll, type GeneratedFile } from '../generator/yaml'
import { ReviewTopologyDiagram } from '../components/ReviewTopologyDiagram'
import { useWizard } from '../state/WizardContext'
import { Callout, CodeBlock, Section } from '../components/ui'

export function ExportStep() {
  const { state, exportConfig, goToFix } = useWizard()
  const plat = PLATFORMS[state.platform]
  const [files, setFiles] = useState<GeneratedFile[]>([])
  const [generating, setGenerating] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [topoOpen, setTopoOpen] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setGenerating(true)
      try {
        const next = await generateAll(state)
        if (!cancelled) setFiles(next)
      } finally {
        if (!cancelled) setGenerating(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [state])

  const storageExportBlocked = !storageArtifactsValid(state)
  const storageExportFix = storageExportBlocked ? storageArtifactsInvalidFix(state) : null
  const consolePromFix = consolePluginPrometheusWiringInvalidFix(state)
  const airGappedFix = airGappedRegistryInvalidFix(state)
  const quickstartFix = quickstartPvcSizeInvalidFix(state)
  const exportBlocked =
    storageExportBlocked ||
    consolePromFix !== null ||
    airGappedFix !== null ||
    quickstartFix !== null
  const exportFix = storageExportFix ?? consolePromFix ?? airGappedFix ?? quickstartFix
  const nextSteps = buildNextSteps(state)

  const offlineReplicationRequired =
    state.components.replication && state.airGapped && Boolean(state.offline?.registryBase?.trim())
  const dualSite = files.some((f) => f.path.startsWith('primary/')) && files.some((f) => f.path.startsWith('secondary/'))
  const repPrefix = dualSite ? ['primary', 'secondary'] : ['']
  const requiredReplicationFiles = offlineReplicationRequired
    ? repPrefix.flatMap((p) => {
        const pre = p ? `${p}/` : ''
        return [
          `${pre}03-replication/hspc-replication-operator-namespace.yaml`,
          `${pre}03-replication/hspc-replication-operator.yaml`,
          `${pre}03-replication/cert-manager.yaml`,
          `${pre}03-replication/dr-operator-install.yaml`,
        ]
      })
    : []
  const missingOfflineReplication = requiredReplicationFiles.filter(
    (path) => !files.some((f) => f.path === path),
  )

  const downloadZip = async () => {
    setDownloading(true)
    try {
      // Always regenerate at click time so Secret/SC YAML match the latest Storage step edits.
      const latest = await generateAll(state)
      setFiles(latest)
      const zip = new JSZip()
      zip.file('VERSION', `${wizardVersion()}\n`)
      zip.file(
        'INSTALL.md',
        nextStepsToMarkdown(buildNextSteps(state), {
          platformDisplayName: plat.displayName,
          platformVersion: state.platformVersion,
          driverVersion: state.versions.driver,
        }),
      )
      zip.file('wizard-config.json', exportConfig())
      for (const f of latest) {
        zip.file(f.path, f.content)
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'hitachi-csi-deployment.zip'
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="step-panel">
      <h2>Review &amp; export</h2>
      <p className="lede">
        Download a complete ZIP package with next steps, manifests, and <code>install.sh</code>. Answers are
        saved in this browser for resume. <strong>Download ZIP</strong> rebuilds from your current answers —
        re-download after edits; an already-unzipped folder is not updated.
      </p>

      <Section
        title="Actions"
        actions={
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-success"
              disabled={exportBlocked || downloading || generating}
              onClick={() => void downloadZip()}
            >
              {downloading ? 'Building ZIP…' : 'Download ZIP'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                const blob = new Blob([exportConfig()], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = 'hitachi-csi-wizard-config.json'
                a.click()
                URL.revokeObjectURL(url)
              }}
            >
              Export config JSON
            </button>
          </div>
        }
      >
        {exportFix ? (
          <Callout variant="warn">
            <button
              type="button"
              className="callout-go"
              onClick={() => goToFix(exportFix)}
            >
              <span>{exportFix.message}</span>
              <span className="callout-go-cta">{wizardFixCta(exportFix)}</span>
            </button>
          </Callout>
        ) : missingOfflineReplication.length ? (
          <Callout variant="warn">
            WARNING: could not fetch some upstream Replication operator/DR YAML; re-export when GitHub is
            reachable.
          </Callout>
        ) : (
          <Callout variant="ok">
            Generated {files.length} files for <strong>{plat.displayName}</strong> / CSI Driver{' '}
            <strong>{state.versions.driver}</strong>
            {generating ? ' (updating preview…)' : ''}. Upstream templates:{' '}
            <a href={REPO.githubUrl} target="_blank" rel="noreferrer">
              {REPO.owner}/{REPO.name}
            </a>
          </Callout>
        )}
      </Section>

      <Section
        title="Your deployment"
        help={HELP.reviewTopology}
        actions={
          <button
            type="button"
            className="toggle-row-collapse"
            onClick={() => setTopoOpen((v) => !v)}
            aria-expanded={topoOpen}
          >
            {topoOpen ? 'Hide details' : 'Show details'}
          </button>
        }
      >
        {topoOpen ? (
          <ReviewTopologyDiagram state={state} files={files} />
        ) : (
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--hv-text-subtle)' }}>
            Show details to see the objects in this package and which files make each one.
          </p>
        )}
      </Section>

      <Section title="Next steps">
        <ol style={{ margin: 0, paddingLeft: '1.5rem' }}>
          {nextSteps.map((step) => (
            <li key={step.id} style={{ marginBottom: '1rem', paddingLeft: '0.25rem' }}>
              <strong>{step.title}</strong>
              <p style={{ margin: '0.35rem 0' }}>{step.body}</p>
              {step.command ? <CodeBlock text={step.command} style={{ marginTop: '0.5rem' }} /> : null}
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Documentation">
        <ul>
          <li>
            <a href={DOCS.hspc} target="_blank" rel="noreferrer">
              CSI Driver installation &amp; user guide
            </a>
          </li>
          <li>
            <a href={DOCS.hrpc} target="_blank" rel="noreferrer">
              Replication installation &amp; user guide
            </a>
          </li>
          <li>
            <a href={DOCS.hspp} target="_blank" rel="noreferrer">
              Performance Metrics installation &amp; user guide
            </a>
          </li>
        </ul>
      </Section>
    </div>
  )
}
