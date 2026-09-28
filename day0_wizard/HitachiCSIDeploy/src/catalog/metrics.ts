import { getSiteStorage, type SiteId } from './sites'
import type { MetricsConfig, StorageSystemConfig, WizardState } from './types'

export {
  applySiteMetricsToState,
  copyPrimarySiteMetricsToTopLevel,
  metricsForSite,
  metricsInstalledForSite,
  prometheusTargetForSite,
  resolvedFlattenedMetricsPvcStorageClassName,
  resolvedMetricsPvcStorageClassName,
  siteMetricsFromGlobal,
  withSiteMetrics,
} from './siteMetrics'

export type MetricsStorage = MetricsConfig['storages'][number]

export function metricsStoragesFromSystems(systems: StorageSystemConfig[]): MetricsStorage[] {
  return systems.map((sys) => ({
    serial: sys.serial,
    url: sys.url,
    user: sys.user,
    password: sys.password,
  }))
}

function hasExporterOverride(storage: MetricsStorage | undefined): boolean {
  return Boolean(storage?.serial?.trim() || storage?.url?.trim())
}

function overlayMetricsStorages(
  systems: StorageSystemConfig[],
  overrides: MetricsStorage[],
): MetricsStorage[] {
  return metricsStoragesFromSystems(systems).map((fromSystem, i) =>
    hasExporterOverride(overrides[i]) ? overrides[i] : fromSystem,
  )
}

export function filledMetricsStorages(storages: MetricsStorage[]): MetricsStorage[] {
  return storages.filter((storage) => storage.serial.trim() || storage.url.trim())
}

/**
 * Exporter credentials for the current (possibly site-flattened) wizard state.
 * Replication packages always use this site's storage systems so a leftover
 * primary copy in metrics.storages is not applied to the secondary cluster.
 */
export function resolvedMetricsStorages(state: WizardState): MetricsStorage[] {
  if (state.components.replication) {
    return filledMetricsStorages(metricsStoragesFromSystems(state.storageSystems || []))
  }
  return filledMetricsStorages(
    overlayMetricsStorages(state.storageSystems || [], state.metrics.storages),
  )
}

const emptyMetricsStorage = (): MetricsStorage => ({
  serial: '',
  url: '',
  user: '',
  password: '',
})

export function patchSingleSiteMetricsStorage(
  state: WizardState,
  idx: number,
  patch: Partial<MetricsStorage>,
): WizardState {
  const systems = state.storageSystems || []
  const fromSystems = metricsStoragesFromSystems(systems)
  const overrides = state.metrics.storages
  const next = [...overrides]
  while (next.length <= idx) {
    next.push(emptyMetricsStorage())
  }
  const existing = next[idx]
  const base = hasExporterOverride(existing) ? existing : fromSystems[idx] ?? emptyMetricsStorage()
  next[idx] = { ...base, ...patch }
  return { ...state, metrics: { ...state.metrics, storages: next } }
}

/** Values shown on the Performance Metrics step (includes empty rows). */
export function displayMetricsStorages(state: WizardState, site: SiteId = 'primary'): MetricsStorage[] {
  if (state.components.replication) {
    return metricsStoragesFromSystems(getSiteStorage(state, site).storageSystems)
  }
  return overlayMetricsStorages(state.storageSystems || [], state.metrics.storages)
}
