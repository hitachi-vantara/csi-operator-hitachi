import type { MetricsConfig } from '../catalog/types'

/** Normalize persisted/imported metrics blobs onto the current MetricsConfig shape. */
export function migrateMetricsConfig(raw: unknown, defaults: MetricsConfig): MetricsConfig {
  const incoming = (raw && typeof raw === 'object' ? raw : {}) as Partial<MetricsConfig> & {
    deployTestStack?: boolean
  }
  const { deployTestStack, deployPrometheus: inProm, deployGrafana: inGraf, ...rest } = incoming
  const both = typeof deployTestStack === 'boolean' ? deployTestStack : true

  return {
    ...defaults,
    ...rest,
    deployPrometheus: typeof inProm === 'boolean' ? inProm : both,
    deployGrafana: typeof inGraf === 'boolean' ? inGraf : both,
    pvcStorageClassName:
      typeof (rest as { pvcStorageClassName?: unknown }).pvcStorageClassName === 'string'
        ? (rest as { pvcStorageClassName: string }).pvcStorageClassName
        : defaults.pvcStorageClassName,
  }
}
