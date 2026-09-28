import { useEffect } from 'react'
import {
  CONNECTION_TYPES,
  PLATFORMS,
  coerceConnectionType,
  connectionsForStorageClassKind,
  gadPairSystems,
  isStretchedKind,
  isVspOneBlock20,
  storageClassKindsForSystems,
  supportsStretchedGad,
  supportsCsiVolumeSnapshots,
  supportsImmutableSnapshots,
} from '../catalog/platforms'
import { HELP } from '../catalog/help'
import type {
  ConnectionType,
  NodeEnvironment,
  SiteStorageConfig,
  StorageClassConfig,
  StorageClassKind,
  StorageSystemConfig,
} from '../catalog/types'
import {
  nextUniqueName,
  portIdWithoutMultipathWarning,
  siteStorageClassesReady,
  siteStorageSystemsReady,
  validateStorageClass,
} from '../catalog/validation'
import {
  applyArrayBindingToClass,
  defaultGadArrayIds,
  defaultStorageSystemId,
  gadArraysForStorageClass,
} from '../catalog/arrayBinding'
import type { SiteId } from '../catalog/sites'
import { quickstartForSite, withSiteQuickstart } from '../catalog/siteQuickstart'
import { ensureSitesForReplication, getSiteStorage, hrpcPairSystem, withSiteStorage } from '../catalog/sites'
import { generateSnapshotClass, generateStorageClass, snapshotClassOpts } from '../generator/yaml'
import { AdvancedSection } from '../components/AdvancedSection'
import { SiteSwitcher } from '../components/SiteSwitcher'
import { GadStretchedPvcDiagram } from '../components/GadStretchedPvcDiagram'
import { useWizard } from '../state/WizardContext'
import { useUiMode } from '../state/UiModeContext'
import { useSiteTab } from '../state/useSiteTab'
import { Callout, CodeBlock, Field, HelpTip, Section } from '../components/ui'

function arrayOptionLabel(sys: StorageSystemConfig): string {
  const name = (sys.name || '').trim() || 'Unnamed array'
  const serial = (sys.serial || '').trim()
  return serial ? `${name} (${serial})` : name
}

function defaultSc(
  kind: StorageClassKind,
  connectionType: ConnectionType,
  nodeEnvironment: NodeEnvironment,
  secretNamespace: string,
  systems: StorageSystemConfig[],
): StorageClassConfig {
  const allowed = connectionsForStorageClassKind(kind, nodeEnvironment)
  const base: StorageClassConfig = {
    id: `sc-${Date.now()}`,
    kind,
    name:
      kind === 'standard'
        ? 'hitachi-csi'
        : kind === 'vsp-one-sds-block'
          ? 'hitachi-csi-sds'
          : kind === 'stretched-adr'
            ? 'hitachi-csi-stretched-adr'
            : 'hitachi-csi-stretched',
    connectionType: coerceConnectionType(connectionType, allowed),
    secretName: 'hitachi-csi-secret',
    secretNamespace,
    reclaimPolicy: 'Delete',
    volumeBindingMode: 'Immediate',
    allowVolumeExpansion: kind === 'stretched' || kind === 'stretched-adr' ? false : true,
    fstype: 'ext4',
    storageEfficiency: 'Disabled',
  }
  if (kind === 'standard' || kind === 'vsp-one-sds-block') {
    base.storageSystemId = defaultStorageSystemId(systems)
  }
  if (kind === 'stretched' || kind === 'stretched-adr') {
    const gad = defaultGadArrayIds(systems)
    base.primaryStorageSystemId = gad.primaryStorageSystemId
    base.secondaryStorageSystemId = gad.secondaryStorageSystemId
    base.stretchedSecretName = 'hitachi-csi-secret-stretched'
    base.copyGroupName = 'spc-cpg1'
    base.consistencyGroupId = '1'
  }
  return base
}

function allowedKindsForSc(
  systems: SiteStorageConfig['storageSystems'],
  usedForReplication: boolean,
): StorageClassKind[] {
  if (usedForReplication) return ['standard']
  return storageClassKindsForSystems(systems)
}

function coerceScToAllowedKind(
  sc: StorageClassConfig,
  allowed: StorageClassKind[],
  connectionType: ConnectionType,
  nodeEnvironment: NodeEnvironment,
  secretNamespace: string,
  systems: StorageSystemConfig[],
): StorageClassConfig {
  if (allowed.includes(sc.kind)) return sc
  const next = defaultSc(allowed[0] ?? 'standard', connectionType, nodeEnvironment, secretNamespace, systems)
  next.id = sc.id
  next.name = sc.name
  next.secretName = sc.secretName
  next.secretNamespace = sc.secretNamespace
  next.isDefault = sc.isDefault
  if (sc.hrpcPairId) next.hrpcPairId = sc.hrpcPairId
  return next
}

