import { describe, expect, it } from 'vitest'
import { createDefaultState } from '../catalog/types'
import { migrateOfflineConfig } from './migrateOffline'

describe('migrateOfflineConfig', () => {
  it('fills defaults when offline is missing from saved state', () => {
    const defaults = createDefaultState().offline
    const migrated = migrateOfflineConfig(undefined, defaults)

    expect(migrated).toEqual({
      registryBase: '',
      catalogSourceName: 'certified-operators',
      catalogIndexImage: '',
    })
    expect(migrated.hspcPath).toBeUndefined()
    expect(migrated.hrpcPath).toBeUndefined()
    expect(migrated.hsppPath).toBeUndefined()
  })

  it('preserves registry fields and trims empty path overrides', () => {
    const defaults = createDefaultState().offline
    const migrated = migrateOfflineConfig(
      {
        registryBase: 'mirror.local:5000/csi',
        catalogSourceName: 'my-operators',
        catalogIndexImage: 'mirror.local/catalog:latest',
        hspcPath: 'custom/hspc',
        hrpcPath: '',
        hsppPath: '   ',
      },
      defaults,
    )

    expect(migrated.registryBase).toBe('mirror.local:5000/csi')
    expect(migrated.catalogSourceName).toBe('my-operators')
    expect(migrated.catalogIndexImage).toBe('mirror.local/catalog:latest')
    expect(migrated.hspcPath).toBe('custom/hspc')
    expect(migrated.hrpcPath).toBeUndefined()
    expect(migrated.hsppPath).toBeUndefined()
  })
})
