import type { OfflineConfig } from '../catalog/types'

/** Normalize persisted/imported offline blobs onto the current OfflineConfig shape. */
export function migrateOfflineConfig(raw: unknown, defaults: OfflineConfig): OfflineConfig {
  const incoming = (raw && typeof raw === 'object' ? raw : {}) as Partial<OfflineConfig>

  const str = (value: unknown, fallback: string) =>
    typeof value === 'string' ? value : fallback

  const optStr = (value: unknown) =>
    typeof value === 'string' && value.trim() ? value : undefined

  return {
    registryBase: str(incoming.registryBase, defaults.registryBase),
    catalogSourceName: str(incoming.catalogSourceName, defaults.catalogSourceName),
    catalogIndexImage: str(incoming.catalogIndexImage, defaults.catalogIndexImage),
    hspcPath: optStr(incoming.hspcPath),
    hrpcPath: optStr(incoming.hrpcPath),
    hsppPath: optStr(incoming.hsppPath),
  }
}
