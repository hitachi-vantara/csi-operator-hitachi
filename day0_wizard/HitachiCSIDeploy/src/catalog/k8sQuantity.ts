/** Kubernetes resource.Quantity maximum magnitude (2^63-1). 8Ei overflows. */
export const K8S_QUANTITY_MAX_BYTES = (1n << 63n) - 1n

const EMPTY = 'Set a PVC size (for example 1Gi).'
const MISSING_UNIT = 'PVC size must include a unit (for example 1Gi or 500Mi).'
const FORMAT = 'PVC size must be a Kubernetes quantity (for example 1Gi or 500Mi).'
const ZERO = 'PVC size must be greater than zero.'
const OVERFLOW = 'PVC size is too large. Use a Kubernetes quantity below 8Ei.'

const BINARY: Record<string, bigint> = {
  Ki: 1n << 10n,
  Mi: 1n << 20n,
  Gi: 1n << 30n,
  Ti: 1n << 40n,
  Pi: 1n << 50n,
  Ei: 1n << 60n,
}

const DECIMAL: Record<string, bigint> = {
  k: 1000n,
  M: 1000n ** 2n,
  G: 1000n ** 3n,
  T: 1000n ** 4n,
  P: 1000n ** 5n,
  E: 1000n ** 6n,
}

const BODY_RE = /^([+-])?(?:(\d+)(?:\.(\d*))?|\.(\d+))(.*)$/

function suffixMultiplier(suffix: string): { mul: bigint; div: bigint } | null {
  if (BINARY[suffix]) return { mul: BINARY[suffix], div: 1n }
  if (DECIMAL[suffix]) return { mul: DECIMAL[suffix], div: 1n }
  return null
}

/**
 * Null when `raw` is a Kubernetes Quantity with a size unit, in (0, 2^63-1] bytes.
 * A bare number (bytes) is rejected; PVC size must include a unit such as Gi.
 */
export function k8sQuantityInvalidReason(raw: string): string | null {
  const s = raw.trim()
  if (!s) return EMPTY
  const m = BODY_RE.exec(s)
  if (!m) return FORMAT
  const sign = m[1]
  if (sign === '-') return ZERO
  const whole = m[2] ?? '0'
  const frac = m[3] ?? m[4] ?? ''
  const suffix = m[5] ?? ''
  if (suffix === '') return MISSING_UNIT
  const scale = suffixMultiplier(suffix)
  if (!scale) return FORMAT
  const digits = (whole + frac).replace(/^0+/, '') || '0'
  const scaleDiv = 10n ** BigInt(frac.length)
  const mantissa = BigInt(digits)
  const numerator = mantissa * scale.mul
  const denominator = scale.div * scaleDiv
  if (numerator === 0n) return ZERO
  if (numerator / denominator < 1n) return ZERO
  if (numerator / denominator > K8S_QUANTITY_MAX_BYTES) return OVERFLOW
  return null
}
