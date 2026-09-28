import { describe, expect, it } from 'vitest'
import { filledReplicationState, filledState } from '../test/fixtures'
import {
  applySiteMetricsToState,
  copyPrimarySiteMetricsToTopLevel,
  displayMetricsStorages,
  patchSingleSiteMetricsStorage,
  metricsForSite,
  metricsInstalledForSite,
  prometheusTargetForSite,
  resolvedMetricsPvcStorageClassName,
  resolvedMetricsStorages,
  withSiteMetrics,
} from './metrics'
import { ensureSitesForReplication, getSiteStorage } from './sites'

describe('resolvedMetricsStorages', () => {
  it('uses storage systems when exporter credentials were never copied into metrics.storages', () => {
    const state = filledState({
      components: { metrics: true },
      metrics: { enabled: true, storages: [] },
    })

    expect(resolvedMetricsStorages(state)).toEqual([
      {
        serial: '400001',
        url: 'https://192.0.2.10',
        user: 'maintenance',
        password: 'fixture-password',
      },
    ])
  })

  it('includes every array on the cluster', () => {
    const base = filledState()
    const state = filledState({
      storageSystems: [
        base.storageSystems[0],
        {
          ...base.storageSystems[0],
          id: 'storage-2',
          name: 'array-2',
          serial: '400099',
          url: 'https://192.0.2.99',
        },
      ],
      metrics: { storages: [] },
    })

    expect(resolvedMetricsStorages(state).map((storage) => storage.serial)).toEqual([
      '400001',
      '400099',
    ])
  })

  it('keeps explicit exporter credentials on a single-site package', () => {
    const state = filledState({
      metrics: {
        storages: [
          {
            serial: '999999',
            url: 'https://metrics.example',
            user: 'metrics',
            password: 'other-password',
          },
        ],
      },
    })

    expect(resolvedMetricsStorages(state)).toEqual([
      {
        serial: '999999',
        url: 'https://metrics.example',
        user: 'metrics',
        password: 'other-password',
      },
    ])
  })

  it('empty leftover rows do not block display pull from storage systems', () => {
    const state = filledState({
      metrics: {
        storages: [{ serial: '', url: '', user: '', password: '' }],
      },
    })

    expect(displayMetricsStorages(state)).toEqual([
      {
        serial: '400001',
        url: 'https://192.0.2.10',
        user: 'maintenance',
        password: 'fixture-password',
      },
    ])
  })

  it('user/password-only leftover does not empty resolved exporter credentials', () => {
    const state = filledState({
      metrics: {
        storages: [{ serial: '', url: '', user: 'leftover', password: 'leftover' }],
      },
    })

    expect(resolvedMetricsStorages(state)).toEqual([
      {
        serial: '400001',
        url: 'https://192.0.2.10',
        user: 'maintenance',
        password: 'fixture-password',
      },
    ])
  })

  it('new arrays still appear after a one-row exporter override', () => {
    const base = filledState()
    const state = filledState({
      storageSystems: [
        base.storageSystems[0],
        {
          ...base.storageSystems[0],
          id: 'storage-2',
          name: 'array-2',
          serial: '400099',
          url: 'https://192.0.2.99',
        },
      ],
      metrics: {
        storages: [
          {
            serial: '999999',
            url: 'https://metrics.example',
            user: 'metrics',
            password: 'other-password',
          },
        ],
      },
    })

    expect(resolvedMetricsStorages(state).map((storage) => storage.serial)).toEqual([
      '999999',
      '400099',
    ])
    expect(displayMetricsStorages(state).map((storage) => storage.serial)).toEqual([
      '999999',
      '400099',
    ])
  })

  it('editing one exporter row does not freeze other storage systems', () => {
    const base = filledState()
    const state = filledState({
      storageSystems: [
        base.storageSystems[0],
        {
          ...base.storageSystems[0],
          id: 'storage-2',
          name: 'array-2',
          serial: '400002',
          url: 'https://192.0.2.99',
        },
      ],
      metrics: { storages: [] },
    })

    const patched = patchSingleSiteMetricsStorage(state, 0, { password: 'exporter-only' })
    const updated = {
      ...patched,
      storageSystems: [
        patched.storageSystems[0],
        { ...patched.storageSystems[1], serial: '400888' },
      ],
    }

    expect(displayMetricsStorages(updated)[0]?.password).toBe('exporter-only')
    expect(displayMetricsStorages(updated)[1]?.serial).toBe('400888')
    expect(resolvedMetricsStorages(updated).map((s) => s.serial)).toEqual(['400001', '400888'])
  })

  it('storage-system serial change is live when that index is not an override', () => {
    const base = filledState()
    const state = filledState({
      metrics: { storages: [] },
      storageSystems: [{ ...base.storageSystems[0], serial: '400777' }],
    })

    expect(displayMetricsStorages(state)[0]?.serial).toBe('400777')
    expect(resolvedMetricsStorages(state)[0]?.serial).toBe('400777')
  })

  it('uses this cluster’s storage systems for Replication even if metrics.storages still holds primary credentials', () => {
    const primary = filledState().storageSystems[0]
    const state = filledReplicationState({
      components: { metrics: true },
      storageSystems: [
        {
          ...primary,
          id: 'storage-1-secondary',
          name: 'secondary',
          serial: '400002',
          url: 'https://192.0.2.11',
        },
      ],
      metrics: {
        enabled: true,
        storages: [
          {
            serial: '400001',
            url: 'https://192.0.2.10',
            user: 'maintenance',
            password: 'fixture-password',
          },
        ],
      },
    })

    expect(resolvedMetricsStorages(state).map((storage) => storage.serial)).toEqual(['400002'])
  })
})

