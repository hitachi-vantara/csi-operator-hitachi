import { useEffect, useState } from 'react'
import type { SiteId } from '../catalog/sites'
import { persistSiteTabFocus, readStoredSite } from './siteTabFocus'
import { useWizard } from './WizardContext'

/** Primary/Secondary site tab, honoring a one-shot focus from Review/Replication jumps. */
export function useSiteTab(replicationOn: boolean): [SiteId, (site: SiteId) => void] {
  const { siteTabFocus, clearSiteTabFocus } = useWizard()
  const [site, setSite] = useState<SiteId>(() => {
    if (siteTabFocus === 'primary' || siteTabFocus === 'secondary') return siteTabFocus
    return readStoredSite() ?? 'primary'
  })

  useEffect(() => {
    if (!replicationOn) return
    const focus =
      siteTabFocus === 'primary' || siteTabFocus === 'secondary' ? siteTabFocus : readStoredSite()
    if (focus) setSite(focus)
  }, [replicationOn, siteTabFocus])

  const selectSite = (next: SiteId) => {
    setSite(next)
    clearSiteTabFocus()
    persistSiteTabFocus(null)
  }

  return [site, selectSite]
}
