/** Platform, protocol, and storage-type catalog with documented constraints. */

export type PlatformId = 'openshift' | 'kubernetes' | 'rke2' | 'eks' | 'rosa'

/** Cards shown on Platform. `rosa` and `eks` remain in PLATFORMS for saved configs. */
export const PLATFORM_PICKER_IDS: readonly PlatformId[] = ['openshift', 'kubernetes', 'rke2']
export type ConnectionType = 'fc' | 'iscsi' | 'nvme-fc' | 'nvme-tcp'
/** Worker node form factor — HSPC server requirements restrict protocols per environment */
export type NodeEnvironment = 'bare-metal' | 'virtual-machine'
/** OpenShift/ROSA control plane — drives multipath delivery (MachineConfig vs DaemonSet) */
export type OpenShiftTopology = 'classic' | 'hosted'
export type MultipathDelivery = 'machineconfig' | 'daemonset' | 'conf' | 'none'
/** CSI-relevant model family. VSP / VSP One Block share one StorageClass shape; SDS Block is the other. */
export type StorageFamily =
  | 'vsp-one-block-20'
  | 'vsp-one-block-high-end'
  | 'vsp-one-sds-block'
  | 'vsp-5000-g-e-f'

export const STORAGE_FAMILIES: { id: StorageFamily; label: string }[] = [
  { id: 'vsp-one-block-20', label: 'VSP One Block 20 Series' },
  { id: 'vsp-one-block-high-end', label: 'VSP One Block High End (B85)' },
  { id: 'vsp-one-sds-block', label: 'VSP One SDS Block' },
  { id: 'vsp-5000-g-e-f', label: 'VSP 5000 / G / E / F' },
]

export function isSdsBlockFamily(family?: StorageFamily): boolean {
  return family === 'vsp-one-sds-block'
}

/** GAD / Stretched PVC is VSP and VSP One Block only (MK-92ADPTR142). */
export function supportsStretchedGad(family?: StorageFamily): boolean {
  return !!family && !isSdsBlockFamily(family)
}

/** CSI volume snapshots for a PVC are not supported on VSP One SDS Block (MK-92ADPTR142). */
export function supportsCsiVolumeSnapshots(
  classes: Array<{ kind: StorageClassKind }>,
): boolean {
  if (classes.length === 0) return true
  return classes.some((sc) => sc.kind !== 'vsp-one-sds-block')
}

export function isStretchedKind(kind: StorageClassKind): boolean {
  return kind === 'stretched' || kind === 'stretched-adr'
}

/** Package path for a stretched / GAD Secret. */
export function stretchedSecretPackagePath(secretName: string): string {
  const name = (secretName || 'hitachi-csi-secret-stretched').trim()
  return name === 'hitachi-csi-secret-stretched'
    ? '01-storage/secret-stretched.yaml'
    : `01-storage/secret-${name}.yaml`
}

type GadRoleSystem = {
  family?: StorageFamily
  stretchedRole?: 'primary' | 'secondary' | 'none'
}

/** True when this site has at least two GAD-capable VSP arrays. */
export function hasGadPair(systems: GadRoleSystem[]): boolean {
  return systems.filter((s) => supportsStretchedGad(s.family)).length >= 2
}

/** First two GAD-capable VSP arrays for a GAD pair, or null if hasGadPair is false. */
export function gadPairSystems<T extends GadRoleSystem>(
  systems: T[],
): { primary: T; secondary: T } | null {
  if (!hasGadPair(systems)) return null
  const gad = systems.filter((s) => supportsStretchedGad(s.family))
  return {
    primary: gad[0]!,
    secondary: gad[1]!,
  }
}

/** StorageClass types valid for the arrays on this site. */
export function storageClassKindsForSystems(systems: GadRoleSystem[]): StorageClassKind[] {
  const vspCount = systems.filter((s) => supportsStretchedGad(s.family)).length
  const hasSds = systems.some((s) => isSdsBlockFamily(s.family))
  const kinds: StorageClassKind[] = []
  if (vspCount > 0) kinds.push('standard')
  if (hasGadPair(systems)) {
    kinds.push('stretched', 'stretched-adr')
  }
  if (hasSds) kinds.push('vsp-one-sds-block')
  return kinds.length ? kinds : ['standard']
}

