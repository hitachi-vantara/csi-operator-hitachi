/**
 * Theme-aware Replication architecture: two sites, Replication + DR operators,
 * remote kubeconfig, journals/copy. CSI Driver is present but de-emphasized.
 */

function SiteCluster({
  x,
  cx,
  title,
  clusterLabel,
}: {
  x: number
  cx: number
  title: string
  clusterLabel: string
}) {
  return (
    <g>
      <rect x={x} y="48" width="268" height="168" rx="12" className="rp-diagram-cluster" />
      <text x={cx} y="66" textAnchor="middle" className="rp-diagram-site">
        {title}
      </text>
      <text x={cx} y="80" textAnchor="middle" className="rp-diagram-muted">
        {clusterLabel}
      </text>

      <g className="rp-diagram-chip-ctrl">
        <rect x={x + 16} y="90" width="236" height="44" rx="8" />
        <text x={cx} y="108" textAnchor="middle" className="rp-diagram-chip-title">
          Replication operator
        </text>
        <text x={cx} y="124" textAnchor="middle" className="rp-diagram-chip-sub">
          TrueCopy / Universal Replicator
        </text>
      </g>

      <g className="rp-diagram-chip-dr">
        <rect x={x + 16} y="140" width="236" height="44" rx="8" />
        <text x={cx} y="158" textAnchor="middle" className="rp-diagram-chip-title">
          DR Operator
        </text>
        <text x={cx} y="174" textAnchor="middle" className="rp-diagram-chip-sub">
          Policies, failover, failback
        </text>
      </g>

      <g className="rp-diagram-pill">
        <rect x={x + 48} y="190" width="172" height="18" rx="9" />
        <text x={cx} y="203" textAnchor="middle" className="rp-diagram-link-label">
          CSI Driver — volumes
        </text>
      </g>
    </g>
  )
}

function ArrayBox({
  x,
  cx,
  title,
  tone,
}: {
  x: number
  cx: number
  title: string
  tone: 'primary' | 'secondary'
}) {
  return (
    <g className={tone === 'primary' ? 'rp-diagram-rg-primary' : 'rp-diagram-rg-secondary'}>
      <rect x={x} y="248" width="268" height="72" rx="10" />
      <text x={cx} y="270" textAnchor="middle" className="rp-diagram-card-title">
        {title}
      </text>
      <text x={cx} y="288" textAnchor="middle" className="rp-diagram-muted">
        Journal ID
      </text>
    </g>
  )
}

export function ReplicationArchitectureDiagram({
  clusterLabel = 'Kubernetes cluster',
}: {
  clusterLabel?: string
}) {
  return (
    <svg
      className="rp-diagram"
      viewBox="0 0 640 360"
      role="img"
      aria-label={`Replication architecture: a ${clusterLabel} at the primary site and another at the secondary site, each running the Replication operator and DR Operator. Sites exchange kubeconfigs. Journals and copy run between the two arrays. CSI Driver provisions volumes on each site.`}
    >
      <defs>
        <marker
          id="hrpc-arr"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M 0 0 L 10 5 L 0 10 Z" className="rp-diagram-marker" />
        </marker>
      </defs>

      <rect x="0" y="0" width="640" height="360" rx="10" className="rp-diagram-bg" />

      <text x="320" y="22" textAnchor="middle" className="rp-diagram-title">
        Replication architecture
      </text>
      <text x="320" y="38" textAnchor="middle" className="rp-diagram-muted">
        Two clusters — Replication operator and DR Operator on each site
      </text>

      <SiteCluster x={16} cx={150} title="Primary site" clusterLabel={clusterLabel} />
      <SiteCluster x={356} cx={490} title="Secondary site" clusterLabel={clusterLabel} />

      <line x1="284" y1="132" x2="356" y2="132" className="rp-diagram-link" />
      <text x="320" y="124" textAnchor="middle" className="rp-diagram-link-label">
        API Path
      </text>

      <line x1="150" y1="216" x2="150" y2="248" className="rp-diagram-link" markerEnd="url(#hrpc-arr)" />
      <line x1="490" y1="216" x2="490" y2="248" className="rp-diagram-link" markerEnd="url(#hrpc-arr)" />

      <ArrayBox x={16} cx={150} title="Primary array" tone="primary" />
      <ArrayBox x={356} cx={490} title="Secondary array" tone="secondary" />

      <line x1="284" y1="284" x2="356" y2="284" className="rp-diagram-link" />
      <text x="320" y="276" textAnchor="middle" className="rp-diagram-link-label">
        Replication Path
      </text>

      <text x="320" y="342" textAnchor="middle" className="rp-diagram-muted">
        Day-2 protection is managed with DR policies after install
      </text>
    </svg>
  )
}
