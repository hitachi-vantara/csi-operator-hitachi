import { describe, expect, it } from 'vitest'
import { k8sQuantityInvalidReason } from './k8sQuantity'

describe('k8sQuantityInvalidReason', () => {
  it('accepts common PVC sizes', () => {
    expect(k8sQuantityInvalidReason('1Gi')).toBeNull()
    expect(k8sQuantityInvalidReason('2Gi')).toBeNull()
    expect(k8sQuantityInvalidReason('500Mi')).toBeNull()
    expect(k8sQuantityInvalidReason('1.5Gi')).toBeNull()
    expect(k8sQuantityInvalidReason(' 1Gi ')).toBeNull()
    expect(k8sQuantityInvalidReason('+1Gi')).toBeNull()
    expect(k8sQuantityInvalidReason('1G')).toBeNull()
  })

  it('rejects a number with no unit', () => {
    expect(k8sQuantityInvalidReason('7')).toBe(
      'PVC size must include a unit (for example 1Gi or 500Mi).',
    )
    expect(k8sQuantityInvalidReason('1024')).toBe(
      'PVC size must include a unit (for example 1Gi or 500Mi).',
    )
    expect(k8sQuantityInvalidReason('1e6')).toBe(
      'PVC size must be a Kubernetes quantity (for example 1Gi or 500Mi).',
    )
  })

  it('rejects empty input', () => {
    expect(k8sQuantityInvalidReason('')).toBe('Set a PVC size (for example 1Gi).')
    expect(k8sQuantityInvalidReason('   ')).toBe('Set a PVC size (for example 1Gi).')
  })

  it('rejects unknown units (EHC-573)', () => {
    expect(k8sQuantityInvalidReason('9999999TTGi')).toBe(
      'PVC size must be a Kubernetes quantity (for example 1Gi or 500Mi).',
    )
    expect(k8sQuantityInvalidReason('1GiB')).toBe(
      'PVC size must be a Kubernetes quantity (for example 1Gi or 500Mi).',
    )
    expect(k8sQuantityInvalidReason('1 Gi')).toBe(
      'PVC size must be a Kubernetes quantity (for example 1Gi or 500Mi).',
    )
  })

  it('rejects zero and negative', () => {
    expect(k8sQuantityInvalidReason('0')).toBe(
      'PVC size must include a unit (for example 1Gi or 500Mi).',
    )
    expect(k8sQuantityInvalidReason('0Gi')).toBe('PVC size must be greater than zero.')
    expect(k8sQuantityInvalidReason('-1Gi')).toBe('PVC size must be greater than zero.')
    expect(k8sQuantityInvalidReason('1m')).toBe(
      'PVC size must be a Kubernetes quantity (for example 1Gi or 500Mi).',
    )
  })

  it('rejects overflow (EHC-572)', () => {
    const huge = `${'1'.padEnd(200, '0')}Gi`
    expect(k8sQuantityInvalidReason(huge)).toBe(
      'PVC size is too large. Use a Kubernetes quantity below 8Ei.',
    )
    expect(k8sQuantityInvalidReason('8Ei')).toBe(
      'PVC size is too large. Use a Kubernetes quantity below 8Ei.',
    )
    expect(k8sQuantityInvalidReason('7Ei')).toBeNull()
  })
})