export function isVspOneBlock20(family?: StorageFamily): boolean {
  return family === 'vsp-one-block-20'
}

export function supportsAlternativeCloneMode(family?: StorageFamily): boolean {
  return family === 'vsp-one-block-20' || family === 'vsp-one-block-high-end'
}

export function storageFamilyHint(family?: StorageFamily): string {
  switch (family) {
    case 'vsp-5000-g-e-f':
      return 'VSP 5000 series, E series, and G/F 350–900. Same StorageClass shape as VSP One Block. Pool, ports, and type are set on the StorageClasses step.'
    case 'vsp-one-block-20':
      return 'Cannot use Disabled storage efficiency (defaults to CompressionDeduplication). Enables immutable snapshots. Use the service IP for REST.'
    case 'vsp-one-block-high-end':
      return 'Enables immutable snapshots and expandable clones. Use the service IP for REST. Pool, ports, and type are set on the StorageClasses step.'
    case 'vsp-one-sds-block':
      return 'FC, iSCSI, and NVMe/TCP. REST is IPv4 only (80/443).'
    default:
      return 'Choose the array model. Serial, GAD, and StorageClass options follow this choice.'
  }
}

export function storageRestUrlHint(family?: StorageFamily): string {
  switch (family) {
    case 'vsp-5000-g-e-f':
      return 'SVP IP for VSP 5000 series; controller IP for G/E/F. IPv4 only (80/443).'
    case 'vsp-one-block-20':
    case 'vsp-one-block-high-end':
      return 'Use the service IP. IPv4 only (80/443).'
    case 'vsp-one-sds-block':
      return 'SDS Block REST URL. IPv4 only (80/443).'
    default:
      return 'Array REST API URL. IPv4 only (80/443). Format depends on the storage family.'
  }
}

/** Map saved configs that used family `vsp` plus B20 / High End checkboxes. */
export function migrateStorageFamily(
  family: string | undefined,
  flags?: { isB20Series?: boolean; isHighEnd?: boolean },
): StorageFamily | undefined {
  if (
    family === 'vsp-5000-g-e-f' ||
    family === 'vsp-one-block-20' ||
    family === 'vsp-one-block-high-end' ||
    family === 'vsp-one-sds-block'
  ) {
    return family
  }
  if (flags?.isB20Series) return 'vsp-one-block-20'
  if (flags?.isHighEnd) return 'vsp-one-block-high-end'
  if (family === 'vsp') return 'vsp-5000-g-e-f'
  return undefined
}

export function migrateStorageSystemFamily<
  T extends { family?: string; isB20Series?: boolean; isHighEnd?: boolean },
>(sys: T): Omit<T, 'isB20Series' | 'isHighEnd' | 'family'> & { family?: StorageFamily } {
  const { isB20Series, isHighEnd, family: rawFamily, ...rest } = sys
  const family = migrateStorageFamily(rawFamily, { isB20Series, isHighEnd })
  return family ? { ...rest, family } : rest
}

export type StorageClassKind = 'standard' | 'stretched' | 'stretched-adr' | 'vsp-one-sds-block'
export type StorageEfficiency = 'Disabled' | 'Compression' | 'CompressionDeduplication'
export type StorageEfficiencyMode = 'Inline' | 'PostProcess'
export type ReplicationType = 'UR' | 'TC'
export type FenceLevel = 'DATA' | 'STATUS' | 'NEVER'

export interface PlatformDef {
  id: PlatformId
  displayName: string
  versions: string[]
  /** Uses `oc` instead of `kubectl` in generated guides */
  useOc: boolean
  supportsConsolePlugin: boolean
  /** Install CSI Driver via OperatorHub / Software Catalog */
  operatorHub: boolean
  multipathHint: 'machineconfig' | 'conf' | 'daemonset'
}

