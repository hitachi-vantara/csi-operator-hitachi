const PROMETHEUS_NAMES = new Set(['prometheus', 'prometheus-config'])
const GRAFANA_NAMES = new Set([
  'grafana',
  'grafana-datasources',
  'grafana-dashboard-config',
  'grafana-dashboard-json',
])

function splitDocs(yaml: string): string[] {
  return yaml
    .split(/^---$/m)
    .map((d) => d.trim())
    .filter(Boolean)
}

function docMeta(doc: string): { kind: string; name: string } {
  const kind = /^kind:\s*(.+)$/m.exec(doc)?.[1]?.trim() ?? ''
  const name = /^  name:\s*(.+)$/m.exec(doc)?.[1]?.trim() ?? ''
  return { kind, name }
}

export function prometheusDatasourceUrl(target: {
  namespace: string
  service: string
  port: string
}): string {
  return `http://${target.service}.${target.namespace}.svc:${target.port}`
}

export function splitMonitoringStack(yaml: string): { prometheusYaml: string; grafanaYaml: string } {
  const prom: string[] = []
  const graf: string[] = []
  for (const doc of splitDocs(yaml)) {
    const { name } = docMeta(doc)
    if (PROMETHEUS_NAMES.has(name)) prom.push(doc)
    else if (GRAFANA_NAMES.has(name)) graf.push(doc)
  }
  return {
    prometheusYaml: prom.join('\n---\n') + (prom.length ? '\n' : ''),
    grafanaYaml: graf.join('\n---\n') + (graf.length ? '\n' : ''),
  }
}

/** Rewrite metadata.namespace (and OpenShift SCC serviceaccount subjects). */
export function rewriteYamlNamespace(yaml: string, namespace: string): string {
  return yaml
    .replace(/^(\s*namespace:\s*).+$/gm, `$1${namespace}`)
    .replace(/system:serviceaccount:[^:\s]+:/g, `system:serviceaccount:${namespace}:`)
}

/** Upstream stacks hardcode storageClassName: sc-sample. */
export function rewriteStorageClassName(yaml: string, storageClassName: string): string {
  if (!storageClassName.trim()) return yaml
  return yaml.replace(/storageClassName:\s*sc-sample\b/g, `storageClassName: ${storageClassName}`)
}

/** Rewrite Grafana Prometheus datasource URL; leave other docs untouched. */
export function patchGrafanaDatasource(
  grafanaYaml: string,
  target: { namespace: string; service: string; port: string },
): string {
  const url = prometheusDatasourceUrl(target)
  return (
    splitDocs(grafanaYaml)
      .map((doc) => {
        const { name } = docMeta(doc)
        if (name !== 'grafana-datasources') return doc
        // Upstream embeds `url: http://prometheus:9090` (same-namespace short name).
        return doc.replace(/url:\s*http:\/\/[^\s]+/g, `url: ${url}`)
      })
      .join('\n---\n') + '\n'
  )
}
