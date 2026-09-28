import type {
  MetricsConfig,
  QuickstartConfig,
  ReplicationConfig,
  SnapshotClassConfig,
  StorageClassConfig,
  StorageSystemConfig,
  WizardState,
} from '../catalog/types'
import {
  CONNECTION_TYPES,
  SDS_BLOCK_CONNECTIONS,
  STRETCHED_CONNECTIONS,
  coerceConnectionType,
  stretchedSecretPackagePath,
  supportsCsiVolumeSnapshots,
} from '../catalog/platforms'
import { PLATFORMS } from '../catalog/platforms'
import { normalizePortId } from '../catalog/validation'
import { wizardVersion } from '../wizardVersion'
import { generateMultipathMachineConfigs, getMultipathConf, expectedMultipathMachineConfigNames } from './multipath'
import {
  expectedMultipathDaemonSet,
  generateMultipathDaemonSetFiles,
} from './multipathDaemonSet'
import {
  HSPC_OLM_PACKAGE,
  HSPC_OLM_SOURCE,
  generateOperatorHubFiles,
} from './operatorHub'
import {
  generateDrRemoteKubeconfigSecret,
  generateRemoteKubeconfigScript,
  generateRemoteKubeconfigSecret,
  REMOTE_KUBECONFIG_SECRET_NAME,
  resolvedDrClusterNames,
} from './remoteKubeconfig'
import { patchGrafanaDatasource, rewriteStorageClassName, rewriteYamlNamespace, splitMonitoringStack } from './monitoringStack'
import { patchConsolePluginManifest } from './consolePlugin'
import { REPO } from '../catalog/components'
import { fetchFirstAvailable, templatePaths } from '../services/versions'
import { extractImages, offlineRegistryPaths, rewriteImagesToRegistry } from './offline'
import { generateMirrorScript } from './mirror'
import {
  applySiteMetricsToState,
  resolvedFlattenedMetricsPvcStorageClassName,
  resolvedMetricsStorages,
} from '../catalog/metrics'
import { resolvedReplicationStorageSecrets } from '../catalog/replicationSecrets'
import { effectiveSerialNumber } from '../catalog/validation'
import { applyArrayBindingToClass, csiSecretRefForSystem, gadArraysForStorageClass } from '../catalog/arrayBinding'
import {
  ensureSitesForReplication,
  getSiteStorage,
  resolvedCurrentStorageClassName,
  resolvedStorageClassName,
} from '../catalog/sites'
import { applySiteQuickstartToState, quickstartInstalledForSite } from '../catalog/siteQuickstart'
import type { SiteId } from '../catalog/sites'

export interface GeneratedFile {
  path: string
  content: string
  description: string
  group: 'prereq' | 'driver' | 'storage' | 'replication' | 'metrics' | 'console' | 'quickstart' | 'scripts'
}

const WIZARD_EXTRAS_ALPINE = 'alpine:3.19'
const WIZARD_EXTRAS_BUSYBOX = 'busybox:1.36'
const WIZARD_EXTRAS_PAUSE = 'registry.k8s.io/pause:3.9'

// Known coverage gap: hvcsi-offline-bundle.sh -t hspc does not scan consoleplugin-ocp-ui.yaml.
// Keep in sync with .superpowers/sdd/offline-image-coverage-gaps.md.
const CONSOLE_PLUGIN_HV_OCP_UI_REPO = 'registry.hitachivantara.com/hitachicsi-oci-oss/hv-ocp-ui'
const CONSOLE_PLUGIN_OSE_TOOLS_RHEL8_DIGEST =
  'registry.redhat.io/openshift4/ose-tools-rhel8@sha256:e44074f21e0cca6464e50cb6ff934747e0bd11162ea01d522433a1a1ae116103'

function wizardOwnedExtrasImagesUsedByPackage(state: WizardState): string[] {
  const plat = PLATFORMS[state.platform]
  const out = new Set<string>()

  if (state.multipath.enabled && plat.useOc && state.multipath.includeDaemonSet) {
    out.add(WIZARD_EXTRAS_ALPINE)
    out.add(WIZARD_EXTRAS_PAUSE)
  }

  if (state.storageClassesEnabled) {
    if (state.quickstart.volumeMode === 'Block') out.add(WIZARD_EXTRAS_PAUSE)
    else out.add(WIZARD_EXTRAS_BUSYBOX)
  }

  return [...out]
}

function imagesUsedByPackage(files: GeneratedFile[]): string[] {
  const out = new Set<string>()
  for (const f of files) {
    if (!f.path.endsWith('.yaml') && !f.path.endsWith('.yml')) continue
    for (const img of extractImages(f.content)) out.add(img)
  }
  return [...out].sort()
}

function mirrorScriptFile(state: WizardState, packageFiles: GeneratedFile[]): GeneratedFile | null {
  if (!state.airGapped) return null
  if (!String(state.offline?.registryBase || '').trim()) return null

  const paths = offlineRegistryPaths(state)
  const extrasBase = (paths.extras || '').trim()
  const extrasImages = extrasBase ? wizardOwnedExtrasImagesUsedByPackage(state) : []
  const hspcExtrasImages: string[] = []
  if (state.components.consolePlugin && PLATFORMS[state.platform].supportsConsolePlugin) {
    hspcExtrasImages.push(`${CONSOLE_PLUGIN_HV_OCP_UI_REPO}:${state.versions.driver}`)
    hspcExtrasImages.push(CONSOLE_PLUGIN_OSE_TOOLS_RHEL8_DIGEST)
  }
  const verifyImages = imagesUsedByPackage(packageFiles)

  return {
    path: 'mirror.sh',
    content: generateMirrorScript(state, { extrasImages, hspcExtrasImages, verifyImages }),
    description: 'Air-gapped mirror entrypoint (plan + optional gap-fill images)',
    group: 'scripts',
  }
}

async function hvOfflineBundleScriptFile(state: WizardState): Promise<GeneratedFile | null> {
  if (!state.airGapped) return null
  if (!String(state.offline?.registryBase || '').trim()) return null

  const url = `${REPO.rawBase}/hvcsi-offline-bundle.sh`
  const raw = await fetchFirstAvailable([url])
  if (raw) {
    return {
      path: 'hvcsi-offline-bundle.sh',
      content: raw,
      description: 'Hitachi CSI offline bundle helper (from csi-operator-hitachi)',
      group: 'scripts',
    }
  }

  // Keep mirror.sh usable even if export-time fetch fails: it can still clone and use the repo’s copy.
  return {
    path: 'hvcsi-offline-bundle.sh',
    content: `#!/usr/bin/env bash
set -euo pipefail

# WIZARD_OFFLINE_BUNDLE_PLACEHOLDER=1

echo "ERROR: This ZIP could not embed hvcsi-offline-bundle.sh at export time." >&2
echo "Run ./mirror.sh, which will clone csi-operator-hitachi and use the script from that checkout." >&2
exit 1
`,
    description: 'Offline bundle helper (placeholder when fetch failed)',
    group: 'scripts',
  }
}

function b64(s: string): string {
  return btoa(unescape(encodeURIComponent(s)))
}