export function defaultOpenShiftTopology(platform: PlatformId): OpenShiftTopology {
  return platform === 'rosa' ? 'hosted' : 'classic'
}

/** Resolve multipath packaging from platform + topology + whether dm-multipath is needed. */
export function effectiveMultipathDelivery(opts: {
  platform: PlatformId
  openshiftTopology: OpenShiftTopology
  needsDm: boolean
}): MultipathDelivery {
  if (!opts.needsDm) return 'none'
  const plat = PLATFORMS[opts.platform]
  if (!plat.useOc) return 'conf'
  return opts.openshiftTopology === 'hosted' ? 'daemonset' : 'machineconfig'
}

export function multipathFlagsForDelivery(delivery: MultipathDelivery): {
  includeMachineConfig: boolean
  includeDaemonSet: boolean
  includeConf: boolean
} {
  return {
    includeMachineConfig: delivery === 'machineconfig',
    includeDaemonSet: delivery === 'daemonset',
    includeConf: delivery === 'conf',
  }
}

export const PLATFORMS: Record<PlatformId, PlatformDef> = {
  openshift: {
    id: 'openshift',
    displayName: 'Red Hat OpenShift',
    versions: ['4.18', '4.19', '4.20', '4.21', '4.22'],
    useOc: true,
    supportsConsolePlugin: true,
    operatorHub: true,
    multipathHint: 'machineconfig',
  },
  rosa: {
    id: 'rosa',
    displayName: 'Red Hat OpenShift Service on AWS (ROSA)',
    versions: ['4.18', '4.19', '4.20', '4.21', '4.22'],
    useOc: true,
    supportsConsolePlugin: true,
    operatorHub: true,
    multipathHint: 'daemonset',
  },
  kubernetes: {
    id: 'kubernetes',
    displayName: 'Kubernetes',
    versions: ['1.31', '1.32', '1.33', '1.34'],
    useOc: false,
    supportsConsolePlugin: false,
    operatorHub: false,
    multipathHint: 'conf',
  },
  rke2: {
    id: 'rke2',
    displayName: 'Rancher Kubernetes Engine 2 (RKE2)',
    versions: ['1.31', '1.32', '1.33', '1.34'],
    useOc: false,
    supportsConsolePlugin: false,
    operatorHub: false,
    multipathHint: 'conf',
  },
  eks: {
    id: 'eks',
    displayName: 'Amazon Elastic Kubernetes Service (EKS)',
    versions: ['1.31', '1.32', '1.33', '1.34'],
    useOc: false,
    supportsConsolePlugin: false,
    operatorHub: false,
    multipathHint: 'conf',
  },
}

export const CONNECTION_TYPES: {
  id: ConnectionType
  label: string
  bareMetal: boolean
  virtualMachine: boolean
  needsPortId: boolean
  needsNvmSubsystem: boolean
  multipath: 'dm-multipath' | 'native-nvme'
}[] = [
  {
    id: 'fc',
    label: 'Fibre Channel (FC)',
    bareMetal: true,
    virtualMachine: false,
    needsPortId: true,
    needsNvmSubsystem: false,
    multipath: 'dm-multipath',
  },
  {
    id: 'iscsi',
    label: 'iSCSI',
    bareMetal: true,
    virtualMachine: true,
    needsPortId: true,
    needsNvmSubsystem: false,
    multipath: 'dm-multipath',
  },
  {
    id: 'nvme-fc',
    label: 'NVMe over FC',
    bareMetal: true,
    virtualMachine: false,
    needsPortId: false,
    needsNvmSubsystem: true,
    multipath: 'native-nvme',
  },
  {
    id: 'nvme-tcp',
    label: 'NVMe/TCP',
    bareMetal: true,
    virtualMachine: true,
    needsPortId: false,
    needsNvmSubsystem: true,
    multipath: 'native-nvme',
  },
]

/** Connection types allowed for VSP One SDS Block (MK-92ADPTR142) */
export const SDS_BLOCK_CONNECTIONS: ConnectionType[] = ['fc', 'iscsi', 'nvme-tcp']

