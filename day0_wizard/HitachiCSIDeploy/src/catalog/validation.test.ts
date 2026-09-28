import { describe, expect, it } from 'vitest'
import { filledReplicationState, filledState } from '../test/fixtures'
import {
  hasGadPair,
  storageClassKindsForSystems,
  stretchedSecretPackagePath,
} from './platforms'
import { ensureSitesForReplication } from './sites'
import { createDefaultState, type WizardState } from './types'
import { withSiteMetrics } from './metrics'
import {
  airGappedRegistryInvalidFix,
  consolePluginPrometheusWiringInvalidFix,
  effectiveSerialNumber,
  hrpcResourceGroupIdReason,
  siteStorageClassesReady,
  siteStorageSystemsReady,
  storageArtifactsValid,
  storageArtifactsValidForContinue,
  storageSystemsContinueInvalidFix,
  storageSystemsValidForContinue,
  validateStorageSystem,
  drClusterNamesInvalidFix,
  remoteKubeconfigSourceInvalidFix,
  validateHrpc,
  validateStorageClass,
  portIdWithoutMultipathWarning,
  portIdFormatError,
  quickstartPvcSizeInvalidFix,
  wizardFixCta,
} from './validation'
import { HELP } from './help'

function validReplicationState(): WizardState {
  const state = ensureSitesForReplication(
    filledState({
      components: { replication: true, disasterRecovery: true },
      replication: { enabled: true, disasterRecovery: true },
    }),
  )
  const primary = state.sites!.primary
  const secondary = state.sites!.secondary

  return {
    ...state,
    sites: {
      primary,
      secondary: {
        storageSystems: secondary.storageSystems.map((system) => ({
          ...system,
          family: 'vsp-5000-g-e-f',
          serial: '400002',
          url: 'https://192.0.2.11',
          user: 'maintenance',
          password: 'fixture-password',
        })),
        storageClasses: secondary.storageClasses.map((storageClass) => ({
          ...storageClass,
          serialNumber: '400002',
          poolID: '1',
          portID: 'CL2-A',
        })),
      },
    },
  }
}

const RG_BOTH_SITES =
  'Resource partitioning must be configured on both sites. Set Resource group ID on both Replication arrays (Storage step).'

function withPairResourceGroup(
  state: WizardState,
  primary?: string,
  secondary?: string,
): WizardState {
  const next = structuredClone(state)
  if (primary !== undefined) next.sites!.primary.storageSystems[0].resourceGroupID = primary
  if (secondary !== undefined) next.sites!.secondary.storageSystems[0].resourceGroupID = secondary
  return next
}

describe('storage system Continue validation', () => {
  it('rejects a storage system without a family', () => {
    expect(storageSystemsValidForContinue(createDefaultState())).toBe(false)
  })

  it('rejects duplicate storage system serial numbers', () => {
    const state = filledState()
    state.storageSystems.push({
      ...state.storageSystems[0],
      id: 'storage-2',
      name: 'secondary',
    })

    expect(storageSystemsValidForContinue(state)).toBe(false)
  })

  it('accepts filledState', () => {
    expect(storageSystemsValidForContinue(filledState())).toBe(true)
  })

  it('requires exactly one complete Replication array on each site', () => {
    const seeded = ensureSitesForReplication(
      filledState({
        components: { replication: true, disasterRecovery: true },
        replication: { enabled: true, disasterRecovery: true },
      }),
    )

    expect(storageSystemsValidForContinue(seeded)).toBe(false)

    const valid = validReplicationState()
    expect(storageSystemsValidForContinue(valid)).toBe(true)

    const noPrimaryPair = structuredClone(valid)
    noPrimaryPair.sites!.primary.storageSystems[0].hrpcPair = false
    expect(storageSystemsValidForContinue(noPrimaryPair)).toBe(false)

    const twoPrimaryPairs = structuredClone(valid)
    twoPrimaryPairs.sites!.primary.storageSystems.push({
      ...twoPrimaryPairs.sites!.primary.storageSystems[0],
      id: 'storage-2',
      name: 'another-primary-array',
      serial: '452339',
    })
    expect(storageSystemsValidForContinue(twoPrimaryPairs)).toBe(false)
  })
})

