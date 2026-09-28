import type {
  SiteId,
  SiteQuickstartConfig,
  SiteStorageConfig,
  StorageClassConfig,
  StorageSystemConfig,
  WizardState,
} from './types'
import { siteMetricsFromGlobal } from './siteMetrics'

export type { SiteId }

function withoutHrpcPair(sys: StorageSystemConfig): StorageSystemConfig {
  // Omit `hrpcPair` rather than setting false, to keep JSON minimal.
  const next: StorageSystemConfig = { ...sys }
  delete (next as Partial<StorageSystemConfig>).hrpcPair
  return next
}

function withoutHrpcPairId(sc: StorageClassConfig): StorageClassConfig {
  // Omit `hrpcPairId` rather than setting empty string, to keep JSON minimal.
  const next: StorageClassConfig = { ...sc }
  delete (next as Partial<StorageClassConfig>).hrpcPairId
  return next
}

export function createEmptySiteStorage(
  partial?: Partial<SiteStorageConfig>,
): SiteStorageConfig {
  return {
    storageSystems: partial?.storageSystems ?? [],
    storageClasses: partial?.storageClasses ?? [],
    ...(partial?.metrics ? { metrics: partial.metrics } : {}),
    ...(partial?.quickstart ? { quickstart: partial.quickstart } : {}),
  }
}

export function hrpcPairSystem(
  systems: StorageSystemConfig[],
): StorageSystemConfig | undefined {
  return systems.find((s) => !!s.hrpcPair)
}

export function setHrpcPair(
  systems: StorageSystemConfig[],
  id: string,
): StorageSystemConfig[] {
  return systems.map((sys) =>
    sys.id === id
      ? { ...sys, hrpcPair: true, stretchedRole: 'none' as const }
      : withoutHrpcPair(sys),
  )
}

export function setHrpcPairOnSite(
  site: SiteStorageConfig,
  id: string,
): SiteStorageConfig {
  const nextSystems = setHrpcPair(site.storageSystems, id)
  const nextClasses = site.storageClasses.map((sc) => {
    const pairId = (sc.hrpcPairId || '').trim()
    if (!pairId) return sc
    if (sc.storageSystemId === id) return sc
    return { ...sc, storageSystemId: id }
  })
  return { ...site, storageSystems: nextSystems, storageClasses: nextClasses }
}

function primaryHrpcStorageClass(
  primary: SiteStorageConfig,
): StorageClassConfig | undefined {
  return (
    primary.storageClasses.find((sc) => !!sc.hrpcPairId) ??
    primary.storageClasses.find((sc) => sc.kind === 'standard') ??
    primary.storageClasses[0]
  )
}

export function seedSecondaryFromPrimary(
  primary: SiteStorageConfig,
): SiteStorageConfig {
  const pairSys =
    hrpcPairSystem(primary.storageSystems) ?? primary.storageSystems[0]
  const seededSystem: StorageSystemConfig = pairSys
    ? {
        ...pairSys,
        id: `${pairSys.id}-secondary`,
        name: 'secondary',
        serial: '',
        url: '',
        user: '',
        password: '',
        csiSecretName: pairSys.csiSecretName ?? 'hitachi-csi-secret',
        csiSecretNamespace: pairSys.csiSecretNamespace ?? '',
        hrpcPair: true,
        stretchedRole: 'none',
      }
    : {
        id: 'storage-1-secondary',
        name: 'secondary',
        serial: '',
        url: '',
        user: '',
        password: '',
        csiSecretName: 'hitachi-csi-secret',
        csiSecretNamespace: '',
        hrpcPair: true,
        stretchedRole: 'none',
      }
  if (seededSystem.resourceGroupID !== undefined) {
    delete (seededSystem as Partial<StorageSystemConfig>).resourceGroupID
  }

  const primaryHrpcSc = primaryHrpcStorageClass(primary)
  const pairId = primaryHrpcSc?.hrpcPairId || 'hrpc-sc-1'
  const seededSc: StorageClassConfig = primaryHrpcSc
    ? {
        ...primaryHrpcSc,
        id: `${primaryHrpcSc.id}-secondary`,
        hrpcPairId: pairId,
        storageSystemId: seededSystem.id,
        serialNumber: '',
        poolID: '',
        portID: '',
        nvmSubsystemID: '',
      }
    : {
        id: 'sc-hrpc-1-secondary',
        kind: 'standard',
        name: 'hitachi-csi',
        connectionType: 'fc',
        secretName: 'hitachi-csi-secret',
        secretNamespace: 'hspc-operator-system',
        storageSystemId: seededSystem.id,
        hrpcPairId: pairId,
        serialNumber: '',
        poolID: '',
        portID: '',
        fstype: 'ext4',
        reclaimPolicy: 'Delete',
        volumeBindingMode: 'Immediate',
        allowVolumeExpansion: true,
      }

  // Enforce paired SC invariants: name/fstype must match across sites.
  seededSc.name = primaryHrpcSc?.name ?? seededSc.name
  seededSc.fstype = primaryHrpcSc?.fstype ?? seededSc.fstype

  return {
    storageSystems: [seededSystem],
    storageClasses: [seededSc],
  }
}

