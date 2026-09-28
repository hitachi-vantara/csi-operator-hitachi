import type { ConsolePluginConfig } from '../catalog/types'

/** Patch upstream consoleplugin-ocp-ui.yaml with wizard Prometheus target. */
export function patchConsolePluginManifest(
  yaml: string,
  cfg: Pick<ConsolePluginConfig, 'prometheusNamespace' | 'prometheusService' | 'prometheusPort'>,
): string {
  let out = yaml.replace(
    /"hsppPrometheus"\s*:\s*\{[^}]*\}/m,
    `"hsppPrometheus": {
        "namespace": ${JSON.stringify(cfg.prometheusNamespace)},
        "service": ${JSON.stringify(cfg.prometheusService)},
        "port": ${JSON.stringify(cfg.prometheusPort)}
      }`,
  )
  // ClusterRole services/proxy resourceNames must match the Prometheus Service name
  out = out.replace(
    /(resources:\s*\["services\/proxy"\]\s*\n\s*resourceNames:\s*\[)[^\]]*(\])/m,
    `$1${JSON.stringify(cfg.prometheusService)}$2`,
  )
  // Also handle single-line resourceNames: ["prometheus"]
  out = out.replace(
    /resourceNames:\s*\["prometheus"\]/g,
    `resourceNames: [${JSON.stringify(cfg.prometheusService)}]`,
  )
  return out
}
