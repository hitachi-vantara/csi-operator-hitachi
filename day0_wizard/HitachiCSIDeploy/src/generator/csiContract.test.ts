import { describe, expect, it, vi } from 'vitest'
import type { StorageClassConfig } from '../catalog/types'
import { filledReplicationState, filledState } from '../test/fixtures'
import {
  CATALOG_ONLY_KEYS,
  SECRET_PORT_MIGRATION_KEYS,
  allowedSecretKeys,
  allowedStorageClassParameterKeys,
  assertAllowedKeys,
  assertCsiContract,
  assertForbiddenKeys,
  assertNoPortMigrationSecretKeys,
  assertRequiredKeys,
  assertSecretCoherence,
  catalogKeysMissingFromSamples,
  forbiddenStorageClassParameterKeys,
  requiredStorageClassParameterKeys,
  sampleParameterKeys,
} from '../test/csiContract'
import { generateAll } from './yaml'

vi.mock('../services/versions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/versions')>()
  return {
    ...actual,
    fetchFirstAvailable: vi.fn(async () =>
      ['apiVersion: v1', 'kind: ConfigMap', 'metadata:', '  name: mocked-upstream'].join('\n'),
    ),
  }
})

function sc(partial: Partial<StorageClassConfig>): StorageClassConfig {
  return {
    id: 'sc-1',
    kind: 'standard',
    name: 'hitachi-csi',
    connectionType: 'fc',
    secretName: 'hitachi-csi-secret',
    secretNamespace: 'hspc-operator-system',
    reclaimPolicy: 'Delete',
    volumeBindingMode: 'Immediate',
    allowVolumeExpansion: true,
    ...partial,
  }
}

describe('catalog vs sample names', () => {
  it('every catalog Hitachi key is in a sample or CATALOG_ONLY_KEYS', () => {
    expect(catalogKeysMissingFromSamples()).toEqual([])
  })
})

describe('allowed StorageClass parameter keys', () => {
  it('accepts keys from the standard sample', () => {
    const allowed = allowedStorageClassParameterKeys('standard')
    expect(() =>
      assertAllowedKeys('sc.yaml', ['serialNumber', 'poolID', 'portID', 'connectionType'], allowed),
    ).not.toThrow()
  })

  it('rejects a misspelled Hitachi key', () => {
    const allowed = allowedStorageClassParameterKeys('standard')
    expect(() => assertAllowedKeys('sc.yaml', ['nvmSubsystemId'], allowed)).toThrow(
      /sc.yaml: unknown parameter "nvmSubsystemId" \(not in sample or catalog\)/,
    )
  })

  it('allows catalog-only nvmSubsystemID on standard', () => {
    const allowed = allowedStorageClassParameterKeys('standard')
    expect(allowed.has('nvmSubsystemID')).toBe(true)
    expect(CATALOG_ONLY_KEYS.nvmSubsystemID).toMatch(/NVMe/)
  })

  it('standard sample does not include nvmSubsystemID', () => {
    expect(sampleParameterKeys('sc-sample.yaml')).not.toContain('nvmSubsystemID')
  })
})