function buildPrimaryFromTopLevel(state: WizardState): SiteStorageConfig {
  const primarySystems = (state.storageSystems || []).map((sys, idx) =>
    idx === 0 ? { ...sys, hrpcPair: true, stretchedRole: 'none' as const } : withoutHrpcPair(sys),
  )

  const primaryStorageClasses = (state.storageClasses || []).map((sc) =>
    withoutHrpcPairId(sc),
  )

  let pairIdx = primaryStorageClasses.findIndex((sc) => sc.kind === 'standard')
  if (pairIdx < 0 && primaryStorageClasses.length > 0) pairIdx = 0
  if (pairIdx >= 0) {
    primaryStorageClasses[pairIdx] = {
      ...primaryStorageClasses[pairIdx],
      hrpcPairId: primaryStorageClasses[pairIdx].hrpcPairId || 'hrpc-sc-1',
    }
  }

  return createEmptySiteStorage({
    storageSystems: primarySystems,
    storageClasses: primaryStorageClasses,
  })
}

function clearGadRoleOnReplicationArrays(site: SiteStorageConfig): SiteStorageConfig {
  let changed = false
  const storageSystems = site.storageSystems.map((sys) => {
    if (!sys.hrpcPair) return sys
    if ((sys.stretchedRole || 'none') === 'none') return sys
    changed = true
    return { ...sys, stretchedRole: 'none' as const }
  })
  return changed ? { ...site, storageSystems } : site
}

export function ensureSitesForReplication(state: WizardState): WizardState {
  if (!state.components.replication) return state

  const primary = clearGadRoleOnReplicationArrays(
    state.sites?.primary ?? buildPrimaryFromTopLevel(state),
  )
  const secondary = clearGadRoleOnReplicationArrays(
    state.sites?.secondary ?? seedSecondaryFromPrimary(primary),
  )

  const seeded = siteMetricsFromGlobal(state.metrics, state.consolePlugin)
  const primaryWithMetrics = primary.metrics ? primary : { ...primary, metrics: seeded }
  const secondaryWithMetrics = secondary.metrics
    ? secondary
    : { ...secondary, metrics: { ...(primaryWithMetrics.metrics ?? seeded) } }

  const seededQs: SiteQuickstartConfig = {
    install: true,
    ...state.quickstart,
  }
  const primaryWithQs = primaryWithMetrics.quickstart
    ? primaryWithMetrics
    : { ...primaryWithMetrics, quickstart: seededQs }
  const secondaryWithQs = secondaryWithMetrics.quickstart
    ? secondaryWithMetrics
    : { ...secondaryWithMetrics, quickstart: { ...(primaryWithQs.quickstart ?? seededQs) } }

  if (
    state.sites?.primary === primaryWithQs &&
    state.sites?.secondary === secondaryWithQs
  ) {
    return state
  }

  return {
    ...state,
    sites: { primary: primaryWithQs, secondary: secondaryWithQs },
  }
}

export function getSiteStorage(
  state: WizardState,
  site: SiteId,
): SiteStorageConfig {
  if (state.components.replication) {
    const ensured = ensureSitesForReplication(state)
    return (
      ensured.sites?.[site] ??
      (site === 'primary'
        ? buildPrimaryFromTopLevel(state)
        : createEmptySiteStorage())
    )
  }
  if (site === 'primary') {
    return createEmptySiteStorage({
      storageSystems: state.storageSystems || [],
      storageClasses: state.storageClasses || [],
    })
  }
  return createEmptySiteStorage()
}

export function withSiteStorage(
  state: WizardState,
  site: SiteId,
  next: SiteStorageConfig,
): WizardState {
  if (!state.components.replication) {
    if (site !== 'primary') return state
    return {
      ...state,
      storageSystems: next.storageSystems,
      storageClasses: next.storageClasses,
    }
  }

  const ensured = ensureSitesForReplication(state)
  return {
    ...ensured,
    sites: {
      primary: ensured.sites!.primary,
      secondary: ensured.sites!.secondary,
      [site]: next,
    },
  }
}

// Back-compat aliases for earlier task wording.
export const ensureSites = ensureSitesForReplication
export const seedSecondarySite = seedSecondaryFromPrimary

export function updateSiteStorage(
  state: WizardState,
  site: SiteId,
  patch: Partial<SiteStorageConfig>,
): WizardState {
  const current = getSiteStorage(state, site)
  return withSiteStorage(state, site, { ...current, ...patch })
}