describe('per-site metrics', () => {
  it('seeds both sites from top-level metrics without linking them', () => {
    const seeded = ensureSitesForReplication(
      filledState({
        components: { replication: true, disasterRecovery: true, metrics: true },
        metrics: { namespace: 'metrics-a', secretName: 'exp-a', maxWorkerCount: '4' },
      }),
    )
    expect(getSiteStorage(seeded, 'primary').metrics?.namespace).toBe('metrics-a')
    expect(getSiteStorage(seeded, 'secondary').metrics?.namespace).toBe('metrics-a')
    const patched = withSiteMetrics(seeded, 'primary', { namespace: 'metrics-primary' })
    expect(metricsForSite(patched, 'primary').namespace).toBe('metrics-primary')
    expect(metricsForSite(patched, 'secondary').namespace).toBe('metrics-a')
  })

  it('auto-selects PVC StorageClass and drops a pin that is no longer in the list', () => {
    const state = filledReplicationState({
      components: { metrics: true },
    })
    const withPin = withSiteMetrics(state, 'secondary', {
      pvcStorageClassName: 'does-not-exist',
    })
    expect(resolvedMetricsPvcStorageClassName(withPin, 'secondary')).toBe(
      getSiteStorage(withPin, 'secondary').storageClasses[0]?.name || 'hitachi-csi',
    )
  })

  it('points Console Plugin Prometheus at the site metrics namespace when Prometheus is included', () => {
    const state = withSiteMetrics(filledReplicationState({ components: { metrics: true } }), 'secondary', {
      namespace: 'sec-mon',
      deployPrometheus: true,
    })
    expect(prometheusTargetForSite(state, 'secondary')).toEqual({
      namespace: 'sec-mon',
      service: 'prometheus',
      port: '9090',
    })
  })

  it('copies primary site metrics onto top-level when Replication is turned off', () => {
    let state = withSiteMetrics(
      filledReplicationState({ components: { metrics: true, consolePlugin: true } }),
      'primary',
      {
        namespace: 'mon-primary',
        secretName: 'exp-primary',
        deployGrafana: true,
        deployPrometheus: false,
        maxWorkerCount: '7',
        pvcStorageClassName: 'hitachi-csi',
        existingPrometheusNamespace: 'existing-ns',
        existingPrometheusService: 'existing-svc',
        existingPrometheusPort: '8080',
      },
    )
    state = {
      ...state,
      components: { ...state.components, replication: false, disasterRecovery: false },
      replication: { ...state.replication, enabled: false, disasterRecovery: false },
    }
    const copied = copyPrimarySiteMetricsToTopLevel(state)
    expect(copied.metrics.namespace).toBe('mon-primary')
    expect(copied.metrics.secretName).toBe('exp-primary')
    expect(copied.metrics.deployGrafana).toBe(true)
    expect(copied.metrics.deployPrometheus).toBe(false)
    expect(copied.metrics.maxWorkerCount).toBe('7')
    expect(copied.metrics.pvcStorageClassName).toBe('hitachi-csi')
    expect(copied.consolePlugin.prometheusNamespace).toBe('existing-ns')
    expect(copied.consolePlugin.prometheusService).toBe('existing-svc')
    expect(copied.consolePlugin.prometheusPort).toBe('8080')
    expect(copied.metrics.storages).toBe(state.metrics.storages)
  })

  it('copies deployed Prometheus target onto consolePlugin when primary deployPrometheus is true', () => {
    let state = withSiteMetrics(
      filledReplicationState({ components: { metrics: true, consolePlugin: true } }),
      'primary',
      {
        namespace: 'mon-primary',
        deployPrometheus: true,
        existingPrometheusNamespace: 'hspc-monitoring-system',
        existingPrometheusService: 'legacy-svc',
        existingPrometheusPort: '8080',
      },
    )
    state = {
      ...state,
      components: { ...state.components, replication: false, disasterRecovery: false },
      replication: { ...state.replication, enabled: false, disasterRecovery: false },
    }
    const copied = copyPrimarySiteMetricsToTopLevel(state)
    expect(copied.metrics.deployPrometheus).toBe(true)
    expect(copied.consolePlugin.prometheusNamespace).toBe('mon-primary')
    expect(copied.consolePlugin.prometheusService).toBe('prometheus')
    expect(copied.consolePlugin.prometheusPort).toBe('9090')
  })

  it('copies existing Prometheus target onto consolePlugin when primary deployPrometheus is false', () => {
    let state = withSiteMetrics(
      filledReplicationState({ components: { metrics: true, consolePlugin: true } }),
      'primary',
      {
        deployPrometheus: false,
        existingPrometheusNamespace: 'ext-prom',
        existingPrometheusService: 'ext-svc',
        existingPrometheusPort: '9091',
      },
    )
    state = {
      ...state,
      components: { ...state.components, replication: false, disasterRecovery: false },
      replication: { ...state.replication, enabled: false, disasterRecovery: false },
    }
    const copied = copyPrimarySiteMetricsToTopLevel(state)
    expect(copied.metrics.deployPrometheus).toBe(false)
    expect(copied.consolePlugin.prometheusNamespace).toBe('ext-prom')
    expect(copied.consolePlugin.prometheusService).toBe('ext-svc')
    expect(copied.consolePlugin.prometheusPort).toBe('9091')
  })
})