describe('required and forbidden StorageClass parameters', () => {
  it('requires portID and forbids nvmSubsystemID for FC', () => {
    const cfg = sc({ connectionType: 'fc' })
    expect(requiredStorageClassParameterKeys(cfg)).toEqual(
      expect.arrayContaining(['connectionType', 'serialNumber', 'poolID', 'portID']),
    )
    expect(forbiddenStorageClassParameterKeys(cfg)).toEqual(
      expect.arrayContaining(['nvmSubsystemID', 'storageType', 'replicationType']),
    )
  })

  it('requires nvmSubsystemID and forbids portID for NVMe/TCP', () => {
    const cfg = sc({ connectionType: 'nvme-tcp' })
    expect(requiredStorageClassParameterKeys(cfg)).toContain('nvmSubsystemID')
    expect(requiredStorageClassParameterKeys(cfg)).not.toContain('portID')
    expect(forbiddenStorageClassParameterKeys(cfg)).toContain('portID')
  })

  it('forbids serial/pool/port on SDS Block', () => {
    const cfg = sc({ kind: 'vsp-one-sds-block', connectionType: 'iscsi' })
    expect(requiredStorageClassParameterKeys(cfg)).toEqual(
      expect.arrayContaining(['storageType', 'connectionType']),
    )
    expect(forbiddenStorageClassParameterKeys(cfg)).toEqual(
      expect.arrayContaining(['serialNumber', 'poolID', 'portID', 'nvmSubsystemID']),
    )
  })

  it('rejects a VolumeSnapshotClass for SDS Block-only storage', () => {
    const base = filledState()
    const state = filledState({
      storageSystems: [{ ...base.storageSystems[0], family: 'vsp-one-sds-block' }],
      storageClasses: [
        {
          ...base.storageClasses[0],
          kind: 'vsp-one-sds-block',
          name: 'hitachi-csi-sds',
          serialNumber: '',
          poolID: '',
          portID: '',
        },
      ],
    })
    expect(() =>
      assertCsiContract(
        [
          {
            path: '01-storage/volumesnapshotclass-hitachi-csi-snapshot.yaml',
            content: [
              'driver: hspc.csi.hitachi.com',
              'parameters:',
              '  poolID: "0"',
              '  csi.storage.k8s.io/snapshotter-secret-name: hitachi-csi-secret',
              '  csi.storage.k8s.io/snapshotter-secret-namespace: hspc-operator-system',
            ].join('\n'),
          },
        ],
        state,
      ),
    ).toThrow(/VolumeSnapshotClass is not supported for VSP One SDS Block/)
  })

  it('throws a path-qualified missing-key error', () => {
    expect(() =>
      assertRequiredKeys('sc.yaml', { connectionType: 'nvme-tcp' }, ['nvmSubsystemID']),
    ).toThrow(/sc.yaml: .*nvmSubsystemID/)
  })

  it('throws a path-qualified forbidden-key error', () => {
    expect(() =>
      assertForbiddenKeys('sc.yaml', { portID: 'CL1-A' }, ['portID'], 'NVMe/TCP'),
    ).toThrow(/sc.yaml: NVMe\/TCP must not emit portID/)
  })
})

describe('Secret contract', () => {
  it('allows catalog standard secret keys and rejects port migration', () => {
    expect(allowedSecretKeys('standard').has('url')).toBe(true)
    expect(allowedSecretKeys('standard').has('user')).toBe(true)
    expect(allowedSecretKeys('standard').has('password')).toBe(true)
    expect(() => assertNoPortMigrationSecretKeys('secret.yaml', ['url', 'user'])).not.toThrow()
    expect(() => assertNoPortMigrationSecretKeys('secret.yaml', ['portIP'])).toThrow(
      /secret.yaml: Secret must not emit port-migration key "portIP"/,
    )
    expect(SECRET_PORT_MIGRATION_KEYS).toContain('portIP')
  })

  it('matches stringData values to wizard state', () => {
    expect(() =>
      assertSecretCoherence(
        'secret.yaml',
        { stringData: { primarySerial: '400001' } },
        { primarySerial: '400001' },
      ),
    ).not.toThrow()
    expect(() =>
      assertSecretCoherence(
        'secret.yaml',
        { stringData: { primarySerial: '999' } },
        { primarySerial: '400001' },
      ),
    ).toThrow(/secret.yaml: primarySerial "999" !== wizard state/)
  })

  it('does not put the password in the error', () => {
    expect(() =>
      assertSecretCoherence(
        'secret.yaml',
        { stringData: { password: 'wrong' } },
        { password: 'fixture-password' },
      ),
    ).toThrow(/secret.yaml: password does not match wizard state/)
    expect(() =>
      assertSecretCoherence(
        'secret.yaml',
        { stringData: { password: 'wrong' } },
        { password: 'fixture-password' },
      ),
    ).not.toThrow(/fixture-password/)
  })
})

