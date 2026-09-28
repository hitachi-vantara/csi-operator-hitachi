import { describe, expect, it } from 'vitest'
import { filledReplicationState, filledState } from '../test/fixtures'
import { ensureSitesForReplication, getSiteStorage } from './sites'
import {
  applySiteQuickstartToState,
  quickstartForSite,
  quickstartInstalledForSite,
  withSiteQuickstart,
} from './siteQuickstart'

describe('per-site test volume', () => {
  it('seeds both sites from top-level quickstart on older Replication saves', () => {
    const state = filledReplicationState({
      quickstart: {
        pvcName: 'legacy-pvc',
        pvcSize: '2Gi',
        storageClassName: 'hitachi-csi',
        podName: 'legacy-pod',
        accessMode: 'ReadWriteOnce',
        volumeMode: 'Filesystem',
      },
    })
    for (const site of ['primary', 'secondary'] as const) {
      const qs = quickstartForSite(state, site)
      expect(qs.pvcName).toBe('legacy-pvc')
      expect(qs.podName).toBe('legacy-pod')
      expect(qs.install).toBe(true)
    }
  })

  it('keeps independent fields per site', () => {
    let state = filledReplicationState()
    state = withSiteQuickstart(state, 'primary', { pvcName: 'p-pvc', storageClassName: 'hitachi-csi' })
    state = withSiteQuickstart(state, 'secondary', {
      pvcName: 's-pvc',
      storageClassName: 'sc-b28',
      install: false,
    })
    expect(quickstartForSite(state, 'primary').pvcName).toBe('p-pvc')
    expect(quickstartForSite(state, 'secondary').pvcName).toBe('s-pvc')
    expect(quickstartInstalledForSite(state, 'primary')).toBe(true)
    expect(quickstartInstalledForSite(state, 'secondary')).toBe(false)
    expect(state.quickstart.pvcName).toBe('p-pvc')
  })

  it('is always installed on a single-site wizard when StorageClasses are on', () => {
    const state = filledState()
    expect(quickstartInstalledForSite(state, 'primary')).toBe(true)
    expect(quickstartInstalledForSite({ ...state, storageClassesEnabled: false }, 'primary')).toBe(
      false,
    )
  })

  it('flattens the site copy onto top-level quickstart for generate', () => {
    let state = filledReplicationState()
    state = withSiteQuickstart(state, 'secondary', { pvcName: 'sec-pvc', podName: 'sec-pod' })
    const flat = applySiteQuickstartToState(state, 'secondary')
    expect(flat.quickstart.pvcName).toBe('sec-pvc')
    expect(flat.quickstart.podName).toBe('sec-pod')
  })
})

describe('ensureSitesForReplication quickstart seeding', () => {
  it('ensureSitesForReplication writes site.quickstart from top-level when missing', () => {
    const state = ensureSitesForReplication(
      filledState({
        components: { replication: true, disasterRecovery: true },
        quickstart: {
          pvcName: 'seed-pvc',
          pvcSize: '1Gi',
          storageClassName: 'hitachi-csi',
          podName: 'seed-pod',
          accessMode: 'ReadWriteOnce',
          volumeMode: 'Filesystem',
        },
      }),
    )
    expect(getSiteStorage(state, 'primary').quickstart?.pvcName).toBe('seed-pvc')
    expect(getSiteStorage(state, 'secondary').quickstart?.install).toBe(true)
  })
})
