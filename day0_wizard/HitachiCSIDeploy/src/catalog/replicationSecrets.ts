import { getSiteStorage, hrpcPairSystem, withSiteStorage, type SiteId } from './sites'
import type { ReplicationConfig, WizardState } from './types'

export type ReplicationStorageSecret = ReplicationConfig['storageSecrets'][number]

function pairSystem(state: WizardState, site: SiteId) {
  const systems = getSiteStorage(state, site).storageSystems
  return hrpcPairSystem(systems) ?? systems[0]
}

function storedJournal(
  stored: ReplicationStorageSecret[],
  serial: string,
  index: number,
): string {
  const trimmed = serial.trim()
  const bySerial = trimmed
    ? stored.find((secret) => secret.serial.trim() === trimmed)
    : undefined
  if (bySerial?.journal != null && bySerial.journal !== '') return bySerial.journal
  return stored[index]?.journal ?? ''
}

/**
 * Replication operator storage secrets for both clusters.
 * Credentials always follow each site's Replication array; journals stay on the
 * Replication step so a leftover primary snapshot cannot overwrite secondary.
 */
export function resolvedReplicationStorageSecrets(state: WizardState): ReplicationStorageSecret[] {
  if (!state.components.replication) return state.replication.storageSecrets || []
  const stored = state.replication.storageSecrets || []
  return (['primary', 'secondary'] as const)
    .map((site, index) => {
      const sys = pairSystem(state, site)
      if (!sys) return null
      return {
        serial: sys.serial,
        url: sys.url,
        user: sys.user,
        password: sys.password,
        journal: storedJournal(stored, sys.serial, index),
      }
    })
    .filter((secret): secret is ReplicationStorageSecret => secret != null)
}

export function applyReplicationSecretPatch(
  state: WizardState,
  index: number,
  patch: Partial<ReplicationStorageSecret>,
): WizardState {
  const site: SiteId = index === 0 ? 'primary' : 'secondary'
  let next = state
  const credentialPatch = {
    ...(patch.serial !== undefined ? { serial: patch.serial } : {}),
    ...(patch.url !== undefined ? { url: patch.url } : {}),
    ...(patch.user !== undefined ? { user: patch.user } : {}),
    ...(patch.password !== undefined ? { password: patch.password } : {}),
  }
  if (Object.keys(credentialPatch).length) {
    const current = getSiteStorage(next, site)
    const pair = pairSystem(next, site)
    if (pair) {
      next = withSiteStorage(next, site, {
        ...current,
        storageSystems: current.storageSystems.map((sys) =>
          sys.id === pair.id ? { ...sys, ...credentialPatch } : sys,
        ),
      })
    }
  }
  const secrets = resolvedReplicationStorageSecrets(next)
  if (!secrets[index]) return next
  secrets[index] = { ...secrets[index], ...patch }
  return {
    ...next,
    replication: { ...next.replication, storageSecrets: secrets },
  }
}
