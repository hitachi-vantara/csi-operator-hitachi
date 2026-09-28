/**
 * Parameter catalog curated from:
 * - Storage Plug-in for Containers Installation and User Guide (MK-92ADPTR142-31)
 * - Replication Plug-in for Containers Installation and User Guide (MK-92ADPTR155-10)
 * - Storage Plug-in for Prometheus Installation and User Guide (MK-92ADPTR156-08)
 * - Sample YAMLs in hitachi-vantara/csi-operator-hitachi
 *
 * See catalog-notes.md for section mapping.
 */

export interface FieldDef {
  key: string
  label: string
  description: string
  required?: boolean
  optional?: boolean
  type: 'string' | 'password' | 'select' | 'boolean' | 'number' | 'textarea'
  options?: { value: string; label: string }[]
  defaultValue?: string | boolean | number
  placeholder?: string
  /** When this field is shown */
  when?: string
  docNote?: string
}

export const SECRET_FIELDS_STANDARD: FieldDef[] = [
  {
    key: 'url',
    label: 'Storage REST URL',
    description:
      'Controller / SVP URL. Use service IP for VSP One Block 20 Series and High End (B85). Port 80 or 443. IPv4 only.',
    required: true,
    type: 'string',
    placeholder: 'https://172.16.1.1',
  },
  {
    key: 'user',
    label: 'Username',
    description:
      'Built-in Storage Administrator (View & Modify) or equivalent custom role. For SDS Block with multitenancy use VpsStorage role.',
    required: true,
    type: 'string',
    placeholder: 'User01',
  },
  {
    key: 'password',
    label: 'Password',
    description: 'Storage user password (encoded into the Secret).',
    required: true,
    type: 'password',
  },
  {
    key: 'hostModeOptions',
    label: 'Host mode options',
    description:
      'Comma-separated host mode options. Defaults applied by the driver: 2, 22, 25, 68, 91. Specify only additional options.',
    optional: true,
    type: 'string',
    placeholder: '88,81',
  },
  {
    key: 'resourceGroupID',
    label: 'Resource group ID',
    description: 'Required only if the user can access multiple resource groups.',
    optional: true,
    type: 'string',
  },
  {
    key: 'alternativeCloneMode',
    label: 'Alternative clone mode',
    description:
      'On, CSI creates a hidden parent volume and a child volume for every new volume so VMs from templates and cloned volumes can grow. The workload uses the child volume. CSI expands the parent volume first, then the child volume, and deletes the parent volume when you delete the child. About twice the pool space: 100 Gi needs about 200 Gi free. VSP One Block High End (B85) and 20 Series only.',
    optional: true,
    type: 'boolean',
    defaultValue: false,
  },
]

export const SECRET_FIELDS_STRETCHED: FieldDef[] = [
  { key: 'primarySerial', label: 'Primary serial', description: 'Primary storage serial number', required: true, type: 'string' },
  { key: 'primaryURL', label: 'Primary REST URL', description: 'Primary storage REST endpoint', required: true, type: 'string', placeholder: 'http://172.16.0.1' },
  { key: 'primaryUser', label: 'Primary username', description: 'Primary storage user', required: true, type: 'string' },
  { key: 'primaryPassword', label: 'Primary password', description: 'Primary storage password', required: true, type: 'password' },
  { key: 'secondarySerial', label: 'Secondary serial', description: 'Secondary storage serial number', required: true, type: 'string' },
  { key: 'secondaryURL', label: 'Secondary REST URL', description: 'Secondary storage REST endpoint', required: true, type: 'string', placeholder: 'http://172.16.0.2' },
  { key: 'secondaryUser', label: 'Secondary username', description: 'Secondary storage user', required: true, type: 'string' },
  { key: 'secondaryPassword', label: 'Secondary password', description: 'Secondary storage password', required: true, type: 'password' },
  {
    key: 'virtualStorageSerialNumber',
    label: 'Virtual storage serial',
    description: 'Optional GAD virtual storage machine serial. Same value at both arrays. Use a new stretched Secret for a different VSM.',
    optional: true,
    type: 'string',
  },
]

