import { describe, expect, it } from 'vitest'
import { filledReplicationState, filledState } from '../test/fixtures'
import { withSiteMetrics } from './siteMetrics'
import { withSiteQuickstart } from './siteQuickstart'
import { buildReviewTopology, type ReviewTopologyModel } from './reviewTopology'
import type { StorageSystemConfig } from './types'

function metricsChip(model: ReviewTopologyModel, siteIndex = 0) {
  return model.sites[siteIndex].chips.flat().find((c) => c.label === 'Performance Metrics')
}

function extraArray(partial: Partial<StorageSystemConfig> & Pick<StorageSystemConfig, 'id' | 'name' | 'serial'>): StorageSystemConfig {
  return {
    ...filledState().storageSystems[0],
    url: 'https://192.0.2.11',
    csiSecretName: 'hitachi-csi-secret-2',
    ...partial,
  }
}

function gadState(extra?: StorageSystemConfig[]) {
  const base = filledState()
  const secondary = extraArray({ id: 'storage-2', name: 'secondary', serial: '400002' })
  return filledState({
    storageSystems: [base.storageSystems[0], secondary, ...(extra ?? [])],
    storageClasses: [
      {
        ...base.storageClasses[0],
        kind: 'stretched',
        name: 'hitachi-csi-stretched',
        storageSystemId: undefined,
        serialNumber: '',
        primaryStorageSystemId: 'storage-1',
        secondaryStorageSystemId: 'storage-2',
        primaryPoolID: '0',
        secondaryPoolID: '1',
        stretchedSecretName: 'hitachi-csi-secret-stretched',
      },
    ],
  })
}

describe('buildReviewTopology', () => {
  it('shows one array card for a single-array site', () => {
    const model = buildReviewTopology(filledState(), [])
    expect(model.sites).toHaveLength(1)
    expect(model.sites[0].arrays).toHaveLength(1)
    expect(model.sites[0].arrays[0].title).toContain('400001')
    expect(model.sites[0].arrays[0].pools[0]?.title).toBe('Pool 0')
  })

  it('shows both GAD arrays with their own pools', () => {
    const model = buildReviewTopology(gadState(), [])
    const site = model.sites[0]
    expect(site.arrays.map((a) => a.title)).toEqual(['Array 400001', 'Array 400002'])
    expect(site.arrays[0].pools.map((p) => p.title)).toEqual(['Pool 0'])
    expect(site.arrays[0].pools[0].extra).toMatch(/GAD primary/)
    expect(site.arrays[1].pools.map((p) => p.title)).toEqual(['Pool 1'])
    expect(site.arrays[1].pools[0].extra).toMatch(/GAD secondary/)
    expect(site.gadLinks).toEqual([
      { id: expect.any(String), fromSystemId: 'storage-1', toSystemId: 'storage-2' },
    ])
    expect(new Set(site.arrays.map((a) => a.id)).size).toBe(2)
    expect(site.arrays[0].pools[0].id).not.toBe(site.arrays[1].pools[0].id)
  })

  it('still lists an unused third array', () => {
    const unused = extraArray({
      id: 'storage-3',
      name: 'unused',
      serial: '400003',
      url: 'https://192.0.2.12',
      csiSecretName: 'hitachi-csi-secret-3',
    })
    const site = buildReviewTopology(gadState([unused]), []).sites[0]
    expect(site.arrays.map((a) => a.title)).toEqual(['Array 400001', 'Array 400002', 'Array 400003'])
    expect(site.arrays[2].pools).toEqual([])
  })

  it('shows a site-local extra array next to the Replication array', () => {
    const state = filledReplicationState()
    const extra = extraArray({
      id: 'storage-local',
      name: 'local',
      serial: '400099',
      url: 'https://192.0.2.99',
      csiSecretName: 'hitachi-csi-secret-local',
    })
    state.sites = {
      ...state.sites!,
      primary: {
        ...state.sites!.primary,
        storageSystems: [...state.sites!.primary.storageSystems, extra],
      },
    }
    const primary = buildReviewTopology(state, []).sites[0]
    expect(primary.arrays.map((a) => a.title)).toEqual(
      expect.arrayContaining(['Array 400001', 'Array 400099']),
    )
    expect(primary.arrays).toHaveLength(2)
  })

  it('points the test volume at the StorageClass array', () => {
    const site = buildReviewTopology(filledState(), []).sites[0]
    expect(site.testVolumeArrayIds).toEqual(['storage-1'])
  })

  it('points the test volume at both GAD arrays', () => {
    const site = buildReviewTopology(gadState(), []).sites[0]
    expect(site.testVolumeArrayIds).toEqual(['storage-1', 'storage-2'])
  })

  it('labels Performance Metrics as Prometheus only when Grafana is off', () => {
    const model = buildReviewTopology(
      filledState({
        components: { metrics: true },
        metrics: { deployPrometheus: true, deployGrafana: false },
      }),
      [],
    )
    expect(metricsChip(model)?.sub).toBe('Prometheus')
  })

  it('labels Performance Metrics from each site’s Prometheus/Grafana flags, not leftover top-level defaults', () => {
    let state = filledReplicationState({ components: { metrics: true } })
    expect(state.metrics.deployGrafana).toBe(true)
    state = withSiteMetrics(state, 'primary', { deployPrometheus: true, deployGrafana: false })
    state = withSiteMetrics(state, 'secondary', { deployPrometheus: false, deployGrafana: true })
    const model = buildReviewTopology(state, [])
    expect(metricsChip(model, 0)?.sub).toBe('Prometheus')
    expect(metricsChip(model, 1)?.sub).toBe('Grafana')
  })

  it('omits Performance Metrics on a Replication site that skipped the install', () => {
    let state = filledReplicationState({ components: { metrics: true } })
    state = withSiteMetrics(state, 'secondary', { install: false })
    const model = buildReviewTopology(state, [])
    expect(metricsChip(model, 0)).toBeDefined()
    expect(metricsChip(model, 1)).toBeUndefined()
  })

  it('omits Test volume chip on a Replication site that skipped the test volume', () => {
    let state = filledReplicationState()
    state = withSiteQuickstart(state, 'secondary', { install: false })
    const model = buildReviewTopology(state, [])
    expect(model.sites[0].testVolume).toBeDefined()
    expect(model.sites[1].testVolume).toBeUndefined()
    expect(model.hits['secondary:testvol']).toBeUndefined()
  })

  it('renders the Console Plugin as a filled chip like CSI Driver, not a hollow pill', () => {
    const model = buildReviewTopology(
      filledState({
        components: { metrics: true, consolePlugin: true },
        metrics: { deployPrometheus: true, deployGrafana: false },
      }),
      [],
    )
    const chips = model.sites[0].chips.flat()
    const consoleChip = chips.find((c) => c.id.endsWith(':console'))
    const driver = chips.find((c) => c.label === 'CSI Driver')
    expect(consoleChip).toMatchObject({
      label: 'Console Plugin',
      sub: 'OpenShift UI',
      tone: 'plugin',
    })
    expect(driver?.tone).toBe('ctrl')
    expect(metricsChip(model)?.tone).toBe('node')
    expect(consoleChip?.tone).not.toBe(driver?.tone)
    expect(consoleChip?.tone).not.toBe(metricsChip(model)?.tone)
  })
})
