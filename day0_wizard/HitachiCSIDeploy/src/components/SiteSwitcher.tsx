import type { SiteId } from '../catalog/sites'

export function SiteSwitcher({
  site,
  onSiteChange,
  primaryReady,
  secondaryReady,
}: {
  site: SiteId
  onSiteChange: (site: SiteId) => void
  primaryReady: boolean
  secondaryReady: boolean
}) {
  return (
    <div className="site-switcher">
      <div className="site-switcher-label">Sites</div>
      <div className="site-switcher-tabs" role="tablist" aria-label="Sites">
        <SiteTab
          site="primary"
          label="Primary site"
          selected={site === 'primary'}
          ready={primaryReady}
          onSelect={onSiteChange}
        />
        <SiteTab
          site="secondary"
          label="Secondary site"
          selected={site === 'secondary'}
          ready={secondaryReady}
          onSelect={onSiteChange}
        />
      </div>
    </div>
  )
}

function SiteTab({
  site,
  label,
  selected,
  ready,
  onSelect,
}: {
  site: SiteId
  label: string
  selected: boolean
  ready: boolean
  onSelect: (site: SiteId) => void
}) {
  const needsAttention = !ready
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={`site-switcher-tab${selected ? ' active' : ''}${needsAttention ? ' needs-attention' : ''}`}
      onClick={() => onSelect(site)}
    >
      {label}
      {needsAttention ? <span className="badge warn">Needs attention</span> : null}
    </button>
  )
}