function yamlQuote(s: string): string {
  if (/[:#{}[\],&*?|>!%@`]/.test(s) || s.includes('\n') || s === '') return JSON.stringify(s)
  return s
}

export function generateTelemetryDisableConfigMap(namespace: string): string {
  return `apiVersion: v1
kind: ConfigMap
metadata:
  name: hspc-csi-telemetry-config
  namespace: ${namespace}
data:
  awsEnabled: "false"
`
}

export function generateStandardSecret(sys: StorageSystemConfig, name: string, namespace: string): string {
  const data: string[] = [
    `  url: ${b64(sys.url)}`,
    `  user: ${b64(sys.user)}`,
    `  password: ${b64(sys.password)}`,
  ]
  if (sys.hostModeOptions) data.push(`  hostModeOptions: ${b64(sys.hostModeOptions)}`)
  if (sys.resourceGroupID) data.push(`  resourceGroupID: ${b64(sys.resourceGroupID)}`)

  const stringData: string[] = []
  if (sys.alternativeCloneMode) stringData.push(`  alternativeCloneMode: "true"`)

  let out = `apiVersion: v1
kind: Secret
metadata:
  name: ${name}
  namespace: ${namespace}
type: Opaque
data:
${data.join('\n')}
`
  if (stringData.length) {
    out += `stringData:
${stringData.join('\n')}
`
  }
  return out
}

export function generateStretchedSecret(
  primary: StorageSystemConfig,
  secondary: StorageSystemConfig,
  name: string,
  namespace: string,
  opts?: { virtualSerial?: string; alternativeCloneMode?: boolean },
): string {
  const lines = [
    `  primarySerial: ${JSON.stringify(primary.serial)}`,
    `  primaryURL: ${primary.url}`,
    `  primaryUser: ${primary.user}`,
    `  primaryPassword: ${primary.password}`,
    `  secondarySerial: ${JSON.stringify(secondary.serial)}`,
    `  secondaryURL: ${secondary.url}`,
    `  secondaryUser: ${secondary.user}`,
    `  secondaryPassword: ${secondary.password}`,
  ]
  const virtualSerial = (opts?.virtualSerial || '').trim()
  if (virtualSerial) lines.push(`  virtualStorageSerialNumber: ${JSON.stringify(virtualSerial)}`)
  if (opts?.alternativeCloneMode) lines.push(`  alternativeCloneMode: "true"`)
  return `apiVersion: v1
kind: Secret
metadata:
  name: ${name}
  namespace: ${namespace}
type: Opaque
stringData:
${lines.join('\n')}
`
}

function secretRefs(secretName: string, secretNs: string, expand: boolean): string {
  const slots = [
    'node-publish',
    'provisioner',
    'controller-publish',
    'node-stage',
    ...(expand ? (['controller-expand'] as const) : []),
  ]
  return slots
    .flatMap((s) => [
      `  csi.storage.k8s.io/${s}-secret-name: "${secretName}"`,
      `  csi.storage.k8s.io/${s}-secret-namespace: "${secretNs}"`,
    ])
    .join('\n')
}

export function generateStorageClass(sc: StorageClassConfig): string {
  const conn = CONNECTION_TYPES.find((c) => c.id === sc.connectionType)
  const expand = sc.kind === 'stretched' || sc.kind === 'stretched-adr' ? false : sc.allowVolumeExpansion
  const params: string[] = []

  if (sc.kind === 'vsp-one-sds-block') {
    params.push(`  storageType: vsp-one-sds-block`)
    params.push(
      `  connectionType: ${coerceConnectionType(sc.connectionType, SDS_BLOCK_CONNECTIONS)}`,
    )
    if (sc.storageEfficiency) params.push(`  storageEfficiency: ${sc.storageEfficiency}`)
    if (sc.fstype) params.push(`  csi.storage.k8s.io/fstype: ${sc.fstype}`)
  } else if (sc.kind === 'stretched' || sc.kind === 'stretched-adr') {
    params.push(
      `  connectionType: ${coerceConnectionType(sc.connectionType, STRETCHED_CONNECTIONS)}`,
    )
    params.push(`  replicationType: stretched`)
    if (sc.quorumID) params.push(`  quorumID: ${JSON.stringify(sc.quorumID)}`)
    if (sc.copyGroupName) params.push(`  copyGroupName: ${JSON.stringify(sc.copyGroupName)}`)
    if (sc.copyPairName) params.push(`  copyPairName: ${JSON.stringify(sc.copyPairName)}`)
    if (sc.consistencyGroupId) params.push(`  consistencyGroupId: ${JSON.stringify(sc.consistencyGroupId)}`)
    if (sc.primaryPoolID) params.push(`  primaryPoolID: ${JSON.stringify(sc.primaryPoolID)}`)
    if (sc.primaryPortID) params.push(`  primaryPortID: ${normalizePortId(sc.primaryPortID)}`)
    if (sc.secondaryPoolID) params.push(`  secondaryPoolID: ${JSON.stringify(sc.secondaryPoolID)}`)
    if (sc.secondaryPortID) params.push(`  secondaryPortID: ${normalizePortId(sc.secondaryPortID)}`)
  } else {
    if (sc.serialNumber) params.push(`  serialNumber: ${JSON.stringify(sc.serialNumber)}`)
    if (sc.poolID) params.push(`  poolID: ${JSON.stringify(sc.poolID)}`)
    if (conn?.needsPortId && sc.portID) params.push(`  portID: ${normalizePortId(sc.portID)}`)
    params.push(`  connectionType: ${sc.connectionType}`)
    if (conn?.needsNvmSubsystem && sc.nvmSubsystemID) {
      params.push(`  nvmSubsystemID: ${JSON.stringify(sc.nvmSubsystemID)}`)
    }
    if (sc.storageEfficiency && sc.storageEfficiency !== 'Disabled') {
      params.push(`  storageEfficiency: ${JSON.stringify(sc.storageEfficiency)}`)
      if (sc.storageEfficiencyMode) {
        params.push(`  storageEfficiencyMode: ${JSON.stringify(sc.storageEfficiencyMode)}`)
      }
    } else if (sc.storageEfficiency === 'Disabled') {
      // omit or set Disabled — sample often omits; include for clarity when user chose it
    }
    if (sc.fstype) params.push(`  csi.storage.k8s.io/fstype: ${sc.fstype}`)
  }

  const secretName = sc.kind.startsWith('stretched') ? sc.stretchedSecretName || sc.secretName : sc.secretName
  params.push(secretRefs(secretName, sc.secretNamespace, expand))

  const annotations = ['    kubernetes.io/description: Hitachi CSI']
  if (sc.isDefault) {
    annotations.push('    storageclass.kubernetes.io/is-default-class: "true"')
  }

  return `apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ${sc.name}
  annotations:
${annotations.join('\n')}
provisioner: hspc.csi.hitachi.com
reclaimPolicy: ${sc.reclaimPolicy}
volumeBindingMode: ${sc.volumeBindingMode}
allowVolumeExpansion: ${expand}
parameters:
${params.join('\n')}
`
}

function snapshotSourceSc(state: WizardState): StorageClassConfig | undefined {
  const list = state.storageClasses
  return (
    list.find((s) => s.isDefault && s.kind === 'standard' && s.poolID) ||
    list.find((s) => s.kind === 'standard' && s.poolID) ||
    list.find((s) => (s.kind === 'stretched' || s.kind === 'stretched-adr') && s.primaryPoolID) ||
    list[0]
  )
}

export function snapshotClassOpts(state: WizardState): {
  poolID: string
  secretName: string
  secretNamespace: string
} {
  const sourceSc = snapshotSourceSc(state)
  const poolID =
    sourceSc?.kind === 'standard' ? sourceSc.poolID || '' : sourceSc?.primaryPoolID || ''
  const bound = sourceSc ? applyArrayBindingToClass(sourceSc, state.storageSystems, state.driverNamespace) : undefined

  const secretName = sourceSc
    ? sourceSc.kind.startsWith('stretched')
      ? sourceSc.stretchedSecretName || bound?.secretName || sourceSc.secretName
      : bound?.secretName || sourceSc.secretName
    : state.storageClasses[0]?.secretName || 'hitachi-csi-secret'

  const secretNamespace =
    (sourceSc?.kind.startsWith('stretched')
      ? (sourceSc.secretNamespace || '').trim() || state.driverNamespace
      : bound?.secretNamespace || sourceSc?.secretNamespace) ||
    state.storageClasses[0]?.secretNamespace ||
    state.driverNamespace
  return { poolID, secretName, secretNamespace }
}

export function generateSnapshotClass(
  cfg: SnapshotClassConfig,
  opts: {
    poolID: string
    secretName: string
    secretNamespace: string
  },
): string {
  const metaAnnotations: string[] = []
  if (cfg.isDefault) {
    metaAnnotations.push('    snapshot.storage.kubernetes.io/is-default-class: "true"')
  }
  const metaBlock =
    metaAnnotations.length > 0
      ? `metadata:
  name: ${cfg.name}
  annotations:
${metaAnnotations.join('\n')}`
      : `metadata:
  name: ${cfg.name}`

  const snapParams: string[] = []
  if (opts.poolID) snapParams.push(`  poolID: ${JSON.stringify(opts.poolID)}`)
  snapParams.push(`  csi.storage.k8s.io/snapshotter-secret-name: ${JSON.stringify(opts.secretName)}`)
  snapParams.push(
    `  csi.storage.k8s.io/snapshotter-secret-namespace: ${JSON.stringify(opts.secretNamespace)}`,
  )
  if (cfg.immutable && cfg.retentionPeriod) {
    snapParams.push(`  retentionPeriod: ${JSON.stringify(cfg.retentionPeriod)}`)
  }

  return `apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshotClass
${metaBlock}
driver: hspc.csi.hitachi.com
deletionPolicy: ${cfg.deletionPolicy}
parameters:
${snapParams.join('\n')}
`
}

export function generateHspcCr(namespace: string): string {
  return `apiVersion: csi.hitachi.com/v1
kind: HSPC
metadata:
  name: hspc
  namespace: ${namespace}
spec: {}
`
}

function parseK8sMinor(version: string): number | null {
  const raw = (version || '').trim()
  const parts = raw.split('.')
  if (parts.length < 2) return null
  const minor = parseInt(parts[1]!, 10)
  return Number.isFinite(minor) && minor > 0 ? minor : null
}

function extractContainerImagesByName(yaml: string): Record<string, string> {
  const out: Record<string, string> = {}
  const lines = yaml.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const nameLine = lines[i]!
    const m = nameLine.match(/^(\s*)-\s*name:\s*([A-Za-z0-9._-]+)\s*$/)
    if (!m) continue
    const indent = m[1]!.length
    const name = m[2]!
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]!
      const next = line.match(/^(\s*)-\s*name:\s*([A-Za-z0-9._-]+)\s*$/)
      if (next && next[1]!.length <= indent) break
      const img = line.match(/^\s*image:\s*(['"]?)([^\s'"]+)\1\s*$/)
      if (img) {
        out[name] = img[2]!
        break
      }
    }
  }
  return out
}

function generateHspcCrFromOfflineSample(namespace: string, rewrittenSampleYaml: string): string | null {
  const byName = extractContainerImagesByName(rewrittenSampleYaml)
  const controller = [
    'hspc-csi-driver',
    'external-attacher',
    'csi-provisioner',
    'liveness-probe',
    'csi-resizer',
    'csi-snapshotter',
  ] as const
  const node = ['hspc-csi-driver', 'driver-registrar'] as const

  const missing = [...controller, ...node].filter((n) => !byName[n])
  if (missing.length) return null

  const controllerLines = controller
    .map((name) => `        - name: ${name}\n          image: ${byName[name]}`)
    .join('\n')
  const nodeLines = node
    .map((name) => `        - name: ${name}\n          image: ${byName[name]}`)
    .join('\n')

  return `apiVersion: csi.hitachi.com/v1
kind: HSPC
metadata:
  name: hspc
  namespace: ${namespace}
spec:
  csiDriver:
    enable: true
    controller:
      containers:
${controllerLines}
    node:
      containers:
${nodeLines}
`
}

export function generateReplicationSecrets(cfg: ReplicationConfig): string {
  const storages = cfg.storageSecrets
    .map(
      (s) => `    - serial: ${s.serial}
      url: ${s.url}
      user: ${s.user}
      password: ${s.password}
      journal: ${s.journal}`,
    )
    .join('\n')
  return `apiVersion: v1
kind: Secret
metadata:
  name: hspc-replication-operator-storage-secrets
  namespace: ${cfg.namespace}
type: Opaque
stringData:
  storage-secrets.yaml: |-
    storages:
${storages}
`
}

export function generateMetricsSecret(cfg: MetricsConfig): string {
  const storages = cfg.storages
    .map(
      (s) => `    - serial: ${s.serial}
      url: ${s.url}
      user: ${s.user}
      password: ${s.password}`,
    )
    .join('\n')
  return `apiVersion: v1
kind: Secret
metadata:
  name: ${cfg.secretName}
  namespace: ${cfg.namespace}
type: Opaque
stringData:
  storage-exporter.yaml: |-
    storages:
${storages}
`
}

export function generateMetricsExporterPatch(cfg: MetricsConfig, version: string): string {
  return `# Performance Metrics exporter overlay (strategic merge patch after exporter.yaml).
# Wizard image tag + Advanced env. Do not kubectl apply this file — it is not a full Deployment.
# Image tag aligned to ${version}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: storage-exporter
  namespace: ${cfg.namespace}
spec:
  template:
    spec:
      containers:
        - name: storage-exporter
          image: registry.hitachivantara.com/hitachicsi-oci-oss/storage-plugin-for-prometheus:${version}
          env:
            - name: SPC_PUSHGATEWAY_URL
              value: http://pushgateway:9091
            - name: SPC_ENABLE_DEBUG_LOG
              value: ${JSON.stringify(String(cfg.enableDebugLog))}
            - name: MAX_BATCH_SIZE
              value: ${JSON.stringify(cfg.maxBatchSize)}
            - name: MAX_WORKER_COUNT
              value: ${JSON.stringify(cfg.maxWorkerCount)}
`
}

export function generatePvc(qs: QuickstartConfig): string {
  return `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ${qs.pvcName}
spec:
  accessModes:
    - ${qs.accessMode}
  volumeMode: ${qs.volumeMode}
  resources:
    requests:
      storage: ${qs.pvcSize}
  storageClassName: ${qs.storageClassName}
`
}

export function generateTestPod(
  qs: QuickstartConfig,
  opts?: { registryPath?: string },
): string {
  const registry = (opts?.registryPath || '').trim()
  const pauseImage = registry ? `${registry}/pause:3.9` : 'registry.k8s.io/pause:3.9'
  const busyboxImage = registry ? `${registry}/busybox:1.36` : 'busybox:1.36'
  if (qs.volumeMode === 'Block') {
    return `apiVersion: v1
kind: Pod
metadata:
  name: ${qs.podName}
spec:
  containers:
    - name: app
      image: ${pauseImage}
      volumeDevices:
        - name: data
          devicePath: /dev/xvda
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: ${qs.pvcName}
`
  }
  return `apiVersion: v1
kind: Pod
metadata:
  name: ${qs.podName}
spec:
  containers:
    - name: app
      image: ${busyboxImage}
      command: ["sh", "-c", "echo Hitachi CSI test volume OK > /data/hello.txt && sleep 3600"]
      volumeMounts:
        - name: data
          mountPath: /data
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: ${qs.pvcName}
`
}

export function generateInstallScript(
  state: WizardState,
  files: GeneratedFile[],
  opts?: { drScNameOverride?: string },
): string {
  const plat = PLATFORMS[state.platform]
  const cmd = plat.useOc ? 'oc' : 'kubectl'
  const applyFiles = files.filter((f) => f.group !== 'scripts' && f.path.endsWith('.yaml'))
  const lines = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `# Hitachi CSI Deployment Wizard — generated install script`,
    `# Wizard: ${wizardVersion()}`,
    `# Platform: ${plat.displayName} ${state.platformVersion}`,
    `CMD="${cmd}"`,
    '',
    '# Always run relative to this script (ZIP root), even if invoked via absolute path.',
    'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    'cd "$SCRIPT_DIR"',
    '',
    'mkdir -p "$SCRIPT_DIR/logs"',
    'INSTALL_LOG="$SCRIPT_DIR/logs/install-$(date +%Y%m%d-%H%M%S).log"',
    'echo "==> Logging this run to $INSTALL_LOG"',
    '# Tee all subsequent stdout/stderr to the log and the console.',
    'exec > >(tee -a "$INSTALL_LOG") 2>&1',
    `echo "==> Wizard ${wizardVersion()}"`,
    'trap \'echo "==> Full log: $INSTALL_LOG"\' EXIT',
    '',
    'APPLY_CRD_WAIT_SEC="${APPLY_CRD_WAIT_SEC:-300}"',
    'APPLY_CRD_POLL_SEC="${APPLY_CRD_POLL_SEC:-5}"',
    '',
    'is_crd_discovery_error() {',
    '  local out="$1"',
    '  local other',
    '  [[ "$out" == *"no matches for kind"* || "$out" == *"ensure CRDs are installed first"* ]] || return 1',
    '  other=$(printf "%s\\n" "$out" | grep -E "^error:" | grep -v "no matches for kind" | grep -v "ensure CRDs are installed first" || true)',
    '  [[ -z "$other" ]]',
    '}',
    '',
    'apply_manifest() {',
    '  local src="$1"',
    '  local end=$((SECONDS + APPLY_CRD_WAIT_SEC))',
    '  local out rc',
    '  while true; do',
    '    rc=0',
    '    out="$("$CMD" apply -f "$src" 2>&1)" || rc=$?',
    '    [[ -n "$out" ]] && printf "%s\\n" "$out"',
    '    if (( rc == 0 )); then',
    '      return 0',
    '    fi',
    '    if ! is_crd_discovery_error "$out"; then',
    '      return "$rc"',
    '    fi',
    '    if (( SECONDS >= end )); then',
    '      echo "Timed out after ${APPLY_CRD_WAIT_SEC}s applying $src — CustomResource APIs never became available." >&2',
    '      return "$rc"',
    '    fi',
    '    echo "    Waiting for CustomResource APIs..."',
    '    sleep "$APPLY_CRD_POLL_SEC"',
    '  done',
    '}',
    '',
    'apply() {',
    '  local f="$1"',
    '  echo "==> Applying $f"',
    '  apply_manifest "$f"',
    '}',
    '',
    'apply_url() {',
    '  echo "==> Applying $1"',
    '  apply_manifest "$1"',
    '}',
    '',
    '# Wait until a CRD is Established and kubectl/oc can map the kind (OLM/CSV Succeeded is not enough).',
    'wait_crd() {',
    '  local crd="$1"',
    '  local kind="${2:-}"',
    '  local ns="${3:-}"',
    '  local end=$((SECONDS + 300))',
    '  while (( SECONDS < end )); do',
    '    if "$CMD" get crd "$crd" >/dev/null 2>&1; then',
    '      if "$CMD" wait --for=condition=Established "crd/$crd" --timeout=30s >/dev/null 2>&1; then',
    '        if [[ -z "$kind" ]]; then',
    '          echo "    CRD $crd is Established"',
    '          return 0',
    '        fi',
    '        if [[ -n "$ns" ]]; then',
    '          if "$CMD" get "$kind" -n "$ns" >/dev/null 2>&1; then',
    '            echo "    $kind API is available (CRD $crd Established)"',
    '            return 0',
    '          fi',
    '        elif "$CMD" get "$kind" >/dev/null 2>&1; then',
    '          echo "    $kind API is available (CRD $crd Established)"',
    '          return 0',
    '        fi',
    '        echo "    CRD $crd found; waiting until $kind is discoverable..."',
    '      fi',
    '    else',
    '      echo "    Waiting for CRD $crd..."',
    '    fi',
    '    sleep 5',
    '  done',
    '  echo "Timed out waiting for CRD $crd." >&2',
    '  "$CMD" get crd "$crd" -o yaml 2>/dev/null || "$CMD" get crd | grep -i "$crd" || true',
    '  [[ -n "$kind" ]] && "$CMD" api-resources | grep -i "$kind" || true',
    '  return 1',
    '}',
    '',
  ]

  const prereqYaml = applyFiles.filter(
    (f) => f.group === 'prereq' && f.path.endsWith('.yaml') && plat.useOc,
  )
  // Multipath delivery must complete before CSI Driver install.
  if (prereqYaml.length && state.multipath.includeDaemonSet) {
    const ds = expectedMultipathDaemonSet({ name: state.multipath.machineConfigName })
    const dsFile =
      prereqYaml.find((f) => f.path.includes('daemonset'))?.path || prereqYaml[0].path
    lines.push(
      `# Multipath DaemonSet (hosted/HCP): wizard alreadyApplied=${state.multipath.alreadyApplied ? '1' : '0'}`,
      `MULTIPATH_ALREADY_APPLIED=${state.multipath.alreadyApplied ? '1' : '0'}`,
      `MULTIPATH_DS_NAME=${JSON.stringify(ds.name)}`,
      `MULTIPATH_DS_NS=${JSON.stringify(ds.namespace)}`,
      '',
      'SKIP_MULTIPATH_APPLY=0',
      'if [[ "$MULTIPATH_ALREADY_APPLIED" == "1" ]]; then',
      '  echo "==> Multipath: wizard marked DaemonSet as already applied — skipping apply."',
      '  SKIP_MULTIPATH_APPLY=1',
      `elif "$CMD" get daemonset "$MULTIPATH_DS_NAME" -n "$MULTIPATH_DS_NS" >/dev/null 2>&1; then`,
      '  echo "==> Multipath: found existing DaemonSet $MULTIPATH_DS_NAME — skipping apply."',
      '  SKIP_MULTIPATH_APPLY=1',
      'fi',
      '',
      'if [[ "$SKIP_MULTIPATH_APPLY" == "1" ]]; then',
      '  echo "YAML remains under 00-prereq/ for reference."',
      '  echo "If you changed multipath.conf after applying, re-apply the YAML manually before continuing."',
      '  "$CMD" get daemonset "$MULTIPATH_DS_NAME" -n "$MULTIPATH_DS_NS" || true',
      '  read -r -p "Press Enter once multipath is verified on nodes... "',
      '  echo',
      'else',
      '  echo "==> Applying multipath DaemonSet (hosted/HCP)"',
      '  echo "Writes /etc/multipath.conf and enables multipathd on nodes (no MachineConfigPool reboot cycle)."',
      '  read -r -p "Press Enter to apply the DaemonSet... " ',
      '',
      `  apply "${dsFile}"`,
      '',
      '  echo "Waiting for DaemonSet rollout..."',
      '  "$CMD" rollout status "daemonset/$MULTIPATH_DS_NAME" -n "$MULTIPATH_DS_NS" --timeout=300s || true',
      '',
      '  read -r -p "Confirm multipath is verified on nodes, then press Enter... "',
      '  echo',
      'fi',
      '',
    )
  } else if (prereqYaml.length && state.multipath.includeMachineConfig) {
    const mcNames = expectedMultipathMachineConfigNames({
      name: state.multipath.machineConfigName,
      role: state.multipath.machineConfigRole,
    })
    const namesBash = mcNames.map((n) => JSON.stringify(n)).join(' ')
    const mcpPools =
      state.multipath.machineConfigRole === 'all'
        ? ['worker', 'master']
        : [state.multipath.machineConfigRole]
    const mcpPoolsBash = mcpPools.map((p) => JSON.stringify(p)).join(' ')
    lines.push(
      `# Multipath: wizard alreadyApplied=${state.multipath.alreadyApplied ? '1' : '0'}`,
      `MULTIPATH_ALREADY_APPLIED=${state.multipath.alreadyApplied ? '1' : '0'}`,
      `MULTIPATH_MC_NAMES=(${namesBash})`,
      `MCP_POOLS=(${mcpPoolsBash})`,
      'MCP_WAIT_TIMEOUT_SEC="${MCP_WAIT_TIMEOUT_SEC:-3600}"',
      'MCP_POLL_SEC="${MCP_POLL_SEC:-5}"',
      'MCP_REQUIRE_NEW_RENDERED=0',
      'MCP_PREV_RENDERED=""',
      '',
      'record_mcp_rendered() {',
      '  MCP_PREV_RENDERED=""',
      '  local p r',
      '  for p in "${MCP_POOLS[@]}"; do',
      '    r="$("$CMD" get mcp "$p" -o jsonpath="{.status.configuration.name}" 2>/dev/null || true)"',
      '    MCP_PREV_RENDERED+="${p}=${r}"$\'\\n\'',
      '  done',
      '}',
      '',
      'mcp_prev_rendered() {',
      '  local p="$1" line',
      '  while IFS= read -r line; do',
      '    if [[ "$line" == "${p}="* ]]; then',
      '      printf "%s" "${line#*=}"',
      '      return 0',
      '    fi',
      '  done <<< "$MCP_PREV_RENDERED"',
      '}',
      '',
      'mcp_has_all_mcs() {',
      '  local sources=" $1 "',
      '  local n',
      '  for n in "${MULTIPATH_MC_NAMES[@]}"; do',
      '    case "$sources" in',
      '      *" $n "*) ;;',
      '      *) return 1 ;;',
      '    esac',
      '  done',
      '  return 0',
      '}',
      '',
      'wait_mcp_healthy() {',
      '  local pools=("$@")',
      '  local start=$SECONDS',
      '  local last_sig="" last_change=$SECONDS',
      '  echo "==> Waiting for MachineConfigPools to finish updating (auto-continues when healthy)"',
      '  if [[ "${MCP_REQUIRE_NEW_RENDERED:-0}" == "1" ]]; then',
      '    echo "    Waiting for pools to pick up the new MachineConfig (ignores pre-apply UPDATED=True)."',
      '  fi',
      '  echo "    Pools: ${pools[*]}  timeout=${MCP_WAIT_TIMEOUT_SEC}s  (override MCP_WAIT_TIMEOUT_SEC)"',
      '  echo "    Detail snapshots append to: $INSTALL_LOG"',
      '  # Hide cursor while redrawing',
      '  tput civis 2>/dev/null || true',
      '  while true; do',
      '    local elapsed=$((SECONDS - start))',
      '    if (( elapsed >= MCP_WAIT_TIMEOUT_SEC )); then',
      '      tput cnorm 2>/dev/null || true',
      '      echo ""',
      '      echo "ERROR: Timed out after ${MCP_WAIT_TIMEOUT_SEC}s waiting for MCP healthy." >&2',
      '      "$CMD" get mcp || true',
      '      "$CMD" get nodes -o wide || true',
      '      echo "See log: $INSTALL_LOG" >&2',
      '      return 1',
      '    fi',
      '    local all_ok=1 line sig="" block=""',
      "    block+=$'MachineConfigPool status\\n'",
      "    block+=$(printf '  elapsed %dm%02ds | heartbeat: waiting…\\n' $((elapsed/60)) $((elapsed%60)))",
      '    local p updated updating mc ready updatedc rendered sources prev render_ok',
      '    for p in "${pools[@]}"; do',
      '      if ! "$CMD" get mcp "$p" >/dev/null 2>&1; then',
      "        block+=$(printf '  %-8s  (not found yet)\\n' \"$p\")",
      '        all_ok=0',
      '        sig+="${p}:missing;"',
      '        continue',
      '      fi',
      '      updated="$("$CMD" get mcp "$p" -o jsonpath="{.status.conditions[?(@.type==\\"Updated\\")].status}" 2>/dev/null || true)"',
      '      updating="$("$CMD" get mcp "$p" -o jsonpath="{.status.conditions[?(@.type==\\"Updating\\")].status}" 2>/dev/null || true)"',
      '      mc="$("$CMD" get mcp "$p" -o jsonpath="{.status.machineCount}" 2>/dev/null || echo "?")"',
      '      ready="$("$CMD" get mcp "$p" -o jsonpath="{.status.readyMachineCount}" 2>/dev/null || echo "?")"',
      '      updatedc="$("$CMD" get mcp "$p" -o jsonpath="{.status.updatedMachineCount}" 2>/dev/null || echo "?")"',
      '      rendered="$("$CMD" get mcp "$p" -o jsonpath="{.status.configuration.name}" 2>/dev/null || true)"',
      '      sources="$("$CMD" get mcp "$p" -o jsonpath="{.status.configuration.source[*].name}" 2>/dev/null || true)"',
      '      render_ok=1',
      '      if [[ "${MCP_REQUIRE_NEW_RENDERED:-0}" == "1" ]]; then',
      '        prev="$(mcp_prev_rendered "$p")"',
      '        if [[ "$rendered" == "$prev" ]] && ! mcp_has_all_mcs "$sources"; then',
      '          render_ok=0',
      '          all_ok=0',
      '        fi',
      '      fi',
      "      block+=$(printf '  %-8s  UPDATED=%s UPDATING=%s  machines %s/%s ready, %s updated\\n' \\",
      '        "$p" "${updated:-?}" "${updating:-?}" "${ready}" "${mc}" "${updatedc}")',
      '      if [[ "${MCP_REQUIRE_NEW_RENDERED:-0}" == "1" && "$render_ok" != "1" ]]; then',
      "        block+=$(printf '           waiting for MachineConfig to render (still previous config)\\n')",
      '      fi',
      '      sig+="${p}:${updated}:${updating}:${mc}:${ready}:${updatedc}:${rendered}:${render_ok};"',
      '      if [[ "$updated" != "True" || "$updating" != "False" ]]; then',
      '        all_ok=0',
      '      fi',
      '    done',
      '    if [[ "$sig" != "$last_sig" ]]; then',
      '      last_sig="$sig"',
      '      last_change=$SECONDS',
      '      {',
      '        echo "---- MCP poll t=${elapsed}s ----"',
      '        "$CMD" get mcp || true',
      '      } >>"$INSTALL_LOG" 2>&1',
      '    fi',
      '    local since=$((SECONDS - last_change))',
      '    block=$(printf %s "$block" | sed "s/heartbeat: waiting…/heartbeat: last change ${since}s ago/")',
      '    # Redraw: move to block start using a marker line count',
      '    if [[ -n "${MCP_UI_LINES:-}" ]]; then',
      '      printf "\\033[%dA\\033[J" "$MCP_UI_LINES" 2>/dev/null || true',
      '    fi',
      '    printf "%s\\n" "$block"',
      '    MCP_UI_LINES=$(printf "%s\\n" "$block" | wc -l | tr -d " ")',
      '    if [[ "$all_ok" == "1" ]]; then',
      '      tput cnorm 2>/dev/null || true',
      '      echo ""',
      '      echo "==> MachineConfigPools healthy (UPDATED=True, UPDATING=False) — continuing"',
      '      return 0',
      '    fi',
      '    sleep "$MCP_POLL_SEC"',
      '  done',
      '}',
      '',
      'multipath_mcs_exist() {',
      '  local n',
      '  for n in "${MULTIPATH_MC_NAMES[@]}"; do',
      '    if ! "$CMD" get machineconfig "$n" >/dev/null 2>&1; then',
      '      return 1',
      '    fi',
      '  done',
      '  return 0',
      '}',
      '',
      'SKIP_MULTIPATH_APPLY=0',
      'if [[ "$MULTIPATH_ALREADY_APPLIED" == "1" ]]; then',
      '  echo "==> Multipath: wizard marked MachineConfig as already applied — skipping apply."',
      '  SKIP_MULTIPATH_APPLY=1',
      'elif multipath_mcs_exist; then',
      '  echo "==> Multipath: found existing MachineConfig(s) (${MULTIPATH_MC_NAMES[*]}) — skipping apply."',
      '  SKIP_MULTIPATH_APPLY=1',
      'fi',
      '',
      'if [[ "$SKIP_MULTIPATH_APPLY" == "1" ]]; then',
      '  echo "YAML remains under 00-prereq/ for reference."',
      '  echo "If you changed multipath.conf after applying, re-apply the YAML manually before continuing."',
      '  echo "Checking MachineConfigPool health (auto-continues when UPDATED=True / UPDATING=False)..."',
      '  MCP_REQUIRE_NEW_RENDERED=0',
      '  wait_mcp_healthy "${MCP_POOLS[@]}"',
      'else',
      '  echo "==> Applying multipath MachineConfig(s)"',
      '  echo "WARNING: MachineConfig updates reboot nodes in the targeted pool (rolling)."',
      '  echo "Do not install the CSI Driver until MCP shows UPDATED=True / UPDATING=False."',
      '  read -r -p "Press Enter to apply MachineConfig(s) and begin node reboots... " ',
      '  record_mcp_rendered',
      '',
    )
    for (const f of prereqYaml) {
      lines.push(`  apply "${f.path}"`)
    }
    lines.push(
      '',
      '  echo "Nodes will reboot rolling as MachineConfigPools update."',
      '  MCP_REQUIRE_NEW_RENDERED=1',
      '  wait_mcp_healthy "${MCP_POOLS[@]}"',
      '  MCP_REQUIRE_NEW_RENDERED=0',
      'fi',
      '',
    )
  }

  if (plat.operatorHub) {
    const ns = state.operatorNamespace
    const pkg = HSPC_OLM_PACKAGE
    const hasCatalogSource = applyFiles.some(
      (f) => f.path === '02-driver/operatorhub-catalogsource.yaml',
    )
    const catalogSourceName = state.airGapped
      ? (state.offline?.catalogSourceName || '').trim() || HSPC_OLM_SOURCE
      : HSPC_OLM_SOURCE
    lines.push(
      `echo "==> CSI Driver operator (OperatorHub / OLM)"`,
      `OPERATOR_NS=${JSON.stringify(ns)}`,
      `OPERATOR_SUB=${JSON.stringify(pkg)}`,
      'apply "02-driver/operatorhub-namespace.yaml"',
      'apply "02-driver/operatorhub-operatorgroup.yaml"',
      ...(hasCatalogSource
        ? [
            '',
            'echo "==> Mirrored OperatorHub CatalogSource"',
            `CATALOGSOURCE_NS=${JSON.stringify('openshift-marketplace')}`,
            `CATALOGSOURCE_NAME=${JSON.stringify(catalogSourceName)}`,
            'apply "02-driver/operatorhub-catalogsource.yaml"',
            '',
            'wait_catalogsource_ready() {',
            '  local ns="$1"',
            '  local name="$2"',
            '  local end=$((SECONDS + 600))',
            '  while (( SECONDS < end )); do',
            '    if ! "$CMD" get catalogsource "$name" -n "$ns" >/dev/null 2>&1; then',
            '      echo "    Waiting for CatalogSource $name in $ns..."',
            '      sleep 5',
            '      continue',
            '    fi',
            '    local st msg',
            '    st="$("$CMD" get catalogsource "$name" -n "$ns" -o jsonpath="{.status.connectionState.lastObservedState}" 2>/dev/null || true)"',
            '    msg="$("$CMD" get catalogsource "$name" -n "$ns" -o jsonpath="{.status.connectionState.lastObservedMessage}" 2>/dev/null || true)"',
            '    echo "    CatalogSource $name state=${st:-?} ${msg:-}"',
            '    if [[ "$st" == "READY" ]]; then',
            '      return 0',
            '    fi',
            '    sleep 10',
            '  done',
            '  echo "Timed out waiting for CatalogSource READY: $name in $ns" >&2',
            '  "$CMD" get catalogsource "$name" -n "$ns" -o yaml || true',
            '  return 1',
            '}',
            'wait_catalogsource_ready "$CATALOGSOURCE_NS" "$CATALOGSOURCE_NAME"',
          ]
        : []),
      'apply "02-driver/operatorhub-subscription.yaml"',
      '',
      'echo "==> Approving day-0 InstallPlan (Subscription stays Manual for later upgrades)"',
      'existing_csv_succeeded() {',
      '  local ns="$1"',
      '  local pkg="$2"',
      '  local csv="" phase=""',
      '  csv="$("$CMD" get csv -n "$ns" --no-headers 2>/dev/null | awk -v p="$pkg" \x27$1 ~ "^"p {print $1; exit}\x27 || true)"',
      '  [[ -n "$csv" ]] || return 1',
      '  phase="$("$CMD" get csv "$csv" -n "$ns" -o jsonpath="{.status.phase}" 2>/dev/null || true)"',
      '  [[ "$phase" == "Succeeded" ]]',
      '}',
      '',
      'approve_installplan() {',
      '  local ns="$1"',
      '  local pkg="$2"',
      '  local end=$((SECONDS + 300))',
      '  local ip=""',
      '  while (( SECONDS < end )); do',
      '    if existing_csv_succeeded "$ns" "$pkg"; then',
      '      echo "    Operator CSV already Succeeded; no day-0 InstallPlan approval is needed."',
      '      return 0',
      '    fi',
      `    ip="$("$CMD" get installplan -n "$ns" -o go-template='{{range .items}}{{if not .spec.approved}}{{.metadata.name}}{{"\\n"}}{{end}}{{end}}' 2>/dev/null | head -n1 || true)"`,
      '    if [[ -n "$ip" ]]; then',
      '      echo "    Approving InstallPlan $ip"',
      `      "$CMD" patch installplan "$ip" -n "$ns" --type merge -p '{"spec":{"approved":true}}'`,
      '      return 0',
      '    fi',
      '    sleep 5',
      '  done',
      '  echo "Timed out waiting for an InstallPlan in $ns (is certified-operators available?)" >&2',
      '  return 1',
      '}',
      'approve_installplan "$OPERATOR_NS" "$OPERATOR_SUB"',
      '',
      'echo "==> Waiting for ClusterServiceVersion Succeeded..."',
      'wait_csv_succeeded() {',
      '  local ns="$1"',
      '  local pkg="$2"',
      '  local end=$((SECONDS + 600))',
      '  local csv="" phase=""',
      '  while (( SECONDS < end )); do',
      '    csv="$("$CMD" get csv -n "$ns" --no-headers 2>/dev/null | awk -v p="$pkg" \x27$1 ~ "^"p {print $1; exit}\x27 || true)"',
      '    if [[ -n "$csv" ]]; then',
      '      phase="$("$CMD" get csv "$csv" -n "$ns" -o jsonpath="{.status.phase}" 2>/dev/null || true)"',
      '      echo "    CSV $csv phase=$phase"',
      '      if [[ "$phase" == "Succeeded" ]]; then',
      '        return 0',
      '      fi',
      '    else',
      '      echo "    Waiting for CSV matching $pkg..."',
      '    fi',
      '    sleep 10',
      '  done',
      '  echo "Timed out waiting for CSV Succeeded in $ns" >&2',
      '  "$CMD" get csv -n "$ns" || true',
      '  return 1',
      '}',
      'wait_csv_succeeded "$OPERATOR_NS" "$OPERATOR_SUB"',
      '',
      'echo "==> Waiting for HSPC CRD (CSV Succeeded does not always mean the API is ready)..."',
      'wait_hspc_crd() { wait_crd hspcs.csi.hitachi.com hspc "$OPERATOR_NS"; }',
      'wait_hspc_crd',
      '',
      'echo "==> Applying CSI Driver HSPC instance"',
      'apply "02-driver/hspc-cr.yaml"',
      `echo "Waiting for CSI Driver HSPC READY..."`,
      `"$CMD" wait --for=jsonpath='{.status.ready}'=true hspc/hspc -n ${state.driverNamespace} --timeout=300s || true`,
      '',
    )
  }

  const hasOfflineNonOlmOperator =
    !plat.operatorHub &&
    applyFiles.some((f) => f.path === '02-driver/hspc-operator-namespace-offline.yaml') &&
    applyFiles.some((f) => f.path === '02-driver/hspc-operator-offline.yaml')

  if (hasOfflineNonOlmOperator) {
    lines.push(
      `echo "==> CSI Driver operator (offline package)"`,
      `OPERATOR_NS=${JSON.stringify(state.operatorNamespace)}`,
      'apply "02-driver/hspc-operator-namespace-offline.yaml"',
      'apply "02-driver/hspc-operator-offline.yaml"',
      '',
      'echo "==> Waiting for operator Deployment Available..."',
      '"$CMD" wait --for=condition=Available deploy/hspc-operator-controller-manager -n "$OPERATOR_NS" --timeout=300s || true',
      '',
      'echo "==> Waiting for HSPC CRD..."',
      'wait_crd hspcs.csi.hitachi.com hspc "$OPERATOR_NS"',
      '',
      'echo "==> Applying CSI Driver HSPC instance"',
      'apply "02-driver/hspc-cr.yaml"',
      '',
    )
  }

  for (const f of applyFiles) {
    if (f.group === 'prereq') continue
    // Replication URLs + ordering handled in the dedicated block below
    if (f.group === 'replication' || f.path.startsWith('03-replication/')) continue
    // OperatorHub path: OLM + HSPC CR applied above
    if (plat.operatorHub && f.path.startsWith('02-driver/')) {
      continue
    }
    // Offline non-OLM driver path: offline operator + HSPC CR applied above
    if (
      hasOfflineNonOlmOperator &&
      (f.path === '02-driver/hspc-operator-namespace-offline.yaml' ||
        f.path === '02-driver/hspc-operator-offline.yaml' ||
        f.path === '02-driver/hspc-cr.yaml')
    ) {
      continue
    }
    // Telemetry disable ConfigMap must be applied only after HSPC READY (dedicated block below)
    if (f.path === '02-driver/hspc-csi-telemetry-config.yaml') {
      continue
    }
    // Quickstart PVC/Pod: wait for Bound before creating the Pod (dedicated block below)
    if (f.group === 'quickstart') {
      continue
    }
    // Sparse Deployment overlay — kubectl apply would clear selector/labels (immutable)
    if (f.path === '04-metrics/exporter-patch.yaml') {
      const metricsNs = state.metrics.namespace || 'hspc-monitoring-system'
      lines.push(
        `echo "==> Patching Performance Metrics exporter env/image"`,
        `"$CMD" patch deployment storage-exporter -n ${JSON.stringify(metricsNs)} --type strategic --patch-file "04-metrics/exporter-patch.yaml"`,
      )
      continue
    }
    lines.push(`apply "${f.path}"`)
  }

  if (state.components.replication) {
    const offlineHrpcEnabled = state.airGapped && Boolean((state.offline?.registryBase || '').trim())
    const hrpcBase = `https://raw.githubusercontent.com/hitachi-vantara/csi-operator-hitachi/main/hrpc/${state.versions.replication}`
    const drScName =
      opts?.drScNameOverride?.trim() ||
      (state.storageClassesEnabled && resolvedCurrentStorageClassName(state)) ||
      'hitachi-csi'
    lines.push(
      '',
      'echo "==> Replication operator + Disaster Recovery (automatic)"',
    )
    if (offlineHrpcEnabled) {
      lines.push(
        'echo "==> Air-gapped: applying packaged Replication YAML only"',
        'require_file() {',
        '  local f="$1"',
        '  if [[ ! -f "$f" ]]; then',
        '    echo "ERROR: Missing required packaged file: $f" >&2',
        '    echo "Re-export when GitHub is reachable so the wizard can fetch upstream templates and rewrite images for your private registry." >&2',
        '    exit 1',
        '  fi',
        '}',
        'require_file "03-replication/hspc-replication-operator-namespace.yaml"',
        'require_file "03-replication/hspc-replication-operator.yaml"',
        'require_file "03-replication/cert-manager.yaml"',
        'require_file "03-replication/dr-operator-install.yaml"',
        'apply "03-replication/hspc-replication-operator-namespace.yaml"',
        'apply "03-replication/hspc-replication-operator.yaml"',
      )
    } else {
      lines.push(
        `apply_url "${hrpcBase}/yaml/hspc-replication-operator-namespace.yaml"`,
        `apply_url "${hrpcBase}/yaml/hspc-replication-operator.yaml"`,
      )
    }
    if (files.some((f) => f.path === '03-replication/storage-secrets.yaml')) {
      lines.push('apply "03-replication/storage-secrets.yaml"')
    }
    const hasLocalCert = files.some((f) => f.path === '03-replication/cert-manager.yaml')
    const hasLocalDr = files.some((f) => f.path === '03-replication/dr-operator-install.yaml')
    if (offlineHrpcEnabled) {
      // require_file() is declared above in the offline block
      lines.push('apply "03-replication/cert-manager.yaml"')
    } else if (hasLocalCert) {
      lines.push('apply "03-replication/cert-manager.yaml"')
    } else {
      lines.push(`apply_url "${hrpcBase}/dr-operator/yaml/cert-manager.yaml"`)
    }
    lines.push(
      '',
      'echo "==> Waiting for cert-manager webhook (required before DR Certificates)..."',
      'wait_cert_manager() {',
      '  local end=$((SECONDS + 300))',
      '  while (( SECONDS < end )); do',
      '    if "$CMD" get deploy -n cert-manager cert-manager-webhook >/dev/null 2>&1 \\',
      '      && "$CMD" wait --for=condition=Available deploy/cert-manager-webhook -n cert-manager --timeout=30s >/dev/null 2>&1 \\',
      '      && "$CMD" wait --for=condition=Available deploy/cert-manager -n cert-manager --timeout=30s >/dev/null 2>&1 \\',
      '      && "$CMD" wait --for=condition=Available deploy/cert-manager-cainjector -n cert-manager --timeout=30s >/dev/null 2>&1; then',
      '      # Webhook Service needs endpoints before Certificate validates',
      '      local eps',
      '      eps="$("$CMD" get endpoints -n cert-manager cert-manager-webhook -o jsonpath="{.subsets[*].addresses[*].ip}" 2>/dev/null || true)"',
      '      if [[ -n "$eps" ]]; then',
      '        echo "    cert-manager webhook is Available"',
      '        return 0',
      '      fi',
      '    fi',
      '    sleep 5',
      '  done',
      '  echo "Timed out waiting for cert-manager webhook." >&2',
      '  "$CMD" get pods -n cert-manager -o wide || true',
      '  return 1',
      '}',
      'wait_cert_manager',
      '',
      'echo "==> Waiting for cert-manager Certificate and Issuer APIs..."',
      'wait_crd certificates.cert-manager.io certificate',
      'wait_crd issuers.cert-manager.io issuer',
      '',
    )
    if (plat.useOc) {
      lines.push(
        'ensure_dr_operator_fsgroup() {',
        '  local file="$1"',
        '  local ns="$2"',
        '  local end=$((SECONDS + 120))',
        '  local ann="" gid=""',
        '  if ! "$CMD" get ns "$ns" >/dev/null 2>&1; then',
        '    echo "    Creating namespace $ns so OpenShift can allocate supplemental-groups"',
        '    "$CMD" create namespace "$ns"',
        '  fi',
        '  while (( SECONDS < end )); do',
        `    ann="$("$CMD" get ns "$ns" -o go-template='{{index .metadata.annotations "openshift.io/sa.scc.supplemental-groups"}}' 2>/dev/null || true)"`,
        '    gid="${ann%%/*}"',
        '    if [[ "$gid" =~ ^[0-9]+$ ]]; then',
        '      echo "    Namespace $ns supplemental-groups=$ann → fsGroup=$gid"',
        '      sed -i -E "s/(fsGroup:[[:space:]]*)[0-9]+/\\1${gid}/" "$file"',
        '      return 0',
        '    fi',
        '    echo "    Waiting for openshift.io/sa.scc.supplemental-groups on $ns..."',
        '    sleep 2',
        '  done',
        '  echo "Timed out waiting for supplemental-groups on namespace $ns." >&2',
        '  echo "HRPC requires fsGroup in dr-operator-install.yaml to match this namespace range." >&2',
        '  "$CMD" get ns "$ns" -o yaml 2>/dev/null | grep -E "supplemental-groups|uid-range" || true',
        '  return 1',
        '}',
        '',
      )
    }
    if (offlineHrpcEnabled || hasLocalDr) {
      if (plat.useOc) {
        lines.push(
          `echo "==> OpenShift: set DR operator fsGroup from namespace ${JSON.stringify(state.replication.namespace)}"`,
          `ensure_dr_operator_fsgroup "03-replication/dr-operator-install.yaml" ${JSON.stringify(state.replication.namespace)}`,
        )
      }
      lines.push(
        `echo "==> Applying DR operator (PVC storageClassName=${JSON.stringify(drScName)})"`,
        'apply "03-replication/dr-operator-install.yaml"',
      )
    } else {
      lines.push(
        `echo "==> Applying DR operator from upstream (warning: replace <storage-class-name> if apply fails)"`,
        `apply_url "${hrpcBase}/dr-operator/yaml/dr-operator-install.yaml"`,
      )
    }
    lines.push(
      '',
      'echo "==> Remote kubeconfig Secrets"',
      '# Two equal options: packaged wizard Secret YAML, or KUBECONFIG_P/S helper (both sites).',
      'if [[ -n "${KUBECONFIG_P:-}" && -n "${KUBECONFIG_S:-}" ]]; then',
      '  echo "Using KUBECONFIG_P / KUBECONFIG_S helper (applies Secret on each site)."',
      '  chmod +x ./03-replication/create-remote-kubeconfig-secrets.sh',
      '  APPLY=1 ./03-replication/create-remote-kubeconfig-secrets.sh',
      'elif [[ -f "03-replication/remote-kubeconfig-for-primary-site.yaml" || -f "03-replication/remote-kubeconfig-for-secondary-site.yaml" ]]; then',
      '  # Wizard-packaged Secrets: if only one is present in this folder, apply it.',
      '  # If both are present, fall back to REPLICATION_SITE (default: primary).',
      '  pk_p=0 pk_s=0',
      '  [[ -f "03-replication/remote-kubeconfig-for-primary-site.yaml" ]] && pk_p=1',
      '  [[ -f "03-replication/remote-kubeconfig-for-secondary-site.yaml" ]] && pk_s=1',
      '  if [[ "$pk_p" == "1" && "$pk_s" == "0" ]]; then',
      '    echo "Applying wizard Secret YAML for PRIMARY site (current kubeconfig/context)."',
      '    apply "03-replication/remote-kubeconfig-for-primary-site.yaml"',
      '  elif [[ "$pk_s" == "1" && "$pk_p" == "0" ]]; then',
      '    echo "Applying wizard Secret YAML for SECONDARY site (current kubeconfig/context)."',
      '    apply "03-replication/remote-kubeconfig-for-secondary-site.yaml"',
      '  else',
      '    site="${REPLICATION_SITE:-primary}"',
      '    case "$site" in',
      '      primary|p)',
      '        if [[ -f "03-replication/remote-kubeconfig-for-primary-site.yaml" ]]; then',
      '          echo "Applying wizard Secret YAML for PRIMARY site (current kubeconfig/context)."',
      '          apply "03-replication/remote-kubeconfig-for-primary-site.yaml"',
      '        else',
      '          echo "ERROR: REPLICATION_SITE=primary but remote-kubeconfig-for-primary-site.yaml is missing." >&2',
      '          exit 1',
      '        fi',
      '        if [[ -f "03-replication/remote-kubeconfig-for-secondary-site.yaml" ]]; then',
      '          echo "Note: secondary-site Secret is in the package — apply on the other cluster with:"',
      '          echo "  REPLICATION_SITE=secondary ./install.sh"',
      '          echo "  # or: $CMD apply -f 03-replication/remote-kubeconfig-for-secondary-site.yaml"',
      '        fi',
      '        ;;',
      '      secondary|s)',
      '        if [[ -f "03-replication/remote-kubeconfig-for-secondary-site.yaml" ]]; then',
      '          echo "Applying wizard Secret YAML for SECONDARY site (current kubeconfig/context)."',
      '          apply "03-replication/remote-kubeconfig-for-secondary-site.yaml"',
      '        else',
      '          echo "ERROR: REPLICATION_SITE=secondary but remote-kubeconfig-for-secondary-site.yaml is missing." >&2',
      '          exit 1',
      '        fi',
      '        ;;',
      '      *)',
      '        echo "ERROR: REPLICATION_SITE must be primary or secondary (got: $site)." >&2',
      '        exit 1',
      '        ;;',
      '    esac',
      '  fi',
      '  if [[ -f "03-replication/remote-kubeconfig.yaml" ]]; then',
      '    echo "Applying DR Operator Secret remote-kubeconfig (current kubeconfig/context)."',
      '    apply "03-replication/remote-kubeconfig.yaml"',
      '  fi',
      'else',
      '  echo "No packaged remote-kubeconfig Secret YAML and KUBECONFIG_P/S not set."',
      '  echo "Both Secrets are required on each site: hspc-replication-operator-remote-kubeconfig and remote-kubeconfig."',
      '  echo "Either re-export after pasting both kubeconfigs in the wizard, or:"',
      '  echo "  export KUBECONFIG_P=/path/to/primary-kubeconfig"',
      '  echo "  export KUBECONFIG_S=/path/to/secondary-kubeconfig"',
      '  echo "  # then re-run install.sh (or APPLY=1 ./03-replication/create-remote-kubeconfig-secrets.sh)"',
      '  read -r -p "Or press Enter after you have applied those Secrets another way... "',
      'fi',
    )
  }

  lines.push(
    '',
    `echo "Waiting for CSI Driver HSPC READY..."`,
    `"$CMD" wait --for=jsonpath='{.status.ready}'=true hspc/hspc -n ${state.driverNamespace} --timeout=300s || true`,
  )

  if (!state.telemetryEnabled) {
    lines.push(
      '',
      'echo "==> Disabling Hitachi Telemetry (ConfigMap awsEnabled=false)"',
      `if [[ "$("$CMD" get hspc hspc -n ${state.driverNamespace} -o jsonpath='{.status.ready}' 2>/dev/null || true)" == "true" ]]; then`,
      `  "$CMD" scale deployment hspc-operator-controller-manager --replicas=0 -n ${state.operatorNamespace}`,
      '  apply "02-driver/hspc-csi-telemetry-config.yaml"',
      `  "$CMD" scale deployment hspc-operator-controller-manager --replicas=1 -n ${state.operatorNamespace}`,
      'else',
      '  echo "WARN: HSPC not READY — skipped Telemetry disable. After READY, scale the operator down, apply 02-driver/hspc-csi-telemetry-config.yaml, then scale back up." >&2',
      '  echo "ERROR: Hitachi Telemetry was opted out but HSPC is not READY; refusing to finish with Telemetry still enabled." >&2',
      '  exit 1',
      'fi',
    )
  }

  const hasQuickstart = files.some((f) => f.group === 'quickstart')
  if (hasQuickstart) {
    const pvcName = state.quickstart.pvcName
    const podName = state.quickstart.podName
    const pvcFile = files.find((f) => f.path === '06-quickstart/pvc.yaml')?.path || '06-quickstart/pvc.yaml'
    const podFile = files.find((f) => f.path === '06-quickstart/pod.yaml')?.path || '06-quickstart/pod.yaml'
    lines.push(
      '',
      'echo "==> Test volume (PVC then Pod)"',
      `apply "${pvcFile}"`,
      '',
      `echo "Waiting for PVC Bound (${pvcName})..."`,
      `if ! "$CMD" wait --for=jsonpath='{.status.phase}'=Bound pvc/${pvcName} --timeout=300s; then`,
      '  echo "ERROR: PVC did not become Bound." >&2',
      '  echo "Common causes: wrong array serial/URL/credentials in the Secret, pool/port IDs on the StorageClass, multipath not ready, or CSI controller errors." >&2',
      `  "$CMD" get pvc ${pvcName} -o wide || true`,
      `  "$CMD" describe pvc ${pvcName} || true`,
      `  "$CMD" get events --field-selector involvedObject.name=${pvcName} --sort-by=.lastTimestamp 2>/dev/null | tail -n 30 || true`,
      `  "$CMD" logs -n ${state.driverNamespace} -l app=hspc-csi-controller -c hspc-csi-controller --tail=80 2>/dev/null || true`,
      '  exit 1',
      'fi',
      '',
      `apply "${podFile}"`,
      `echo "Waiting for Pod Running (${podName})..."`,
      `if ! "$CMD" wait --for=jsonpath='{.status.phase}'=Running pod/${podName} --timeout=180s; then`,
      '  echo "ERROR: test Pod did not become Running." >&2',
      `  "$CMD" get pod ${podName} -o wide || true`,
      `  "$CMD" describe pod ${podName} || true`,
      '  exit 1',
      'fi',
      '',
      'echo "Done. Verify with:"',
      `echo "  $CMD get pvc ${pvcName}"`,
      `echo "  $CMD get pod ${podName}"`,
    )
  } else {
    lines.push('', 'echo "Done. Verify CSI Driver:"', `"$CMD" get hspc -n ${state.driverNamespace}`)
  }
  return lines.join('\n') + '\n'
}

function stateForSite(state: WizardState, site: SiteId): WizardState {
  const s = getSiteStorage(state, site)
  return applySiteQuickstartToState(
    applySiteMetricsToState(
      {
        ...state,
        storageSystems: s.storageSystems,
        storageClasses: s.storageClasses,
      },
      site,
    ),
    site,
  )
}

function prefixFiles(files: GeneratedFile[], prefix: string): GeneratedFile[] {
  return files.map((f) => ({
    ...f,
    path: `${prefix}/${f.path}`,
  }))
}

function primaryHrpcStorageClassName(state: WizardState): string | undefined {
  if (!state.components.replication) return undefined
  const ensured = ensureSitesForReplication(state)
  const primary = getSiteStorage(ensured, 'primary')
  return (
    primary.storageClasses.find((sc) => !!sc.hrpcPairId)?.name?.trim() ||
    primary.storageClasses[0]?.name?.trim() ||
    undefined
  )
}

async function generateAllSingleSite(
  state: WizardState,
  opts?: {
    remoteKubeconfigSite?: SiteId | 'both'
    drScNameOverride?: string
    includeTestVolume?: boolean
  },
): Promise<GeneratedFile[]> {
  const files: GeneratedFile[] = []
  const plat = PLATFORMS[state.platform]
  const extrasRegistry =
    state.airGapped && Boolean((state.offline?.registryBase || '').trim())
      ? offlineRegistryPaths(state).extras
      : ''

  // Multipath prerequisites
  if (state.multipath.enabled) {
    // Classic OpenShift/ROSA: MachineConfig. Hosted/HCP: DaemonSet. Others: loose conf.
    if (plat.useOc && state.multipath.includeMachineConfig) {
      for (const mc of generateMultipathMachineConfigs({
        name: state.multipath.machineConfigName,
        role: state.multipath.machineConfigRole,
        conf: state.multipath.customConf || undefined,
      })) {
        files.push({ ...mc, group: 'prereq' })
      }
      files.push({
        path: '00-prereq/README-multipath.md',
        content: `# Multipath (OpenShift — self-managed)

> **Important:** Applying these MachineConfigs **reboots every node** in the targeted MachineConfigPool
> (rolling). Schedule a maintenance window. Do **not** install the CSI Driver or create PVCs until pools
> are fully updated.

The Hitachi multipath sample is embedded in the MachineConfig as base64 Ignition content for
\`/etc/multipath.conf\`. Do not copy a loose \`multipath.conf\` onto nodes.

**Paths:**

1. **Early apply (optional):** On the Prerequisites step, copy the MachineConfig preview and
   \`oc apply\` it so nodes reboot while you finish the wizard. Check **I already applied this
   MachineConfig** so \`install.sh\` skips apply.
2. **Via install.sh (default):** Leave that checkbox unchecked. \`install.sh\` applies the YAML,
   snapshots the current MachineConfigPool rendered config, then waits until pools pick up the
   new MachineConfig **and** show UPDATED=True / UPDATING=False (so it does not continue on the
   pre-apply healthy state). Detail snapshots go to \`logs/install-*.log\`. It also skips apply
   if the MachineConfig already exists on the cluster.

\`\`\`bash
# Early apply example:
oc apply -f 00-prereq/

# Or let install.sh handle apply + wait
./install.sh
\`\`\`

After apply (either path), wait until pools are healthy before CSI Driver install. When using
\`install.sh\`, the script waits and continues on its own; check \`logs/install-*.log\` for full detail.
`,
        description: 'Multipath apply notes for OpenShift (includes reboot warning)',
        group: 'prereq',
      })
    } else if (plat.useOc && state.multipath.includeDaemonSet) {
      for (const ds of generateMultipathDaemonSetFiles({
        name: state.multipath.machineConfigName,
        conf: state.multipath.customConf || undefined,
        enableIscsi: state.connectionType === 'iscsi',
        registryPath: extrasRegistry || undefined,
      })) {
        files.push({ ...ds, group: 'prereq' })
      }
      files.push({
        path: '00-prereq/README-multipath.md',
        content: `# Multipath (OpenShift — hosted / HCP)

Use this path when the guest API has **no MachineConfig** (HyperShift, ROSA HCP, many lab clusters).
The DaemonSet writes Hitachi \`/etc/multipath.conf\` and enables \`multipathd\` on each node.

**Paths:**

1. **Early apply (optional):** On the Prerequisites step, \`oc apply\` the DaemonSet preview. Check
   **I already applied this DaemonSet** so \`install.sh\` skips apply.
2. **Via install.sh (default):** Leave that checkbox unchecked. \`install.sh\` applies the YAML and
   waits for DaemonSet rollout. It also skips if the DaemonSet already exists.

\`\`\`bash
oc apply -f 00-prereq/
oc rollout status ds/${state.multipath.machineConfigName || 'hitachi-csi-multipath'} -n kube-system

# Or:
./install.sh
\`\`\`

Confirm multipath is healthy on workers before installing the CSI Driver.
`,
        description: 'Multipath apply notes for hosted/HCP OpenShift (DaemonSet)',
        group: 'prereq',
      })
    } else if (!plat.useOc && state.multipath.includeConf) {
      files.push({
        path: '00-prereq/multipath.conf',
        content: getMultipathConf(state.multipath.customConf || undefined),
        description: 'Hitachi CSI Device Mapper Multipath sample (/etc/multipath.conf)',
        group: 'prereq',
      })
      files.push({
        path: '00-prereq/README-multipath.md',
        content: `# Multipath (Kubernetes)

1. Copy \`multipath.conf\` to each worker:

\`\`\`bash
sudo cp multipath.conf /etc/multipath.conf
sudo systemctl enable --now multipathd
multipath -ll
\`\`\`

2. Ensure \`user_friendly_names yes\` remains set.
`,
        description: 'Multipath apply notes for Kubernetes',
        group: 'prereq',
      })
    }
  }

  // Secrets from storage systems
  for (const sys of state.storageSystems) {
    if (!sys.serial && !sys.url) continue
    const ref = csiSecretRefForSystem(sys, state.driverNamespace)
    files.push({
      path: `01-storage/secret-${sys.name || sys.id}.yaml`,
      content: generateStandardSecret(sys, ref.name, ref.namespace),
      description: `Storage Secret for ${sys.name || sys.serial}`,
      group: 'storage',
    })
  }

  if (state.storageClassesEnabled) {
    const stretched = state.storageClasses.filter((s) => s.kind === 'stretched' || s.kind === 'stretched-adr')
    const seen = new Set<string>()
    for (const sc of stretched) {
      const pair = gadArraysForStorageClass(sc, state.storageSystems)
      if (!pair.primary || !pair.secondary) continue
      const name = (sc.stretchedSecretName || 'hitachi-csi-secret-stretched').trim()
      const ns = (sc.secretNamespace || '').trim() || state.driverNamespace
      const key = `${name}\0${ns}`
      if (seen.has(key)) continue
      seen.add(key)
      files.push({
        path: stretchedSecretPackagePath(name),
        content: generateStretchedSecret(pair.primary, pair.secondary, name, ns, {
          virtualSerial: sc.virtualStorageSerialNumber,
          alternativeCloneMode: !!(pair.primary.alternativeCloneMode || pair.secondary.alternativeCloneMode),
        }),
        description: 'Stretched / GAD dual-array Secret',
        group: 'storage',
      })
    }
  }

  if (state.storageClassesEnabled) {
    for (const sc of state.storageClasses) {
      const bound = applyArrayBindingToClass(sc, state.storageSystems, state.driverNamespace)
      const serial =
        bound.kind === 'standard'
          ? effectiveSerialNumber(bound, state.storageSystems) || bound.serialNumber
          : bound.serialNumber
      files.push({
        path: `01-storage/storageclass-${sc.name}.yaml`,
        content: generateStorageClass({
          ...bound,
          connectionType: bound.connectionType || state.connectionType,
          serialNumber: serial,
        }),
        description: `StorageClass ${sc.name} (${sc.kind})`,
        group: 'storage',
      })
    }

    if (
      state.snapshotClass.enabled &&
      supportsCsiVolumeSnapshots(state.storageClasses) &&
      snapshotClassOpts(state).poolID
    ) {
      files.push({
        path: `01-storage/volumesnapshotclass-${state.snapshotClass.name}.yaml`,
        content: generateSnapshotClass(state.snapshotClass, snapshotClassOpts(state)),
        description: 'VolumeSnapshotClass',
        group: 'storage',
      })
    }
  }

  // Driver
  let hspcCrYaml = generateHspcCr(state.driverNamespace)
  if (!plat.operatorHub) {
    const offlineEnabled = state.airGapped && Boolean(state.offline?.registryBase?.trim())
    const offlineRegistry = offlineRegistryPaths(state).hspc
    let fetchFailed = false

    if (offlineEnabled && offlineRegistry) {
      const k8sMinor = parseK8sMinor(state.platformVersion)
      const hspcPaths = templatePaths('hspc', state.versions.driver, {
        k8sMinor: k8sMinor ?? undefined,
      })

      const nsRaw = await fetchFirstAvailable(hspcPaths.operatorNs ?? [])
      if (nsRaw) {
        files.push({
          path: '02-driver/hspc-operator-namespace-offline.yaml',
          content: nsRaw,
          description: 'CSI Driver operator namespace (offline package)',
          group: 'driver',
        })
      } else {
        fetchFailed = true
      }

      const opRaw = await fetchFirstAvailable(hspcPaths.operator ?? [])
      if (opRaw) {
        files.push({
          path: '02-driver/hspc-operator-offline.yaml',
          content: rewriteImagesToRegistry(opRaw, offlineRegistry),
          description: 'CSI Driver operator manifests (offline package; images rewritten to private registry)',
          group: 'driver',
        })
      } else {
        fetchFailed = true
      }

      const sampleRaw = await fetchFirstAvailable(hspcPaths.k8sSample ?? [])
      if (sampleRaw) {
        const rewrittenSample = rewriteImagesToRegistry(sampleRaw, offlineRegistry)
        const populated = generateHspcCrFromOfflineSample(state.driverNamespace, rewrittenSample)
        if (populated) {
          hspcCrYaml = populated
        } else {
          fetchFailed = true
        }
      } else {
        fetchFailed = true
      }

      files.push({
        path: '02-driver/README.md',
        content: `# CSI Driver install (Kubernetes — air-gapped)

This ZIP includes the CSI Driver operator YAML with container images rewritten to your private registry base:

- \`02-driver/hspc-operator-namespace-offline.yaml\`
- \`02-driver/hspc-operator-offline.yaml\`
- \`02-driver/hspc-cr.yaml\` (offline image bundle fields populated when the upstream sample is available)

Run \`install.sh\`. It applies the offline operator, waits for the HSPC API, then applies \`hspc-cr.yaml\`.

${fetchFailed ? 'WARNING: could not fetch some upstream CSI Driver YAML/sample; re-export when GitHub is reachable.\n' : ''}${
  state.telemetryEnabled
    ? ''
    : `
Telemetry is disabled in this package. \`install.sh\` applies \`hspc-csi-telemetry-config\` (awsEnabled=false)
after the CSI Driver HSPC instance is READY.`
}
`,
        description: 'Air-gapped Kubernetes CSI Driver install notes',
        group: 'driver',
      })
    } else {
    files.push({
      path: '02-driver/README.md',
      content: `# CSI Driver install (Kubernetes)

Apply operator manifests from the upstream repo at version ${state.versions.driver}:

\`\`\`bash
kubectl apply -f https://raw.githubusercontent.com/hitachi-vantara/csi-operator-hitachi/main/hspc/${state.versions.driver}/operator/hspc-operator-namespace.yaml
kubectl apply -f https://raw.githubusercontent.com/hitachi-vantara/csi-operator-hitachi/main/hspc/${state.versions.driver}/operator/hspc-operator.yaml
kubectl apply -f hspc-cr.yaml
kubectl get hspc -n ${state.driverNamespace}
\`\`\`
${
  state.telemetryEnabled
    ? ''
    : `
Telemetry is disabled in this package. \`install.sh\` applies \`hspc-csi-telemetry-config\` (awsEnabled=false)
after the CSI Driver HSPC instance is READY.`
}
`,
      description: 'Kubernetes driver install notes',
      group: 'driver',
    })
    }
  } else {
    for (const f of generateOperatorHubFiles(state)) {
      files.push({ ...f, group: 'driver' })
    }
    files.push({
      path: '02-driver/README-openshift.md',
      content: `# CSI Driver install (OpenShift OperatorHub)

\`install.sh\` installs the operator via OLM (no console click required):

1. Applies Namespace, OperatorGroup, and Subscription for **Hitachi Storage Plug-in for Containers**
   (\`hspc-operator\` from \`certified-operators\`, channel \`stable\`).
2. Approves the **day-0** InstallPlan. The Subscription keeps \`installPlanApproval: Manual\` so later
   upgrades still require approval (per product docs).
3. Waits for ClusterServiceVersion **Succeeded**.
4. Waits until CRD \`hspcs.csi.hitachi.com\` is Established and kind HSPC is discoverable.
5. Applies \`hspc-cr.yaml\` in \`${state.driverNamespace}\` and waits until READY.

## Air-gapped / mirrored catalogs

This wizard keeps OpenShift/ROSA installs on the **OperatorHub/OLM** path.

- If \`offline.catalogIndexImage\` is set, the ZIP includes \`02-driver/operatorhub-catalogsource.yaml\`
  and \`install.sh\` applies it **before** the Subscription and waits until the CatalogSource reports READY.
- The Subscription \`spec.source\` is set from \`offline.catalogSourceName\` when \`airGapped\` is on
  (default \`certified-operators\`).
- \`02-driver/hspc-cr.yaml\` stays \`spec: {}\` on OpenShift/ROSA. Image redirection is handled by
  \`oc-mirror\` and the cluster’s mirror policies (for example ImageDigestMirrorSet / ImageTagMirrorSet),
  not by embedding image overrides into the HSPC custom resource.

Manual verify:

\`\`\`bash
oc get csv -n ${state.operatorNamespace}
oc get hspc -n ${state.driverNamespace}
# NAME   READY   AGE
# hspc   true    30s
\`\`\`

Target driver version (wizard): **${state.versions.driver}**
${
  state.telemetryEnabled
    ? ''
    : `

Telemetry is disabled in this package. After HSPC is READY, \`install.sh\` scales the operator, applies
\`hspc-csi-telemetry-config\` (awsEnabled=false), then scales back up.`
}
`,
      description: 'OpenShift OperatorHub install guide',
      group: 'driver',
    })
  }

  files.push({
    path: '02-driver/hspc-cr.yaml',
    content: hspcCrYaml,
    description: 'Hitachi CSI Driver custom resource',
    group: 'driver',
  })

  if (!state.telemetryEnabled) {
    files.push({
      path: '02-driver/hspc-csi-telemetry-config.yaml',
      content: generateTelemetryDisableConfigMap(state.driverNamespace),
      description: 'Disable Hitachi Telemetry (awsEnabled false)',
      group: 'driver',
    })
  }

  // Replication
  if (state.components.replication) {
    const hrpcPaths = templatePaths('hrpc', state.versions.replication)
    const offlineEnabled = state.airGapped && Boolean(state.offline?.registryBase?.trim())
    const offlineRegistry = offlineEnabled ? offlineRegistryPaths(state).hrpc : ''
    const drScName =
      opts?.drScNameOverride?.trim() ||
      (state.storageClassesEnabled && resolvedCurrentStorageClassName(state)) ||
      'hitachi-csi'

    let fetchFailed = false
    if (offlineEnabled && offlineRegistry) {
      const opNsRaw = await fetchFirstAvailable(hrpcPaths.operatorNs ?? [])
      if (opNsRaw) {
        files.push({
          path: '03-replication/hspc-replication-operator-namespace.yaml',
          content: rewriteImagesToRegistry(opNsRaw, offlineRegistry),
          description: 'Replication operator namespace (offline package)',
          group: 'replication',
        })
      } else {
        fetchFailed = true
      }

      const opRaw = await fetchFirstAvailable(hrpcPaths.operator ?? [])
      if (opRaw) {
        files.push({
          path: '03-replication/hspc-replication-operator.yaml',
          content: rewriteImagesToRegistry(opRaw, offlineRegistry),
          description: 'Replication operator manifests (offline package; images rewritten to private registry)',
          group: 'replication',
        })
      } else {
        fetchFailed = true
      }
    }

    const certRaw = await fetchFirstAvailable(hrpcPaths.certManager ?? [])
    if (certRaw) {
      files.push({
        path: '03-replication/cert-manager.yaml',
        content: offlineEnabled && offlineRegistry ? rewriteImagesToRegistry(certRaw, offlineRegistry) : certRaw,
        description: 'cert-manager (required by Disaster Recovery operator)',
        group: 'replication',
      })
    } else if (offlineEnabled && offlineRegistry) {
      fetchFailed = true
    }

    const drRaw = await fetchFirstAvailable(hrpcPaths.drInstall ?? [])
    if (drRaw) {
      // Upstream ships a literal placeholder that fails API validation until substituted.
      const patched = drRaw.replaceAll('<storage-class-name>', drScName)
      files.push({
        path: '03-replication/dr-operator-install.yaml',
        content: offlineEnabled && offlineRegistry ? rewriteImagesToRegistry(patched, offlineRegistry) : patched,
        description: `Disaster Recovery operator install (PVC uses StorageClass ${drScName})`,
        group: 'replication',
      })
    } else if (offlineEnabled && offlineRegistry) {
      fetchFailed = true
    }

    const remoteSite = opts?.remoteKubeconfigSite ?? 'both'
    const drClusterNames = resolvedDrClusterNames(state)
    const remoteKcInstallBlurb =
      remoteSite === 'primary'
        ? 'Applies the packaged `remote-kubeconfig-for-primary-site.yaml` and `remote-kubeconfig.yaml` in this folder (run from `primary/` on the primary cluster).'
        : remoteSite === 'secondary'
          ? 'Applies the packaged `remote-kubeconfig-for-secondary-site.yaml` and `remote-kubeconfig.yaml` in this folder (run from `secondary/` on the secondary cluster).'
          : 'Applies packaged `remote-kubeconfig-for-*-site.yaml` and `remote-kubeconfig.yaml` (`REPLICATION_SITE=primary` default; use `secondary` on the other site when both files are present).'

    files.push({
      path: '03-replication/README.md',
      content: `# Replication + Disaster Recovery

Version: ${state.versions.replication}

## What install.sh does for you

1. Applies the Replication operator (namespace + operator manifests)
2. Applies \`storage-secrets.yaml\` when present
3. Applies cert-manager, waits for the webhook **and Certificate/Issuer APIs**, then applies the Disaster Recovery operator
4. DR operator PVC \`hspc-dr-operator-pvc\` uses StorageClass \`${drScName}\` (from this wizard — not the upstream \`<storage-class-name>\` placeholder)
5. On OpenShift, \`install.sh\` sets \`fsGroup\` in \`dr-operator-install.yaml\` from this cluster’s \`openshift.io/sa.scc.supplemental-groups\` on \`${state.replication.namespace}\` (primary and secondary ranges often differ)
6. Remote kubeconfig Secrets — **either**:
   - ${remoteKcInstallBlurb}
   - Or runs \`create-remote-kubeconfig-secrets.sh\` when \`KUBECONFIG_P\` and \`KUBECONFIG_S\` are set

## What you provide

**Option A — wizard Secret YAML (already in this ZIP if you pasted kubeconfigs):** nothing else for this cluster; \`install.sh\` applies both remote-kubeconfig Secrets packaged for this folder (\`hspc-replication-operator-remote-kubeconfig\` and \`remote-kubeconfig\`). DRPolicy \`clusterName\` values must match the data keys in the \`remote-kubeconfig\` Secret (\`${drClusterNames.primary}\` / \`${drClusterNames.secondary}\`).

**Option B — helper script:** set paths to both cluster kubeconfigs before \`./install.sh\`:

\`\`\`bash
export KUBECONFIG_P=/path/to/primary-kubeconfig
export KUBECONFIG_S=/path/to/secondary-kubeconfig
\`\`\`

Details: \`remote-kubeconfig-notes.md\`.

${
  fetchFailed
    ? '\nWARNING: could not fetch some upstream Replication operator/DR YAML; re-export when GitHub is reachable.\n'
    : certRaw && drRaw
      ? ''
      : '\nWARNING: could not fetch some upstream Replication/DR YAML; re-export when GitHub is reachable.\n'
}
`,
      description: 'Replication and DR Operator install notes',
      group: 'replication',
    })
    const replicationSecrets = resolvedReplicationStorageSecrets(state)
    if (replicationSecrets.length) {
      files.push({
        path: '03-replication/storage-secrets.yaml',
        content: generateReplicationSecrets({
          ...state.replication,
          enabled: true,
          disasterRecovery: true,
          storageSecrets: replicationSecrets,
        }),
        description: 'Replication storage secrets',
        group: 'replication',
      })
    }
    const remoteNotesApply =
      remoteSite === 'primary'
        ? `\`\`\`bash
${plat.useOc ? 'oc' : 'kubectl'} apply -f 03-replication/remote-kubeconfig-for-primary-site.yaml
${plat.useOc ? 'oc' : 'kubectl'} apply -f 03-replication/remote-kubeconfig.yaml
\`\`\``
        : remoteSite === 'secondary'
          ? `\`\`\`bash
${plat.useOc ? 'oc' : 'kubectl'} apply -f 03-replication/remote-kubeconfig-for-secondary-site.yaml
${plat.useOc ? 'oc' : 'kubectl'} apply -f 03-replication/remote-kubeconfig.yaml
\`\`\``
          : `\`\`\`bash
# on primary:
${plat.useOc ? 'oc' : 'kubectl'} apply -f 03-replication/remote-kubeconfig-for-primary-site.yaml
${plat.useOc ? 'oc' : 'kubectl'} apply -f 03-replication/remote-kubeconfig.yaml
# on secondary:
${plat.useOc ? 'oc' : 'kubectl'} apply -f 03-replication/remote-kubeconfig-for-secondary-site.yaml
${plat.useOc ? 'oc' : 'kubectl'} apply -f 03-replication/remote-kubeconfig.yaml
\`\`\``

    files.push({
      path: '03-replication/remote-kubeconfig-notes.md',
      content: `# Remote kubeconfig Secrets

Each site needs **two** Secrets in \`${state.replication.namespace}\`:

1. **Replication operator** — \`${state.replication.remoteKubeconfigSecretName || REMOTE_KUBECONFIG_SECRET_NAME}\` (data key \`remote-kubeconfig\`): the other site's kubeconfig
2. **DR Operator** — \`remote-kubeconfig\` (data key = the other site's cluster name): same kubeconfig, keyed for DRPolicy \`clusterName\`

Resolved cluster names: primary \`${drClusterNames.primary}\`, secondary \`${drClusterNames.secondary}\`. DRPolicy \`clusterName\` on each site must match the data key in that site's \`remote-kubeconfig\` Secret.

## Option A — wizard Secret YAML (in this ZIP when you pasted kubeconfigs)

\`install.sh\` applies both Secrets packaged for **this folder** automatically (dual-site ZIP: run \`./install.sh\` from \`primary/\` or \`secondary/\`). If both site YAML files are present in one folder, set \`REPLICATION_SITE=primary|secondary\`.

Or apply by hand:

${remoteNotesApply}

## Option B — helper script (KUBECONFIG_P / KUBECONFIG_S)

\`\`\`bash
export KUBECONFIG_P=/path/to/primary-kubeconfig
export KUBECONFIG_S=/path/to/secondary-kubeconfig
\`\`\`

\`install.sh\` (or \`APPLY=1 ./create-remote-kubeconfig-secrets.sh\`) will:

1. Build both Replication operator Secrets with the correct name, namespace, and base64 data key
2. Build both DR Operator \`remote-kubeconfig\` Secrets with cluster-name data keys
3. Put the **other** site's kubeconfig into each Secret
4. Apply all four Secrets with \`KUBECONFIG_P\` / \`KUBECONFIG_S\`

You do not create these Secrets by hand.
`,
      description: 'Remote kubeconfig instructions',
      group: 'replication',
    })
    files.push({
      path: '03-replication/create-remote-kubeconfig-secrets.sh',
      content: generateRemoteKubeconfigScript({
        namespace: state.replication.namespace,
        cmd: plat.useOc ? 'oc' : 'kubectl',
        secretName: state.replication.remoteKubeconfigSecretName || REMOTE_KUBECONFIG_SECRET_NAME,
        primaryClusterName: drClusterNames.primary,
        secondaryClusterName: drClusterNames.secondary,
      }),
      description: 'Automates both remote-kubeconfig Secrets from KUBECONFIG_P / KUBECONFIG_S',
      group: 'replication',
    })
    if (remoteSite !== 'secondary' && state.replication.secondaryKubeconfig?.trim()) {
      files.push({
        path: '03-replication/remote-kubeconfig-for-primary-site.yaml',
        content: generateRemoteKubeconfigSecret({
          namespace: state.replication.namespace,
          kubeconfig: state.replication.secondaryKubeconfig,
          secretName: state.replication.remoteKubeconfigSecretName || REMOTE_KUBECONFIG_SECRET_NAME,
        }),
        description: 'Apply on primary cluster (contains secondary kubeconfig)',
        group: 'replication',
      })
      files.push({
        path: '03-replication/remote-kubeconfig.yaml',
        content: generateDrRemoteKubeconfigSecret({
          namespace: state.replication.namespace,
          kubeconfig: state.replication.secondaryKubeconfig,
          clusterName: drClusterNames.secondary,
        }),
        description: 'DR Operator Secret on primary cluster (secondary cluster name as data key)',
        group: 'replication',
      })
    }
    if (remoteSite !== 'primary' && state.replication.primaryKubeconfig?.trim()) {
      files.push({
        path: '03-replication/remote-kubeconfig-for-secondary-site.yaml',
        content: generateRemoteKubeconfigSecret({
          namespace: state.replication.namespace,
          kubeconfig: state.replication.primaryKubeconfig,
          secretName: state.replication.remoteKubeconfigSecretName || REMOTE_KUBECONFIG_SECRET_NAME,
        }),
        description: 'Apply on secondary cluster (contains primary kubeconfig)',
        group: 'replication',
      })
      files.push({
        path: '03-replication/remote-kubeconfig.yaml',
        content: generateDrRemoteKubeconfigSecret({
          namespace: state.replication.namespace,
          kubeconfig: state.replication.primaryKubeconfig,
          clusterName: drClusterNames.primary,
        }),
        description: 'DR Operator Secret on secondary cluster (primary cluster name as data key)',
        group: 'replication',
      })
    }
  }

  // Metrics
  if (state.components.metrics) {
    const cmd = plat.useOc ? 'oc' : 'kubectl'
    const metricsNs = state.metrics.namespace || 'hspc-monitoring-system'
    const stackSc = resolvedFlattenedMetricsPvcStorageClassName(state)
    const hsppPaths = templatePaths('hspp', state.versions.metrics)
    const offlineMetricsEnabled = state.airGapped && Boolean((state.offline?.registryBase || '').trim())
    const offlineHsppRegistry = offlineMetricsEnabled ? offlineRegistryPaths(state).hspp : ''
    const stackLines: string[] = []
    let fetchFailed = false

    // Namespace must exist before prometheus/grafana/exporter (splitMonitoringStack drops it).
    files.push({
      path: '04-metrics/namespace.yaml',
      content: `apiVersion: v1
kind: Namespace
metadata:
  name: ${metricsNs}
`,
      description: 'Performance Metrics namespace',
      group: 'metrics',
    })
    stackLines.push(`${cmd} apply -f namespace.yaml`)

    if (plat.useOc) {
      const sccRaw = await fetchFirstAvailable(hsppPaths.scc ?? [])
      if (sccRaw) {
        files.push({
          path: '04-metrics/scc-for-openshift.yaml',
          content: rewriteYamlNamespace(sccRaw, metricsNs),
          description: 'OpenShift SCC for Performance Metrics',
          group: 'metrics',
        })
        stackLines.push(`${cmd} apply -f scc-for-openshift.yaml`)
      } else {
        fetchFailed = true
      }
    }

    const metricsStorages = resolvedMetricsStorages(state)
    if (metricsStorages.length) {
      files.push({
        path: '04-metrics/metrics-secret.yaml',
        content: generateMetricsSecret({ ...state.metrics, storages: metricsStorages }),
        description: 'Performance Metrics exporter secret',
        group: 'metrics',
      })
      stackLines.push(`${cmd} apply -f metrics-secret.yaml`)
    }

    const exporterRaw = await fetchFirstAvailable(hsppPaths.exporter ?? [])
    if (exporterRaw) {
      let content = rewriteYamlNamespace(exporterRaw, metricsNs)
      if (offlineMetricsEnabled && offlineHsppRegistry) {
        content = rewriteImagesToRegistry(content, offlineHsppRegistry)
      }
      files.push({
        path: '04-metrics/exporter.yaml',
        content,
        description: 'Performance Metrics exporter',
        group: 'metrics',
      })
      stackLines.push(`${cmd} apply -f exporter.yaml`)

      let patch = generateMetricsExporterPatch({ ...state.metrics, namespace: metricsNs }, state.versions.metrics)
      if (offlineMetricsEnabled && offlineHsppRegistry) {
        patch = rewriteImagesToRegistry(patch, offlineHsppRegistry)
      }
      files.push({
        path: '04-metrics/exporter-patch.yaml',
        content: patch,
        description: 'Performance Metrics exporter patch (env + image tag aligned to wizard version)',
        group: 'metrics',
      })
      stackLines.push(
        `${cmd} patch deployment storage-exporter -n ${metricsNs} --type strategic --patch-file exporter-patch.yaml`,
      )
    } else {
      fetchFailed = true
    }

    if (state.metrics.deployPrometheus || state.metrics.deployGrafana) {
      const urls = hsppPaths.grafanaProm ?? []
      const combined = await fetchFirstAvailable(urls)
      if (!combined) {
        fetchFailed = true
      } else {
        const { prometheusYaml, grafanaYaml } = splitMonitoringStack(combined)

        if (state.metrics.deployPrometheus && prometheusYaml.trim()) {
          let content = rewriteStorageClassName(rewriteYamlNamespace(prometheusYaml, metricsNs), stackSc)
          if (offlineMetricsEnabled && offlineHsppRegistry) {
            content = rewriteImagesToRegistry(content, offlineHsppRegistry)
          }
          files.push({
            path: '04-metrics/prometheus-stack.yaml',
            content,
            description: 'Prometheus stack (from upstream HSPP monitoring YAML)',
            group: 'metrics',
          })
          stackLines.push(`${cmd} apply -f prometheus-stack.yaml`)
        }

        if (state.metrics.deployGrafana && grafanaYaml.trim()) {
          let content = state.metrics.deployPrometheus
            ? grafanaYaml
            : patchGrafanaDatasource(grafanaYaml, {
                namespace: state.consolePlugin.prometheusNamespace,
                service: state.consolePlugin.prometheusService,
                port: state.consolePlugin.prometheusPort,
              })
          content = rewriteStorageClassName(rewriteYamlNamespace(content, metricsNs), stackSc)
          if (offlineMetricsEnabled && offlineHsppRegistry) {
            content = rewriteImagesToRegistry(content, offlineHsppRegistry)
          }
          files.push({
            path: '04-metrics/grafana-stack.yaml',
            content,
            description: 'Grafana stack + Hitachi dashboard (from upstream HSPP monitoring YAML)',
            group: 'metrics',
          })
          stackLines.push(`${cmd} apply -f grafana-stack.yaml`)
        }
      }
    }

    const stackNotes =
      state.metrics.deployPrometheus || state.metrics.deployGrafana
        ? `Notes:
- Stack manifests are filtered from upstream \`grafana-prometheus-sample.yaml\`.
- \`storageClassName\` is set to \`${stackSc}\` (current StorageClass from this wizard). Change if needed.
${
  state.metrics.deployGrafana && !state.metrics.deployPrometheus
    ? `- Grafana datasource points at \`http://${state.consolePlugin.prometheusService}.${state.consolePlugin.prometheusNamespace}.svc:${state.consolePlugin.prometheusPort}\`.`
    : ''
}
${fetchFailed ? '- WARNING: could not fetch some upstream metrics YAML; re-export when network access to GitHub is available.\n' : ''}
`
        : ''

    files.push({
      path: '04-metrics/README.md',
      content: `# Performance Metrics install

