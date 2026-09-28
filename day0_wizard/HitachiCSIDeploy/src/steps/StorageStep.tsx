import { type StorageFamily, type StorageSystemConfig } from '../catalog/types'
import {
  STORAGE_FAMILIES,
  isSdsBlockFamily,
  storageFamilyHint,
  storageRestUrlHint,
  supportsAlternativeCloneMode,
  supportsImmutableSnapshots,
} from '../catalog/platforms'
import { HELP } from '../catalog/help'
import { DEFAULT_CSI_SECRET_NAME, nextCsiSecretName } from '../catalog/arrayBinding'
import { getSiteStorage, setHrpcPairOnSite, withSiteStorage } from '../catalog/sites'
import {
  hrpcPairResourceGroupIds,
  nextUniqueName,
  siteStorageSystemsReady,
  validateStorageSystem,
} from '../catalog/validation'
import { AlternativeCloneModeDiagram } from '../components/AlternativeCloneModeDiagram'
import { SiteSwitcher } from '../components/SiteSwitcher'
import { ResourceGroupOverviewDiagram } from '../components/ResourceGroupOverviewDiagram'
import { AdvancedSection } from '../components/AdvancedSection'
import { useWizard } from '../state/WizardContext'
import { useSiteTab } from '../state/useSiteTab'
import { Callout, Field, HelpTip, PasswordInput, Section } from '../components/ui'

function newSystem(n: number, existing: StorageSystemConfig[]): StorageSystemConfig {
  return {
    id: `storage-${n}`,
    name: n === 1 ? 'primary' : `array-${n}`,
    serial: '',
    url: '',
    user: '',
    password: '',
    stretchedRole: 'none',
    csiSecretName: n === 1 ? DEFAULT_CSI_SECRET_NAME : nextCsiSecretName(existing),
    csiSecretNamespace: '',
  }
}

