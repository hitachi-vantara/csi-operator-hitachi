import { REPO } from '../catalog/components'

export type PluginFolder = 'hspc' | 'hrpc' | 'hspp'

export interface VersionInfo {
  hspc: string[]
  hrpc: string[]
  hspp: string[]
  latest: { hspc: string; hrpc: string; hspp: string }
  fetchedAt: string
  source: 'api' | 'cache' | 'fallback'
}

/** Oldest CSI component tag the wizard offers in version dropdowns. */
export const MIN_COMPONENT_VERSION = 'v3.18.0'

/** Bundled fallback when GitHub API is unavailable */
export const FALLBACK_VERSIONS: VersionInfo = {
  hspc: ['v3.18.3', 'v3.18.2', 'v3.18.1', 'v3.18.0'],
  hrpc: ['v3.18.3'],
  hspp: ['v3.18.3'],
  latest: { hspc: 'v3.18.3', hrpc: 'v3.18.3', hspp: 'v3.18.3' },
  fetchedAt: '2026-08-10T00:00:00.000Z',
  source: 'fallback',
}

const CACHE_KEY = 'hitachi-csi-versions'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

function parseSemver(v: string): number[] {
  const m = v.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  while (m.length < 3) m.push(0)
  return m
}

export function compareVersions(a: string, b: string): number {
  const aa = parseSemver(a)
  const bb = parseSemver(b)
  for (let i = 0; i < 3; i++) {
    if (aa[i] !== bb[i]) return bb[i] - aa[i] // descending
  }
  return 0
}

export function versionAtLeast(version: string, min: string): boolean {
  const a = parseSemver(version)
  const b = parseSemver(min)
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true
    if (a[i] < b[i]) return false
  }
  return true
}

export function filterSupportedVersions(list: string[]): string[] {
  return list.filter((v) => versionAtLeast(v, MIN_COMPONENT_VERSION)).sort(compareVersions)
}

/** Keep the current tag when it is still offered; otherwise use latest. */
export function pickListedVersion(current: string, listed: string[], latest: string): string {
  if (current && listed.includes(current)) return current
  return latest
}

function extractVersions(paths: string[], folder: PluginFolder): string[] {
  const set = new Set<string>()
  const re = new RegExp(`^${folder}/(v\\d+\\.\\d+\\.\\d+)/`)
  for (const p of paths) {
    const m = p.match(re)
    if (m) set.add(m[1])
  }
  return filterSupportedVersions(Array.from(set))
}

function withSupportedLists(info: VersionInfo): VersionInfo | null {
  const hspc = filterSupportedVersions(info.hspc)
  const hrpc = filterSupportedVersions(info.hrpc)
  const hspp = filterSupportedVersions(info.hspp)
  if (!hspc.length) return null
  return {
    ...info,
    hspc,
    hrpc: hrpc.length ? hrpc : FALLBACK_VERSIONS.hrpc,
    hspp: hspp.length ? hspp : FALLBACK_VERSIONS.hspp,
    latest: {
      hspc: hspc[0],
      hrpc: (hrpc.length ? hrpc : FALLBACK_VERSIONS.hrpc)[0]!,
      hspp: (hspp.length ? hspp : FALLBACK_VERSIONS.hspp)[0]!,
    },
  }
}

function loadCache(): VersionInfo | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as VersionInfo & { cachedAt?: number }
    if (parsed.cachedAt && Date.now() - parsed.cachedAt > CACHE_TTL_MS) return null
    return withSupportedLists({ ...parsed, source: 'cache' })
  } catch {
    return null
  }
}

function saveCache(info: VersionInfo) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...info, cachedAt: Date.now() }))
  } catch {
    /* ignore quota */
  }
}

export async function fetchVersions(): Promise<VersionInfo> {
  const cached = loadCache()
  try {
    const res = await fetch(`${REPO.apiBase}/git/trees/main?recursive=1`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) throw new Error(`GitHub API ${res.status}`)
    const data = (await res.json()) as { tree: { path: string; type: string }[] }
    const paths = data.tree.filter((t) => t.type === 'blob').map((t) => t.path)
    const hspc = extractVersions(paths, 'hspc')
    const hrpc = extractVersions(paths, 'hrpc')
    const hspp = extractVersions(paths, 'hspp')
    if (!hspc.length) throw new Error('No HSPC versions found')
    const info = withSupportedLists({
      hspc,
      hrpc,
      hspp,
      latest: {
        hspc: hspc[0]!,
        hrpc: (hrpc.length ? hrpc : FALLBACK_VERSIONS.hrpc)[0]!,
        hspp: (hspp.length ? hspp : FALLBACK_VERSIONS.hspp)[0]!,
      },
      fetchedAt: new Date().toISOString(),
      source: 'api',
    })
    if (!info) throw new Error('No supported HSPC versions found')
    saveCache(info)
    return info
  } catch {
    if (cached) return cached
    return FALLBACK_VERSIONS
  }
}