export function StorageClassesStep() {
  const { state, setState } = useWizard()
  const { isAdvanced } = useUiMode()
  const replicationOn = state.components.replication
  const clusterLabel = PLATFORMS[state.platform].useOc ? 'OpenShift cluster' : 'Kubernetes cluster'
  const [site, setSite] = useSiteTab(replicationOn)
  const ensured = replicationOn ? ensureSitesForReplication(state) : state
  const storage: SiteStorageConfig = replicationOn
    ? getSiteStorage(ensured, site)
    : { storageSystems: ensured.storageSystems, storageClasses: ensured.storageClasses }
  const primary = replicationOn ? getSiteStorage(ensured, 'primary').storageSystems[0] : state.storageSystems[0]
  const previewSc = storage.storageClasses[0]
  const canImmutableSnapshots = supportsImmutableSnapshots(primary)
  const snapshotsSupported = supportsCsiVolumeSnapshots(storage.storageClasses)

  useEffect(() => {
    if (!state.storageClassesEnabled) return
    setState((s) => {
      const coerceList = (
        systems: SiteStorageConfig['storageSystems'],
        classes: StorageClassConfig[],
      ): StorageClassConfig[] | null => {
        let changed = false
        const next = classes.map((sc) => {
          const allowed = allowedKindsForSc(systems, !!(sc.hrpcPairId || '').trim())
          const coerced = coerceScToAllowedKind(
            sc,
            allowed,
            s.connectionType,
            s.nodeEnvironment,
            s.driverNamespace,
            systems,
          )
          if (coerced === sc) return sc
          changed = true
          return coerced
        })
        return changed ? next : null
      }

      if (s.components.replication) {
        const ensured = ensureSitesForReplication(s)
        const p = getSiteStorage(ensured, 'primary')
        const sec = getSiteStorage(ensured, 'secondary')
        const np = coerceList(p.storageSystems, p.storageClasses)
        const ns = coerceList(sec.storageSystems, sec.storageClasses)
        if (!np && !ns) return s
        return {
          ...ensured,
          sites: {
            primary: np ? { ...p, storageClasses: np } : p,
            secondary: ns ? { ...sec, storageClasses: ns } : sec,
          },
        }
      }
      const next = coerceList(s.storageSystems, s.storageClasses)
      if (!next) return s
      return { ...s, storageClasses: next }
    })
  }, [
    state.storageClassesEnabled,
    state.components.replication,
    state.storageSystems,
    state.storageClasses,
    state.sites,
    setState,
  ])

  function systemsWithHrpcFirst(systems: SiteStorageConfig['storageSystems']) {
    const pair = hrpcPairSystem(systems)
    if (!pair) return systems
    return [pair, ...systems.filter((s) => s !== pair)]
  }

  const updateSc = (id: string, patch: Partial<StorageClassConfig>) => {
    setState((s) => {
      if (!s.components.replication) {
        const prev = s.storageClasses.find((sc) => sc.id === id)
        const nextClasses = s.storageClasses.map((sc) => {
          if (sc.id !== id) return sc
          const next = { ...sc, ...patch }
          if (next.kind === 'stretched' || next.kind === 'stretched-adr') {
            next.allowVolumeExpansion = false
          }
          const allowed = connectionsForStorageClassKind(next.kind, s.nodeEnvironment)
          next.connectionType = coerceConnectionType(next.connectionType, allowed)
          return next
        })
        const nextScName =
          patch.name !== undefined &&
          prev &&
          (s.quickstart.storageClassName || '').trim() === (prev.name || '').trim()
            ? patch.name
            : s.quickstart.storageClassName
        return {
          ...s,
          storageClasses: nextClasses,
          quickstart: {
            ...s.quickstart,
            storageClassName: nextScName,
          },
        }
      }

      const ensured = ensureSitesForReplication(s)
      const current = getSiteStorage(ensured, site)
      const sc = current.storageClasses.find((x) => x.id === id)
      if (!sc) return s

      const pairId = (sc.hrpcPairId || '').trim()
      const sharedPatch: Partial<StorageClassConfig> = {}
      if (pairId) {
        if (patch.name !== undefined) sharedPatch.name = patch.name
        if (patch.fstype !== undefined) sharedPatch.fstype = patch.fstype
      }

      const siteOnlyPatch: Partial<StorageClassConfig> = { ...patch }
      // Paired fields are always mirrored across sites for Replication SCs.
      if (pairId) {
        delete (siteOnlyPatch as Partial<StorageClassConfig>).name
        delete (siteOnlyPatch as Partial<StorageClassConfig>).fstype
      }

      const patchOne = (storage: SiteStorageConfig): SiteStorageConfig => {
        return {
          ...storage,
          storageClasses: storage.storageClasses.map((x) => {
            const samePair = !!(pairId && (x.hrpcPairId || '').trim() === pairId)
            const isTarget = x.id === id
            if (!isTarget && !samePair) return x

            let next = { ...x }
            // Name/fstype stay in lockstep across sites for StorageClasses used for Replication.
            if (samePair) next = { ...next, ...sharedPatch }
            // Pool, ports, serial, secret, etc. stay local to the StorageClass being edited.
            if (isTarget) {
              next = { ...next, ...siteOnlyPatch }
              if (next.kind === 'stretched' || next.kind === 'stretched-adr') {
                next.allowVolumeExpansion = false
              }
              const allowed = connectionsForStorageClassKind(next.kind, ensured.nodeEnvironment)
              next.connectionType = coerceConnectionType(next.connectionType, allowed)
            }
            return next
          }),
        }
      }

      const primary = patchOne(getSiteStorage(ensured, 'primary'))
      const secondary = patchOne(getSiteStorage(ensured, 'secondary'))
      const siteQs = quickstartForSite(ensured, site)
      const nextScName =
        patch.name !== undefined &&
        (siteQs.storageClassName || '').trim() === (sc.name || '').trim()
          ? patch.name
          : siteQs.storageClassName
      return withSiteQuickstart(
        {
          ...ensured,
          sites: { primary, secondary },
        },
        site,
        { storageClassName: nextScName },
      )
    })
  }

  const removeSc = (id: string) => {
    setState((s) => {
      if (!s.components.replication) {
        return {
          ...s,
          storageClasses: s.storageClasses.filter((x) => x.id !== id),
        }
      }
      const ensured = ensureSitesForReplication(s)
      const current = getSiteStorage(ensured, site)
      const sc = current.storageClasses.find((x) => x.id === id)
      const pairId = (sc?.hrpcPairId || '').trim()
      const drop = (storage: SiteStorageConfig): SiteStorageConfig => ({
        ...storage,
        storageClasses: storage.storageClasses.filter((x) => {
          if (x.id === id) return false
          if (pairId && (x.hrpcPairId || '').trim() === pairId) return false
          return true
        }),
      })
      return {
        ...ensured,
        sites: {
          primary: drop(getSiteStorage(ensured, 'primary')),
          secondary: drop(getSiteStorage(ensured, 'secondary')),
        },
      }
    })
  }

  const toggleUseForReplication = (id: string, on: boolean) => {
    setState((s) => {
      const ensured = ensureSitesForReplication(s)
      const current = getSiteStorage(ensured, site)
      const otherSite: SiteId = site === 'primary' ? 'secondary' : 'primary'
      const other = getSiteStorage(ensured, otherSite)
      const sc = current.storageClasses.find((x) => x.id === id)
      if (!sc) return s

      if (on) {
        if (sc.kind !== 'standard') return s
        const pairId = (sc.hrpcPairId || '').trim() || `hrpc-sc-${Date.now()}`
        const currentPair = hrpcPairSystem(current.storageSystems)
        const otherPair = hrpcPairSystem(other.storageSystems)
        const nextCurrent: SiteStorageConfig = {
          ...current,
          storageClasses: current.storageClasses.map((x) =>
            x.id === id
              ? {
                  ...x,
                  hrpcPairId: pairId,
                  storageSystemId: currentPair?.id || x.storageSystemId,
                  serialNumber: '',
                }
              : x,
          ),
        }
        const already = other.storageClasses.some((x) => (x.hrpcPairId || '').trim() === pairId)
        const name = (sc.name || '').trim()
        const sameName = other.storageClasses.find((x) => (x.name || '').trim() === name)
        const reuse =
          sameName && !(sameName.hrpcPairId || '').trim() ? sameName : undefined
        const nextOther: SiteStorageConfig = already
          ? other
          : reuse
            ? {
                ...other,
                storageClasses: other.storageClasses.map((x) =>
                  x.id === reuse.id
                    ? {
                        ...x,
                        hrpcPairId: pairId,
                        fstype: sc.fstype || x.fstype,
                        storageSystemId: otherPair?.id || x.storageSystemId,
                        serialNumber: '',
                      }
                    : x,
                ),
              }
            : sameName
              ? other
              : {
                  ...other,
                  storageClasses: [
                    ...other.storageClasses,
                    {
                      ...sc,
                      id: `${sc.id}-${otherSite}`,
                      hrpcPairId: pairId,
                      storageSystemId: otherPair?.id || '',
                      serialNumber: '',
                      poolID: '',
                      portID: '',
                      nvmSubsystemID: '',
                      isDefault: false,
                    },
                  ],
                }
        return {
          ...ensured,
          sites:
            site === 'primary'
              ? { primary: nextCurrent, secondary: nextOther }
              : { primary: nextOther, secondary: nextCurrent },
        }
      }

      const pairId = (sc.hrpcPairId || '').trim()
      const unpair = (storage: SiteStorageConfig): SiteStorageConfig => ({
        ...storage,
        storageClasses: storage.storageClasses.map((x) => {
          if (!pairId || (x.hrpcPairId || '').trim() !== pairId) return x
          const next = { ...x }
          delete (next as Partial<StorageClassConfig>).hrpcPairId
          return next
        }),
      })
      return {
        ...ensured,
        sites: {
          primary: unpair(getSiteStorage(ensured, 'primary')),
          secondary: unpair(getSiteStorage(ensured, 'secondary')),
        },
      }
    })
  }

  const addStorageClass = () => {
    setState((s) => {
      if (!s.components.replication) {
        const kind = storageClassKindsForSystems(s.storageSystems)[0] ?? 'standard'
        const nextSc = defaultSc(kind, s.connectionType, s.nodeEnvironment, s.driverNamespace, s.storageSystems)
        nextSc.name = nextUniqueName(
          nextSc.name,
          s.storageClasses.map((sc) => sc.name),
        )
        return { ...s, storageClasses: [...s.storageClasses, nextSc] }
      }
      const ensured = ensureSitesForReplication(s)
      const current = getSiteStorage(ensured, site)
      const kind = storageClassKindsForSystems(current.storageSystems)[0] ?? 'standard'
      const nextSc = defaultSc(kind, s.connectionType, s.nodeEnvironment, s.driverNamespace, current.storageSystems)
      nextSc.name = nextUniqueName(
        nextSc.name,
        current.storageClasses.map((sc) => sc.name),
      )
      return withSiteStorage(ensured, site, {
        ...current,
        storageClasses: [...current.storageClasses, nextSc],
      })
    })
  }

  return (
    <div className="step-panel">
      <h2>StorageClasses & snapshots</h2>
      <p className="lede">
        {replicationOn ? HELP.replicationSitesLede : HELP.secretVsStorageClass.storageClassLede}
      </p>

      {replicationOn && (
        <SiteSwitcher
          site={site}
          onSiteChange={setSite}
          primaryReady={
            siteStorageSystemsReady(state, 'primary') && siteStorageClassesReady(state, 'primary')
          }
          secondaryReady={
            siteStorageSystemsReady(state, 'secondary') && siteStorageClassesReady(state, 'secondary')
          }
        />
      )}

      <label className="toggle-row" style={{ marginBottom: '0.85rem' }}>
        <input
          type="checkbox"
          checked={state.storageClassesEnabled}
          onChange={(e) => {
            const on = e.target.checked
            if (!on) {
              setState((s) => ({
                ...s,
                storageClassesEnabled: false,
                snapshotClass: { ...s.snapshotClass, enabled: false },
              }))
            } else {
              setState((s) => {
                if (s.components.replication) {
                  const base = { ...s, storageClassesEnabled: true }
                  return ensureSitesForReplication(base)
                }
                return {
                  ...s,
                  storageClassesEnabled: true,
                  storageClasses:
                    s.storageClasses.length >= 1
                      ? s.storageClasses
                      : [
                          defaultSc(
                            storageClassKindsForSystems(s.storageSystems)[0] ?? 'standard',
                            s.connectionType,
                            s.nodeEnvironment,
                            s.driverNamespace,
                            s.storageSystems,
                          ),
                        ],
                }
              })
            }
          }}
        />
        <div>
          <strong>Generate StorageClass(es)</strong>
          <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: 'var(--hv-text-subtle)' }}>
            {HELP.storageClassesEnabled}
          </p>
        </div>
      </label>

      {!state.storageClassesEnabled && (
        <Callout>
          StorageClass, VolumeSnapshotClass, and test PVC/Pod manifests are skipped in the download when
          generation is turned off.
        </Callout>
      )}

      {state.storageClassesEnabled &&
        storage.storageClasses.map((sc) => {

          const usedForReplication = !!(sc.hrpcPairId || '').trim()
          const allowedKinds = allowedKindsForSc(storage.storageSystems, usedForReplication)
          const stretchedOffered = allowedKinds.some(isStretchedKind)
          const gadPicked = gadArraysForStorageClass(sc, storage.storageSystems)
          const gadPickersEmpty = !((sc.primaryStorageSystemId || '').trim() || (sc.secondaryStorageSystemId || '').trim())
          const gadFallback = stretchedOffered && gadPickersEmpty ? gadPairSystems(storage.storageSystems) : null
          const diagramPrimary = gadPicked.primary || gadFallback?.primary
          const diagramSecondary = gadPicked.secondary || gadFallback?.secondary
          const ctxSystems =
            replicationOn && usedForReplication
              ? systemsWithHrpcFirst(storage.storageSystems)
              : storage.storageSystems
          const errors = validateStorageClass(sc, {
            storageSystems: ctxSystems,
            siblings: storage.storageClasses,
          })
          const pairSys = hrpcPairSystem(storage.storageSystems)
          const allowedConns = connectionsForStorageClassKind(sc.kind, state.nodeEnvironment)
          const effectiveConn = coerceConnectionType(sc.connectionType, allowedConns)
          const conn = CONNECTION_TYPES.find((c) => c.id === effectiveConn)!
          const efficiencyBlocked =
            isVspOneBlock20(primary?.family) && sc.storageEfficiency === 'Disabled' && sc.kind === 'standard'
          const multipathOff = !state.multipath.enabled
          const portIdHint = multipathOff
            ? 'Prefer a single port when wizard multipath packaging is off (e.g. CL1-A).'
            : 'Comma-separated ports for multipath (e.g. CL1-A,CL2-A). Not used for NVMe.'
          const portIdPlaceholder = multipathOff ? 'CL1-A' : 'CL1-A,CL2-A'
          const advancedError =
            errors.name ||
            (sc.kind === 'stretched' || sc.kind === 'stretched-adr' ? errors.stretchedSecretName : undefined) ||
            (sc.kind === 'stretched' || sc.kind === 'stretched-adr' ? errors.copyGroupName : undefined) ||
            (sc.kind === 'stretched' || sc.kind === 'stretched-adr' ? errors.copyPairName : undefined) ||
            (sc.kind === 'stretched' || sc.kind === 'stretched-adr' ? errors.virtualStorageSerialNumber : undefined) ||
            (efficiencyBlocked
              ? 'VSP One Block 20 Series does not support Disabled storage efficiency. Use Compression or Compression + Deduplication.'
              : undefined)

          return (
            <Section
              key={sc.id}
              title={`StorageClass: ${sc.name}`}
              actions={
                storage.storageClasses.length > 1 ? (
                  <button type="button" className="btn btn-danger" onClick={() => removeSc(sc.id)}>
                    Remove
                  </button>
                ) : null
              }
            >
              <div className="field-grid">
                {allowedKinds.length > 1 && (
                <Field
                  label="Type"
                  help={
                    usedForReplication
                      ? 'Replication uses a standard StorageClass on each site (one array per site). Stretched / GAD is a different, single-cluster pattern. VSP One SDS Block is not used with Replication.'
                      : stretchedOffered
                        ? HELP.gad.type
                        : HELP.storageClassType
                  }
                  helpDiagram={
                    stretchedOffered ? (
                      <GadStretchedPvcDiagram
                        clusterLabel={clusterLabel}
                        primary={{
                          family: diagramPrimary?.family,
                          serial: diagramPrimary?.serial || '',
                          url: diagramPrimary?.url || '',
                        }}
                        secondary={{
                          family: diagramSecondary?.family,
                          serial: diagramSecondary?.serial || '',
                          url: diagramSecondary?.url || '',
                        }}
                      />
                    ) : undefined
                  }
                >
                  <select
                    value={sc.kind}
                    onChange={(e) => {
                      const kind = e.target.value as StorageClassKind
                      if (usedForReplication && kind !== 'standard') {
                        toggleUseForReplication(sc.id, false)
                      }
                      const next = defaultSc(
                        kind,
                        sc.connectionType,
                        state.nodeEnvironment,
                        state.driverNamespace,
                        storage.storageSystems,
                      )
                      next.id = sc.id
                      next.secretName = sc.secretName
                      next.secretNamespace = sc.secretNamespace
                      next.name = nextUniqueName(
                        next.name,
                        storage.storageClasses.filter((x) => x.id !== sc.id).map((x) => x.name),
                      )
                      if (next.stretchedSecretName) {
                        next.stretchedSecretName = nextUniqueName(
                          next.stretchedSecretName,
                          storage.storageClasses
                            .filter((x) => x.id !== sc.id && x.kind !== 'stretched' && x.kind !== 'stretched-adr')
                            .map((x) => x.secretName),
                        )
                      }
                      updateSc(sc.id, next)
                    }}
                  >
                    {allowedKinds.includes('standard') && (
                      <option value="standard">Standard (VSP / VSP One Block)</option>
                    )}
                    {allowedKinds.includes('stretched') && (
                      <option value="stretched">Stretched / GAD</option>
                    )}
                    {allowedKinds.includes('stretched-adr') && (
                      <option value="stretched-adr">Stretched + ADR</option>
                    )}
                    {allowedKinds.includes('vsp-one-sds-block') && (
                      <option value="vsp-one-sds-block">VSP One SDS Block</option>
                    )}
                  </select>
                </Field>
                )}
                <Field label="Connection type" help={HELP.protocolMultipath}>
                  <select
                    value={effectiveConn}
                    onChange={(e) =>
                      updateSc(sc.id, {
                        connectionType: e.target.value as StorageClassConfig['connectionType'],
                      })
                    }
                  >
                    {CONNECTION_TYPES.filter((c) => allowedConns.includes(c.id)).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </Field>
                {(sc.kind === 'standard' || sc.kind === 'vsp-one-sds-block') &&
                  storage.storageSystems.length >= 2 && (
                    <Field
                      label="Array"
                      hint={
                        usedForReplication
                          ? "Uses this site's Replication array."
                          : 'Select which array this StorageClass provisions from.'
                      }
                      error={errors.storageSystemId || (sc.kind === 'standard' ? errors.serialNumber : undefined)}
                    >
                      <select
                        value={usedForReplication && pairSys ? pairSys.id : sc.storageSystemId || ''}
                        disabled={usedForReplication && !!pairSys}
                        onChange={(e) => updateSc(sc.id, { storageSystemId: e.target.value })}
                      >
                        <option value="">Select an array…</option>
                        {storage.storageSystems.map((sys) => (
                          <option key={sys.id} value={sys.id}>
                            {arrayOptionLabel(sys)}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
              </div>

              <AdvancedSection
                title="Advanced StorageClass options"
                error={advancedError}
              >
                <div className="field-grid">
                  <Field
                    label="Name"
                    hint={
                      usedForReplication
                        ? 'Must be the same on both sites. Changing it here updates the other site too.'
                        : 'Kubernetes StorageClass metadata.name referenced by PVCs.'
                    }
                    error={errors.name}
                  >
                    <input value={sc.name} onChange={(e) => updateSc(sc.id, { name: e.target.value })} />
                  </Field>

                  {sc.kind === 'standard' && (
                    <>
                      <Field
                        label="Filesystem"
                        hint={
                          usedForReplication
                            ? 'Must be the same on both sites. Changing it here updates the other site too.'
                            : 'ext4 (default) or xfs. Ignored for raw Block volumeMode.'
                        }
                      >
                        <select
                          value={sc.fstype || 'ext4'}
                          onChange={(e) => updateSc(sc.id, { fstype: e.target.value })}
                        >
                          <option value="ext4">ext4</option>
                          <option value="xfs">xfs</option>
                        </select>
                      </Field>
                      <Field label="Allow volume expansion" hint="Must be false for stretched StorageClasses.">
                        <select
                          value={String(sc.allowVolumeExpansion)}
                          onChange={(e) =>
                            updateSc(sc.id, { allowVolumeExpansion: e.target.value === 'true' })
                          }
                        >
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      </Field>
                      <Field
                        label="Storage efficiency"
                        hint="Adaptive data reduction. VSP One Block 20 Series does not support Disabled."
                        error={
                          efficiencyBlocked
                            ? 'VSP One Block 20 Series does not support Disabled — use Compression or CompressionDeduplication.'
                            : undefined
                        }
                      >
                        <select
                          value={sc.storageEfficiency || 'Disabled'}
                          onChange={(e) =>
                            updateSc(sc.id, {
                              storageEfficiency: e.target.value as StorageClassConfig['storageEfficiency'],
                            })
                          }
                        >
                          <option value="Disabled" disabled={isVspOneBlock20(primary?.family)}>
                            Disabled
                          </option>
                          <option value="Compression">Compression</option>
                          <option value="CompressionDeduplication">Compression + Deduplication</option>
                        </select>
                      </Field>
                      {sc.storageEfficiency && sc.storageEfficiency !== 'Disabled' && (
                        <Field label="Efficiency mode" hint="Inline compresses on write; PostProcess reduces data after write.">
                          <select
                            value={sc.storageEfficiencyMode || 'PostProcess'}
                            onChange={(e) =>
                              updateSc(sc.id, {
                                storageEfficiencyMode:
                                  e.target.value as StorageClassConfig['storageEfficiencyMode'],
                              })
                            }
                          >
                            <option value="Inline">Inline</option>
                            <option value="PostProcess">PostProcess</option>
                          </select>
                        </Field>
                      )}
                    </>
                  )}

                  {(sc.kind === 'stretched' || sc.kind === 'stretched-adr') && (
                    <>
                      <Field
                        label="Stretched secret name"
                        hint="Secret that holds primary and secondary array credentials. Create a new Secret for a different VSM."
                        error={errors.stretchedSecretName}
                      >
                        <input
                          value={sc.stretchedSecretName || ''}
                          onChange={(e) => updateSc(sc.id, { stretchedSecretName: e.target.value })}
                        />
                      </Field>
                      <Field
                        label="Virtual storage serial"
                        hint="Optional VSM serial (same on both arrays). Leave blank if you are not targeting a VSM."
                        error={errors.virtualStorageSerialNumber}
                      >
                        <input
                          value={sc.virtualStorageSerialNumber || ''}
                          onChange={(e) => updateSc(sc.id, { virtualStorageSerialNumber: e.target.value })}
                          placeholder="33333"
                        />
                      </Field>
                      <Field
                        label="Copy group name"
                        hint="Must start with spc, 1–29 characters. CSI rejects a missing prefix."
                        error={errors.copyGroupName}
                      >
                        <input
                          value={sc.copyGroupName || ''}
                          onChange={(e) => updateSc(sc.id, { copyGroupName: e.target.value })}
                        />
                      </Field>
                      <Field
                        label="Copy pair name"
                        hint="Optional. Must start with spc, 1–31 characters. One GAD pair per StorageClass; leave blank to let CSI choose."
                        error={errors.copyPairName}
                      >
                        <input
                          value={sc.copyPairName || ''}
                          onChange={(e) => updateSc(sc.id, { copyPairName: e.target.value })}
                          placeholder="spc-cpp"
                        />
                      </Field>
                    </>
                  )}
                </div>
              </AdvancedSection>

              {replicationOn && sc.kind === 'standard' && (
                <label className="toggle-row" style={{ marginTop: '0.85rem' }}>
                  <input
                    type="checkbox"
                    checked={usedForReplication}
                    onChange={(e) => toggleUseForReplication(sc.id, e.target.checked)}
                  />
                  <div>
                    <strong>
                      Use this StorageClass for Replication
                      <HelpTip text={HELP.replicationPairedStorageClassesCallout} />
                    </strong>
                    <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: 'var(--hv-text-subtle)' }}>
                      Creates a matching StorageClass on the other site with the same name and filesystem
                      type. Fill pool, ports, and other fields on both the Primary and Secondary site tabs.
                    </p>
                  </div>
                </label>
              )}

              <label className="toggle-row" style={{ marginTop: '0.85rem' }}>
                <input
                  type="checkbox"
                  checked={!!sc.isDefault}
                  onChange={(e) => {
                    const on = e.target.checked
                    setState((s) => {
                      if (!s.components.replication) {
                        return {
                          ...s,
                          storageClasses: s.storageClasses.map((x) => ({
                            ...x,
                            isDefault: x.id === sc.id ? on : on ? false : x.isDefault,
                          })),
                        }
                      }
                      const ensured = ensureSitesForReplication(s)
                      const current = getSiteStorage(ensured, site)
                      return withSiteStorage(ensured, site, {
                        ...current,
                        storageClasses: current.storageClasses.map((x) => ({
                          ...x,
                          isDefault: x.id === sc.id ? on : on ? false : x.isDefault,
                        })),
                      })
                    })
                  }}
                />
                <div>
                  <strong>Default StorageClass</strong>
                  <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: 'var(--hv-text-subtle)' }}>
                    Sets <code>storageclass.kubernetes.io/is-default-class</code>. Only one StorageClass in
                    this package can be the default.
                  </p>
                </div>
              </label>

              {sc.kind === 'vsp-one-sds-block' && (
                <Callout>
                  VSP One SDS Block supports FC, iSCSI, and NVMe/TCP only (not NVMe over FC).
                </Callout>
              )}

              {sc.kind === 'standard' && (
                <div className="field-grid" style={{ marginTop: '1rem' }}>
                  <Field label="Pool ID" hint="HDP pool ID used for dynamic provisioning." error={errors.poolID}>
                    <input value={sc.poolID || ''} onChange={(e) => updateSc(sc.id, { poolID: e.target.value })} placeholder="1" />
                  </Field>
                  {conn.needsPortId && (
                    <Field
                      label="Port ID(s)"
                      hint={portIdHint}
                      error={errors.portID}
                      warning={portIdWithoutMultipathWarning(state.multipath.enabled, sc.portID)}
                    >
                      <input value={sc.portID || ''} onChange={(e) => updateSc(sc.id, { portID: e.target.value })} placeholder={portIdPlaceholder} />
                    </Field>
                  )}
                  {conn.needsNvmSubsystem && (
                    <Field label="NVMe subsystem ID" hint="Required for NVMe-FC and NVMe/TCP — Port ID is not used." error={errors.nvmSubsystemID}>
                      <input value={sc.nvmSubsystemID || ''} onChange={(e) => updateSc(sc.id, { nvmSubsystemID: e.target.value })} />
                    </Field>
                  )}
                </div>
              )}

              {(sc.kind === 'stretched' || sc.kind === 'stretched-adr') && (
                <>
                  <div className="field-grid" style={{ marginTop: '1rem' }}>
                    <Field
                      label="Primary array"
                      hint="GAD-capable VSP / VSP One Block array used as the primary."
                      error={errors.primaryStorageSystemId}
                    >
                      <select
                        value={sc.primaryStorageSystemId || ''}
                        onChange={(e) => updateSc(sc.id, { primaryStorageSystemId: e.target.value })}
                      >
                        <option value="">Select a primary array…</option>
                        {storage.storageSystems
                          .filter((sys) => supportsStretchedGad(sys.family))
                          .map((sys) => (
                            <option key={sys.id} value={sys.id}>
                              {arrayOptionLabel(sys)}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field
                      label="Secondary array"
                      hint="GAD-capable VSP / VSP One Block array used as the secondary."
                      error={errors.secondaryStorageSystemId}
                    >
                      <select
                        value={sc.secondaryStorageSystemId || ''}
                        onChange={(e) => updateSc(sc.id, { secondaryStorageSystemId: e.target.value })}
                      >
                        <option value="">Select a secondary array…</option>
                        {storage.storageSystems
                          .filter((sys) => supportsStretchedGad(sys.family))
                          .map((sys) => (
                            <option key={sys.id} value={sys.id}>
                              {arrayOptionLabel(sys)}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="Quorum ID" hint="Quorum disk ID for GAD." error={errors.quorumID}>
                      <input value={sc.quorumID || ''} onChange={(e) => updateSc(sc.id, { quorumID: e.target.value })} />
                    </Field>
                    <Field
                      label="Consistency group ID"
                      hint="Decimal number (for example 1). Applied with a custom copy group name."
                      error={errors.consistencyGroupId}
                    >
                      <input
                        value={sc.consistencyGroupId || ''}
                        onChange={(e) => updateSc(sc.id, { consistencyGroupId: e.target.value })}
                        placeholder="1"
                      />
                    </Field>
                    <Field label="Primary pool ID" hint="HDP pool on the primary array." error={errors.primaryPoolID}>
                      <input value={sc.primaryPoolID || ''} onChange={(e) => updateSc(sc.id, { primaryPoolID: e.target.value })} />
                    </Field>
                    <Field
                      label="Primary port ID(s)"
                      hint={multipathOff ? 'Prefer a single primary port when wizard multipath packaging is off (e.g. CL1-A).' : 'Comma-separated primary ports (e.g. CL1-A,CL2-A).'}
                      error={errors.primaryPortID}
                      warning={portIdWithoutMultipathWarning(state.multipath.enabled, sc.primaryPortID)}
                    >
                      <input value={sc.primaryPortID || ''} onChange={(e) => updateSc(sc.id, { primaryPortID: e.target.value })} placeholder={portIdPlaceholder} />
                    </Field>
                    <Field label="Secondary pool ID" hint="HDP pool on the secondary array." error={errors.secondaryPoolID}>
                      <input value={sc.secondaryPoolID || ''} onChange={(e) => updateSc(sc.id, { secondaryPoolID: e.target.value })} />
                    </Field>
                    <Field
                      label="Secondary port ID(s)"
                      hint={multipathOff ? 'Prefer a single secondary port when wizard multipath packaging is off (e.g. CL1-F).' : 'Comma-separated secondary ports.'}
                      error={errors.secondaryPortID}
                      warning={portIdWithoutMultipathWarning(state.multipath.enabled, sc.secondaryPortID)}
                    >
                      <input value={sc.secondaryPortID || ''} onChange={(e) => updateSc(sc.id, { secondaryPortID: e.target.value })} placeholder={multipathOff ? 'CL1-F' : 'CL1-F,CL2-F'} />
                    </Field>
                  </div>
                </>
              )}
            </Section>
          )
        })}

      {state.storageClassesEnabled && (
        <button
          type="button"
          className="btn btn-secondary"
          style={{ marginBottom: '1.25rem' }}
          onClick={addStorageClass}
        >
          Add StorageClass
        </button>
      )}

      {state.storageClassesEnabled && snapshotsSupported && (
      <Section
        title="VolumeSnapshotClass"
        help="Enables CSI volume snapshots. Deletion policy controls whether snapshot content is removed when the VolumeSnapshot is deleted."
      >
        <label className="toggle-row" style={{ marginBottom: '0.85rem' }}>
          <input
            type="checkbox"
            checked={state.snapshotClass.enabled}
            onChange={(e) =>
              setState((s) => ({
                ...s,
                snapshotClass: { ...s.snapshotClass, enabled: e.target.checked },
              }))
            }
          />
          <div>
            <strong>Generate VolumeSnapshotClass</strong>
          </div>
        </label>
        {state.snapshotClass.enabled && (
          <AdvancedSection
            title="Advanced snapshot options"
          >
            <div className="field-grid">
              <Field label="Name" hint="Kubernetes VolumeSnapshotClass metadata.name.">
                <input
                  value={state.snapshotClass.name}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      snapshotClass: { ...s.snapshotClass, name: e.target.value },
                    }))
                  }
                />
              </Field>
              <Field
                label="Deletion policy"
                hint="Delete removes snapshot content with the VolumeSnapshot; Retain keeps it."
              >
                <select
                  value={state.snapshotClass.deletionPolicy}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      snapshotClass: {
                        ...s.snapshotClass,
                        deletionPolicy: e.target.value as 'Delete' | 'Retain',
                      },
                    }))
                  }
                >
                  <option value="Delete">Delete</option>
                  <option value="Retain">Retain</option>
                </select>
              </Field>
            </div>

            <label className="toggle-row" style={{ marginTop: '0.85rem' }}>
              <input
                type="checkbox"
                checked={!!state.snapshotClass.isDefault}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    snapshotClass: { ...s.snapshotClass, isDefault: e.target.checked },
                  }))
                }
              />
              <div>
                <strong>Default VolumeSnapshotClass</strong>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: 'var(--hv-text-subtle)' }}>
                  Sets <code>snapshot.storage.kubernetes.io/is-default-class</code>.
                </p>
              </div>
            </label>

            <label
              className="toggle-row"
              style={{ marginTop: '0.85rem', opacity: canImmutableSnapshots ? 1 : 0.65 }}
            >
              <input
                type="checkbox"
                checked={!!state.snapshotClass.immutable && canImmutableSnapshots}
                disabled={!canImmutableSnapshots}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    snapshotClass: {
                      ...s.snapshotClass,
                      immutable: e.target.checked,
                      retentionPeriod: s.snapshotClass.retentionPeriod || '24',
                    },
                  }))
                }
              />
              <div>
                <strong>Immutable snapshots</strong>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: 'var(--hv-text-subtle)' }}>
                  {canImmutableSnapshots
                    ? 'Adds retentionPeriod so snapshot data cannot be deleted or cloned until the period expires (1–12288 hours).'
                    : 'Requires primary array marked as VSP One Block 20 Series or High End (B85) on Storage systems.'}
                </p>
              </div>
            </label>
            {canImmutableSnapshots && state.snapshotClass.immutable && (
              <div className="field-grid" style={{ marginTop: '0.85rem' }}>
                <Field
                  label="Retention period (hours)"
                  hint="1–12288 hours. Snapshot cannot be deleted or cloned until this expires."
                  error={
                    (() => {
                      const n = Number(state.snapshotClass.retentionPeriod)
                      if (
                        !state.snapshotClass.retentionPeriod ||
                        !Number.isFinite(n) ||
                        n < 1 ||
                        n > 12288
                      ) {
                        return 'Enter a number from 1 to 12288.'
                      }
                      return undefined
                    })()
                  }
                >
                  <input
                    value={state.snapshotClass.retentionPeriod || ''}
                    onChange={(e) =>
                      setState((s) => ({
                        ...s,
                        snapshotClass: {
                          ...s.snapshotClass,
                          retentionPeriod: e.target.value,
                        },
                      }))
                    }
                    placeholder="24"
                  />
                </Field>
              </div>
            )}
          </AdvancedSection>
        )}
      </Section>
      )}

      {isAdvanced && state.storageClassesEnabled && previewSc && (
        <Section title="Live YAML preview">
          <CodeBlock className="yaml-preview">
            {generateStorageClass(
              applyArrayBindingToClass(previewSc, storage.storageSystems, state.driverNamespace),
            )}
          </CodeBlock>
          {state.snapshotClass.enabled && snapshotsSupported && (
            <CodeBlock className="yaml-preview" style={{ marginTop: '0.75rem' }}>
              {generateSnapshotClass(state.snapshotClass, snapshotClassOpts(state))}
            </CodeBlock>
          )}
        </Section>
      )}
    </div>
  )
}
