import type { SiteId } from '../catalog/sites'
import { STORAGE_SITE_FOCUS_KEY } from '../catalog/types'

export function readStoredSite(): SiteId | null {
  try {
    const focus = sessionStorage.getItem(STORAGE_SITE_FOCUS_KEY)
    if (focus === 'primary' || focus === 'secondary') return focus
  } catch {
    /* private mode */
  }
  return null
}

export function persistSiteTabFocus(site: SiteId | null) {
  try {
    if (site) sessionStorage.setItem(STORAGE_SITE_FOCUS_KEY, site)
    else sessionStorage.removeItem(STORAGE_SITE_FOCUS_KEY)
  } catch {
    /* private mode */
  }
}
