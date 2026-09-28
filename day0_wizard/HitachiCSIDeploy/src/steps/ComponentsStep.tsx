import { COMPONENTS } from '../catalog/components'
import { HELP, RECAP } from '../catalog/help'
import { CONNECTION_TYPES, PLATFORMS } from '../catalog/platforms'
import { ensureSitesForReplication } from '../catalog/sites'
import { CsiDriverArchitectureDiagram } from '../components/CsiDriverArchitectureDiagram'
import { ReplicationArchitectureDiagram } from '../components/ReplicationArchitectureDiagram'
import { AdvancedSection } from '../components/AdvancedSection'
import { useWizard } from '../state/WizardContext'
import { Callout, Field, HelpTip, Section, ToggleRow } from '../components/ui'

export function ComponentsStep() {
  const { state, setState, versions } = useWizard()
  const plat = PLATFORMS[state.platform]

  return (
    <div className="step-panel">
      <h2>CSI components</h2>
      <p className="lede">
        Select what to deploy under the Hitachi Vantara CSI software package. The CSI Driver is always included.{' '}
        {RECAP.componentsLede}
      </p>

      <Section title="Select components">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          <ToggleRow
            checked
            disabled
            onChange={() => undefined}
            title={COMPONENTS.driver.displayName}
            description={COMPONENTS.driver.description}
            acronym={COMPONENTS.driver.acronym}
            help={HELP.csiDriver}
            collapsible
            defaultExpanded
          >
            <div className="toggle-row-diagram">
              <CsiDriverArchitectureDiagram
                clusterLabel={plat.useOc ? 'OpenShift cluster' : 'Kubernetes cluster'}
                dataPathLabel={
                  CONNECTION_TYPES.find((c) => c.id === state.connectionType)?.label ??
                  'FC / iSCSI / NVMe'
                }
              />
            </div>
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
                margin: 0,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={state.telemetryEnabled}
                onChange={(e) =>
                  setState((s) => ({ ...s, telemetryEnabled: e.target.checked }))
                }
                style={{ width: 18, height: 18, marginTop: 2, accentColor: 'var(--hv-primary)' }}
              />
              <div>
                <strong>
                  Hitachi Telemetry
                  <HelpTip text={HELP.telemetry} />
                </strong>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--hv-text-subtle)' }}>
                  Sends anonymized cluster and storage usage to Hitachi over HTTPS to AWS. Enabled by
                  default — turn off to opt out.
                </p>
              </div>
            </label>
            {state.airGapped && state.telemetryEnabled && (
              <Callout variant="warn">
                Telemetry needs outbound HTTPS :443 to AWS — disable Telemetry for disconnected installs, or
                leave on knowing it will fail without egress.
              </Callout>
            )}
          </ToggleRow>
          <ToggleRow
            checked={state.components.replication}
            onChange={(v) =>
              setState((s) => {
                let next = {
                  ...s,
                  components: {
                    ...s.components,
                    replication: v,
                    // DR Operator is always part of Replication
                    disasterRecovery: v,
                  },
                  replication: { ...s.replication, enabled: v, disasterRecovery: v },
                }
                if (v) {
                  next = ensureSitesForReplication(next)
                }
                return next
              })
            }
            title={COMPONENTS.replication.displayName}
            description={COMPONENTS.replication.description}
            acronym={COMPONENTS.replication.acronym}
            help={HELP.replicationArchitecture}
            collapsible
            defaultExpanded={false}
          >
            <div className="toggle-row-diagram">
              <ReplicationArchitectureDiagram
                clusterLabel={plat.useOc ? 'OpenShift cluster' : 'Kubernetes cluster'}
              />
            </div>
          </ToggleRow>
          <ToggleRow
            checked={state.components.metrics}
            onChange={(v) =>
              setState((s) => ({
                ...s,
                components: { ...s.components, metrics: v },
                metrics: { ...s.metrics, enabled: v },
              }))
            }
            title={COMPONENTS.metrics.displayName}
            description={COMPONENTS.metrics.description}
            acronym={COMPONENTS.metrics.acronym}
          />
          <ToggleRow
            checked={state.components.consolePlugin}
            disabled={!plat.supportsConsolePlugin}
            onChange={(v) =>
              setState((s) => ({
                ...s,
                components: {
                  ...s.components,
                  consolePlugin: v,
                  metrics: v ? true : s.components.metrics,
                },
                consolePlugin: { ...s.consolePlugin, enabled: v },
                metrics: { ...s.metrics, enabled: v ? true : s.metrics.enabled },
              }))
            }
            title={COMPONENTS.consolePlugin.displayName}
            description={
              plat.supportsConsolePlugin
                ? COMPONENTS.consolePlugin.description
                : 'Only available on OpenShift. Switch platform to enable.'
            }
          />
        </div>
        {state.components.consolePlugin && (
          <Callout>
            Enabling the Console Plugin also enables <strong>Performance Metrics</strong> so the console
            metrics tab can reach Prometheus.
          </Callout>
        )}
      </Section>

      <AdvancedSection
        title="Install defaults"
      >
        <Section title="Versions">
          <div className="field-grid">
            <Field
              label="CSI Driver version"
              hint="Latest tag from GitHub when available. Match a supported release for your platform."
            >
              <select
                value={state.versions.driver}
                onChange={(e) =>
                  setState((s) => ({ ...s, versions: { ...s.versions, driver: e.target.value } }))
                }
              >
                {(versions?.hspc || [state.versions.driver]).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            {state.components.replication ? (
              <Field
                label="Replication version"
                hint="Latest tag from GitHub when available. Used for Replication and the included DR Operator."
              >
                <select
                  value={state.versions.replication}
                  onChange={(e) =>
                    setState((s) => ({ ...s, versions: { ...s.versions, replication: e.target.value } }))
                  }
                >
                  {(versions?.hrpc || [state.versions.replication]).map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            {state.components.metrics ? (
              <Field label="Performance Metrics version" hint="Latest tag from GitHub when available.">
                <select
                  value={state.versions.metrics}
                  onChange={(e) =>
                    setState((s) => ({ ...s, versions: { ...s.versions, metrics: e.target.value } }))
                  }
                >
                  {(versions?.hspp || [state.versions.metrics]).map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
          </div>
        </Section>

        <Section
          title="Namespaces"
          help={
            plat.operatorHub
              ? 'On OpenShift/ROSA, OperatorHub installs into one namespace and the CSI Driver instance must live in that same namespace (OwnNamespace).'
              : 'On Kubernetes/RKE2/EKS, the operator typically runs in hspc-operator-system and the CSI Driver instance in kube-system.'
          }
        >
          <div className="field-grid">
            {plat.operatorHub ? (
              <Field
                label="Operator & CSI Driver namespace"
                hint="OperatorHub installs into a specific namespace; the CSI Driver instance must be created in the same namespace."
              >
                <input
                  value={state.operatorNamespace}
                  onChange={(e) => {
                    const ns = e.target.value
                    setState((s) => ({
                      ...s,
                      operatorNamespace: ns,
                      driverNamespace: ns,
                      storageClasses: s.storageClasses.map((sc) =>
                        sc.secretNamespace === s.driverNamespace || sc.secretNamespace === 'default'
                          ? { ...sc, secretNamespace: ns }
                          : sc,
                      ),
                    }))
                  }}
                />
              </Field>
            ) : (
              <>
                <Field
                  label="Operator namespace"
                  hint="Upstream default for the operator deployment (hspc-operator-system)."
                >
                  <input
                    value={state.operatorNamespace}
                    onChange={(e) => setState((s) => ({ ...s, operatorNamespace: e.target.value }))}
                  />
                </Field>
                <Field
                  label="CSI Driver namespace"
                  hint="Namespace for the CSI Driver instance (upstream sample uses kube-system)."
                >
                  <input
                    value={state.driverNamespace}
                    onChange={(e) => {
                      const ns = e.target.value
                      setState((s) => ({
                        ...s,
                        driverNamespace: ns,
                        storageClasses: s.storageClasses.map((sc) =>
                          sc.secretNamespace === s.driverNamespace || sc.secretNamespace === 'default'
                            ? { ...sc, secretNamespace: ns }
                            : sc,
                        ),
                      }))
                    }}
                  />
                </Field>
              </>
            )}
          </div>
        </Section>
      </AdvancedSection>
    </div>
  )
}