describe('CSI Secret name uniqueness', () => {
  it('does not block Continue when standard StorageClasses have stale duplicate secretName values', () => {
    const state = filledState({
      driverNamespace: 'kube-system',
      storageSystems: [
        {
          ...filledState().storageSystems[0],
          id: 'storage-1',
          name: 'array-1',
          serial: '400001',
          csiSecretName: 'hitachi-csi-secret',
          csiSecretNamespace: '',
        },
        {
          ...filledState().storageSystems[0],
          id: 'storage-2',
          name: 'array-2',
          serial: '400002',
          csiSecretName: 'hitachi-csi-secret-2',
          csiSecretNamespace: '',
        },
      ],
      storageClasses: [
        {
          ...filledState().storageClasses[0],
          id: 'sc-1',
          name: 'hitachi-csi-1',
          storageSystemId: 'storage-1',
          // stale/duplicated secretName should not block storage-system Continue
          secretName: 'hitachi-csi-secret',
          secretNamespace: '',
        },
        {
          ...filledState().storageClasses[0],
          id: 'sc-2',
          name: 'hitachi-csi-2',
          storageSystemId: 'storage-2',
          // stale/duplicated secretName should not block storage-system Continue
          secretName: 'hitachi-csi-secret',
          secretNamespace: '',
        },
      ],
    })

    expect(storageSystemsContinueInvalidFix(state)).toBeNull()
    expect(storageSystemsValidForContinue(state)).toBe(true)
  })

  it('rejects two arrays with the same resolved CSI Secret name+namespace', () => {
    const driverNamespace = 'kube-system'
    const systems = [
      { ...filledState().storageSystems[0], id: 'a', name: 'array-a', csiSecretName: 'shared', csiSecretNamespace: '' },
      { ...filledState().storageSystems[0], id: 'b', name: 'array-b', serial: '400002', csiSecretName: 'shared', csiSecretNamespace: '' },
    ]

    expect(validateStorageSystem(systems[1], systems, driverNamespace)).toEqual(
      expect.objectContaining({ csiSecretName: expect.any(String) }),
    )
  })
})

describe('Replication resource group both-or-neither', () => {
  it('allows Continue when both Replication arrays omit Resource group ID', () => {
    const state = validReplicationState()
    expect(hrpcResourceGroupIdReason(state)).toBeNull()
    expect(storageSystemsValidForContinue(state)).toBe(true)
  })

  it('blocks Continue and Export when only the primary Replication array has an ID', () => {
    const state = withPairResourceGroup(validReplicationState(), '10', '')
    expect(hrpcResourceGroupIdReason(state)).toBe(RG_BOTH_SITES)
    expect(storageSystemsValidForContinue(state)).toBe(false)
    expect(storageSystemsContinueInvalidFix(state)).toEqual({
      message: RG_BOTH_SITES,
      stepId: 'storage',
      site: 'secondary',
    })
    expect(validateHrpc(state)).toBe(RG_BOTH_SITES)
    expect(siteStorageSystemsReady(state, 'primary')).toBe(true)
    expect(siteStorageSystemsReady(state, 'secondary')).toBe(false)
  })

  it('blocks Continue when only the secondary Replication array has an ID', () => {
    const state = withPairResourceGroup(validReplicationState(), '', '20')
    expect(storageSystemsValidForContinue(state)).toBe(false)
    expect(storageSystemsContinueInvalidFix(state)?.site).toBe('primary')
    expect(siteStorageSystemsReady(state, 'primary')).toBe(false)
    expect(siteStorageSystemsReady(state, 'secondary')).toBe(true)
  })

  it('allows Continue when both Replication arrays have different IDs', () => {
    const state = withPairResourceGroup(validReplicationState(), '10', '20')
    expect(hrpcResourceGroupIdReason(state)).toBeNull()
    expect(storageSystemsValidForContinue(state)).toBe(true)
    expect(siteStorageSystemsReady(state, 'primary')).toBe(true)
    expect(siteStorageSystemsReady(state, 'secondary')).toBe(true)
  })

  it('treats whitespace-only Resource group ID as empty', () => {
    const state = withPairResourceGroup(validReplicationState(), '  ', '7')
    expect(hrpcResourceGroupIdReason(state)).toBe(RG_BOTH_SITES)
    expect(storageSystemsValidForContinue(state)).toBe(false)
    expect(storageSystemsContinueInvalidFix(state)?.site).toBe('primary')
  })

  it('does not require Replication-array IDs when only an extra array has a Resource group ID', () => {
    const state = structuredClone(validReplicationState())
    state.sites!.primary.storageSystems.push({
      ...state.sites!.primary.storageSystems[0],
      id: 'storage-extra',
      name: 'local-extra',
      serial: '400099',
      csiSecretName: 'hitachi-csi-secret-2',
      hrpcPair: false,
      resourceGroupID: '99',
    })
    expect(hrpcResourceGroupIdReason(state)).toBeNull()
    expect(storageSystemsValidForContinue(state)).toBe(true)
  })
})