describe('assertCsiContract on generateAll', () => {
  it('accepts classic OpenShift FC', async () => {
    const state = filledState()
    const files = await generateAll(state)
    expect(() => assertCsiContract(files, state)).not.toThrow()
  })

  it('accepts OpenShift iSCSI', async () => {
    const base = filledState()
    const state = filledState({
      connectionType: 'iscsi',
      storageClasses: [{ ...base.storageClasses[0], connectionType: 'iscsi' }],
    })
    const files = await generateAll(state)
    expect(() => assertCsiContract(files, state)).not.toThrow()
  })

  it('accepts NVMe/TCP', async () => {
    const base = filledState()
    const state = filledState({
      connectionType: 'nvme-tcp',
      multipath: {
        enabled: false,
        includeConf: false,
        includeMachineConfig: false,
        includeDaemonSet: false,
        alreadyApplied: false,
        machineConfigName: 'hitachi-csi-multipath',
        machineConfigRole: 'worker',
        customConf: '',
      },
      storageClasses: [
        {
          ...base.storageClasses[0],
          connectionType: 'nvme-tcp',
          nvmSubsystemID: '1',
          portID: '',
        },
      ],
    })
    const files = await generateAll(state)
    expect(() => assertCsiContract(files, state)).not.toThrow()
  })

  it('accepts VSP One SDS Block', async () => {
    const base = filledState()
    const state = filledState({
      storageSystems: [{ ...base.storageSystems[0], family: 'vsp-one-sds-block' }],
      storageClasses: [
        {
          ...base.storageClasses[0],
          kind: 'vsp-one-sds-block',
          name: 'hitachi-csi-sds',
          serialNumber: '',
          poolID: '',
          portID: '',
        },
      ],
    })
    const files = await generateAll(state)
    expect(files.some((file) => file.path.includes('volumesnapshotclass-'))).toBe(false)
    expect(() => assertCsiContract(files, state)).not.toThrow()
  })

  it('accepts a GAD stretched pair', async () => {
    const base = filledState()
    const state = filledState({
      storageSystems: [
        {
          ...base.storageSystems[0],
          id: 'storage-1',
          name: 'array-1',
          csiSecretName: 'hitachi-csi-secret-a',
          stretchedRole: 'none',
        },
        {
          ...base.storageSystems[0],
          id: 'storage-2',
          name: 'array-2',
          serial: '400002',
          url: 'https://192.0.2.11',
          csiSecretName: 'hitachi-csi-secret-b',
          stretchedRole: 'none',
        },
      ],
      storageClasses: [
        {
          ...base.storageClasses[0],
          kind: 'stretched',
          serialNumber: '',
          quorumID: '1',
          copyGroupName: 'spc-test-cg',
          copyPairName: 'spc-test-pair',
          consistencyGroupId: '10',
          primaryPoolID: '0',
          primaryPortID: 'CL1-A',
          secondaryPoolID: '1',
          secondaryPortID: 'CL2-A',
          stretchedSecretName: 'hitachi-csi-secret-stretched',
          primaryStorageSystemId: 'storage-1',
          secondaryStorageSystemId: 'storage-2',
        },
      ],
    })
    const files = await generateAll(state)
    expect(() => assertCsiContract(files, state)).not.toThrow()
  })

  it('accepts Replication with journals on both site folders', async () => {
    const state = filledReplicationState({
      replication: {
        primaryKubeconfig: 'dummy-primary-kubeconfig',
        secondaryKubeconfig: 'dummy-secondary-kubeconfig',
      },
    })
    const files = await generateAll(state)
    expect(() => assertCsiContract(files, state)).not.toThrow()
  })

  it('accepts StorageClasses off (Secret and HSPC only)', async () => {
    const state = filledState({ storageClassesEnabled: false })
    const files = await generateAll(state)
    expect(() => assertCsiContract(files, state)).not.toThrow()
  })
})