describe('per-site metrics install', () => {
  it('treats a missing install flag as installed', () => {
    const state = filledReplicationState({ components: { metrics: true } })
    const stored = getSiteStorage(state, 'secondary').metrics
    expect(stored && 'install' in stored ? stored.install : undefined).not.toBe(false)
    expect(metricsInstalledForSite(state, 'secondary')).toBe(true)
    expect(metricsInstalledForSite(state, 'primary')).toBe(true)
  })

  it('returns false for a site when install is false', () => {
    const state = withSiteMetrics(
      filledReplicationState({ components: { metrics: true } }),
      'secondary',
      { install: false },
    )
    expect(metricsInstalledForSite(state, 'secondary')).toBe(false)
    expect(metricsInstalledForSite(state, 'primary')).toBe(true)
  })

  it('returns false for every site when the global Performance Metrics component is off', () => {
    const state = withSiteMetrics(
      filledReplicationState({ components: { metrics: false } }),
      'secondary',
      { install: true },
    )
    expect(metricsInstalledForSite(state, 'primary')).toBe(false)
    expect(metricsInstalledForSite(state, 'secondary')).toBe(false)
  })

  it('is true on a single-site package whenever the component is on', () => {
    const state = filledState({ components: { metrics: true, replication: false } })
    expect(metricsInstalledForSite(state, 'primary')).toBe(true)
  })

  it('uses existing Prometheus fields when the site is not installed, even if deployPrometheus is leftover true', () => {
    const state = withSiteMetrics(
      filledReplicationState({ components: { metrics: true, consolePlugin: true } }),
      'secondary',
      {
        install: false,
        deployPrometheus: true,
        namespace: 'mon-secondary',
        existingPrometheusNamespace: 'ext-ns',
        existingPrometheusService: 'ext-svc',
        existingPrometheusPort: '9091',
      },
    )
    expect(prometheusTargetForSite(state, 'secondary')).toEqual({
      namespace: 'ext-ns',
      service: 'ext-svc',
      port: '9091',
    })
  })

  it('keeps Prom/Grafana flags when install is turned off then on', () => {
    let state = withSiteMetrics(
      filledReplicationState({ components: { metrics: true } }),
      'secondary',
      { deployPrometheus: true, deployGrafana: true, namespace: 'keep-me' },
    )
    state = withSiteMetrics(state, 'secondary', { install: false })
    state = withSiteMetrics(state, 'secondary', { install: true })
    const metrics = metricsForSite(state, 'secondary')
    expect(metrics.deployPrometheus).toBe(true)
    expect(metrics.deployGrafana).toBe(true)
    expect(metrics.namespace).toBe('keep-me')
    expect(metricsInstalledForSite(state, 'secondary')).toBe(true)
  })

  it('does not map primary install: false onto components.metrics when copying back', () => {
    let state = withSiteMetrics(
      filledReplicationState({ components: { metrics: true, consolePlugin: true } }),
      'primary',
      { install: false, namespace: 'mon-primary' },
    )
    state = {
      ...state,
      components: { ...state.components, replication: false, disasterRecovery: false },
    }
    const copied = copyPrimarySiteMetricsToTopLevel(state)
    expect(copied.components.metrics).toBe(true)
    expect(copied.metrics.namespace).toBe('mon-primary')
  })

  it('clears components.metrics only on the flattened clone for a skipped site', () => {
    const state = withSiteMetrics(
      filledReplicationState({ components: { metrics: true } }),
      'secondary',
      { install: false },
    )
    const flattened = applySiteMetricsToState(state, 'secondary')
    expect(state.components.metrics).toBe(true)
    expect(flattened.components.metrics).toBe(false)
    expect(applySiteMetricsToState(state, 'primary').components.metrics).toBe(true)
  })
})