Version: ${state.versions.metrics}

\`install.sh\` applies these in order (namespace first):

\`\`\`bash
${stackLines.join('\n')}
\`\`\`

${stackNotes}
`,
      description: 'Performance Metrics install notes',
      group: 'metrics',
    })
  }

  // Console plugin
  if (state.components.consolePlugin && plat.supportsConsolePlugin) {
    const cmd = plat.useOc ? 'oc' : 'kubectl'
    const pluginUrls = templatePaths('hspc', state.versions.driver).consolePlugin ?? []
    const pluginRaw = await fetchFirstAvailable(pluginUrls)
    if (pluginRaw) {
      const offlineEnabled = state.airGapped && Boolean(state.offline?.registryBase?.trim())
      const offlineRegistry = offlineEnabled ? offlineRegistryPaths(state).hspc : ''
      let content = patchConsolePluginManifest(pluginRaw, state.consolePlugin)
      if (offlineEnabled && offlineRegistry) {
        content = rewriteImagesToRegistry(content, offlineRegistry)
      }
      files.push({
        path: '05-console/consoleplugin-ocp-ui.yaml',
        content,
        description: 'OpenShift Console Plugin manifests (Prometheus target patched from wizard)',
        group: 'console',
      })
    }
    files.push({
      path: '05-console/README.md',
      content: `# OpenShift Console Plugin

Version: ${state.versions.driver}

\`install.sh\` applies \`consoleplugin-ocp-ui.yaml\` (includes a Job that registers the plugin on the
cluster Console). Prometheus target embedded in the ConfigMap:

- namespace: \`${state.consolePlugin.prometheusNamespace}\`
- service: \`${state.consolePlugin.prometheusService}\`
- port: \`${state.consolePlugin.prometheusPort}\`

\`\`\`bash
${cmd} apply -f consoleplugin-ocp-ui.yaml
${cmd} get consoleplugin console-plugin-vsp360-dcm
${cmd} get consoles.operator.openshift.io cluster -o jsonpath='{.spec.plugins}{"\\n"}'
\`\`\`
${pluginRaw ? '' : '\nWARNING: could not fetch upstream console plugin YAML; re-export when GitHub is reachable.\n'}
`,
      description: 'Console plugin install notes',
      group: 'console',
    })
  }

  // Quickstart
  const includeTestVolume = opts?.includeTestVolume ?? state.storageClassesEnabled
  if (includeTestVolume) {
    files.push({
      path: '06-quickstart/pvc.yaml',
      content: generatePvc({
        ...state.quickstart,
        storageClassName: resolvedCurrentStorageClassName(state),
      }),
      description: 'Test PVC for first PV',
      group: 'quickstart',
    })
    files.push({
      path: '06-quickstart/pod.yaml',
      content: generateTestPod(state.quickstart, { registryPath: extrasRegistry || undefined }),
      description: 'Test Pod mounting the PVC',
      group: 'quickstart',
    })
  }

  const installSh = generateInstallScript(state, files, {
    drScNameOverride: opts?.drScNameOverride,
  })
  files.push({
    path: 'install.sh',
    content: installSh,
    description: 'Ordered install script',
    group: 'scripts',
  })

  // silence unused
  void yamlQuote
  void generateMetricsExporterPatch

  return files
}

