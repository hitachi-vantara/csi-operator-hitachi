import type { ConsolePluginConfig, MetricsConfig, SiteMetricsConfig, WizardState } from './types'
import { getSiteStorage, pickStorageClassName, withSiteStorage, type SiteId } from './sites'

export function siteMetricsFromGlobal(
  metrics: MetricsConfig,
  consolePlugin: ConsolePluginConfig,
): SiteMetricsConfig {
  return {
    install: true,
    namespace: metrics.namespace,
    secretName: metrics.secretName,
    deployPrometheus: metrics.deployPrometheus,
    deployGrafana: metrics.deployGrafana,
    enableDebugLog: metrics.enableDebugLog,
    maxBatchSize: metrics.maxBatchSize,
    maxWorkerCount: metrics.maxWorkerCount,
    pvcStorageClassName: metrics.pvcStorageClassName || '',
    existingPrometheusNamespace: consolePlugin.prometheusNamespace,
    existingPrometheusService: consolePlugin.prometheusService,
    existingPrometheusPort: consolePlugin.prometheusPort,
  }
}

function toMetricsConfig(site: SiteMetricsConfig, base: MetricsConfig): MetricsConfig {
  return {
    ...base,
    namespace: site.namespace,
    secretName: site.secretName,
    deployPrometheus: site.deployPrometheus,
    deployGrafana: site.deployGrafana,
    enableDebugLog: site.enableDebugLog,
    maxBatchSize: site.maxBatchSize,
    maxWorkerCount: site.maxWorkerCount,
    pvcStorageClassName: site.pvcStorageClassName,
  }
}

export function metricsInstalledForSite(state: WizardState, site: SiteId = 'primary'): boolean {
  if (!state.components.metrics) return false
  if (!state.components.replication) return true
  return getSiteStorage(state, site).metrics?.install !== false
}

export function metricsForSite(state: WizardState, site: SiteId = 'primary'): MetricsConfig {
  if (!state.components.replication) return state.metrics
  const stored = getSiteStorage(state, site).metrics
  if (!stored) {
    return toMetricsConfig(siteMetricsFromGlobal(state.metrics, state.consolePlugin), state.metrics)
  }
  return toMetricsConfig(stored, state.metrics)
}

export function withSiteMetrics(
  state: WizardState,
  site: SiteId,
  patch: Partial<SiteMetricsConfig>,
): WizardState {
  if (!state.components.replication) {
    const {
      install: _install,
      existingPrometheusNamespace,
      existingPrometheusService,
      existingPrometheusPort,
      ...metricsPatch
    } = patch
    const nextMetrics = { ...state.metrics, ...metricsPatch }
    let consolePlugin = state.consolePlugin
    if (existingPrometheusNamespace !== undefined) {
      consolePlugin = { ...consolePlugin, prometheusNamespace: existingPrometheusNamespace }
    }
    if (existingPrometheusService !== undefined) {
      consolePlugin = { ...consolePlugin, prometheusService: existingPrometheusService }
    }
    if (existingPrometheusPort !== undefined) {
      consolePlugin = { ...consolePlugin, prometheusPort: existingPrometheusPort }
    }
    if (patch.deployPrometheus === true || (nextMetrics.deployPrometheus && patch.namespace)) {
      consolePlugin = {
        ...consolePlugin,
        prometheusNamespace: nextMetrics.namespace,
        prometheusService: 'prometheus',
        prometheusPort: '9090',
      }
    }
    return { ...state, metrics: nextMetrics, consolePlugin }
  }
  const current = getSiteStorage(state, site)
  const base = current.metrics ?? siteMetricsFromGlobal(state.metrics, state.consolePlugin)
  return withSiteStorage(state, site, { ...current, metrics: { ...base, ...patch } })
}

export function resolvedMetricsPvcStorageClassName(
  state: WizardState,
  site: SiteId = 'primary',
): string {
  if (!state.storageClassesEnabled) return 'hitachi-csi'
  const classes = state.components.replication
    ? getSiteStorage(state, site).storageClasses
    : state.storageClasses || []
  const pin = metricsForSite(state, site).pvcStorageClassName
  return pickStorageClassName(classes, pin)
}

/** After `applySiteMetricsToState`, metrics pin and StorageClasses are already site-local. */
export function resolvedFlattenedMetricsPvcStorageClassName(state: WizardState): string {
  if (!state.storageClassesEnabled) return 'hitachi-csi'
  return pickStorageClassName(state.storageClasses || [], state.metrics.pvcStorageClassName)
}

export function copyPrimarySiteMetricsToTopLevel(state: WizardState): WizardState {
  const siteMetrics = state.sites?.primary?.metrics
  if (!siteMetrics) return state

  const metrics: MetricsConfig = {
    ...state.metrics,
    namespace: siteMetrics.namespace,
    secretName: siteMetrics.secretName,
    deployPrometheus: siteMetrics.deployPrometheus,
    deployGrafana: siteMetrics.deployGrafana,
    enableDebugLog: siteMetrics.enableDebugLog,
    maxBatchSize: siteMetrics.maxBatchSize,
    maxWorkerCount: siteMetrics.maxWorkerCount,
    pvcStorageClassName: siteMetrics.pvcStorageClassName,
  }

  const consolePlugin: ConsolePluginConfig = siteMetrics.deployPrometheus
    ? {
        ...state.consolePlugin,
        prometheusNamespace: siteMetrics.namespace,
        prometheusService: 'prometheus',
        prometheusPort: '9090',
      }
    : {
        ...state.consolePlugin,
        prometheusNamespace: siteMetrics.existingPrometheusNamespace,
        prometheusService: siteMetrics.existingPrometheusService,
        prometheusPort: siteMetrics.existingPrometheusPort,
      }

  return { ...state, metrics, consolePlugin }
}

export function prometheusTargetForSite(
  state: WizardState,
  site: SiteId = 'primary',
): { namespace: string; service: string; port: string } {
  if (!metricsInstalledForSite(state, site)) {
    const stored = state.components.replication
      ? getSiteStorage(state, site).metrics
      : undefined
    return {
      namespace: stored?.existingPrometheusNamespace ?? state.consolePlugin.prometheusNamespace,
      service: stored?.existingPrometheusService ?? state.consolePlugin.prometheusService,
      port: stored?.existingPrometheusPort ?? state.consolePlugin.prometheusPort,
    }
  }
  const m = metricsForSite(state, site)
  if (m.deployPrometheus) {
    return { namespace: m.namespace, service: 'prometheus', port: '9090' }
  }
  const stored = state.components.replication
    ? getSiteStorage(state, site).metrics
    : undefined
  return {
    namespace: stored?.existingPrometheusNamespace ?? state.consolePlugin.prometheusNamespace,
    service: stored?.existingPrometheusService ?? state.consolePlugin.prometheusService,
    port: stored?.existingPrometheusPort ?? state.consolePlugin.prometheusPort,
  }
}

export function applySiteMetricsToState(state: WizardState, site: SiteId): WizardState {
  const target = prometheusTargetForSite(state, site)
  const metrics = {
    ...metricsForSite(state, site),
    storages: state.components.replication ? [] : state.metrics.storages,
  }
  return {
    ...state,
    metrics,
    components: {
      ...state.components,
      metrics: state.components.metrics && metricsInstalledForSite(state, site),
    },
    consolePlugin: {
      ...state.consolePlugin,
      prometheusNamespace: target.namespace,
      prometheusService: target.service,
      prometheusPort: target.port,
    },
  }
}