describe('per-site readiness for the site switcher', () => {
  it('treats seeded Replication primary arrays as ready and secondary as not', () => {
    const seeded = ensureSitesForReplication(
      filledState({
        components: { replication: true, disasterRecovery: true },
        replication: { enabled: true, disasterRecovery: true },
      }),
    )

    expect(siteStorageSystemsReady(seeded, 'primary')).toBe(true)
    expect(siteStorageSystemsReady(seeded, 'secondary')).toBe(false)
    expect(storageSystemsValidForContinue(seeded)).toBe(false)
  })

  it('treats validReplicationState arrays as ready on both sites', () => {
    const state = validReplicationState()
    expect(siteStorageSystemsReady(state, 'primary')).toBe(true)
    expect(siteStorageSystemsReady(state, 'secondary')).toBe(true)
    expect(siteStorageClassesReady(state, 'primary')).toBe(true)
    expect(siteStorageClassesReady(state, 'secondary')).toBe(true)
  })

  it('treats both StorageClass sites as ready when generation is off', () => {
    const state = { ...validReplicationState(), storageClassesEnabled: false }
    expect(siteStorageClassesReady(state, 'primary')).toBe(true)
    expect(siteStorageClassesReady(state, 'secondary')).toBe(true)
  })

  it('badges Secondary when the matching Replication StorageClass is incomplete', () => {
    const state = structuredClone(validReplicationState())
    state.sites!.secondary.storageClasses[0].poolID = ''

    expect(siteStorageClassesReady(state, 'primary')).toBe(true)
    expect(siteStorageClassesReady(state, 'secondary')).toBe(false)
  })
})

describe('DR cluster names validation', () => {
  it('blocks Export when DR cluster names resolve to the same string', () => {
    const state = filledReplicationState({
      replication: { primaryClusterName: 'dc1', secondaryClusterName: 'dc1' },
    })
    expect(drClusterNamesInvalidFix(state)).toEqual({
      message: 'Primary and secondary cluster names must be different (on the Replication step).',
      stepId: 'replication',
    })
    expect(validateHrpc(state)).toBe(
      'Primary and secondary cluster names must be different (on the Replication step).',
    )
  })

  it('allows Export when DR cluster names differ after trim', () => {
    const state = filledReplicationState({
      replication: { primaryClusterName: 'dc1', secondaryClusterName: ' dc2 ' },
    })
    expect(drClusterNamesInvalidFix(state)).toBeNull()
  })
})

const CHOOSE_KUBECONFIG_SOURCE =
  'Choose how to create the remote kubeconfig Secrets: paste both in this wizard, or confirm you will create them at install time.'
const PASTE_BOTH_KUBECONFIGS =
  'Paste both the primary and secondary kubeconfigs, or confirm you will create the Secrets at install time.'