/**
 * Resolve path to a sample/operator file for a given version.
 * Handles layout drift (v3.18.2 uses yaml/ subfolder).
 */
export function templatePaths(folder: PluginFolder, version: string, opts?: { k8sMinor?: number }) {
  const base = `${REPO.rawBase}/${folder}/${version}`
  if (folder === 'hspc') {
    const k8sMinor = opts?.k8sMinor
    return {
      operatorNs: [`${base}/operator/hspc-operator-namespace.yaml`, `${base}/yaml/operator/hspc-operator-namespace.yaml`],
      operator: [`${base}/operator/hspc-operator.yaml`, `${base}/yaml/operator/hspc-operator.yaml`],
      hspcCr: [`${base}/operator/hspc_v1_hspc.yaml`, `${base}/yaml/operator/hspc_v1_hspc.yaml`],
      k8sSample: k8sMinor
        ? [`${base}/sample/hspc-k8s${k8sMinor}.yaml`, `${base}/yaml/sample/hspc-k8s${k8sMinor}.yaml`]
        : [],
      secret: [`${base}/sample/secret-sample.yaml`, `${base}/yaml/sample/secret-sample.yaml`],
      secretStretched: [`${base}/sample/secret-sample-stretched.yaml`, `${base}/yaml/sample/secret-sample-stretched.yaml`],
      sc: [`${base}/sample/sc-sample.yaml`, `${base}/yaml/sample/sc-sample.yaml`],
      scStretched: [`${base}/sample/sc-sample-stretched.yaml`, `${base}/yaml/sample/sc-sample-stretched.yaml`],
      scStretchedAdr: [`${base}/sample/sc-sample-stretched-adr.yaml`, `${base}/yaml/sample/sc-sample-stretched-adr.yaml`],
      scSds: [`${base}/sample/sc-sample-vsp-one-sds-block.yaml`, `${base}/yaml/sample/sc-sample-vsp-one-sds-block.yaml`],
      snapshotClass: [`${base}/sample/volumesnapshotclass-sample.yaml`, `${base}/yaml/sample/volumesnapshotclass-sample.yaml`],
      snapshotClassImmutable: [
        `${base}/sample/volumesnapshotclass-immutable-sample.yaml`,
        `${base}/yaml/sample/volumesnapshotclass-immutable-sample.yaml`,
      ],
      pvc: [`${base}/sample/pvc-sample.yaml`, `${base}/yaml/sample/pvc-sample.yaml`],
      pod: [`${base}/sample/pod-sample.yaml`, `${base}/yaml/sample/pod-sample.yaml`],
      consolePlugin: [`${base}/sample/consoleplugin-ocp-ui.yaml`, `${base}/yaml/sample/consoleplugin-ocp-ui.yaml`],
      multipathMc: [`${base}/sample/multipath-machineconfig-sample.yaml`, `${base}/yaml/sample/multipath-machineconfig-sample.yaml`],
      rosaDaemonset: [`${base}/sample/rosa-daemonset.yaml`, `${base}/yaml/sample/rosa-daemonset.yaml`],
    }
  }
  if (folder === 'hrpc') {
    return {
      operatorNs: [`${base}/yaml/hspc-replication-operator-namespace.yaml`],
      operator: [`${base}/yaml/hspc-replication-operator.yaml`],
      replicationCr: [`${base}/yaml/hspc_v1_replication.yaml`],
      storageSecrets: [`${base}/yaml/storage-secrets-sample.yaml`],
      remoteKubeconfig: [`${base}/yaml/remote-kubeconfig-sample.yaml`],
      drInstall: [`${base}/dr-operator/yaml/dr-operator-install.yaml`],
      certManager: [`${base}/dr-operator/yaml/cert-manager.yaml`],
    }
  }
  return {
    namespace: [`${base}/yaml/namespace.yaml`],
    exporter: [`${base}/yaml/exporter.yaml`],
    secret: [`${base}/yaml/secret-sample.yaml`],
    scc: [`${base}/yaml/scc-for-openshift.yaml`],
    grafanaProm: [`${base}/yaml/grafana-prometheus-sample.yaml`],
  }
}

const templateCache = new Map<string, string>()

export async function fetchFirstAvailable(urls: string[]): Promise<string | null> {
  for (const url of urls) {
    if (templateCache.has(url)) return templateCache.get(url)!
    try {
      const res = await fetch(url)
      if (res.ok) {
        const text = await res.text()
        templateCache.set(url, text)
        return text
      }
    } catch {
      /* try next */
    }
  }
  return null
}