export function StorageStep() {
  const { state, setState } = useWizard()
  const replicationOn = state.components.replication
  const [site, setSite] = useSiteTab(replicationOn)
  const storage = replicationOn ? getSiteStorage(state, site) : null
  const storageSystems = replicationOn ? storage!.storageSystems : state.storageSystems
  const pairRgIds = replicationOn
    ? hrpcPairResourceGroupIds(state)
    : { primary: '', secondary: '' }
  const partitioningOn = !!(pairRgIds.primary || pairRgIds.secondary)
  const thisPairRgFilled = site === 'primary' ? !!pairRgIds.primary : !!pairRgIds.secondary
  const rgFieldError =
    partitioningOn && !thisPairRgFilled
      ? 'Resource partitioning must be set on both sites. Enter a Resource group ID for this Replication array.'
      : undefined

  const updateSys = (id: string, patch: Partial<StorageSystemConfig>) => {
    setState((s) => {
      if (!s.components.replication) {
        const storageSystems = s.storageSystems.map((sys) => (sys.id === id ? { ...sys, ...patch } : sys))
        const primary = storageSystems[0]
        const snapshotClass =
          s.snapshotClass.immutable && !supportsImmutableSnapshots(primary)
            ? { ...s.snapshotClass, immutable: false }
            : s.snapshotClass
        return { ...s, storageSystems, snapshotClass }
      }

      const current = getSiteStorage(s, site)
      const nextSystems = current.storageSystems.map((sys) => (sys.id === id ? { ...sys, ...patch } : sys))

      // Snapshot class is packaged per site; keep guardrails stable by keying off the primary site.
      const primaryArray =
        site === 'primary' ? nextSystems[0] : getSiteStorage(s, 'primary').storageSystems[0]
      const snapshotClass =
        s.snapshotClass.immutable && !supportsImmutableSnapshots(primaryArray)
          ? { ...s.snapshotClass, immutable: false }
          : s.snapshotClass

      const next = withSiteStorage(s, site, { ...current, storageSystems: nextSystems })
      return { ...next, snapshotClass }
    })
  }

  const removeSys = (id: string) => {
    setState((s) => {
      if (!s.components.replication) {
        return {
          ...s,
          storageSystems: s.storageSystems.filter((sys) => sys.id !== id),
        }
      }
      const current = getSiteStorage(s, site)
      return withSiteStorage(s, site, {
        ...current,
        storageSystems: current.storageSystems.filter((sys) => sys.id !== id),
      })
    })
  }

  return (
    <div className="step-panel">
      <h2>Storage systems</h2>
      <p className="lede">{replicationOn ? HELP.replicationSitesLede : HELP.secretVsStorageClass.storageLede}</p>

      {replicationOn && (
        <SiteSwitcher
          site={site}
          onSiteChange={setSite}
          primaryReady={siteStorageSystemsReady(state, 'primary')}
          secondaryReady={siteStorageSystemsReady(state, 'secondary')}
        />
      )}

      {storageSystems.map((sys, idx) => {
        const sysErrors = validateStorageSystem(sys, storageSystems, state.driverNamespace)
        return (
        <Section
          key={sys.id}
          title={`Array: ${sys.name || sys.id}`}
          actions={
            storageSystems.length > 1 ? (
              <button type="button" className="btn btn-danger" onClick={() => removeSys(sys.id)}>
                Remove
              </button>
            ) : null
          }
        >
          {replicationOn && (
            <label className="toggle-row" style={{ marginBottom: '0.85rem' }}>
              <input
                type="checkbox"
                checked={!!sys.hrpcPair}
                onChange={(e) => {
                  if (!e.target.checked) return
                  const id = sys.id
                  setState((s) => {
                    const current = getSiteStorage(s, site)
                    return withSiteStorage(s, site, setHrpcPairOnSite(current, id))
                  })
                }}
              />
              <div>
                <strong>
                  Use this array for Replication
                  <HelpTip text={HELP.replicationPairArrayCallout} />
                </strong>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: 'var(--hv-text-subtle)' }}>
                  Each site picks exactly one array that Replication will use. Extra arrays stay on this
                  site for local or stretched (GAD) StorageClasses.
                </p>
              </div>
            </label>
          )}

          <div className="field-grid">
            <Field
              label="Display name"
              hint="Label used in this wizard only (not a Kubernetes name). Also used in generated Secret file names."
              error={sysErrors.name}
            >
              <input value={sys.name} onChange={(e) => updateSys(sys.id, { name: e.target.value })} />
            </Field>
            <Field
              label="Storage family"
              hint={storageFamilyHint(sys.family)}
              error={sysErrors.family}
            >
              <select
                value={sys.family || ''}
                onChange={(e) => {
                  const family = e.target.value as StorageFamily
                  updateSys(sys.id, {
                    family,
                    alternativeCloneMode: supportsAlternativeCloneMode(family)
                      ? sys.alternativeCloneMode
                      : false,
                    serial: isSdsBlockFamily(family) ? '' : sys.serial,
                    resourceGroupID: isSdsBlockFamily(family) ? '' : sys.resourceGroupID,
                    ...(isSdsBlockFamily(family) ? { stretchedRole: 'none' } : {}),
                  })
                }}
              >
                <option value="" disabled hidden>
                  Select your storage family…
                </option>
                {STORAGE_FAMILIES.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Field>
            {!!sys.family && !isSdsBlockFamily(sys.family) && (
            <Field label="Serial number" hint="From the VSP storage system." error={sysErrors.serial}>
              <input
                value={sys.serial}
                onChange={(e) => updateSys(sys.id, { serial: e.target.value })}
                placeholder="54321"
              />
            </Field>
            )}
            <Field
              label="REST URL"
              hint={storageRestUrlHint(sys.family)}
              help={HELP.secretVsStorageClass.restUrlHelp}
            >
              <input
                value={sys.url}
                onChange={(e) => updateSys(sys.id, { url: e.target.value })}
                placeholder="https://172.16.1.1"
              />
            </Field>
            <Field
              label="Username"
              hint="Storage Administrator (View & Modify) or equivalent. SDS Block with multitenancy: VpsStorage role."
            >
              <input value={sys.user} onChange={(e) => updateSys(sys.id, { user: e.target.value })} />
            </Field>
            <Field label="Password" hint="Encoded into the generated Kubernetes Secret.">
              <PasswordInput
                value={sys.password}
                onChange={(value) => updateSys(sys.id, { password: value })}
              />
            </Field>
            {replicationOn && sys.hrpcPair && !!sys.family && !isSdsBlockFamily(sys.family) && (
              <Field
                label={partitioningOn ? 'Resource group ID' : 'Resource group ID (optional)'}
                hint="If you use resource partitioning, set this on both sites’ Replication arrays. IDs are per array and do not need to match. CSI Driver and Replication use the same ID on this array."
                help={HELP.resourceGroupId}
                helpDiagram={<ResourceGroupOverviewDiagram resourceGroupID={sys.resourceGroupID} />}
                error={rgFieldError}
              >
                <input
                  value={sys.resourceGroupID || ''}
                  onChange={(e) => updateSys(sys.id, { resourceGroupID: e.target.value })}
                />
              </Field>
            )}
          </div>

          <AdvancedSection
            title="Advanced array options"
          >
            <div className="field-grid">
              <Field
                label="CSI Secret name"
                hint="StorageClasses on this cluster select this array’s Secret by this name."
                error={sysErrors.csiSecretName}
              >
                <input
                  value={sys.csiSecretName || DEFAULT_CSI_SECRET_NAME}
                  onChange={(e) => updateSys(sys.id, { csiSecretName: e.target.value })}
                  placeholder={DEFAULT_CSI_SECRET_NAME}
                />
              </Field>
              <Field
                label="CSI Secret namespace"
                hint="Leave empty to use the CSI Driver namespace. StorageClasses on this cluster select this array’s Secret."
              >
                <input
                  value={sys.csiSecretNamespace || ''}
                  onChange={(e) => updateSys(sys.id, { csiSecretNamespace: e.target.value })}
                  placeholder={state.driverNamespace}
                />
              </Field>
              <Field
                label="Host mode options (optional)"
                hint="Comma-separated. Driver defaults include 2,22,25,68,91 — specify only additional options."
              >
                <input
                  value={sys.hostModeOptions || ''}
                  onChange={(e) => updateSys(sys.id, { hostModeOptions: e.target.value })}
                  placeholder="88,81"
                />
              </Field>
              {!!sys.family && !isSdsBlockFamily(sys.family) && !(replicationOn && sys.hrpcPair) && (
                <Field
                  label="Resource group ID (optional)"
                  hint={HELP.resourceGroupIdHint}
                  help={HELP.resourceGroupId}
                  helpDiagram={<ResourceGroupOverviewDiagram resourceGroupID={sys.resourceGroupID} />}
                >
                  <input
                    value={sys.resourceGroupID || ''}
                    onChange={(e) => updateSys(sys.id, { resourceGroupID: e.target.value })}
                  />
                </Field>
              )}
            </div>

            {supportsAlternativeCloneMode(sys.family) && (
              <div style={{ marginTop: '0.85rem' }}>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={!!sys.alternativeCloneMode}
                    onChange={(e) => updateSys(sys.id, { alternativeCloneMode: e.target.checked })}
                  />
                  <div>
                    <strong>
                      Alternative clone mode
                      <HelpTip
                        text={HELP.alternativeCloneMode}
                        diagram={<AlternativeCloneModeDiagram />}
                      />
                    </strong>
                    <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: 'var(--hv-text-subtle)' }}>
                      {HELP.alternativeCloneModeHint}
                    </p>
                  </div>
                </label>
              </div>
            )}

            {isSdsBlockFamily(sys.family) && (
              <label className="toggle-row" style={{ marginTop: '0.85rem' }}>
                <input
                  type="checkbox"
                  checked={!!sys.multitenancy}
                  onChange={(e) => updateSys(sys.id, { multitenancy: e.target.checked })}
                />
                <div>
                  <strong>Multitenancy / VPS enabled</strong>
                  <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: 'var(--hv-text-subtle)' }}>
                    One VPS per cluster; user must have VpsStorage role. Storage efficiency follows VPS
                    settings.
                  </p>
                </div>
              </label>
            )}
          </AdvancedSection>

          {idx === 0 && !sys.url && (
            <Callout variant="warn">Enter at least URL, user, and password to generate a usable Secret.</Callout>
          )}
        </Section>
        )
      })}

      <button
        type="button"
        className="btn btn-secondary"
        onClick={() =>
          setState((s) => {
            const currentSystems = s.components.replication
              ? getSiteStorage(s, site).storageSystems
              : s.storageSystems
            const next = newSystem(currentSystems.length + 1, currentSystems)
            next.id = `storage-${Date.now()}`
            next.name = nextUniqueName(
              currentSystems.length === 0 ? 'primary' : 'array',
              currentSystems.map((x) => x.name),
            )
            if (!s.components.replication) {
              return { ...s, storageSystems: [...s.storageSystems, next] }
            }
            const current = getSiteStorage(s, site)
            return withSiteStorage(s, site, {
              ...current,
              storageSystems: [...current.storageSystems, next],
            })
          })
        }
      >
        Add storage system
      </button>
    </div>
  )
}
