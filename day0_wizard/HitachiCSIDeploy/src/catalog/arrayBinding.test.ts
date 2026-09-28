import { describe, expect, it } from 'vitest'
import {
  applyArrayBindingToClass,
  arrayForStorageClass,
  csiSecretRefForSystem,
  defaultGadArrayIds,
  defaultStorageSystemId,
  gadArraysForStorageClass,
  migrateArrayBinding,
  nextCsiSecretName,
} from './arrayBinding'
import { createDefaultState } from './types'
import type { StorageClassConfig, StorageSystemConfig, WizardState } from './types'

function sys(
  partial: Partial<StorageSystemConfig> & Pick<StorageSystemConfig, 'id' | 'name'>,
): StorageSystemConfig {
  return {
    serial: '',
    url: '',
    user: '',
    password: '',
    csiSecretName: 'hitachi-csi-secret',
    csiSecretNamespace: '',
    ...partial,
  }
}

function sc(
  partial: Partial<StorageClassConfig> & Pick<StorageClassConfig, 'id' | 'name'>,
): StorageClassConfig {
  return {
    kind: 'standard',
    connectionType: 'iscsi',
    secretName: 'hitachi-csi-secret',
    secretNamespace: '',
    reclaimPolicy: 'Delete',
    volumeBindingMode: 'Immediate',
    allowVolumeExpansion: true,
    ...partial,
  }
}

describe('csiSecretRefForSystem', () => {
  it('defaults name to hitachi-csi-secret and empty namespace to the driver namespace', () => {
    expect(
      csiSecretRefForSystem(
        sys({ id: 'a', name: 'primary', csiSecretName: '', csiSecretNamespace: '' }),
        'kube-system',
      ),
    ).toEqual({ name: 'hitachi-csi-secret', namespace: 'kube-system' })
  })

  it('does not suffix because the array display name is secondary', () => {
    expect(
      csiSecretRefForSystem(
        sys({ id: 'storage-1-secondary', name: 'secondary', csiSecretName: 'hitachi-csi-secret' }),
        'hspc-operator-system',
      ).name,
    ).toBe('hitachi-csi-secret')
  })
})

describe('nextCsiSecretName', () => {
  it('keeps hitachi-csi-secret for the first array and suffixes only on collision', () => {
    expect(nextCsiSecretName([])).toBe('hitachi-csi-secret')
    expect(nextCsiSecretName([sys({ id: 'a', name: 'primary' })])).toBe('hitachi-csi-secret-2')
  })
})

describe('defaultStorageSystemId', () => {
  it('prefers the Replication-marked array when several exist', () => {
    const systems = [sys({ id: 'a', name: 'local' }), sys({ id: 'b', name: 'pair', hrpcPair: true })]
    expect(defaultStorageSystemId(systems)).toBe('b')
  })
})

describe('defaultGadArrayIds', () => {
  it('picks two different VSP arrays', () => {
    const systems = [
      sys({ id: 'a', name: 'one', family: 'vsp-5000-g-e-f' }),
      sys({ id: 'b', name: 'two', family: 'vsp-one-block-20' }),
    ]
    expect(defaultGadArrayIds(systems)).toEqual({
      primaryStorageSystemId: 'a',
      secondaryStorageSystemId: 'b',
    })
  })
})

describe('arrayForStorageClass', () => {
  it('returns undefined when storageSystemId is set but the array was deleted', () => {
    const sc1 = sc({ id: 'sc-1', name: 'hitachi-csi', storageSystemId: 'missing' })
    expect(arrayForStorageClass(sc1, [sys({ id: 'a', name: 'primary' })])).toBeUndefined()
  })

  it('returns undefined when storageSystemId is empty, even when multiple arrays exist', () => {
    const sc1 = sc({ id: 'sc-1', name: 'hitachi-csi', storageSystemId: '' })
    const systems = [sys({ id: 'a', name: 'one' }), sys({ id: 'b', name: 'two' })]
    expect(arrayForStorageClass(sc1, systems)).toBeUndefined()
  })

  it('does not fall back to the first array when storageSystemId is set', () => {
    const sc1 = sc({ id: 'sc-1', name: 'hitachi-csi', storageSystemId: 'b' })
    const systems = [
      sys({ id: 'a', name: 'one', serial: '1' }),
      sys({ id: 'b', name: 'two', serial: '2' }),
    ]
    expect(arrayForStorageClass(sc1, systems)?.id).toBe('b')
  })
})

