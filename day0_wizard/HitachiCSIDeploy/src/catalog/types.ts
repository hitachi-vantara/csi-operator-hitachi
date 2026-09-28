import type { ComponentId } from './components'
import type {
  ConnectionType,
  NodeEnvironment,
  OpenShiftTopology,
  PlatformId,
  StorageClassKind,
  StorageEfficiency,
  StorageEfficiencyMode,
  StorageFamily,
} from './platforms'

export type {
  ComponentId,
  ConnectionType,
  NodeEnvironment,
  OpenShiftTopology,
  PlatformId,
  StorageClassKind,
  StorageEfficiency,
  StorageEfficiencyMode,
  StorageFamily,
}

export interface StorageSystemConfig {
  id: string
  name: string
  family?: StorageFamily
  serial: string
  url: string
  user: string
  password: string
  /** CSI Secret metadata.name for this array. Default hitachi-csi-secret. */
  csiSecretName?: string
  /** CSI Secret metadata.namespace. Empty = CSI Driver namespace. */
  csiSecretNamespace?: string
  hostModeOptions?: string
  resourceGroupID?: string
  alternativeCloneMode?: boolean
  /** For SDS Block multitenancy */
  multitenancy?: boolean
  /** Replication: this site’s array used by Replication (not a TrueCopy/UR copy pair) */
  hrpcPair?: boolean
  /** Role in stretched pair */
  stretchedRole?: 'primary' | 'secondary' | 'none'
}

export interface StorageClassConfig {
  id: string
  kind: StorageClassKind
  name: string
  connectionType: ConnectionType
  secretName: string
  secretNamespace: string
  /** StorageSystemConfig.id this class provisions from (standard / SDS). */
  storageSystemId?: string
  /** StorageSystemConfig.id for the primary array on this site (stretched / GAD). */
  primaryStorageSystemId?: string
  /** StorageSystemConfig.id for the secondary array on this site (stretched / GAD). */
  secondaryStorageSystemId?: string
  /** Cluster default StorageClass (at most one in the package) */
  isDefault?: boolean
  /** Replication: links the same StorageClass name/fstype across primary and secondary sites */
  hrpcPairId?: string
  serialNumber?: string
  poolID?: string
  portID?: string
  nvmSubsystemID?: string
  storageEfficiency?: StorageEfficiency
  storageEfficiencyMode?: StorageEfficiencyMode
  fstype?: string
  reclaimPolicy: 'Delete' | 'Retain'
  volumeBindingMode: 'Immediate' | 'WaitForFirstConsumer'
  allowVolumeExpansion: boolean
  // Stretched / GAD
  quorumID?: string
  copyGroupName?: string
  copyPairName?: string
  consistencyGroupId?: string
  primaryPoolID?: string
  primaryPortID?: string
  secondaryPoolID?: string
  secondaryPortID?: string
  /** Link to stretched secret name */
  stretchedSecretName?: string
  /** Optional GAD virtual storage machine serial on the stretched Secret */
  virtualStorageSerialNumber?: string
}

export type SiteId = 'primary' | 'secondary'

export interface SiteMetricsConfig {
  /** When false, this cluster's package omits 04-metrics/. Default true. */
  install: boolean
  namespace: string
  secretName: string
  deployPrometheus: boolean
  deployGrafana: boolean
  enableDebugLog: boolean
  maxBatchSize: string
  maxWorkerCount: string
  /** Empty = auto-resolve from this site's StorageClasses. */
  pvcStorageClassName: string
  existingPrometheusNamespace: string
  existingPrometheusService: string
  existingPrometheusPort: string
}

export interface SiteStorageConfig {
  storageSystems: StorageSystemConfig[]
  storageClasses: StorageClassConfig[]
  metrics?: SiteMetricsConfig
  quickstart?: SiteQuickstartConfig
}

export interface SnapshotClassConfig {
  enabled: boolean
  name: string
  deletionPolicy: 'Delete' | 'Retain'
  /** Cluster default VolumeSnapshotClass */
  isDefault?: boolean
  /**
   * Immutable snapshots via retentionPeriod (VSP One Block 20 Series / High End B85 only).
   */
  immutable: boolean
  /** Hours 1–12288 when immutable; emitted as parameters.retentionPeriod */
  retentionPeriod?: string
}

export type RemoteKubeconfigSource = 'wizard' | 'install-time'