describe('remote kubeconfig source validation', () => {
  it('blocks Continue and Export when neither pastes nor an install-time confirmation exist', () => {
    const state = filledReplicationState({
      replication: { remoteKubeconfigSource: undefined },
    })
    expect(remoteKubeconfigSourceInvalidFix(state)).toEqual({
      message: CHOOSE_KUBECONFIG_SOURCE,
      stepId: 'replication',
    })
    expect(validateHrpc(state)).toBe(CHOOSE_KUBECONFIG_SOURCE)
  })

  it('blocks when wizard source is chosen but a kubeconfig is missing after reload', () => {
    const state = filledReplicationState({
      replication: { remoteKubeconfigSource: 'wizard', primaryKubeconfig: 'only-primary' },
    })
    expect(remoteKubeconfigSourceInvalidFix(state)).toEqual({
      message: PASTE_BOTH_KUBECONFIGS,
      stepId: 'replication',
    })
    expect(validateHrpc(state)).toBe(PASTE_BOTH_KUBECONFIGS)
  })

  it('allows Continue and Export when both kubeconfigs are pasted', () => {
    const state = filledReplicationState({
      replication: {
        primaryKubeconfig: 'dummy-primary',
        secondaryKubeconfig: 'dummy-secondary',
      },
    })
    expect(remoteKubeconfigSourceInvalidFix(state)).toBeNull()
    expect(validateHrpc(state)).toBeNull()
  })

  it('allows Continue and Export when install-time Secret creation is confirmed', () => {
    const state = filledReplicationState({
      replication: { remoteKubeconfigSource: 'install-time' },
    })
    expect(remoteKubeconfigSourceInvalidFix(state)).toBeNull()
    expect(validateHrpc(state)).toBeNull()
  })

  it('does not require a kubeconfig choice when Replication is off', () => {
    const state = filledState()
    expect(remoteKubeconfigSourceInvalidFix(state)).toBeNull()
  })
})

