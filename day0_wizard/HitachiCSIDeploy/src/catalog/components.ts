/** Central component naming map — UI leads with plain-language names. */
export type ComponentId = 'driver' | 'replication' | 'metrics' | 'consolePlugin' | 'disasterRecovery'

export interface ComponentDef {
  id: ComponentId
  /** Primary display name used throughout the wizard UI */
  displayName: string
  /** Short blurb shown on the components step */
  description: string
  /** Legacy acronym (secondary only) */
  acronym?: string
  /** Folder under hitachi-vantara/csi-operator-hitachi */
  repoFolder?: 'hspc' | 'hrpc' | 'hspp'
  /** Only available on OpenShift */
  openshiftOnly?: boolean
  /** Always installed */
  required?: boolean
}

export const COMPONENTS: Record<ComponentId, ComponentDef> = {
  driver: {
    id: 'driver',
    displayName: 'CSI Driver',
    description:
      'Core Hitachi CSI driver that provisions and attaches volumes from Hitachi storage to pods and VMs.',
    acronym: 'HSPC',
    repoFolder: 'hspc',
    required: true,
  },
  replication: {
    id: 'replication',
    displayName: 'Replication + DR Operator',
    description:
      'Cross-cluster volume replication with the Disaster Recovery operator for policy-based failover and failback.',
    acronym: 'HRPC',
    repoFolder: 'hrpc',
  },
  disasterRecovery: {
    id: 'disasterRecovery',
    displayName: 'Disaster Recovery',
    description:
      'Included with Replication — policy-based automated failover and failback (DR Operator).',
    acronym: 'DR',
    repoFolder: 'hrpc',
  },
  metrics: {
    id: 'metrics',
    displayName: 'Performance Metrics',
    description:
      'Exposes storage and volume metrics for Prometheus, with optional Grafana dashboards for operational visibility.',
    acronym: 'HSPP',
    repoFolder: 'hspp',
  },
  consolePlugin: {
    id: 'consolePlugin',
    displayName: 'OpenShift Console Plugin',
    description:
      'Adds a Hitachi dashboard tab in the OpenShift web console for observability and single-click actions. Requires OpenShift.',
    openshiftOnly: true,
  },
}

export const REPO = {
  owner: 'hitachi-vantara',
  name: 'csi-operator-hitachi',
  branch: 'main',
  rawBase: 'https://raw.githubusercontent.com/hitachi-vantara/csi-operator-hitachi/main',
  apiBase: 'https://api.github.com/repos/hitachi-vantara/csi-operator-hitachi',
  githubUrl: 'https://github.com/hitachi-vantara/csi-operator-hitachi',
} as const

export const DOCS = {
  hspc: 'https://docs.hitachivantara.com/r/en-us/mk-92adptr142/latest',
  hrpc: 'https://docs.hitachivantara.com/r/en-us/mk-92adptr155/latest',
  hspp: 'https://docs.hitachivantara.com/r/en-us/mk-92adptr156/latest',
  compatibility: 'https://compatibility.hitachivantara.com/products/hspc',
  prometheusOverview: 'https://prometheus.io/docs/introduction/overview/',
  grafanaIntro: 'https://grafana.com/docs/grafana/latest/introduction/',
} as const
