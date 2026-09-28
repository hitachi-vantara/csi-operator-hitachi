import { useEffect, useRef } from 'react'
import { DOCS } from '../catalog/components'
import { STORAGE_KEY } from '../catalog/types'
import { WELCOME_SEEN_KEY } from '../catalog/help'
import { TopologyDiagram } from './TopologyDiagram'

function markSeen() {
  try {
    localStorage.setItem(WELCOME_SEEN_KEY, '1')
  } catch {
    /* ignore quota / private mode */
  }
}

function shouldShowWelcome(): boolean {
  try {
    if (localStorage.getItem(WELCOME_SEEN_KEY)) return false
    // Existing users mid-configuration: treat as seen, do not interrupt.
    if (localStorage.getItem(STORAGE_KEY)) {
      markSeen()
      return false
    }
  } catch {
    return false
  }
  return true
}

export function WelcomeModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    if (open) {
      if (!el.open) el.showModal()
      startedRef.current = false
    } else if (el.open) {
      el.close()
    }
  }, [open])

  const dismiss = () => {
    markSeen()
    onClose()
  }

  return (
    <dialog
      ref={dialogRef}
      className="welcome-dialog"
      aria-labelledby="welcome-title"
      onCancel={(e) => {
        e.preventDefault()
        dismiss()
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) dismiss()
      }}
      onClose={() => {
        if (!startedRef.current) markSeen()
        onClose()
      }}
    >
      <div className="welcome-dialog-body">
        <h2 id="welcome-title">Configure Hitachi Vantara CSI for your cluster</h2>
        <p>
          This browser configurator walks you through platform, storage, and optional Replication,
          Performance Metrics, and OpenShift Console Plugin, then generates install manifests and scripts.
          It does <strong>not</strong> connect to your cluster from this page.
        </p>
        <p className="welcome-boundary">
          This wizard runs in your browser. Answers stay on this device and are not sent to Hitachi
          Vantara servers.
        </p>
        <p>
          Simple view (default) asks for cluster and storage decisions; switch to Advanced in the header
          when you need to change namespaces, Secret names, or component versions.
        </p>

        {open && <TopologyDiagram />}

        <h3>What you get</h3>
        <ul>
          <li>
            Leave with a ready-to-run ZIP / <code>install.sh</code> tailored to your platform and components
          </li>
          <li>Correct defaults for OpenShift vs Kubernetes (namespaces, OperatorHub vs YAML)</li>
          <li>
            Built-in multipath and replication remote-kubeconfig packaging so you are not hunting sample
            YAMLs
          </li>
          <li>A sample PVC and Pod so you can confirm provisioning after install</li>
        </ul>

        <h3>What you will need</h3>
        <p>
          Cluster-admin access later (when you run the scripts), plus array REST credentials, serial, and
          pool IDs. If you enable Replication, you also need a second cluster and a second storage array
          attached there, with replication paths set up between the two Hitachi VSP storage arrays. Gather
          journal IDs as well — details a storage admin may already have.
        </p>

        <p className="welcome-boundary">
          This page only builds files. You download and apply them from a machine that can reach the
          cluster.
        </p>

        <p className="welcome-docs">
          Official guides:{' '}
          <a href={DOCS.hspc} target="_blank" rel="noreferrer">
            CSI Driver
          </a>
          {' · '}
          <a href={DOCS.hrpc} target="_blank" rel="noreferrer">
            Replication
          </a>
          {' · '}
          <a href={DOCS.hspp} target="_blank" rel="noreferrer">
            Performance Metrics
          </a>
        </p>

        <div className="welcome-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              startedRef.current = true
              dismiss()
            }}
          >
            Get started
          </button>
        </div>
      </div>
    </dialog>
  )
}

export { shouldShowWelcome }
