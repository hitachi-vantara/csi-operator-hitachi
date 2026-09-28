/**
 * Theme-aware diagram for Replication resource partitioning.
 * Two sites, two arrays; each array has its own resource group (IDs need not match).
 * Serials, resource group IDs, and journals come from the wizard when filled in.
 */

export type ResourcePartitioningSite = {
  serial?: string
  resourceGroupID?: string
  journal?: string
}

function shown(value: string | undefined, empty: string): { text: string; pending: boolean } {
  const text = (value || '').trim()
  return text ? { text, pending: false } : { text: empty, pending: true }
}

function SiteArrayCard({
  x,
  cx,
  title,
  site,
}: {
  x: number
  cx: number
  title: string
  site: ResourcePartitioningSite
}) {
  const serial = shown(site.serial, 'Serial not set yet')
  const rg = shown(site.resourceGroupID, 'Resource group ID not set yet')
  const journal = shown(site.journal, 'Journal not set yet')
  return (
    <g className={`rp-diagram-rg ${cx < 320 ? 'rp-diagram-rg-primary' : 'rp-diagram-rg-secondary'}`}>
      <rect x={x} y="176" width="268" height="132" rx="10" />
      <text x={cx} y="196" textAnchor="middle" className="rp-diagram-card-title">
        {title}
      </text>
      <text
        x={cx}
        y="216"
        textAnchor="middle"
        className={serial.pending ? 'rp-diagram-muted' : 'rp-diagram-body'}
      >
        {serial.pending ? serial.text : `Serial ${serial.text}`}
      </text>
      <text
        x={cx}
        y="238"
        textAnchor="middle"
        className={rg.pending ? 'rp-diagram-muted' : 'rp-diagram-body'}
      >
        {rg.pending ? rg.text : `Resource group ID ${rg.text}`}
      </text>
      <text
        x={cx}
        y="256"
        textAnchor="middle"
        className={journal.pending ? 'rp-diagram-muted' : 'rp-diagram-body'}
      >
        {journal.pending ? journal.text : `Journal ${journal.text}`}
      </text>
      <text x={cx} y="278" textAnchor="middle" className="rp-diagram-muted">
        Host group spc-replication
      </text>
      <text x={cx} y="294" textAnchor="middle" className="rp-diagram-muted">
        All Replications on this array share this group
      </text>
    </g>
  )
}

export function ResourcePartitioningDiagram({
  primary = {},
  secondary = {},
}: {
  primary?: ResourcePartitioningSite
  secondary?: ResourcePartitioningSite
}) {
  const pSerial = (primary.serial || '').trim()
  const sSerial = (secondary.serial || '').trim()
  const pRg = (primary.resourceGroupID || '').trim()
  const sRg = (secondary.resourceGroupID || '').trim()
  const aria = [
    'Resource partitioning for Replication: primary and secondary clusters each use CSI Driver and Replication against a resource group on that site’s array.',
    pSerial || sSerial
      ? `Primary serial ${pSerial || 'not set'}, secondary serial ${sSerial || 'not set'}.`
      : '',
    pRg || sRg
      ? `Primary resource group ${pRg || 'not set'}, secondary resource group ${sRg || 'not set'}.`
      : '',
    'Journals and the spc-replication host group live in that resource group. Both sites must be configured.',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <svg
      className="rp-diagram"
      viewBox="0 0 640 348"
      role="img"
      aria-label={aria}
    >
      <defs>
        <marker
          id="rp-arrow"
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

      <rect x="0" y="0" width="640" height="348" rx="10" className="rp-diagram-bg" />

      <text x="320" y="22" textAnchor="middle" className="rp-diagram-title">
        Resource partitioning for Replication
      </text>
      <text x="320" y="38" textAnchor="middle" className="rp-diagram-muted">
        Each site uses a resource group on its own array — configure both sites
      </text>

      <text x="150" y="60" textAnchor="middle" className="rp-diagram-site">
        Primary site
      </text>
      <text x="506" y="60" textAnchor="middle" className="rp-diagram-site">
        Secondary site
      </text>

      <g className="rp-diagram-card">
        <rect x="16" y="68" width="268" height="86" rx="10" />
        <text x="150" y="88" textAnchor="middle" className="rp-diagram-card-title">
          Cluster
        </text>
        <text x="150" y="108" textAnchor="middle" className="rp-diagram-body">
          CSI Driver  ·  Replication
        </text>
        <text x="150" y="126" textAnchor="middle" className="rp-diagram-muted">
          Same storage user as CSI Driver
        </text>
        <text x="150" y="142" textAnchor="middle" className="rp-diagram-muted">
          Secret includes this array’s resource group ID
        </text>
      </g>
      <g className="rp-diagram-card">
        <rect x="372" y="68" width="268" height="86" rx="10" />
        <text x="506" y="88" textAnchor="middle" className="rp-diagram-card-title">
          Cluster
        </text>
        <text x="506" y="108" textAnchor="middle" className="rp-diagram-body">
          CSI Driver  ·  Replication
        </text>
        <text x="506" y="126" textAnchor="middle" className="rp-diagram-muted">
          Same storage user as CSI Driver
        </text>
        <text x="506" y="142" textAnchor="middle" className="rp-diagram-muted">
          Secret includes this array’s resource group ID
        </text>
      </g>

      <line x1="284" y1="111" x2="372" y2="111" className="rp-diagram-link" />
      <text x="330" y="102" textAnchor="middle" className="rp-diagram-link-label">
        Control Path
      </text>

      <line x1="150" y1="154" x2="150" y2="176" className="rp-diagram-link" markerEnd="url(#rp-arrow)" />
      <line x1="506" y1="154" x2="506" y2="176" className="rp-diagram-link" markerEnd="url(#rp-arrow)" />

      <SiteArrayCard x={16} cx={150} title="Primary array" site={primary} />
      <SiteArrayCard x={372} cx={506} title="Secondary array" site={secondary} />

      <line x1="284" y1="242" x2="372" y2="242" className="rp-diagram-link" />
      <text x="330" y="233" textAnchor="middle" className="rp-diagram-link-label">
        Replication Path
      </text>

      <text x="330" y="332" textAnchor="middle" className="rp-diagram-muted">
        One-sided resource partitioning is not supported
      </text>
    </svg>
  )
}
