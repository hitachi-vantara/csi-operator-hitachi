import {
  metricsForSite,
  metricsInstalledForSite,
  prometheusTargetForSite,
  withSiteMetrics,
} from '../catalog/metrics'
import { siteStorageSystemsReady } from '../catalog/validation'
import { AdvancedSection } from '../components/AdvancedSection'
import { SiteSwitcher } from '../components/SiteSwitcher'
import { useWizard } from '../state/WizardContext'
import { useSiteTab } from '../state/useSiteTab'
import { useUiMode } from '../state/UiModeContext'
import { Callout, Field, Section } from '../components/ui'

export function ConsolePluginStep() {
  const { state, setState } = useWizard()
  const { isAdvanced } = useUiMode()
  const replicationOn = state.components.replication
  const [site, setSite] = useSiteTab(replicationOn)
  const metrics = metricsForSite(state, site)
  const installed = metricsInstalledForSite(state, site)
  const needsPromWiring = !installed || !metrics.deployPrometheus
  const target = prometheusTargetForSite(state, site)

  return (
    <div className="step-panel">
      <h2>OpenShift Console Plugin</h2>
      <p className="lede">
        {!isAdvanced && !needsPromWiring
          ? 'This export installs the OpenShift Console Plugin, adding the Hitachi dashboard tab in the OpenShift web console.'
          : 'Deploys the Hitachi dashboard tab in the OpenShift web console. Prometheus settings should match where metrics are scraped. If you set them on Performance Metrics (Grafana with an existing Prometheus), those values appear here.'}
      </p>

      {replicationOn && (
        <SiteSwitcher
          site={site}
          onSiteChange={setSite}
          primaryReady={siteStorageSystemsReady(state, 'primary')}
          secondaryReady={siteStorageSystemsReady(state, 'secondary')}
        />
      )}

      {!isAdvanced && !needsPromWiring && installed && (
        <Callout variant="ok">
          <strong>Included in this package:</strong> the Console Plugin and Prometheus (so no additional wiring
          is required on this page
          {replicationOn ? ' for this site' : ''}).
        </Callout>
      )}

      <Section title="Plugin settings">
        {needsPromWiring && (
          <div className="field-grid">
            <Field
              label="Prometheus namespace"
              hint="Namespace of the Prometheus service the plugin queries (often the metrics exporter NS)."
            >
              <input
                value={target.namespace}
                onChange={(e) =>
                  setState((s) =>
                    withSiteMetrics(s, site, { existingPrometheusNamespace: e.target.value }),
                  )
                }
              />
            </Field>
            <Field label="Prometheus service" hint="Kubernetes Service name for Prometheus.">
              <input
                value={target.service}
                onChange={(e) =>
                  setState((s) =>
                    withSiteMetrics(s, site, { existingPrometheusService: e.target.value }),
                  )
                }
              />
            </Field>
            <Field label="Prometheus port" hint="Service port Prometheus listens on.">
              <input
                value={target.port}
                onChange={(e) =>
                  setState((s) =>
                    withSiteMetrics(s, site, { existingPrometheusPort: e.target.value }),
                  )
                }
              />
            </Field>
          </div>
        )}

        <AdvancedSection title="Advanced plugin settings">
          <div className="field-grid">
            <Field label="Plugin namespace" hint="Namespace where the console plugin pods run.">
              <input
                value={state.consolePlugin.namespace}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    consolePlugin: { ...s.consolePlugin, namespace: e.target.value },
                  }))
                }
              />
            </Field>
          </div>
        </AdvancedSection>
      </Section>
    </div>
  )
}