/** Stretched PVC supports only Fibre Channel and iSCSI (MK-92ADPTR142) */
export const STRETCHED_CONNECTIONS: ConnectionType[] = ['fc', 'iscsi']

export function connectionsForNodeEnvironment(env: NodeEnvironment): ConnectionType[] {
  return CONNECTION_TYPES.filter((c) => (env === 'bare-metal' ? c.bareMetal : c.virtualMachine)).map(
    (c) => c.id,
  )
}

/** Allowed connectionType values for a StorageClass kind under the chosen node environment */
export function connectionsForStorageClassKind(
  kind: StorageClassKind,
  env: NodeEnvironment,
): ConnectionType[] {
  const byEnv = connectionsForNodeEnvironment(env)
  if (kind === 'stretched' || kind === 'stretched-adr') {
    return byEnv.filter((id) => STRETCHED_CONNECTIONS.includes(id))
  }
  if (kind === 'vsp-one-sds-block') {
    return byEnv.filter((id) => SDS_BLOCK_CONNECTIONS.includes(id))
  }
  return byEnv
}

/** Pick a valid connection when the current one is disallowed (prefer iSCSI — valid on BM and VM). */
export function coerceConnectionType(
  current: ConnectionType,
  allowed: ConnectionType[],
): ConnectionType {
  if (allowed.includes(current)) return current
  if (allowed.includes('iscsi')) return 'iscsi'
  return allowed[0] ?? 'fc'
}

export const STORAGE_EFFICIENCY: {
  id: StorageEfficiency
  label: string
  /** Not allowed on VSP One B20 series */
  blockedOnB20?: boolean
}[] = [
  { id: 'Disabled', label: 'Disabled (default on most models)', blockedOnB20: true },
  { id: 'Compression', label: 'Compression' },
  { id: 'CompressionDeduplication', label: 'Compression + Deduplication (default on VSP One B20)' },
]

export const FS_TYPES = ['ext4', 'xfs'] as const

export const FIREWALL_DOMAINS = [
  { domain: 'github.com', purpose: 'Deployment manifests, Helm charts, release assets' },
  { domain: '*.githubusercontent.com', purpose: 'Raw YAML manifests from GitHub' },
  { domain: 'registry.hitachivantara.com', purpose: 'Hitachi CSI container images' },
  { domain: 'registry.k8s.io', purpose: 'Kubernetes CSI sidecar images' },
  { domain: '*.pkg.dev', purpose: 'Google Artifact Registry redirect for registry.k8s.io' },
  { domain: '*.amazonaws.com', purpose: 'AWS S3/ECR redirect for registry.k8s.io' },
  { domain: 'auth.docker.io', purpose: 'Docker Hub authentication' },
  { domain: 'registry-1.docker.io', purpose: 'Docker Hub registry' },
  { domain: '*.docker.com', purpose: 'Additional Docker Hub services' },
]

export const REQUIRED_LICENSES = [
  'Dynamic Provisioning (DP)',
  'Hitachi Thin Image (HTI)',
  'Hitachi Thin Image Advanced (HTIA) — VSP One Block only',
]

export const MULTIPATH_CONF = `defaults {
    polling_interval     10
    recheck_wwid         yes
    find_multipaths      yes
    user_friendly_names  yes
    flush_on_last_del    yes
}
blacklist {
}
devices {
    device {
        vendor                 "HITACHI"
        product                "OPEN-.*"
        path_grouping_policy   "multibus"
        path_selector          "round-robin 0"
        path_checker           "tur"
        features               "0"
        hardware_handler       "0"
        failback               "immediate"
        rr_weight              "priorities"
        no_path_retry          fail
        fast_io_fail_tmo       5
        dev_loss_tmo           30
        eh_deadline            10
    }
}
`

/** Immutable snapshots (retentionPeriod): VSP One Block 20 Series and High End (B85) only. */
export function supportsImmutableSnapshots(sys?: { family?: StorageFamily }): boolean {
  if (!sys) return false
  return sys.family === 'vsp-one-block-20' || sys.family === 'vsp-one-block-high-end'
}
