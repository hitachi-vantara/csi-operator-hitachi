import type { QuickstartConfig, SiteQuickstartConfig, WizardState } from './types'
import { getSiteStorage, withSiteStorage, type SiteId } from './sites'

export function siteQuickstartFromGlobal(qs: QuickstartConfig): SiteQuickstartConfig {
  return {
    install: true,
    pvcName: qs.pvcName,
    pvcSize: qs.pvcSize,
    storageClassName: qs.storageClassName,
    podName: qs.podName,
    accessMode: qs.accessMode,
    volumeMode: qs.volumeMode,
  }
}

function toQuickstartConfig(site: SiteQuickstartConfig): QuickstartConfig {
  return {
    pvcName: site.pvcName,
    pvcSize: site.pvcSize,
    storageClassName: site.storageClassName,
    podName: site.podName,
    accessMode: site.accessMode,
    volumeMode: site.volumeMode,
  }
}

export function quickstartInstalledForSite(state: WizardState, site: SiteId = 'primary'): boolean {
  if (!state.storageClassesEnabled) return false
  if (!state.components.replication) return true
  return getSiteStorage(state, site).quickstart?.install !== false
}

export function quickstartForSite(state: WizardState, site: SiteId = 'primary'): SiteQuickstartConfig {
  if (!state.components.replication) {
    return siteQuickstartFromGlobal(state.quickstart)
  }
  const stored = getSiteStorage(state, site).quickstart
  if (!stored) return siteQuickstartFromGlobal(state.quickstart)
  return stored
}

export function withSiteQuickstart(
  state: WizardState,
  site: SiteId,
  patch: Partial<SiteQuickstartConfig>,
): WizardState {
  if (!state.components.replication) {
    const { install: _install, ...qsPatch } = patch
    return { ...state, quickstart: { ...state.quickstart, ...qsPatch } }
  }
  const current = quickstartForSite(state, site)
  const next = { ...current, ...patch }
  let out = withSiteStorage(state, site, { ...getSiteStorage(state, site), quickstart: next })
  if (site === 'primary') {
    out = { ...out, quickstart: toQuickstartConfig(next) }
  }
  return out
}

export function applySiteQuickstartToState(state: WizardState, site: SiteId): WizardState {
  return {
    ...state,
    quickstart: toQuickstartConfig(quickstartForSite(state, site)),
  }
}
