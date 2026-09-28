import { describe, expect, it } from 'vitest'
import { withSiteQuickstart } from '../catalog/siteQuickstart'
import { filledReplicationState, filledState } from '../test/fixtures'
import { buildNextSteps } from './nextSteps'

function stepIds(state: ReturnType<typeof filledState>): string[] {
  return buildNextSteps(state).map((step) => step.id)
}

describe('buildNextSteps', () => {
  it('adds the offline bundle step for an air-gapped OpenShift cluster', () => {
    const steps = buildNextSteps(
      filledState({
        airGapped: true,
        components: { replication: true, disasterRecovery: true, metrics: true },
        offline: {
          registryBase: 'registry.local/hitachi',
          catalogSourceName: 'certified-operators',
          catalogIndexImage: '',
        },
      }),
    )
    const airGapped = steps.find((step) => step.id === 'air-gapped')

    expect(airGapped).toBeDefined()
    expect(airGapped?.title).toContain('Mirror')
    expect(airGapped?.body).toContain('mirror.sh')
    expect(airGapped?.body).toContain('hvcsi-offline-bundle.sh')
    expect(airGapped?.body).toContain('mirror.sh extras')
    expect(airGapped?.body).toContain('oc-mirror')
    expect(airGapped?.body).toContain('ImageDigestMirrorSet')
    expect(airGapped?.body).toContain('CatalogSource')
  })

  it('tells Kubernetes operators to copy multipath.conf onto workers', () => {
    const steps = buildNextSteps(
      filledState({
        platform: 'kubernetes',
        driverNamespace: 'kube-system',
        multipath: {
          enabled: true,
          includeConf: true,
          includeMachineConfig: false,
          includeDaemonSet: false,
          alreadyApplied: false,
          machineConfigName: 'hitachi-csi-multipath',
          machineConfigRole: 'worker',
          customConf: '',
        },
      }),
    )
    const multipath = steps.find((step) => step.id === 'multipath-workers')

    expect(multipath?.command).toContain('00-prereq/multipath.conf')
    expect(stepIds(filledState())).not.toContain('multipath-workers')
  })

  it('uses dual-site install commands when Replication is on', () => {
    const ids = stepIds(filledReplicationState())

    expect(ids).toEqual(expect.arrayContaining(['install-primary', 'install-secondary']))
    expect(ids).not.toContain('install')
  })

  it('omits the test-volume verify step when StorageClasses are off', () => {
    expect(stepIds(filledState({ storageClassesEnabled: false }))).not.toContain('verify-test-volume')
    expect(stepIds(filledState())).toContain('verify-test-volume')
  })

  it('omits verify-test-volume when both Replication sites skip the test volume', () => {
    let state = filledReplicationState()
    state = withSiteQuickstart(state, 'primary', { install: false })
    state = withSiteQuickstart(state, 'secondary', { install: false })
    expect(stepIds(state)).not.toContain('verify-test-volume')
  })

  it('scopes verify-test-volume to the secondary site when primary skips it', () => {
    let state = filledReplicationState()
    state = withSiteQuickstart(state, 'primary', { install: false })
    state = withSiteQuickstart(state, 'secondary', { pvcName: 's-pvc', podName: 's-pod' })
    const step = buildNextSteps(state).find((s) => s.id === 'verify-test-volume')

    expect(step).toBeDefined()
    expect(step?.body).toContain('s-pvc')
    expect(step?.body).toContain('s-pod')
    expect(step?.body).not.toContain('hitachi-csi-test-pvc')
    expect(step?.command).toContain('s-pvc')
    expect(step?.command).toContain('s-pod')
  })

  it('uses a stable unzip directory name without the CSI Driver tag', () => {
    const unzip = buildNextSteps(filledState()).find((step) => step.id === 'unzip')
    expect(unzip?.command).toBe('unzip hitachi-csi-deployment.zip -d hitachi-csi-deployment\ncd hitachi-csi-deployment')
  })

  it('packaged remote-kubeconfig step mentions both Secrets and DRPolicy clusterName', () => {
    const step = buildNextSteps(
      filledReplicationState({
        replication: {
          primaryKubeconfig: 'dummy-primary',
          secondaryKubeconfig: 'dummy-secondary',
        },
      }),
    ).find((s) => s.id === 'replication-kubeconfigs')

    expect(step?.title).toContain('already in the ZIP')
    expect(step?.body).toContain('hspc-replication-operator-remote-kubeconfig')
    expect(step?.body).toContain('remote-kubeconfig')
    expect(step?.body).toContain('DRPolicy')
    expect(step?.body).toContain('clusterName')
    expect(step?.body).toContain('primary')
    expect(step?.body).toContain('secondary')
  })

  it('helper-path remote-kubeconfig step says install.sh creates both Secrets', () => {
    const step = buildNextSteps(filledReplicationState()).find((s) => s.id === 'replication-kubeconfigs')

    expect(step?.title).toContain('install time')
    expect(step?.body).toContain('install.sh')
    expect(step?.body).toContain('hspc-replication-operator-remote-kubeconfig')
    expect(step?.body).toContain('remote-kubeconfig')
    expect(step?.body).toContain('DRPolicy')
    expect(step?.body).toContain('clusterName')
  })

  it('uses Advanced cluster names in packaged remote-kubeconfig DRPolicy hint', () => {
    const step = buildNextSteps(
      filledReplicationState({
        replication: {
          primaryKubeconfig: 'dummy-primary',
          secondaryKubeconfig: 'dummy-secondary',
          primaryClusterName: 'dc1',
          secondaryClusterName: 'dc2',
        },
      }),
    ).find((s) => s.id === 'replication-kubeconfigs')

    expect(step?.body).toContain('dc1')
    expect(step?.body).toContain('dc2')
  })
})