export interface ReplicationConfig {
  enabled: boolean
  /** Always true when Replication is selected — DR Operator is part of the stack */
  disasterRecovery: boolean
  namespace: string
  /**
   * Optional beginner checklist toggle for resource partitioning requirements.
   * (Does not change generated manifests; guidance only.)
   */
  resourcePartitioningGuide?: boolean
  /** Acknowledged items on the resource partitioning checklist */
  resourcePartitioningAcknowledged?: Record<string, boolean>
  storageSecrets: {
    serial: string
    url: string
    user: string
    password: string
    journal: string
  }[]
  /** Upstream Secret name: hspc-replication-operator-remote-kubeconfig */
  remoteKubeconfigSecretName: string
  /** DR Operator Secret remote-kubeconfig data key for this site. Default primary */
  primaryClusterName: string
  /** DR Operator Secret remote-kubeconfig data key for this site. Default secondary */
  secondaryClusterName: string
  /**
   * Optional pasted kubeconfigs for assisted Secret generation.
   * Never persisted to localStorage (stripped on save).
   */
  primaryKubeconfig?: string
  secondaryKubeconfig?: string
  /**
   * How the two remote kubeconfig Secrets will be created.
   * Persist this choice (not the kubeconfig bytes). Unset on older saves.
   */
  remoteKubeconfigSource?: RemoteKubeconfigSource
}

export interface MetricsConfig {
  enabled: boolean
  namespace: string
  secretName: string
  deployPrometheus: boolean
  deployGrafana: boolean
  enableDebugLog: boolean
  maxBatchSize: string
  maxWorkerCount: string
  /** Empty = auto-resolve from this site's StorageClasses. */
  pvcStorageClassName: string
  storages: { serial: string; url: string; user: string; password: string }[]
}

export interface ConsolePluginConfig {
  enabled: boolean
  namespace: string
  prometheusNamespace: string
  prometheusService: string
  prometheusPort: string
}

export interface QuickstartConfig {
  pvcName: string
  pvcSize: string
  storageClassName: string
  podName: string
  accessMode: 'ReadWriteOnce' | 'ReadWriteMany' | 'ReadOnlyMany'
  volumeMode: 'Filesystem' | 'Block'
}

export interface SiteQuickstartConfig extends QuickstartConfig {
  /** When false, this cluster’s package omits 06-quickstart/. Default true. */
  install: boolean
}

export interface MultipathConfig {
  /** Include multipath artifacts in the export package */
  enabled: boolean
  /**
   * Kubernetes / RKE2 / EKS: include standalone multipath.conf in the export.
   * Always false on OpenShift / ROSA (conf is embedded in MachineConfig or DaemonSet).
   */
  includeConf: boolean
  /**
   * Classic OpenShift / ROSA only: generate MachineConfig wrapping the conf.
   * False on hosted/HCP and on Kubernetes / RKE2 / EKS.
   */
  includeMachineConfig: boolean
  /**
   * Hosted / HCP OpenShift / ROSA: generate DaemonSet wrapping the conf.
   * False on classic OpenShift and on Kubernetes / RKE2 / EKS.
   */
  includeDaemonSet: boolean
  /**
   * OpenShift / ROSA: user already applied multipath delivery (MachineConfig or DaemonSet).
   * install.sh skips apply when true or when the target objects already exist.
   */
  alreadyApplied: boolean
  machineConfigName: string
  machineConfigRole: 'worker' | 'master' | 'all'
  /** Optional override of the sample conf body; empty = use Hitachi sample */
  customConf: string
}

export interface OfflineConfig {
  registryBase: string
  /** Optional overrides; empty = derive from registryBase */
  hspcPath?: string
  hrpcPath?: string
  hsppPath?: string
  /** OpenShift/ROSA CatalogSource name; default certified-operators */
  catalogSourceName: string
  /** Optional mirrored index image for CatalogSource */
  catalogIndexImage: string
}

export interface WizardState {
  version: number
  platform: PlatformId
  platformVersion: string
  /**
   * OpenShift / ROSA control plane topology. Ignored for other platforms.
   * classic → MachineConfig; hosted → DaemonSet.
   */
  openshiftTopology: OpenShiftTopology
  /** Bare metal vs VM — restricts FC / NVMe-FC (guide server requirements) */
  nodeEnvironment: NodeEnvironment
  connectionType: ConnectionType
  airGapped: boolean
  offline: OfflineConfig
  components: {
    driver: boolean
    replication: boolean
    disasterRecovery: boolean
    metrics: boolean
    consolePlugin: boolean
  }
  versions: {
    driver: string
    replication: string
    metrics: string
  }
  driverNamespace: string
  /** For OpenShift OperatorHub path */
  operatorNamespace: string
  multipath: MultipathConfig
  storageSystems: StorageSystemConfig[]
  storageClasses: StorageClassConfig[]
  sites?: {
    primary: SiteStorageConfig
    secondary: SiteStorageConfig
  }
  /** When false, skip StorageClass / snapshot / quickstart generation and validation */
  storageClassesEnabled: boolean
  snapshotClass: SnapshotClassConfig
  replication: ReplicationConfig
  metrics: MetricsConfig
  consolePlugin: ConsolePluginConfig
  quickstart: QuickstartConfig
  /** Prerequisite checkboxes acknowledged */
  prereqAcknowledged: Record<string, boolean>
  /** Hitachi Telemetry (CSI Driver); default on, opt out via ConfigMap */
  telemetryEnabled: boolean
}

