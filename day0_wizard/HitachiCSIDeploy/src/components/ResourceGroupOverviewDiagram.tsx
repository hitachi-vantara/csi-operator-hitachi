/**
 * Theme-aware resource group helper.
 * Diagram 1: one cluster, two Secrets, shared Meta resource.
 * Diagram 2: two storage users. The pool belongs to resource group 2.
 */

function overviewLabels(resourceGroupID?: string): { thisLabel: string; otherLabel: string } {
  const trimmed = (resourceGroupID || '').trim()
  if (!trimmed) return { thisLabel: 'Resource group 1', otherLabel: 'Resource group 2' }
  if (trimmed === '2') return { thisLabel: 'Resource group 2', otherLabel: 'Resource group 1' }
  return { thisLabel: `Resource group ${trimmed}`, otherLabel: 'Resource group 2' }
}

function GroupCard({
  x,
  y,
  title,
  lines,
  tone,
}: {
  x: number
  y: number
  title: string
  lines: string[]
  tone: 'primary' | 'secondary' | 'plain'
}) {
  const toneClass =
    tone === 'primary' ? 'rp-diagram-rg-primary' : tone === 'secondary' ? 'rp-diagram-rg-secondary' : 'rp-diagram-card'
  return (
    <g className={toneClass}>
      <rect x={x} y={y} width="188" height={36 + lines.length * 18} rx="8" />
      <text x={x + 94} y={y + 20} textAnchor="middle" className="rp-diagram-card-title" style={{ fontSize: 10 }}>
        {title}
      </text>
      {lines.map((line, index) => (
        <text
          key={line}
          x={x + 94}
          y={y + 40 + index * 16}
          textAnchor="middle"
          className="rp-diagram-muted"
          style={line.length > 28 ? { fontSize: 8 } : undefined}
        >
          {line}
        </text>
      ))}
    </g>
  )
}

const SECRETS_ARIA =
  'One cluster can use more than one resource group. This Secret selects one resource group. Another Secret in the same cluster selects a different resource group. LDEV IDs and host groups stay in each resource group. Pools and ports in the Meta resource are shared. A pool belongs to one group.'

function SecretsDiagram({ resourceGroupID }: { resourceGroupID?: string }) {
  const { thisLabel, otherLabel } = overviewLabels(resourceGroupID)
  return (
    <svg className="rp-diagram" viewBox="0 0 640 304" role="img" aria-label={SECRETS_ARIA}>
      <defs>
        <marker id="rg-secret-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" className="rp-diagram-marker-data" />
        </marker>
      </defs>
      <rect x="0" y="0" width="640" height="304" rx="10" className="rp-diagram-bg" />
      <text x="320" y="18" textAnchor="middle" className="rp-diagram-title">
        Resource groups
      </text>
      <text x="320" y="34" textAnchor="middle" className="rp-diagram-muted">
        One cluster can use more than one resource group.
      </text>

      <rect x="12" y="44" width="616" height="70" rx="10" className="rp-diagram-cluster" />
      <text x="248" y="60" textAnchor="end" className="rp-diagram-card-title">
        Cluster
      </text>
      <text x="262" y="60" className="rp-diagram-muted">
        CSI Driver
      </text>
      <g className="rp-diagram-rg-primary">
        <rect x="28" y="68" width="280" height="40" rx="8" />
        <text x="168" y="84" textAnchor="middle" className="rp-diagram-card-title">
          This Secret
        </text>
        <text x="168" y="100" textAnchor="middle" className="rp-diagram-muted">
          {thisLabel}
        </text>
      </g>
      <g className="rp-diagram-rg-secondary">
        <rect x="332" y="68" width="280" height="40" rx="8" />
        <text x="472" y="84" textAnchor="middle" className="rp-diagram-card-title">
          Another Secret
        </text>
        <text x="472" y="100" textAnchor="middle" className="rp-diagram-muted">
          {otherLabel}
        </text>
      </g>

      <line
        x1="168"
        y1="108"
        x2="122"
        y2="164"
        className="rp-diagram-link-data"
        markerEnd="url(#rg-secret-arr)"
      />
      <text x="78" y="138" textAnchor="middle" className="rp-diagram-link-label" style={{ fontSize: 9 }}>
        provisions into
      </text>
      <line
        x1="472"
        y1="108"
        x2="320"
        y2="164"
        className="rp-diagram-link-data"
        markerEnd="url(#rg-secret-arr)"
      />
      <text x="520" y="138" textAnchor="middle" className="rp-diagram-link-label" style={{ fontSize: 9 }}>
        provisions into
      </text>

      <g className="rp-diagram-card">
        <rect x="12" y="152" width="616" height="140" rx="10" />
        <text x="28" y="168" className="rp-diagram-card-title">
          Array
        </text>
        <GroupCard x={28} y={176} title={thisLabel} lines={['LDEV IDs', 'Host groups']} tone="primary" />
        <GroupCard x={226} y={176} title={otherLabel} lines={['LDEV IDs', 'Host groups']} tone="secondary" />
        <GroupCard x={424} y={176} title="Meta resource" lines={['Shared pool', 'Shared ports']} tone="plain" />
        <line x1="122" y1="258" x2="518" y2="258" className="rp-diagram-link rp-diagram-link-dashed" />
        <text x="320" y="274" textAnchor="middle" className="rp-diagram-body">
          Pools and ports in the Meta resource are shared.
        </text>
        <text x="320" y="288" textAnchor="middle" className="rp-diagram-muted">
          A pool belongs to one group.
        </text>
      </g>
    </svg>
  )
}