describe('storage artifact validation', () => {
  it('blocks Continue when two arrays exist and a standard class has no storageSystemId', () => {
    const state = filledState({
      storageSystems: [
        { ...filledState().storageSystems[0], id: 'storage-1' },
        {
          ...filledState().storageSystems[0],
          id: 'storage-2',
          name: 'array-2',
          serial: '400002',
          csiSecretName: 'hitachi-csi-secret-2',
        },
      ],
      storageClasses: [{ ...filledState().storageClasses[0], storageSystemId: '' }],
    })

    expect(validateStorageClass(state.storageClasses[0], { storageSystems: state.storageSystems })).toEqual(
      expect.objectContaining({ storageSystemId: expect.any(String) }),
    )
  })

  it('allows Continue without journals but requires both journals for Export', () => {
    const state = validReplicationState()

    expect(storageArtifactsValidForContinue(state)).toBe(true)
    expect(storageArtifactsValid(state)).toBe(false)
    expect(validateHrpc(state)).toBe(
      'Set a Journal ID for array serial 400001 (on the Replication step).',
    )

    const withJournals: WizardState = {
      ...state,
      replication: {
        ...state.replication,
        remoteKubeconfigSource: 'install-time',
        storageSecrets: [
          {
            serial: '400001',
            url: 'https://192.0.2.10',
            user: 'maintenance',
            password: 'fixture-password',
            journal: '0',
          },
          {
            serial: '400002',
            url: 'https://192.0.2.11',
            user: 'maintenance',
            password: 'fixture-password',
            journal: '1',
          },
        ],
      },
    }

    expect(storageArtifactsValid(withJournals)).toBe(true)
  })

  it('allows Continue and Export when StorageClasses are off', () => {
    const state = filledState({ storageClassesEnabled: false })
    state.storageClasses[0].poolID = ''
    state.storageClasses[0].portID = ''

    expect(storageArtifactsValidForContinue(state)).toBe(true)
    expect(storageArtifactsValid(state)).toBe(true)
  })

  it('requires NVMe subsystem ID (and not Port ID) for NVMe/TCP', () => {
    const state = filledState()
    const nvme = {
      ...state.storageClasses[0],
      connectionType: 'nvme-tcp' as const,
      portID: '',
      nvmSubsystemID: '',
    }

    expect(validateStorageClass(nvme, { storageSystems: state.storageSystems })).toEqual(
      expect.objectContaining({ nvmSubsystemID: expect.any(String) }),
    )
    expect(validateStorageClass(nvme, { storageSystems: state.storageSystems })).not.toHaveProperty(
      'portID',
    )

    expect(
      validateStorageClass(
        { ...nvme, nvmSubsystemID: '1' },
        { storageSystems: state.storageSystems },
      ),
    ).toEqual({})
  })

  it('does not require serial, pool, or port on a VSP One SDS Block StorageClass', () => {
    const state = filledState()
    const sds = {
      ...state.storageClasses[0],
      kind: 'vsp-one-sds-block' as const,
      serialNumber: '',
      poolID: '',
      portID: '',
    }

    expect(validateStorageClass(sds, { storageSystems: state.storageSystems })).toEqual({})
  })

  it('does not block Continue when multiple Port IDs are set with wizard multipath packaging off', () => {
    const state = filledState({
      multipath: { enabled: false, includeConf: false, includeMachineConfig: false, includeDaemonSet: false },
    })
    state.storageClasses[0].portID = 'CL1-A,CL2-A'

    expect(validateStorageClass(state.storageClasses[0], { storageSystems: state.storageSystems })).not.toHaveProperty(
      'portID',
    )
    expect(storageArtifactsValidForContinue(state)).toBe(true)
    expect(portIdWithoutMultipathWarning(false, 'CL1-A,CL2-A')).toBe(HELP.portIdMultipleWithoutMultipath)
    expect(portIdWithoutMultipathWarning(false, 'CL1-A')).toBeUndefined()
    expect(portIdWithoutMultipathWarning(true, 'CL1-A,CL2-A')).toBeUndefined()
  })

  it('blocks Continue when a Port ID token is malformed', () => {
    const state = filledState()
    state.storageClasses[0].portID = 'CL-2A'

    expect(
      validateStorageClass(state.storageClasses[0], { storageSystems: state.storageSystems }).portID,
    ).toBe(HELP.portIdFormat)
    expect(storageArtifactsValidForContinue(state)).toBe(false)
    expect(storageArtifactsValid(state)).toBe(false)
  })

  it('accepts comma-separated Port IDs matching Hitachi CL[1-9A-G]-[A-HJ-NP-R]', () => {
    const state = filledState()
    const ctx = { storageSystems: state.storageSystems }

    for (const portID of [
      'CL2-A',
      'CL3-G,CL4-G,CL2-A',
      'CL3-G, CL4-G',
      'CLA-A',
      'CLG-R',
      'cl1-A',
      'Cl3-G',
    ]) {
      expect(portIdFormatError(portID)).toBeUndefined()
      expect(validateStorageClass({ ...state.storageClasses[0], portID }, ctx)).not.toHaveProperty(
        'portID',
      )
    }

    expect(portIdFormatError(undefined)).toBeUndefined()
    expect(portIdFormatError('')).toBeUndefined()
    expect(portIdFormatError('   ')).toBeUndefined()
  })

  it('returns HELP.portIdFormat for malformed Port ID tokens', () => {
    for (const portID of [
      ',',
      '  ,  ',
      'CL-2A',
      'CLG4',
      'CL12-A',
      'CL99-Z',
      'CL0-A',
      'CL1-I',
      'CL1-O',
      'CL1-S',
      'CLH-A',
      'cl3-g',
      'CL3-g',
      'CL2-A,CLG4',
    ]) {
      expect(portIdFormatError(portID)).toBe(HELP.portIdFormat)
    }
  })

  it('keeps the required Port ID message when the field is blank', () => {
    const state = filledState()
    state.storageClasses[0].portID = ''

    expect(
      validateStorageClass(state.storageClasses[0], { storageSystems: state.storageSystems }).portID,
    ).toBe('Port ID is required for this connection type.')
    expect(portIdFormatError('')).toBeUndefined()
  })
})

