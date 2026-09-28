import { DOCS } from '../catalog/components'
import {
  displayMetricsStorages,
  metricsForSite,
  metricsInstalledForSite,
  patchSingleSiteMetricsStorage,
  prometheusTargetForSite,
  resolvedMetricsPvcStorageClassName,
  withSiteMetrics,
} from '../catalog/metrics'
import { getSiteStorage, withSiteStorage } from '../catalog/sites'
import { siteStorageSystemsReady } from '../catalog/validation'
import { AdvancedSection } from '../components/AdvancedSection'
import { SiteSwitcher } from '../components/SiteSwitcher'
import { useWizard } from '../state/WizardContext'
import { useSiteTab } from '../state/useSiteTab'
import { Callout, Field, PasswordInput, Section } from '../components/ui'
import type { MetricsConfig, StorageSystemConfig } from '../catalog/types'

type MetricsStorage = MetricsConfig['storages'][number]

export function MetricsStep() {
  const { state, setState } = useWizard()
  const replicationOn = state.components.replication
  const [site, setSite] = useSiteTab(replicationOn)
  const metrics = metricsForSite(state, site)
  const metricsInstall = metricsInstalledForSite(state, site)
  const showMetricsForm = !replicationOn || metricsInstall
  const prometheusTarget = prometheusTargetForSite(state, site)
  const storages = displayMetricsStorages(state, site)
  const storageSystems = replicationOn
    ? getSiteStorage(state, site).storageSystems
    : state.storageSystems || []

  const classNames = (replicationOn
    ? getSiteStorage(state, site).storageClasses
    : state.storageClasses || []
  )
    .map((sc) => (sc.name || '').trim())
    .filter(Boolean)
  const pin = metrics.pvcStorageClassName
  const selectValue = classNames.includes(pin) ? pin : ''

  const patchStorage = (idx: number, patch: Partial<MetricsStorage>) => {
    setState((s) => {
      if (s.components.replication) {
        const current = getSiteStorage(s, site)
        const nextSystems = current.storageSystems.map((sys: StorageSystemConfig, i: number) =>
          i === idx ? { ...sys, ...patch } : sys,
        )
        return withSiteStorage(s, site, { ...current, storageSystems: nextSystems })
      }
      return patchSingleSiteMetricsStorage(s, idx, patch)
    })
  }

  return (
    <div className="step-panel">
      <h2>Performance Metrics</h2>
      <p className="lede">
        Deploy the storage metrics exporter for Prometheus (and optional Grafana).
      </p>

      {replicationOn && (
        <SiteSwitcher
          site={site}
          onSiteChange={setSite}
          primaryReady={siteStorageSystemsReady(state, 'primary')}
          secondaryReady={siteStorageSystemsReady(state, 'secondary')}
        />
      )}

      {replicationOn && (
        <>
          <label className="toggle-row" style={{ marginBottom: '0.85rem' }}>
            <input
              type="checkbox"
              checked={metricsInstall}
              onChange={(e) =>
                setState((s) => withSiteMetrics(s, site, { install: e.target.checked }))
              }
            />
            <div>
              <strong>Install Performance Metrics on this cluster</strong>
            </div>
          </label>
          {!metricsInstall && (
            <Callout>
              This cluster&apos;s package will not include Performance Metrics.
            </Callout>
          )}
        </>
      )}

      {showMetricsForm && (
      <>
      <Section title="Deployment options">
        <AdvancedSection
          title="Advanced deployment settings"
        >
          <div className="field-grid">
            <Field label="Namespace" hint="Where the metrics exporter Deployment runs.">
              <input
                value={metrics.namespace}
                onChange={(e) =>
                  setState((s) => withSiteMetrics(s, site, { namespace: e.target.value }))
                }
              />
            </Field>
            <Field label="Secret name" hint="Secret listing the arrays the exporter scrapes for metrics.">
              <input
                value={metrics.secretName}
                onChange={(e) =>
                  setState((s) => withSiteMetrics(s, site, { secretName: e.target.value }))
                }
              />
            </Field>
            <Field
              label="Max batch size"
              hint="Increasing batch size or worker count may raise memory use."
            >
              <input
                value={metrics.maxBatchSize}
                onChange={(e) =>
                  setState((s) => withSiteMetrics(s, site, { maxBatchSize: e.target.value }))
                }
              />
            </Field>
            <Field
              label="Max worker count"
              hint="Parallel workers for metric collection. Higher values may use more memory."
            >
              <input
                value={metrics.maxWorkerCount}
                onChange={(e) =>
                  setState((s) => withSiteMetrics(s, site, { maxWorkerCount: e.target.value }))
                }
              />
            </Field>
          </div>
          {(metrics.deployPrometheus || metrics.deployGrafana) && state.storageClassesEnabled && (
            <Field
              label="PVC StorageClass"
              hint="Used for Prometheus and Grafana persistent volumes on this cluster. Auto follows this site’s default or first StorageClass if you add or remove classes."
            >
              <select
                value={selectValue}
                onChange={(e) =>
                  setState((s) => withSiteMetrics(s, site, { pvcStorageClassName: e.target.value }))
                }
              >
                <option value="">Auto ({resolvedMetricsPvcStorageClassName(state, site)})</option>
                {classNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <label className="toggle-row" style={{ marginTop: '0.75rem' }}>
            <input
              type="checkbox"
              checked={metrics.enableDebugLog}
              onChange={(e) =>
                setState((s) => withSiteMetrics(s, site, { enableDebugLog: e.target.checked }))
              }
            />
            <div>
              <strong>Enable debug logging</strong>
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: 'var(--hv-text-subtle)' }}>
                Disable in production to reduce log volume.
              </p>
            </div>
          </label>
        </AdvancedSection>

        <label className="toggle-row" style={{ marginTop: '0.65rem' }}>
          <input
            type="checkbox"
            checked={metrics.deployPrometheus}
            onChange={(e) =>
              setState((s) => withSiteMetrics(s, site, { deployPrometheus: e.target.checked }))
            }
          />
          <div>
            <strong>Include Prometheus</strong>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: 'var(--hv-text-subtle)' }}>
              Deploys Prometheus into the metrics namespace. Turn off if you already run Prometheus
              elsewhere.{' '}
              <a href={DOCS.prometheusOverview} target="_blank" rel="noreferrer">
                What is Prometheus?
              </a>
            </p>
          </div>
        </label>
        <label className="toggle-row" style={{ marginTop: '0.65rem' }}>
          <input
            type="checkbox"
            checked={metrics.deployGrafana}
            onChange={(e) =>
              setState((s) => withSiteMetrics(s, site, { deployGrafana: e.target.checked }))
            }
          />
          <div>
            <strong>Include Grafana</strong>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: 'var(--hv-text-subtle)' }}>
              Deploys Grafana with the Hitachi dashboard provisioned. Optional if you only need metrics
              scrape.{' '}
              <a href={DOCS.grafanaIntro} target="_blank" rel="noreferrer">
                What is Grafana?
              </a>
            </p>
          </div>
        </label>
        {metrics.deployGrafana && !metrics.deployPrometheus && (
          <>
            <div className="field-grid" style={{ marginTop: '0.75rem' }}>
              <Field label="Prometheus namespace" hint="Namespace of the existing Prometheus Service.">
                <input
                  value={prometheusTarget.namespace}
                  onChange={(e) =>
                    setState((s) =>
                      withSiteMetrics(s, site, { existingPrometheusNamespace: e.target.value }),
                    )
                  }
                />
              </Field>
              <Field
                label="Prometheus service"
                hint="Service name Grafana (and the Console Plugin) will query."
              >
                <input
                  value={prometheusTarget.service}
                  onChange={(e) =>
                    setState((s) =>
                      withSiteMetrics(s, site, { existingPrometheusService: e.target.value }),
                    )
                  }
                />
              </Field>
              <Field label="Prometheus port">
                <input
                  value={prometheusTarget.port}
                  onChange={(e) =>
                    setState((s) =>
                      withSiteMetrics(s, site, { existingPrometheusPort: e.target.value }),
                    )
                  }
                />
              </Field>
            </div>
            {(!prometheusTarget.namespace.trim() ||
              !prometheusTarget.service.trim() ||
              !prometheusTarget.port.trim()) && (
              <Callout variant="warn">
                Prometheus namespace, service, and port are required so Grafana can reach your existing
                Prometheus.
              </Callout>
            )}
          </>
        )}
      </Section>

      <Section title="Exporter storage credentials">
        <p style={{ marginTop: 0, fontSize: '0.9rem', color: 'var(--hv-text-subtle)' }}>
          {replicationOn
            ? 'Pre-filled from this cluster’s storage systems (same credentials as the CSI Driver secret). Each site package includes only that cluster’s arrays.'
            : 'Pre-filled from Storage systems. You can change these if the exporter should use different credentials.'}
        </p>
        {storages.map((sec, idx) => {
          const sys = storageSystems[idx]
          const arrayLabel = `Array: ${sys?.name || sys?.id || idx + 1}`
          return (
            <div key={sys?.id ?? idx} className="exporter-array">
              <h4 className="exporter-array-title">{arrayLabel}</h4>
              <div className="field-grid">
                <Field label="Serial">
                  <input
                    value={sec.serial}
                    onChange={(e) => patchStorage(idx, { serial: e.target.value })}
                  />
                </Field>
                <Field label="URL" hint="Prefer storage controller IP where documented.">
                  <input
                    value={sec.url}
                    onChange={(e) => patchStorage(idx, { url: e.target.value })}
                  />
                </Field>
                <Field label="User">
                  <input
                    value={sec.user}
                    onChange={(e) => patchStorage(idx, { user: e.target.value })}
                  />
                </Field>
                <Field label="Password">
                  <PasswordInput
                    value={sec.password}
                    onChange={(value) => patchStorage(idx, { password: value })}
                  />
                </Field>
              </div>
            </div>
          )
        })}
      </Section>
      </>
      )}
    </div>
  )
}
