import { PLATFORMS } from '../catalog/platforms'
import { k8sQuantityInvalidReason } from '../catalog/k8sQuantity'
import { quickstartForSite, withSiteQuickstart } from '../catalog/siteQuickstart'
import { getSiteStorage, packageStorageClasses, pickStorageClassName } from '../catalog/sites'
import { siteStorageClassesReady, siteStorageSystemsReady } from '../catalog/validation'
import { AdvancedSection } from '../components/AdvancedSection'
import { SiteSwitcher } from '../components/SiteSwitcher'
import { useWizard } from '../state/WizardContext'
import { useSiteTab } from '../state/useSiteTab'
import { Callout, Field, Section } from '../components/ui'

export function QuickstartStep() {
  const { state, setState } = useWizard()
  const plat = PLATFORMS[state.platform]
  const replicationOn = state.components.replication
  const [site, setSite] = useSiteTab(replicationOn)
  const qs = quickstartForSite(state, site)
  const classes = replicationOn
    ? getSiteStorage(state, site).storageClasses
    : packageStorageClasses(state)
  const scName = pickStorageClassName(classes, qs.storageClassName)
  const installed = !replicationOn || qs.install !== false

  return (
    <div className="step-panel">
      <h2>Test volume</h2>
      <p className="lede">
        Configure the sample PVC and Pod packaged into the export. After prerequisites and{' '}
        <code>install.sh</code> have applied the driver, Secret, and StorageClass, these manifests confirm
        provisioning works (Bound PVC + Running Pod).
        {plat.useOc && state.multipath.enabled ? (
          <>
            {' '}
            On OpenShift, finish multipath MachineConfig / node reboots before expecting a Bound volume.
          </>
        ) : null}
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

      {replicationOn && (
        <>
          <label className="toggle-row" style={{ marginBottom: '0.85rem' }}>
            <input
              type="checkbox"
              checked={installed}
              onChange={(e) =>
                setState((s) => withSiteQuickstart(s, site, { install: e.target.checked }))
              }
            />
            <div>
              <strong>Include test volume on this cluster</strong>
            </div>
          </label>
          {!installed && (
            <Callout>
              This cluster&apos;s package will not include the sample PVC/Pod.
            </Callout>
          )}
        </>
      )}

      {installed && (
        <Section title="Test workload">
          <AdvancedSection title="Advanced test workload options">
            <div className="field-grid">
              <Field label="PVC name">
                <input
                  value={qs.pvcName}
                  onChange={(e) =>
                    setState((s) => withSiteQuickstart(s, site, { pvcName: e.target.value }))
                  }
                />
              </Field>
              <Field
                label="Access mode"
                hint="ReadWriteOnce: one node at a time. ReadWriteMany: shared filesystem across nodes (when supported)."
              >
                <select
                  value={qs.accessMode}
                  onChange={(e) =>
                    setState((s) =>
                      withSiteQuickstart(s, site, {
                        accessMode: e.target.value as typeof qs.accessMode,
                      }),
                    )
                  }
                >
                  <option value="ReadWriteOnce">ReadWriteOnce</option>
                  <option value="ReadWriteMany">ReadWriteMany</option>
                  <option value="ReadOnlyMany">ReadOnlyMany</option>
                </select>
              </Field>
              <Field
                label="Volume mode"
                hint="Filesystem mounts a formatted volume. Block presents a raw device to the container."
              >
                <select
                  value={qs.volumeMode}
                  onChange={(e) =>
                    setState((s) =>
                      withSiteQuickstart(s, site, {
                        volumeMode: e.target.value as typeof qs.volumeMode,
                      }),
                    )
                  }
                >
                  <option value="Filesystem">Filesystem</option>
                  <option value="Block">Block</option>
                </select>
              </Field>
              <Field label="Pod name">
                <input
                  value={qs.podName}
                  onChange={(e) =>
                    setState((s) => withSiteQuickstart(s, site, { podName: e.target.value }))
                  }
                />
              </Field>
            </div>
          </AdvancedSection>

          <div className="field-grid">
            <Field
              label="Size"
              hint="Requested capacity with a unit (for example 1Gi or 500Mi)."
              error={k8sQuantityInvalidReason(qs.pvcSize) ?? undefined}
            >
              <input
                value={qs.pvcSize}
                onChange={(e) =>
                  setState((s) => withSiteQuickstart(s, site, { pvcSize: e.target.value }))
                }
              />
            </Field>
            {classes.length > 1 ? (
              <Field label="StorageClass">
                <select
                  value={scName}
                  onChange={(e) =>
                    setState((s) =>
                      withSiteQuickstart(s, site, { storageClassName: e.target.value }),
                    )
                  }
                >
                  {classes.map((sc) => (
                    <option key={sc.id} value={sc.name}>
                      {sc.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label="StorageClass" hint="Uses the only StorageClass in this package.">
                <input value={scName} disabled readOnly />
              </Field>
            )}
          </div>
        </Section>
      )}
    </div>
  )
}
