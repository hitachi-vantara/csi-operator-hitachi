/**
 * Theme-aware GAD stretched PVC: one cluster, two arrays, sync replication.
 * Array labels are Secret fields (family, serial, REST URL) — not wizard display names.
 */

import { STORAGE_FAMILIES, type StorageFamily } from '../catalog/platforms'

export type GadArrayInfo = {
  family?: StorageFamily
  serial: string
  url: string
}

function familyLabel(family?: StorageFamily): string {
  if (!family) return 'Family —'
  return STORAGE_FAMILIES.find((f) => f.id === family)?.label ?? family
}

function serialLabel(serial: string): string {
  const t = serial.trim()
  return t ? `Serial ${t}` : 'Serial —'
}

function urlLabel(url: string): string {
  const t = url.trim()
  if (!t) return 'URL —'
  return t.length > 32 ? `${t.slice(0, 30)}…` : t
}

function Volume({ cx, cy, label }: { cx: number; cy: number; label: string }) {
  return (
    <g className="rp-diagram-volume">
      <ellipse cx={cx} cy={cy} rx="52" ry="8" className="rp-diagram-volume-cap" />
      <rect x={cx - 52} y={cy} width="104" height="36" className="rp-diagram-volume-body" />
      <ellipse cx={cx} cy={cy + 36} rx="52" ry="8" className="rp-diagram-volume-cap" />
      <text x={cx} y={cy + 22} textAnchor="middle" className="rp-diagram-body">
        {label}
      </text>
    </g>
  )
}

function ArrayCard({
  x,
  role,
  info,
  tone,
}: {
  x: number
  role: string
  info: GadArrayInfo
  tone: 'primary' | 'secondary'
}) {
  return (
    <g className={tone === 'primary' ? 'rp-diagram-rg-primary' : 'rp-diagram-rg-secondary'}>
      <rect x={x} y="368" width="296" height="92" rx="10" />
      <text x={x + 148} y="388" textAnchor="middle" className="rp-diagram-card-title">
        {role}
      </text>
      <text x={x + 148} y="406" textAnchor="middle" className="rp-diagram-body">
        {familyLabel(info.family)}
      </text>
      <text x={x + 148} y="424" textAnchor="middle" className="rp-diagram-muted">
        {serialLabel(info.serial)}
      </text>
      <text x={x + 148} y="442" textAnchor="middle" className="rp-diagram-muted">
        {urlLabel(info.url)}
      </text>
    </g>
  )
}

export function GadStretchedPvcDiagram({
  clusterLabel = 'Kubernetes cluster',
  primary,
  secondary,
}: {
  clusterLabel?: string
  primary: GadArrayInfo
  secondary: GadArrayInfo
}) {
  return (
    <svg
      className="rp-diagram"
      viewBox="0 0 640 476"
      role="img"
      aria-label={`Stretched PVC (Global-Active Device) in one ${clusterLabel}: Site A and Site B workers, a csi-controller, one stretched PVC kept in sync across the primary and secondary arrays.`}
    >
      <rect x="0" y="0" width="640" height="476" rx="10" className="rp-diagram-bg" />

      <text x="320" y="18" textAnchor="middle" className="rp-diagram-title">
        Stretched PVC
      </text>
      <text x="320" y="34" textAnchor="middle" className="rp-diagram-muted">
        Global-Active Device — one cluster, two arrays, sync replication
      </text>

      <rect x="12" y="44" width="616" height="176" rx="12" className="rp-diagram-cluster" />
      <text x="320" y="62" textAnchor="middle" className="rp-diagram-site">
        {`Stretched ${clusterLabel}`}
      </text>

      <g className="rp-diagram-worker">
        <rect x="24" y="72" width="188" height="132" rx="10" />
        <text x="118" y="90" textAnchor="middle" className="rp-diagram-card-title">
          Site A
        </text>
        <text x="118" y="104" textAnchor="middle" className="rp-diagram-muted">
          Worker node
        </text>
        <g className="rp-diagram-chip-node">
          <rect x="40" y="114" width="156" height="44" rx="8" />
          <text x="118" y="132" textAnchor="middle" className="rp-diagram-chip-title">
            csi-node
          </text>
          <text x="118" y="148" textAnchor="middle" className="rp-diagram-chip-sub">
            CSI node
          </text>
        </g>
      </g>

      <g className="rp-diagram-worker">
        <rect x="226" y="72" width="188" height="132" rx="10" />
        <text x="320" y="90" textAnchor="middle" className="rp-diagram-card-title">
          Site B
        </text>
        <text x="320" y="104" textAnchor="middle" className="rp-diagram-muted">
          Worker node
        </text>
        <g className="rp-diagram-chip-node">
          <rect x="242" y="114" width="156" height="44" rx="8" />
          <text x="320" y="132" textAnchor="middle" className="rp-diagram-chip-title">
            csi-node
          </text>
          <text x="320" y="148" textAnchor="middle" className="rp-diagram-chip-sub">
            CSI node
          </text>
        </g>
      </g>

      <g className="rp-diagram-plane">
        <rect x="428" y="72" width="184" height="132" rx="10" />
        <text x="520" y="90" textAnchor="middle" className="rp-diagram-card-title">
          Control plane
        </text>
        <text x="520" y="104" textAnchor="middle" className="rp-diagram-muted">
          Deployment
        </text>
        <g className="rp-diagram-chip-ctrl">
          <rect x="442" y="114" width="156" height="44" rx="8" />
          <text x="520" y="132" textAnchor="middle" className="rp-diagram-chip-title">
            csi-controller
          </text>
          <text x="520" y="148" textAnchor="middle" className="rp-diagram-chip-sub">
            CSI controller
          </text>
        </g>
      </g>

      <g className="rp-diagram-card">
        <Volume cx={320} cy={248} label="Stretched PVC" />
      </g>
      <line x1="320" y1="292" x2="320" y2="312" className="rp-diagram-link-data" />
      <g className="rp-diagram-pill">
        <rect x="268" y="308" width="104" height="18" rx="9" />
        <text x="320" y="321" textAnchor="middle" className="rp-diagram-link-label">
          Sync replication
        </text>
      </g>
      <line x1="268" y1="317" x2="160" y2="368" className="rp-diagram-link-data" />
      <line x1="372" y1="317" x2="480" y2="368" className="rp-diagram-link-data" />

      <ArrayCard x={16} role="Primary" info={primary} tone="primary" />
      <ArrayCard x={328} role="Secondary" info={secondary} tone="secondary" />
    </svg>
  )
}