function trimName(value: string | undefined): string {
  return (value || '').trim()
}

/** Pick a StorageClass that exists in `classes` (saved name, else default, else first). */
export function pickStorageClassName(
  classes: StorageClassConfig[],
  saved?: string,
): string {
  const names = classes.map((sc) => (sc.name || '').trim()).filter(Boolean)
  const want = (saved || '').trim()
  if (want && names.includes(want)) return want
  const def = classes.find((sc) => sc.isDefault && (sc.name || '').trim())
  if (def) return def.name.trim()
  return names[0] || 'hitachi-csi'
}

/**
 * CSI Secret metadata.name for a storage system. Prefers the array’s `csiSecretName`,
 * and may fall back to StorageClass `secretName` for older states/migrations.
 * Does not suffix `-${system.name}` for a single-array site — that collided with
 * Replication secondary sites whose array is named "secondary".
 */
export function standardSecretNameForSystem(
  sys: StorageSystemConfig,
  systems: StorageSystemConfig[],
  classes: StorageClassConfig[],
): string {
  const fallback = 'hitachi-csi-secret'
  const owned = trimName(sys.csiSecretName)
  if (owned) {
    const collisions = systems.filter((s) => trimName(s.csiSecretName) === owned).length
    if (collisions <= 1) return owned
    // Back-compat: when older callers clone systems (duplicate owned names),
    // fall back to the historical suffixing heuristic to keep names unique.
  }
  const standard = classes.filter((sc) => sc.kind !== 'stretched' && sc.kind !== 'stretched-adr')
  const bySerial = standard.find(
    (sc) =>
      trimName(sc.serialNumber) &&
      trimName(sc.serialNumber) === trimName(sys.serial) &&
      trimName(sc.secretName),
  )
  if (bySerial) return trimName(bySerial.secretName)

  const secretNames = [...new Set(standard.map((sc) => trimName(sc.secretName)).filter(Boolean))]
  if (systems.length <= 1) {
    return secretNames[0] || trimName(classes[0]?.secretName) || fallback
  }

  const primaryName = secretNames[0] || trimName(classes[0]?.secretName) || fallback
  const first = systems[0]
  const isFirst = sys.id === first?.id || trimName(sys.name) === 'primary'

  if (secretNames.length === 1 && standard.length > 0) {
    const owner =
      systems.find((item) =>
        standard.some((sc) => trimName(sc.serialNumber) === trimName(item.serial) && trimName(item.serial)),
      ) || first
    if (sys.id === owner.id) return secretNames[0]
    return `${primaryName}-${sys.name || sys.id}`
  }

  if (secretNames.length > 1) {
    const idx = systems.findIndex((item) => item.id === sys.id)
    return (idx >= 0 && secretNames[idx]) || secretNames[0]
  }

  if (isFirst) return primaryName
  return `${primaryName}-${sys.name || sys.id}`
}

export function standardSecretNamespaceForSystem(
  sys: StorageSystemConfig,
  systems: StorageSystemConfig[],
  classes: StorageClassConfig[],
  driverNamespace: string,
): string {
  const owned = trimName(sys.csiSecretNamespace)
  const ownedName = trimName(sys.csiSecretName)
  if (ownedName || owned) {
    const collisions = ownedName
      ? systems.filter((s) => trimName(s.csiSecretName) === ownedName).length
      : 0
    if (collisions <= 1) return owned || driverNamespace
  }
  const name = standardSecretNameForSystem(sys, systems, classes)
  const match = classes.find((sc) => trimName(sc.secretName) === name && trimName(sc.secretNamespace))
  return trimName(match?.secretNamespace) || trimName(classes[0]?.secretNamespace) || driverNamespace
}

/** StorageClasses used for wizard-wide UI names (Test volume step, primary site). */
export function packageStorageClasses(state: WizardState): StorageClassConfig[] {
  if (!state.storageClassesEnabled) return []
  if (state.components.replication) return getSiteStorage(state, 'primary').storageClasses
  return state.storageClasses || []
}

/**
 * Live StorageClass name for Grafana/Prometheus PVCs, DR operator, and the test volume
 * in the wizard UI (Replication: primary site). Ignores a saved name that no longer exists.
 */
export function resolvedStorageClassName(state: WizardState): string {
  return pickStorageClassName(packageStorageClasses(state), state.quickstart?.storageClassName)
}

/**
 * StorageClass name for the current `state.storageClasses` (site-scoped during dual-site export).
 */
export function resolvedCurrentStorageClassName(state: WizardState): string {
  if (!state.storageClassesEnabled) return 'hitachi-csi'
  return pickStorageClassName(state.storageClasses || [], state.quickstart?.storageClassName)
}