describe('GAD and stretched StorageClass constraints', () => {
  const gadSystems = [
    { family: 'vsp-5000-g-e-f' as const },
    { family: 'vsp-one-block-20' as const },
  ]

  it('recognizes two VSP arrays as a GAD pair even without roles', () => {
    expect(hasGadPair(gadSystems)).toBe(true)
    expect(hasGadPair(gadSystems.slice(0, 1))).toBe(false)
    expect(
      hasGadPair([
        { family: 'vsp-one-sds-block' },
        { family: 'vsp-one-sds-block' },
      ]),
    ).toBe(false)
  })

  it('offers stretched StorageClasses for a GAD pair', () => {
    expect(storageClassKindsForSystems(gadSystems)).toContain('stretched')
  })

  it('blocks GAD when primary and secondary pickers are the same array', () => {
    const systems = filledState().storageSystems.concat([
      {
        ...filledState().storageSystems[0],
        id: 'storage-2',
        name: 'array-2',
        serial: '400002',
        family: 'vsp-5000-g-e-f',
        csiSecretName: 'hitachi-csi-secret-2',
      },
    ])
    const stretched = {
      ...filledState().storageClasses[0],
      kind: 'stretched' as const,
      quorumID: '1',
      copyGroupName: 'spc-cpg1',
      consistencyGroupId: '1',
      primaryPoolID: '0',
      primaryPortID: 'CL1-A',
      secondaryPoolID: '1',
      secondaryPortID: 'CL2-A',
      stretchedSecretName: 'hitachi-csi-secret-stretched',
      primaryStorageSystemId: 'storage-1',
      secondaryStorageSystemId: 'storage-1',
    }
    expect(validateStorageClass(stretched, { storageSystems: systems })).toEqual(
      expect.objectContaining({ secondaryStorageSystemId: expect.any(String) }),
    )
  })

  it('keeps stretchedSecretName unique from standard Secret names on this site', () => {
    const systems = filledState().storageSystems.concat([
      {
        ...filledState().storageSystems[0],
        id: 'storage-2',
        name: 'array-2',
        serial: '400002',
        family: 'vsp-one-block-20',
        csiSecretName: 'hitachi-csi-secret-2',
      },
    ])
    const standard = {
      ...filledState().storageClasses[0],
      id: 'sc-std',
      name: 'hitachi-csi',
      kind: 'standard' as const,
      storageSystemId: 'storage-1',
      secretName: 'hitachi-csi-secret',
      secretNamespace: 'kube-system',
    }
    const stretched = {
      ...filledState().storageClasses[0],
      id: 'sc-gad',
      name: 'hitachi-csi-stretched',
      kind: 'stretched' as const,
      quorumID: '1',
      copyGroupName: 'spc-cpg1',
      consistencyGroupId: '1',
      primaryPoolID: '0',
      primaryPortID: 'CL1-A',
      secondaryPoolID: '1',
      secondaryPortID: 'CL2-A',
      stretchedSecretName: 'hitachi-csi-secret',
      secretNamespace: 'kube-system',
      primaryStorageSystemId: 'storage-1',
      secondaryStorageSystemId: 'storage-2',
    }

    expect(
      validateStorageClass(stretched, { storageSystems: systems, siblings: [standard, stretched] }),
    ).toEqual(expect.objectContaining({ stretchedSecretName: expect.any(String) }))
  })

  it('reports required stretched StorageClass fields', () => {
    const state = filledState()
    const stretched = {
      ...state.storageClasses[0],
      kind: 'stretched' as const,
      quorumID: '',
      copyGroupName: '',
      consistencyGroupId: '',
      primaryPoolID: '',
      primaryPortID: '',
      secondaryPoolID: '',
      secondaryPortID: '',
    }

    const errors = validateStorageClass(stretched, { storageSystems: state.storageSystems })

    expect(errors).toHaveProperty('quorumID')
    expect(errors).toHaveProperty('copyGroupName')
    expect(errors).toHaveProperty('consistencyGroupId')
    expect(errors).toHaveProperty('primaryPoolID')
    expect(errors).toHaveProperty('primaryPortID')
    expect(errors).toHaveProperty('secondaryPoolID')
    expect(errors).toHaveProperty('secondaryPortID')
  })

  it('blocks malformed primary and secondary Port IDs on stretched StorageClasses', () => {
    const systems = filledState().storageSystems.concat([
      {
        ...filledState().storageSystems[0],
        id: 'storage-2',
        name: 'array-2',
        serial: '400002',
        family: 'vsp-5000-g-e-f',
        csiSecretName: 'hitachi-csi-secret-2',
      },
    ])
    const stretched = {
      ...filledState().storageClasses[0],
      kind: 'stretched' as const,
      quorumID: '1',
      copyGroupName: 'spc-cpg1',
      consistencyGroupId: '1',
      primaryPoolID: '0',
      primaryPortID: 'CL-2A',
      secondaryPoolID: '1',
      secondaryPortID: 'CLG4',
      stretchedSecretName: 'hitachi-csi-secret-stretched',
      primaryStorageSystemId: 'storage-1',
      secondaryStorageSystemId: 'storage-2',
    }

    const errors = validateStorageClass(stretched, { storageSystems: systems })
    expect(errors.primaryPortID).toBe(HELP.portIdFormat)
    expect(errors.secondaryPortID).toBe(HELP.portIdFormat)
  })

  it('derives stable package paths for stretched Secrets', () => {
    expect(stretchedSecretPackagePath('hitachi-csi-secret-stretched')).toBe(
      '01-storage/secret-stretched.yaml',
    )
    expect(stretchedSecretPackagePath('custom-gad')).toBe('01-storage/secret-custom-gad.yaml')
  })
})