export async function generateAll(state: WizardState): Promise<GeneratedFile[]> {
  if (!state.components.replication) {
    const files = await generateAllSingleSite(state, { remoteKubeconfigSite: 'both' })
    const mirror = mirrorScriptFile(state, files)
    if (mirror) {
      files.push(mirror)
      const offline = await hvOfflineBundleScriptFile(state)
      if (offline) files.push(offline)
    }
    return files
  }

  const ensured = ensureSitesForReplication(state)

  const drScName =
    primaryHrpcStorageClassName(ensured) ||
    (ensured.storageClassesEnabled && resolvedStorageClassName(ensured)) ||
    'hitachi-csi'

  const primaryState = stateForSite(ensured, 'primary')
  const secondaryState = stateForSite(ensured, 'secondary')

  const primaryFiles = await generateAllSingleSite(primaryState, {
    remoteKubeconfigSite: 'primary',
    drScNameOverride: drScName,
    includeTestVolume: quickstartInstalledForSite(ensured, 'primary'),
  })
  const secondaryFiles = await generateAllSingleSite(secondaryState, {
    remoteKubeconfigSite: 'secondary',
    drScNameOverride: drScName,
    includeTestVolume: quickstartInstalledForSite(ensured, 'secondary'),
  })
  const mirror = mirrorScriptFile(ensured, [...primaryFiles, ...secondaryFiles])
  const offline = mirror ? await hvOfflineBundleScriptFile(ensured) : null

  const out: GeneratedFile[] = [
    ...(mirror ? [mirror] : []),
    ...(offline ? [offline] : []),
    ...prefixFiles(primaryFiles, 'primary'),
    ...prefixFiles(secondaryFiles, 'secondary'),
  ]

  return out
}
