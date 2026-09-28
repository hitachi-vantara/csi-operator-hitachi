import { describe, expect, it } from 'vitest'
import { createDefaultState } from '../catalog/types'
import { migrateMetricsConfig } from './migrateMetrics'

describe('migrateMetricsConfig', () => {
  it('fills pvcStorageClassName when older saves omit it', () => {
    const defaults = createDefaultState().metrics
    const migrated = migrateMetricsConfig({ namespace: 'ns' }, defaults)
    expect(migrated.pvcStorageClassName).toBe('')
    expect(migrated.namespace).toBe('ns')
  })
})