describe('effectiveSerialNumber', () => {
  it('uses the linked array serial and does not fall back after storageSystemId is set', () => {
    const systems = [
      { ...filledState().storageSystems[0], id: 'a', serial: '111' },
      { ...filledState().storageSystems[0], id: 'b', serial: '222', name: 'two' },
    ]
    expect(
      effectiveSerialNumber(
        { ...filledState().storageClasses[0], storageSystemId: 'b', serialNumber: '' },
        systems,
      ),
    ).toBe('222')
    expect(
      effectiveSerialNumber(
        { ...filledState().storageClasses[0], storageSystemId: 'missing', serialNumber: 'stale' },
        systems,
      ),
    ).toBe('')
  })
})

describe('air-gapped registry export validation', () => {
  const AIR_GAPPED_REGISTRY_MSG =
    'Set a private registry base on the Prerequisites step for air-gapped installs.'

  it('blocks export when air-gapped and registry base is empty', () => {
    const state = filledState({
      airGapped: true,
      offline: { ...createDefaultState().offline, registryBase: '' },
    })
    const fix = airGappedRegistryInvalidFix(state)
    expect(fix).not.toBeNull()
    expect(fix?.message).toBe(AIR_GAPPED_REGISTRY_MSG)
    expect(fix?.stepId).toBe('prerequisites-checklist')
  })

  it('blocks export when air-gapped and registry base is whitespace', () => {
    const state = filledState({
      airGapped: true,
      offline: { ...createDefaultState().offline, registryBase: '   ' },
    })
    expect(airGappedRegistryInvalidFix(state)?.message).toBe(AIR_GAPPED_REGISTRY_MSG)
  })

  it('does not block export when air-gapped and registry base is set', () => {
    const state = filledState({
      airGapped: true,
      offline: { ...createDefaultState().offline, registryBase: 'mirror.local:5000/csi' },
    })
    expect(airGappedRegistryInvalidFix(state)).toBeNull()
  })

  it('does not block export when not air-gapped even if registry base is empty', () => {
    const state = filledState({
      airGapped: false,
      offline: { ...createDefaultState().offline, registryBase: '' },
    })
    expect(airGappedRegistryInvalidFix(state)).toBeNull()
  })

  it('does not block Continue when air-gapped without registry base', () => {
    const state = filledState({
      airGapped: true,
      offline: { ...createDefaultState().offline, registryBase: '' },
    })
    expect(storageSystemsValidForContinue(state)).toBe(true)
    expect(storageArtifactsValidForContinue(state)).toBe(true)
  })
})