const USERS_ARIA =
  'user 1 can access resource groups 1 and 2. user 2 can access resource group 2 only. The pool belongs to resource group 2. user 1 can provision into resource group 1 from that pool. user 2 can use it only for resource group 2. The Meta resource holds shared ports and shared host groups.'

function UsersDiagram() {
  return (
    <svg
      className="rp-diagram"
      viewBox="0 0 640 292"
      role="img"
      aria-label={USERS_ARIA}
      style={{ marginTop: '0.45rem' }}
    >
      <defs>
        <marker id="rg-user-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" className="rp-diagram-marker-data" />
        </marker>
      </defs>
      <rect x="0" y="0" width="640" height="292" rx="10" className="rp-diagram-bg" />
      <text x="320" y="18" textAnchor="middle" className="rp-diagram-title">
        Storage users
      </text>
      <text x="320" y="34" textAnchor="middle" className="rp-diagram-muted">
        A storage user can access one resource group, or more than one.
      </text>

      <g className="rp-diagram-rg-primary">
        <rect x="16" y="44" width="296" height="44" rx="8" />
        <text x="164" y="62" textAnchor="middle" className="rp-diagram-card-title">
          user 1
        </text>
        <text x="164" y="78" textAnchor="middle" className="rp-diagram-muted">
          resource groups 1 and 2
        </text>
      </g>
      <g className="rp-diagram-rg-secondary">
        <rect x="328" y="44" width="296" height="44" rx="8" />
        <text x="476" y="62" textAnchor="middle" className="rp-diagram-card-title">
          user 2
        </text>
        <text x="476" y="78" textAnchor="middle" className="rp-diagram-muted">
          resource group 2 only
        </text>
      </g>

      <line x1="120" y1="88" x2="122" y2="136" className="rp-diagram-link-data" markerEnd="url(#rg-user-arr)" />
      <line x1="208" y1="88" x2="300" y2="136" className="rp-diagram-link-data" markerEnd="url(#rg-user-arr)" />
      <line x1="476" y1="88" x2="360" y2="136" className="rp-diagram-link-data" markerEnd="url(#rg-user-arr)" />

      <g className="rp-diagram-card">
        <rect x="12" y="112" width="616" height="168" rx="10" />
        <text x="28" y="128" className="rp-diagram-card-title">
          Array
        </text>
        <GroupCard x={28} y={136} title="Resource group 1" lines={['LDEV IDs', 'Host groups']} tone="primary" />
        <GroupCard
          x={226}
          y={136}
          title="Resource group 2"
          lines={['LDEV IDs', 'Host groups', 'the pool that belongs to this group']}
          tone="secondary"
        />
        <GroupCard x={424} y={136} title="Meta resource" lines={['Shared ports', 'Shared host groups']} tone="plain" />
        <line x1="122" y1="232" x2="320" y2="232" className="rp-diagram-link rp-diagram-link-dashed" />
        <text x="320" y="248" textAnchor="middle" className="rp-diagram-body">
          The pool belongs to resource group 2.
        </text>
        <text x="320" y="262" textAnchor="middle" className="rp-diagram-muted">
          user 1 can provision into resource group 1 from that pool.
        </text>
        <text x="320" y="276" textAnchor="middle" className="rp-diagram-muted">
          user 2 can use it only for resource group 2.
        </text>
      </g>
    </svg>
  )
}

export function ResourceGroupOverviewDiagram({ resourceGroupID }: { resourceGroupID?: string }) {
  return (
    <>
      <SecretsDiagram resourceGroupID={resourceGroupID} />
      <UsersDiagram />
    </>
  )
}