describe('gadArraysForStorageClass', () => {
  it('looks up primary/secondary by id with no fallback', () => {
    const systems = [sys({ id: 'a', name: 'one' }), sys({ id: 'b', name: 'two' })]
    const stretched = sc({
      id: 'sc-1',
      name: 'hitachi-csi-stretched',
      kind: 'stretched',
      primaryStorageSystemId: 'a',
      secondaryStorageSystemId: 'missing',
    })
    expect(gadArraysForStorageClass(stretched, systems)).toEqual({
      primary: systems[0],
      secondary: undefined,
    })
  })
})

describe('applyArrayBindingToClass', () => {
  it('copies serial and Secret metadata from the linked array', () => {
    const systems = [
      sys({
        id: 'b',
        name: 'two',
        serial: '400002',
        csiSecretName: 'secret-b',
        csiSecretNamespace: 'ns-b',
      }),
    ]
    const bound = applyArrayBindingToClass(
      sc({ id: 'sc-1', name: 'hitachi-csi', storageSystemId: 'b', secretName: 'stale', serialNumber: 'stale' }),
      systems,
      'hspc-operator-system',
    )
    expect(bound.serialNumber).toBe('400002')
    expect(bound.secretName).toBe('secret-b')
    expect(bound.secretNamespace).toBe('ns-b')
  })
})

describe('migrateArrayBinding', () => {
  it('binds a class by serial and copies secretName onto that array', () => {
    const state = createDefaultState()
    const migrated = migrateArrayBinding({
      ...state,
      storageSystems: [
        sys({ id: 'storage-1', name: 'primary', serial: '400001', csiSecretName: '' }),
        sys({ id: 'storage-2', name: 'secondary', serial: '400002', csiSecretName: '' }),
      ],
      storageClasses: [
        sc({
          id: 'sc-1',
          name: 'hitachi-csi',
          serialNumber: '400002',
          secretName: 'hitachi-csi-secret',
        }),
      ],
    } as WizardState)
    expect(migrated.storageClasses[0].storageSystemId).toBe('storage-2')
    expect(migrated.storageSystems.find((s) => s.id === 'storage-2')?.csiSecretName).toBe(
      'hitachi-csi-secret',
    )
  })

  it('keeps the first migrated secretName for a serial (first-class-wins)', () => {
    const state = createDefaultState()
    const migrated = migrateArrayBinding({
      ...state,
      storageSystems: [sys({ id: 'storage-1', name: 'primary', serial: '400002', csiSecretName: '' })],
      storageClasses: [
        sc({ id: 'sc-1', name: 'hitachi-csi-1', serialNumber: '400002', secretName: 'keep-me' }),
        sc({ id: 'sc-2', name: 'hitachi-csi-2', serialNumber: '400002', secretName: 'overwrite-me' }),
      ],
    } as WizardState)
    expect(migrated.storageSystems.find((s) => s.id === 'storage-1')?.csiSecretName).toBe('keep-me')
  })

  it('copies secretNamespace onto the array only once (first-class-wins)', () => {
    const state = createDefaultState()
    const migrated = migrateArrayBinding({
      ...state,
      storageSystems: [sys({ id: 'storage-1', name: 'primary', serial: '400002', csiSecretNamespace: '' })],
      storageClasses: [
        sc({
          id: 'sc-1',
          name: 'hitachi-csi-1',
          serialNumber: '400002',
          secretNamespace: 'keep-ns',
        }),
        sc({
          id: 'sc-2',
          name: 'hitachi-csi-2',
          serialNumber: '400002',
          secretNamespace: 'overwrite-ns',
        }),
      ],
    } as WizardState)
    expect(migrated.storageSystems.find((s) => s.id === 'storage-1')?.csiSecretNamespace).toBe(
      'keep-ns',
    )
  })

  it('binds GAD pickers from stretchedRole', () => {
    const state = createDefaultState()
    const migrated = migrateArrayBinding({
      ...state,
      storageSystems: [
        sys({
          id: 'storage-1',
          name: 'primary',
          serial: '400001',
          family: 'vsp-5000-g-e-f',
          stretchedRole: 'primary',
        }),
        sys({
          id: 'storage-2',
          name: 'secondary',
          serial: '400002',
          family: 'vsp-one-block-20',
          stretchedRole: 'secondary',
        }),
      ],
      storageClasses: [
        sc({
          id: 'sc-1',
          name: 'hitachi-csi-stretched',
          kind: 'stretched',
          stretchedSecretName: 'hitachi-csi-secret-stretched',
        }),
      ],
    } as WizardState)
    expect(migrated.storageClasses[0].primaryStorageSystemId).toBe('storage-1')
    expect(migrated.storageClasses[0].secondaryStorageSystemId).toBe('storage-2')
  })
})