export const WIZARD_STATE_VERSION = 1
export const STORAGE_KEY = 'hitachi-csi-wizard-state'
/** One-shot: Replication jump focuses this Storage site tab */
export const STORAGE_SITE_FOCUS_KEY = 'hitachi-csi-wizard-storage-site'

export function createDefaultState(): WizardState {
  return {
    version: WIZARD_STATE_VERSION,
    platform: 'openshift',
    platformVersion: '4.22',
    openshiftTopology: 'classic',
    nodeEnvironment: 'bare-metal',
    connectionType: 'fc',
    airGapped: false,
    offline: {
      registryBase: '',
      catalogSourceName: 'certified-operators',
      catalogIndexImage: '',
    },
    components: {
      driver: true,
      replication: false,
      disasterRecovery: false,
      metrics: false,
      consolePlugin: false,
    },
    versions: {
      driver: 'v3.18.3',
      replication: 'v3.18.3',
      metrics: 'v3.18.3',
    },
    // OpenShift OperatorHub uses OwnNamespace — CR lives with the operator.
    // Kubernetes YAML samples place the driver in kube-system (see platform step).
    driverNamespace: 'hspc-operator-system',
    operatorNamespace: 'hspc-operator-system',
    multipath: {
      enabled: true,
      includeConf: false,
      includeMachineConfig: true,
      includeDaemonSet: false,
      alreadyApplied: false,
      machineConfigName: 'hitachi-csi-multipath',
      machineConfigRole: 'worker',
      customConf: '',
    },
    storageSystems: [
      {
        id: 'storage-1',
        name: 'primary',
        serial: '',
        url: '',
        user: '',
        password: '',
        csiSecretName: 'hitachi-csi-secret',
        csiSecretNamespace: '',
        stretchedRole: 'none',
      },
    ],
    storageClasses: [
      {
        id: 'sc-1',
        kind: 'standard',
        name: 'hitachi-csi',
        connectionType: 'fc',
        secretName: 'hitachi-csi-secret',
        secretNamespace: 'hspc-operator-system',
        storageSystemId: 'storage-1',
        serialNumber: '',
        poolID: '',
        portID: '',
        storageEfficiency: 'Disabled',
        fstype: 'ext4',
        reclaimPolicy: 'Delete',
        volumeBindingMode: 'Immediate',
        allowVolumeExpansion: true,
      },
    ],
    storageClassesEnabled: true,
    snapshotClass: {
      enabled: true,
      name: 'hitachi-csi-snapshot',
      deletionPolicy: 'Delete',
      isDefault: false,
      immutable: false,
      retentionPeriod: '24',
    },
    replication: {
      enabled: false,
      disasterRecovery: false,
      namespace: 'hspc-replication-operator-system',
      storageSecrets: [],
      remoteKubeconfigSecretName: 'hspc-replication-operator-remote-kubeconfig',
      primaryClusterName: 'primary',
      secondaryClusterName: 'secondary',
    },
    metrics: {
      enabled: false,
      namespace: 'hspc-monitoring-system',
      secretName: 'storage-exporter-secret',
      deployPrometheus: true,
      deployGrafana: true,
      enableDebugLog: true,
      maxBatchSize: '10',
      maxWorkerCount: '10',
      pvcStorageClassName: '',
      storages: [],
    },
    consolePlugin: {
      enabled: false,
      namespace: 'vsp360-dcm',
      prometheusNamespace: 'hspc-monitoring-system',
      prometheusService: 'prometheus',
      prometheusPort: '9090',
    },
    quickstart: {
      pvcName: 'hitachi-csi-test-pvc',
      pvcSize: '1Gi',
      storageClassName: 'hitachi-csi',
      podName: 'hitachi-csi-test-pod',
      accessMode: 'ReadWriteOnce',
      volumeMode: 'Filesystem',
    },
    prereqAcknowledged: {},
    telemetryEnabled: true,
  }
}