export const SC_FIELDS_STANDARD: FieldDef[] = [
  { key: 'name', label: 'StorageClass name', description: 'Kubernetes StorageClass metadata.name', required: true, type: 'string', defaultValue: 'hitachi-csi' },
  { key: 'serialNumber', label: 'Serial number', description: 'Storage system serial number', required: true, type: 'string' },
  { key: 'poolID', label: 'Pool ID', description: 'HDP pool ID for dynamic provisioning', required: true, type: 'string' },
  {
    key: 'portID',
    label: 'Port ID(s)',
    description: 'Comma-separated ports for multipath (e.g. CL1-A,CL2-A). Not required for NVMe connections.',
    required: true,
    type: 'string',
    placeholder: 'CL1-A,CL2-A',
    when: 'needsPortId',
  },
  {
    key: 'nvmSubsystemID',
    label: 'NVMe subsystem ID',
    description: 'Required when connectionType is nvme-fc or nvme-tcp.',
    required: true,
    type: 'string',
    when: 'needsNvmSubsystem',
  },
  {
    key: 'storageEfficiency',
    label: 'Storage efficiency',
    description: 'Adaptive data reduction. VSP One Block 20 Series does not support Disabled (default CompressionDeduplication).',
    optional: true,
    type: 'select',
    options: [
      { value: 'Disabled', label: 'Disabled' },
      { value: 'Compression', label: 'Compression' },
      { value: 'CompressionDeduplication', label: 'Compression + Deduplication' },
    ],
    defaultValue: 'Disabled',
  },
  {
    key: 'storageEfficiencyMode',
    label: 'Efficiency mode',
    description: 'Inline or PostProcess. Only when storageEfficiency is Compression or CompressionDeduplication.',
    optional: true,
    type: 'select',
    options: [
      { value: 'Inline', label: 'Inline' },
      { value: 'PostProcess', label: 'PostProcess' },
    ],
    when: 'efficiencyEnabled',
  },
  {
    key: 'fstype',
    label: 'Filesystem type',
    description: 'ext4 (default) or xfs. Ignored for raw block volumeMode.',
    optional: true,
    type: 'select',
    options: [
      { value: 'ext4', label: 'ext4' },
      { value: 'xfs', label: 'xfs' },
    ],
    defaultValue: 'ext4',
  },
  {
    key: 'reclaimPolicy',
    label: 'Reclaim policy',
    description: 'What happens to the volume when the PVC is deleted.',
    type: 'select',
    options: [
      { value: 'Delete', label: 'Delete' },
      { value: 'Retain', label: 'Retain' },
    ],
    defaultValue: 'Delete',
  },
  {
    key: 'volumeBindingMode',
    label: 'Volume binding mode',
    description: 'Immediate or WaitForFirstConsumer.',
    type: 'select',
    options: [
      { value: 'Immediate', label: 'Immediate' },
      { value: 'WaitForFirstConsumer', label: 'WaitForFirstConsumer' },
    ],
    defaultValue: 'Immediate',
  },
  {
    key: 'allowVolumeExpansion',
    label: 'Allow volume expansion',
    description: 'Must be false for stretched StorageClasses.',
    type: 'boolean',
    defaultValue: true,
  },
]

export const SC_FIELDS_STRETCHED: FieldDef[] = [
  { key: 'name', label: 'StorageClass name', description: 'Kubernetes StorageClass metadata.name', required: true, type: 'string', defaultValue: 'hitachi-csi-stretched' },
  { key: 'quorumID', label: 'Quorum ID', description: 'Quorum disk ID for GAD', required: true, type: 'string' },
  { key: 'copyGroupName', label: 'Copy group name', description: 'Must start with spc, 1–29 characters', required: true, type: 'string', defaultValue: 'spc-cpg1' },
  { key: 'copyPairName', label: 'Copy pair name', description: 'Optional. Must start with spc, 1–31 characters. One GAD pair per StorageClass.', optional: true, type: 'string' },
  { key: 'consistencyGroupId', label: 'Consistency group ID', description: 'Decimal consistency group ID', required: true, type: 'string', defaultValue: '1' },
  { key: 'primaryPoolID', label: 'Primary pool ID', description: 'Pool on the primary array', required: true, type: 'string' },
  { key: 'primaryPortID', label: 'Primary port ID(s)', description: 'Comma-separated primary ports', required: true, type: 'string', placeholder: 'CL1-A,CL2-A' },
  { key: 'secondaryPoolID', label: 'Secondary pool ID', description: 'Pool on the secondary array', required: true, type: 'string' },
  { key: 'secondaryPortID', label: 'Secondary port ID(s)', description: 'Comma-separated secondary ports', required: true, type: 'string', placeholder: 'CL1-F' },
  {
    key: 'virtualStorageSerialNumber',
    label: 'Virtual storage serial',
    description: 'Optional GAD VSM serial on the stretched Secret. Same at both arrays. New Secret for a different VSM.',
    optional: true,
    type: 'string',
  },
]

export const SC_FIELDS_SDS: FieldDef[] = [
  { key: 'name', label: 'StorageClass name', description: 'Kubernetes StorageClass metadata.name', required: true, type: 'string', defaultValue: 'hitachi-csi-sds' },
  {
    key: 'storageEfficiency',
    label: 'Storage efficiency',
    description: 'Compression or Disabled. Cannot be set when multitenancy/VPS is enabled (follows VPS settings).',
    optional: true,
    type: 'select',
    options: [
      { value: 'Disabled', label: 'Disabled' },
      { value: 'Compression', label: 'Compression' },
    ],
    defaultValue: 'Disabled',
  },
  {
    key: 'fstype',
    label: 'Filesystem type',
    description: 'ext4 (default) or xfs.',
    optional: true,
    type: 'select',
    options: [
      { value: 'ext4', label: 'ext4' },
      { value: 'xfs', label: 'xfs' },
    ],
    defaultValue: 'ext4',
  },
]

export const METRICS_ENV_FIELDS: FieldDef[] = [
  {
    key: 'SPC_ENABLE_DEBUG_LOG',
    label: 'Enable debug log',
    description: 'Set false to reduce log volume.',
    type: 'boolean',
    defaultValue: true,
  },
  {
    key: 'MAX_BATCH_SIZE',
    label: 'Max batch size',
    description: 'Increasing batch size or worker count may raise memory use.',
    type: 'string',
    defaultValue: '10',
  },
  {
    key: 'MAX_WORKER_COUNT',
    label: 'Max worker count',
    description: 'Parallel workers for metric collection.',
    type: 'string',
    defaultValue: '10',
  },
]
