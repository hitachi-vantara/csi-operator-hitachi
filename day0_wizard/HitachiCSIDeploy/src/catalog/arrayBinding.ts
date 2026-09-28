import { supportsStretchedGad } from './platforms'
import { nextUniqueName } from './uniqueName'
import type { StorageClassConfig, StorageSystemConfig, WizardState } from './types'

export const DEFAULT_CSI_SECRET_NAME = 'hitachi-csi-secret'

function t(v: string | undefined | null): string {
  return (v || '').trim()
}

function defaultedCsiSecretName(sys: StorageSystemConfig): string {
  return t(sys.csiSecretName) || DEFAULT_CSI_SECRET_NAME
}

export function csiSecretRefForSystem(
  sys: StorageSystemConfig,
  driverNamespace: string,
): { name: string; namespace: string } {
  return {
    name: defaultedCsiSecretName(sys),
    namespace: t(sys.csiSecretNamespace) || t(driverNamespace),
  }
}

export function nextCsiSecretName(systems: StorageSystemConfig[]): string {
  const taken = systems.map((s) => defaultedCsiSecretName(s)).filter(Boolean)
  return nextUniqueName(DEFAULT_CSI_SECRET_NAME, taken)
}

export function defaultStorageSystemId(systems: StorageSystemConfig[]): string {
  const pair = systems.find((s) => !!s.hrpcPair)
  return pair?.id || systems[0]?.id || ''
}

export function defaultGadArrayIds(systems: StorageSystemConfig[]): {
  primaryStorageSystemId: string
  secondaryStorageSystemId: string
} {
  const gad = systems.filter((s) => supportsStretchedGad(s.family))
  return {
    primaryStorageSystemId: gad[0]?.id || '',
    secondaryStorageSystemId: gad[1]?.id || '',
  }
}

export function arrayForStorageClass(
  sc: StorageClassConfig,
  systems: StorageSystemConfig[],
): StorageSystemConfig | undefined {
  const id = t(sc.storageSystemId)
  if (!id) return undefined
  return systems.find((s) => s.id === id)
}

export function gadArraysForStorageClass(
  sc: StorageClassConfig,
  systems: StorageSystemConfig[],
): { primary?: StorageSystemConfig; secondary?: StorageSystemConfig } {
  const primaryId = t(sc.primaryStorageSystemId)
  const secondaryId = t(sc.secondaryStorageSystemId)
  return {
    primary: primaryId ? systems.find((s) => s.id === primaryId) : undefined,
    secondary: secondaryId ? systems.find((s) => s.id === secondaryId) : undefined,
  }
}

export function applyArrayBindingToClass(
  sc: StorageClassConfig,
  systems: StorageSystemConfig[],
  driverNamespace: string,
): StorageClassConfig {
  const id = t(sc.storageSystemId)
  if (!id) return sc
  const sys = systems.find((s) => s.id === id)
  if (!sys) return sc
  const secret = csiSecretRefForSystem(sys, driverNamespace)
  return {
    ...sc,
    serialNumber: t(sys.serial),
    secretName: secret.name,
    secretNamespace: secret.namespace,
  }
}

function migrateSiteArrayBinding(site: {
  storageSystems: StorageSystemConfig[]
  storageClasses: StorageClassConfig[]
}): { storageSystems: StorageSystemConfig[]; storageClasses: StorageClassConfig[] } {
  const systems = site.storageSystems || []
  const classes = site.storageClasses || []

  // Ensure every array has a Secret name/namespace field, even if empty (migration fills below).
  let migratedSystems = systems.map((sys) => ({
    ...sys,
    csiSecretName: (sys as StorageSystemConfig).csiSecretName ?? '',
    csiSecretNamespace: (sys as StorageSystemConfig).csiSecretNamespace ?? '',
  }))

  const bySerial = new Map<string, string>()
  for (const sys of migratedSystems) {
    const serial = t(sys.serial)
    if (serial) bySerial.set(serial, sys.id)
  }

  const migratedClasses = classes.map((sc) => {
    // Standard / SDS: bind by storageSystemId; migrate from serialNumber when missing.
    if (sc.kind !== 'stretched' && sc.kind !== 'stretched-adr') {
      if (t(sc.storageSystemId)) return sc
      const matchId = bySerial.get(t(sc.serialNumber)) || migratedSystems[0]?.id || ''
      if (!matchId) return sc

      const current = migratedSystems.find((s) => s.id === matchId)
      if (!current) return sc

      const secretName = t(sc.secretName) || DEFAULT_CSI_SECRET_NAME
      const secretNamespace = t(sc.secretNamespace)

      if (!t(current.csiSecretName) || (!t(current.csiSecretNamespace) && secretNamespace)) {
        migratedSystems = migratedSystems.map((sys) => {
          if (sys.id !== matchId) return sys
          return {
            ...sys,
            csiSecretName: t(sys.csiSecretName) ? sys.csiSecretName : secretName,
            csiSecretNamespace:
              t(sys.csiSecretNamespace) || !secretNamespace ? sys.csiSecretNamespace : secretNamespace,
          }
        })
      }

      return { ...sc, storageSystemId: matchId }
    }

    // Stretched / GAD: migrate pickers from stretchedRole when missing.
    if (t(sc.primaryStorageSystemId) && t(sc.secondaryStorageSystemId)) return sc

    const gad = migratedSystems.filter((s) => supportsStretchedGad(s.family))
    const primary =
      gad.find((s) => s.stretchedRole === 'primary') || gad[0] || migratedSystems[0]
    const secondary =
      gad.find((s) => s.stretchedRole === 'secondary') || gad[1] || gad[0] || migratedSystems[1]

    return {
      ...sc,
      primaryStorageSystemId: primary?.id || '',
      secondaryStorageSystemId: secondary?.id || '',
    }
  })

  return { storageSystems: migratedSystems, storageClasses: migratedClasses }
}

export function migrateArrayBinding(state: WizardState): WizardState {
  if (state.components.replication && state.sites) {
    const primary = migrateSiteArrayBinding(state.sites.primary)
    const secondary = migrateSiteArrayBinding(state.sites.secondary)
    if (
      primary.storageSystems === state.sites.primary.storageSystems &&
      primary.storageClasses === state.sites.primary.storageClasses &&
      secondary.storageSystems === state.sites.secondary.storageSystems &&
      secondary.storageClasses === state.sites.secondary.storageClasses
    ) {
      return state
    }
    return {
      ...state,
      sites: {
        primary: { ...state.sites.primary, ...primary },
        secondary: { ...state.sites.secondary, ...secondary },
      },
    }
  }

  const migrated = migrateSiteArrayBinding({
    storageSystems: state.storageSystems || [],
    storageClasses: state.storageClasses || [],
  })

  return {
    ...state,
    storageSystems: migrated.storageSystems,
    storageClasses: migrated.storageClasses,
  }
}