describe('Console Plugin Prometheus wiring export validation', () => {
  it('blocks export when Console Plugin is on and a skipped-metrics site has empty Prometheus fields', () => {
    let state = validReplicationState()
    state = {
      ...state,
      components: { ...state.components, metrics: true, consolePlugin: true },
    }
    state = withSiteMetrics(state, 'secondary', {
      install: false,
      existingPrometheusNamespace: '',
      existingPrometheusService: '',
      existingPrometheusPort: '',
    })
    const fix = consolePluginPrometheusWiringInvalidFix(state)
    expect(fix).not.toBeNull()
    expect(fix?.stepId).toBe('console')
    expect(fix?.site).toBe('secondary')
  })

  it('does not block export when a skipped-metrics site has Prometheus namespace, service, and port', () => {
    let state = validReplicationState()
    state = {
      ...state,
      components: { ...state.components, metrics: true, consolePlugin: true },
    }
    state = withSiteMetrics(state, 'secondary', {
      install: false,
      existingPrometheusNamespace: 'ext-ns',
      existingPrometheusService: 'ext-svc',
      existingPrometheusPort: '9090',
    })
    expect(consolePluginPrometheusWiringInvalidFix(state)).toBeNull()
  })
})

describe('quickstart PVC size', () => {
  it('allows the default 1Gi', () => {
    expect(quickstartPvcSizeInvalidFix(filledState())).toBeNull()
  })

  it('rejects unknown units and overflow', () => {
    expect(
      quickstartPvcSizeInvalidFix(filledState({ quickstart: { pvcSize: '9999999TTGi' } })),
    ).toEqual({
      message: 'PVC size must be a Kubernetes quantity (for example 1Gi or 500Mi).',
      stepId: 'quickstart',
    })
    const huge = `${'1'.padEnd(200, '0')}Gi`
    expect(quickstartPvcSizeInvalidFix(filledState({ quickstart: { pvcSize: huge } }))).toEqual({
      message: 'PVC size is too large. Use a Kubernetes quantity below 8Ei.',
      stepId: 'quickstart',
    })
  })

  it('skips when StorageClasses are off', () => {
    expect(
      quickstartPvcSizeInvalidFix(
        filledState({ storageClassesEnabled: false, quickstart: { pvcSize: '9999999TTGi' } }),
      ),
    ).toBeNull()
  })

  it('validates only sites that include a test volume', () => {
    const state = filledReplicationState({ quickstart: { pvcSize: '1Gi' } })
    const primaryQs = {
      install: true as const,
      ...state.quickstart,
      pvcSize: '1Gi',
    }
    const badQs = {
      install: false as const,
      ...state.quickstart,
      pvcSize: '9999999TTGi',
    }
    const skipped: WizardState = {
      ...state,
      sites: {
        primary: { ...state.sites!.primary, quickstart: primaryQs },
        secondary: { ...state.sites!.secondary, quickstart: badQs },
      },
    }
    expect(quickstartPvcSizeInvalidFix(skipped)).toBeNull()
    const included: WizardState = {
      ...skipped,
      sites: {
        ...skipped.sites!,
        secondary: {
          ...skipped.sites!.secondary,
          quickstart: { ...badQs, install: true },
        },
      },
    }
    expect(quickstartPvcSizeInvalidFix(included)).toEqual({
      message: 'Secondary site: PVC size must be a Kubernetes quantity (for example 1Gi or 500Mi).',
      stepId: 'quickstart',
      site: 'secondary',
    })
  })

  it('uses the Test volume CTA', () => {
    expect(wizardFixCta({ message: 'x', stepId: 'quickstart' })).toBe('Open Test volume')
    expect(
      wizardFixCta({ message: 'x', stepId: 'quickstart', site: 'secondary' }),
    ).toBe('Open Test volume')
  })
})
