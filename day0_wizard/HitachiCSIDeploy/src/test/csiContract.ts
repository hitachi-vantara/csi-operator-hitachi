import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import {
  SC_FIELDS_SDS,
  SC_FIELDS_STANDARD,
  SC_FIELDS_STRETCHED,
  SECRET_FIELDS_STANDARD,
  SECRET_FIELDS_STRETCHED,
} from '../catalog/parameters'
import { CONNECTION_TYPES, supportsCsiVolumeSnapshots } from '../catalog/platforms'
import { resolvedReplicationStorageSecrets } from '../catalog/replicationSecrets'
import { getSiteStorage } from '../catalog/sites'
import { csiSecretRefForSystem, gadArraysForStorageClass } from '../catalog/arrayBinding'
import type { StorageClassConfig, StorageClassKind, StorageSystemConfig, WizardState } from '../catalog/types'
import { effectiveSerialNumber, normalizePortId } from '../catalog/validation'
import { resolvedDrClusterNames } from '../generator/remoteKubeconfig'
import { snapshotClassOpts } from '../generator/yaml'

export const UPSTREAM_SAMPLE_VERSION = 'v3.18.3'

export const CATALOG_ONLY_KEYS: Record<string, string> = {
  nvmSubsystemID: 'NVMe StorageClass; not in sc-sample.yaml',
  storageEfficiency: 'optional; not in sc-sample.yaml',
  storageEfficiencyMode: 'optional; not in sc-sample.yaml',
  copyPairName: 'optional stretched; not in sc-sample-stretched.yaml',
  retentionPeriod: 'immutable snapshots; not in volumesnapshotclass-sample.yaml',
  resourceGroupID: 'optional; not in secret-sample.yaml',
}

export const SECRET_PORT_MIGRATION_KEYS = [
  'portID',
  'portIP',
  'primaryPortID',
  'secondaryPortID',
  'primaryPortIP',
  'secondaryPortIP',
] as const

const CSI_PARAM_KEYS = [
  'csi.storage.k8s.io/fstype',
  'csi.storage.k8s.io/node-publish-secret-name',
  'csi.storage.k8s.io/node-publish-secret-namespace',
  'csi.storage.k8s.io/provisioner-secret-name',
  'csi.storage.k8s.io/provisioner-secret-namespace',
  'csi.storage.k8s.io/controller-publish-secret-name',
  'csi.storage.k8s.io/controller-publish-secret-namespace',
  'csi.storage.k8s.io/node-stage-secret-name',
  'csi.storage.k8s.io/node-stage-secret-namespace',
  'csi.storage.k8s.io/controller-expand-secret-name',
  'csi.storage.k8s.io/controller-expand-secret-namespace',
] as const

const samplesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  'upstream-samples',
  UPSTREAM_SAMPLE_VERSION,
)

const SAMPLE_FOR_KIND: Record<StorageClassKind, string> = {
  standard: 'sc-sample.yaml',
  stretched: 'sc-sample-stretched.yaml',
  'stretched-adr': 'sc-sample-stretched-adr.yaml',
  'vsp-one-sds-block': 'sc-sample-vsp-one-sds-block.yaml',
}

const UI_ONLY_SC_KEYS = new Set([
  'name',
  'reclaimPolicy',
  'volumeBindingMode',
  'allowVolumeExpansion',
  'virtualStorageSerialNumber',
])

export function sampleParameterKeys(sampleFile: string): string[] {
  const doc = parse(readFileSync(join(samplesDir, sampleFile), 'utf8')) as {
    parameters?: Record<string, unknown>
  }
  return Object.keys(doc.parameters ?? {})
}

function catalogKeyInSample(catalogKey: string, sampleKeys: string[]): boolean {
  if (catalogKey === 'fstype') return sampleKeys.includes('csi.storage.k8s.io/fstype')
  return sampleKeys.includes(catalogKey)
}

function missingCatalogKeysFromSample(
  label: string,
  fields: { key: string }[],
  sampleFile: string,
): string[] {
  const sampleKeys = sampleParameterKeys(sampleFile)
  const missing: string[] = []
  for (const field of fields) {
    const key = field.key
    if (UI_ONLY_SC_KEYS.has(key)) continue
    if (CATALOG_ONLY_KEYS[key]) continue
    if (!catalogKeyInSample(key, sampleKeys)) missing.push(`${label}: ${key}`)
  }
  return missing
}

function missingSecretCatalogKeys(
  label: string,
  fields: { key: string }[],
  sampleFile: string,
): string[] {
  const sample = parse(readFileSync(join(samplesDir, sampleFile), 'utf8')) as {
    data?: Record<string, string>
    stringData?: Record<string, string>
  }
  const sampleKeys = secretKeys(sample)
  const missing: string[] = []
  for (const field of fields) {
    const key = field.key
    if (CATALOG_ONLY_KEYS[key]) continue
    if (!sampleKeys.includes(key)) missing.push(`${label}: ${key}`)
  }
  return missing
}

export function catalogKeysMissingFromSamples(): string[] {
  return [
    ...missingCatalogKeysFromSample('standard SC', SC_FIELDS_STANDARD, 'sc-sample.yaml'),
    ...missingCatalogKeysFromSample('stretched SC', SC_FIELDS_STRETCHED, 'sc-sample-stretched.yaml'),
    ...missingCatalogKeysFromSample(
      'stretched-adr SC',
      SC_FIELDS_STRETCHED,
      'sc-sample-stretched-adr.yaml',
    ),
    ...missingCatalogKeysFromSample(
      'SDS SC',
      SC_FIELDS_SDS,
      'sc-sample-vsp-one-sds-block.yaml',
    ),
    ...missingSecretCatalogKeys('standard Secret', SECRET_FIELDS_STANDARD, 'secret-sample.yaml'),
    ...missingSecretCatalogKeys(
      'stretched Secret',
      SECRET_FIELDS_STRETCHED,
      'secret-sample-stretched.yaml',
    ),
  ]
}

function catalogParameterKeys(kind: StorageClassKind): string[] {
  const fields =
    kind === 'vsp-one-sds-block'
      ? SC_FIELDS_SDS
      : kind === 'stretched' || kind === 'stretched-adr'
        ? SC_FIELDS_STRETCHED
        : SC_FIELDS_STANDARD
  return fields.map((field) => field.key).filter((key) => !UI_ONLY_SC_KEYS.has(key))
}

export function allowedStorageClassParameterKeys(kind: StorageClassKind): Set<string> {
  const keys = new Set<string>([
    ...sampleParameterKeys(SAMPLE_FOR_KIND[kind]),
    ...catalogParameterKeys(kind),
    ...Object.keys(CATALOG_ONLY_KEYS),
    ...CSI_PARAM_KEYS,
  ])
  if (kind === 'vsp-one-sds-block') keys.add('storageType')
  if (kind === 'stretched' || kind === 'stretched-adr') keys.add('replicationType')
  keys.add('connectionType')
  if (catalogParameterKeys(kind).includes('fstype') || kind === 'vsp-one-sds-block') {
    keys.add('csi.storage.k8s.io/fstype')
  }
  return keys
}

export function assertAllowedKeys(path: string, emitted: string[], allowed: Set<string>): void {
  for (const key of emitted) {
    if (!allowed.has(key)) {
      throw new Error(`${path}: unknown parameter "${key}" (not in sample or catalog)`)
    }
  }
}

export function requiredStorageClassParameterKeys(sc: StorageClassConfig): string[] {
  if (sc.kind === 'vsp-one-sds-block') return ['storageType', 'connectionType']
  if (sc.kind === 'stretched' || sc.kind === 'stretched-adr') {
    const fromCatalog = SC_FIELDS_STRETCHED.filter((field) => field.required)
      .map((field) => field.key)
      .filter((key) => key !== 'name' && key !== 'virtualStorageSerialNumber')
    return ['connectionType', 'replicationType', ...fromCatalog]
  }
  const conn = CONNECTION_TYPES.find((item) => item.id === sc.connectionType)
  const keys = ['connectionType', 'serialNumber', 'poolID']
  if (conn?.needsPortId) keys.push('portID')
  if (conn?.needsNvmSubsystem) keys.push('nvmSubsystemID')
  return keys
}

export function forbiddenStorageClassParameterKeys(sc: StorageClassConfig): string[] {
  const stretchedKeys = [
    'replicationType',
    'quorumID',
    'copyGroupName',
    'consistencyGroupId',
    'primaryPoolID',
    'primaryPortID',
    'secondaryPoolID',
    'secondaryPortID',
  ]
  if (sc.kind === 'vsp-one-sds-block') {
    return ['serialNumber', 'poolID', 'portID', 'nvmSubsystemID', ...stretchedKeys]
  }
  if (sc.kind === 'stretched' || sc.kind === 'stretched-adr') {
    return ['serialNumber', 'poolID', 'portID', 'nvmSubsystemID', 'storageType']
  }
  const conn = CONNECTION_TYPES.find((item) => item.id === sc.connectionType)
  const keys = ['storageType', ...stretchedKeys]
  if (conn?.needsPortId) keys.push('nvmSubsystemID')
  if (conn?.needsNvmSubsystem) keys.push('portID')
  return keys
}

export function assertRequiredKeys(
  path: string,
  params: Record<string, unknown>,
  required: string[],
  reason = 'this StorageClass',
): void {
  for (const key of required) {
    const value = params[key]
    if (value === undefined || value === null || String(value).trim() === '') {
      throw new Error(`${path}: ${reason} requires ${key}`)
    }
  }
}

export function assertForbiddenKeys(
  path: string,
  params: Record<string, unknown>,
  forbidden: string[],
  reason: string,
): void {
  for (const key of forbidden) {
    if (params[key] !== undefined) {
      throw new Error(`${path}: ${reason} must not emit ${key}`)
    }
  }
}

export function secretKeys(doc: {
  data?: Record<string, string>
  stringData?: Record<string, string>
}): string[] {
  return [...Object.keys(doc.data ?? {}), ...Object.keys(doc.stringData ?? {})]
}

export function allowedSecretKeys(kind: 'standard' | 'stretched'): Set<string> {
  const fields = kind === 'stretched' ? SECRET_FIELDS_STRETCHED : SECRET_FIELDS_STANDARD
  const fromCatalog = fields.map((field) => field.key)
  const sampleFile = kind === 'stretched' ? 'secret-sample-stretched.yaml' : 'secret-sample.yaml'
  const sample = parse(readFileSync(join(samplesDir, sampleFile), 'utf8')) as {
    data?: Record<string, string>
    stringData?: Record<string, string>
  }
  return new Set([...fromCatalog, ...secretKeys(sample)])
}

export function assertNoPortMigrationSecretKeys(path: string, keys: string[]): void {
  for (const key of keys) {
    if ((SECRET_PORT_MIGRATION_KEYS as readonly string[]).includes(key)) {
      throw new Error(`${path}: Secret must not emit port-migration key "${key}"`)
    }
  }
}

function decodeSecretValue(
  doc: { data?: Record<string, string>; stringData?: Record<string, string> },
  key: string,
): string | undefined {
  if (doc.stringData?.[key] !== undefined) return doc.stringData[key]
  if (doc.data?.[key] !== undefined) {
    return Buffer.from(doc.data[key], 'base64').toString('utf8')
  }
  return undefined
}

const PASSWORD_KEYS = new Set(['password', 'primaryPassword', 'secondaryPassword'])

export function assertSecretCoherence(
  path: string,
  doc: { data?: Record<string, string>; stringData?: Record<string, string> },
  expected: Record<string, string>,
): void {
  for (const [key, want] of Object.entries(expected)) {
    const actual = decodeSecretValue(doc, key)
    if (actual !== want) {
      if (PASSWORD_KEYS.has(key)) {
        throw new Error(`${path}: ${key} does not match wizard state`)
      }
      throw new Error(`${path}: ${key} "${actual ?? ''}" !== wizard state`)
    }
  }
}

export function assertSecretEmittedKeys(
  path: string,
  keys: string[],
  kind: 'standard' | 'stretched',
): void {
  const catalog = new Set(
    (kind === 'stretched' ? SECRET_FIELDS_STRETCHED : SECRET_FIELDS_STANDARD).map(
      (field) => field.key,
    ),
  )
  for (const key of keys) {
    if (!catalog.has(key)) {
      throw new Error(`${path}: unknown parameter "${key}" (not in sample or catalog)`)
    }
  }
  assertNoPortMigrationSecretKeys(path, keys)
}

const CSI_PATH =
  /^(?:primary\/|secondary\/)?(?:01-storage\/(?:storageclass-|secret-|volumesnapshotclass-).*|02-driver\/hspc-cr\.yaml|03-replication\/(?:storage-secrets\.yaml|remote-kubeconfig\.yaml|remote-kubeconfig-.+\.yaml))$/

function paramStr(value: unknown): string {
  if (value === undefined || value === null) return ''
  return String(value)
}

function selectionReason(sc: StorageClassConfig): string {
  if (sc.kind === 'vsp-one-sds-block') return 'SDS Block'
  if (sc.kind === 'stretched' || sc.kind === 'stretched-adr') return 'stretched StorageClass'
  return CONNECTION_TYPES.find((item) => item.id === sc.connectionType)?.label ?? sc.connectionType
}

function expectedStandardSecretName(sys: StorageSystemConfig): string {
  return csiSecretRefForSystem(sys, '').name
}

function inferStorageClassKind(
  params: Record<string, unknown>,
  sc: StorageClassConfig,
): StorageClassKind {
  if (paramStr(params.storageType) === 'vsp-one-sds-block') return 'vsp-one-sds-block'
  if (paramStr(params.replicationType) === 'stretched') {
    return sc.kind === 'stretched-adr' ? 'stretched-adr' : 'stretched'
  }
  return sc.kind
}

function storageForPath(
  state: WizardState,
  path: string,
): { systems: StorageSystemConfig[]; classes: StorageClassConfig[] } {
  if (path.startsWith('primary/') || path.startsWith('secondary/')) {
    const site = path.startsWith('primary/') ? 'primary' : 'secondary'
    const storage = getSiteStorage(state, site)
    return { systems: storage.storageSystems, classes: storage.storageClasses }
  }
  return { systems: state.storageSystems, classes: state.storageClasses }
}

function assertStorageClassFile(
  path: string,
  content: string,
  classes: StorageClassConfig[],
  systems: StorageSystemConfig[],
): void {
  const doc = parse(content) as {
    metadata?: { name?: string }
    allowVolumeExpansion?: boolean
    parameters?: Record<string, unknown>
  }
  const name = doc.metadata?.name || ''
  const sc = classes.find((item) => item.name === name)
  if (!sc) {
    throw new Error(`${path}: StorageClass "${name}" is not in wizard state`)
  }
  const params = doc.parameters ?? {}
  const kind = inferStorageClassKind(params, sc)
  const scForRules: StorageClassConfig = { ...sc, kind }
  assertAllowedKeys(path, Object.keys(params), allowedStorageClassParameterKeys(kind))
  const reason = selectionReason(scForRules)
  assertRequiredKeys(path, params, requiredStorageClassParameterKeys(scForRules), reason)
  assertForbiddenKeys(path, params, forbiddenStorageClassParameterKeys(scForRules), reason)

  if (kind === 'stretched' || kind === 'stretched-adr') {
    if (doc.allowVolumeExpansion !== false) {
      throw new Error(`${path}: stretched StorageClass must set allowVolumeExpansion false`)
    }
    if (params['csi.storage.k8s.io/controller-expand-secret-name'] !== undefined) {
      throw new Error(`${path}: stretched StorageClass must not emit controller-expand secret refs`)
    }
    const expected: Record<string, string> = {
      connectionType: sc.connectionType,
      replicationType: 'stretched',
      quorumID: sc.quorumID || '',
      copyGroupName: sc.copyGroupName || '',
      consistencyGroupId: sc.consistencyGroupId || '',
      primaryPoolID: sc.primaryPoolID || '',
      primaryPortID: normalizePortId(sc.primaryPortID) || '',
      secondaryPoolID: sc.secondaryPoolID || '',
      secondaryPortID: normalizePortId(sc.secondaryPortID) || '',
    }
    if (sc.copyPairName) expected.copyPairName = sc.copyPairName
    for (const [key, want] of Object.entries(expected)) {
      const actual = paramStr(params[key])
      if (actual !== want) {
        throw new Error(`${path}: ${key} "${actual}" !== wizard state`)
      }
    }
    return
  }

  if (kind === 'vsp-one-sds-block') {
    if (paramStr(params.storageType) !== 'vsp-one-sds-block') {
      throw new Error(`${path}: storageType "${paramStr(params.storageType)}" !== wizard state`)
    }
    if (paramStr(params.connectionType) !== sc.connectionType) {
      throw new Error(`${path}: connectionType "${paramStr(params.connectionType)}" !== wizard state`)
    }
    return
  }

  const expectedSerial = effectiveSerialNumber(sc, systems)
  if (expectedSerial && paramStr(params.serialNumber) !== expectedSerial) {
    throw new Error(`${path}: serialNumber "${paramStr(params.serialNumber)}" !== wizard state`)
  }
  if (sc.poolID && paramStr(params.poolID) !== sc.poolID) {
    throw new Error(`${path}: poolID "${paramStr(params.poolID)}" !== wizard state`)
  }
  if (sc.portID && paramStr(params.portID) !== normalizePortId(sc.portID)) {
    throw new Error(`${path}: portID "${paramStr(params.portID)}" !== wizard state`)
  }
  if (sc.nvmSubsystemID && paramStr(params.nvmSubsystemID) !== sc.nvmSubsystemID) {
    throw new Error(`${path}: nvmSubsystemID "${paramStr(params.nvmSubsystemID)}" !== wizard state`)
  }
  if (paramStr(params.connectionType) !== sc.connectionType) {
    throw new Error(`${path}: connectionType "${paramStr(params.connectionType)}" !== wizard state`)
  }
}

function assertSecretFile(
  path: string,
  content: string,
  systems: StorageSystemConfig[],
  classes: StorageClassConfig[],
): void {
  const doc = parse(content) as {
    metadata?: { name?: string }
    data?: Record<string, string>
    stringData?: Record<string, string>
  }
  const keys = secretKeys(doc)
  const stretched = doc.stringData?.primarySerial !== undefined
  if (stretched) {
    assertSecretEmittedKeys(path, keys, 'stretched')
    const secretName = (doc.metadata?.name || '').trim()
    const sc = classes.find((c) => {
      if (c.kind !== 'stretched' && c.kind !== 'stretched-adr') return false
      const expectedName = (c.stretchedSecretName || 'hitachi-csi-secret-stretched').trim()
      return expectedName === secretName
    })
    if (!sc) {
      throw new Error(`${path}: no stretched StorageClass in wizard state for Secret "${secretName}"`)
    }
    const pair = gadArraysForStorageClass(sc, systems)
    if (!pair.primary || !pair.secondary) {
      throw new Error(`${path}: stretched Secret generated without selected arrays in wizard state`)
    }
    const expected: Record<string, string> = {
      primarySerial: pair.primary.serial,
      primaryURL: pair.primary.url,
      primaryUser: pair.primary.user,
      primaryPassword: pair.primary.password,
      secondarySerial: pair.secondary.serial,
      secondaryURL: pair.secondary.url,
      secondaryUser: pair.secondary.user,
      secondaryPassword: pair.secondary.password,
    }
    if (sc.virtualStorageSerialNumber) {
      expected.virtualStorageSerialNumber = sc.virtualStorageSerialNumber
    }
    assertSecretCoherence(path, doc, expected)
    return
  }
  assertSecretEmittedKeys(path, keys, 'standard')
  const secretName = doc.metadata?.name || ''
  const sys = systems.find((item) => expectedStandardSecretName(item) === secretName)
  if (!sys) {
    throw new Error(`${path}: no storage system in wizard state for Secret "${secretName}"`)
  }
  assertSecretCoherence(path, doc, {
    url: sys.url,
    user: sys.user,
    password: sys.password,
  })
}

function assertSnapshotFile(path: string, content: string, state: WizardState): void {
  const doc = parse(content) as {
    driver?: string
    parameters?: Record<string, unknown>
  }
  if (doc.driver !== 'hspc.csi.hitachi.com') {
    throw new Error(`${path}: driver "${doc.driver ?? ''}" !== wizard state`)
  }
  const params = doc.parameters ?? {}
  const allowed = new Set([
    ...sampleParameterKeys('volumesnapshotclass-sample.yaml'),
    ...sampleParameterKeys('volumesnapshotclass-immutable-sample.yaml'),
    'retentionPeriod',
  ])
  assertAllowedKeys(path, Object.keys(params), allowed)
  const opts = snapshotClassOpts(state)
  assertRequiredKeys(
    path,
    params,
    [
      'poolID',
      'csi.storage.k8s.io/snapshotter-secret-name',
      'csi.storage.k8s.io/snapshotter-secret-namespace',
    ],
    'VolumeSnapshotClass',
  )
  const { poolID } = opts
  if (poolID && paramStr(params.poolID) !== poolID) {
    throw new Error(`${path}: poolID "${paramStr(params.poolID)}" !== wizard state`)
  }
}

function assertHspcCr(path: string, content: string, state: WizardState): void {
  const doc = parse(content) as {
    apiVersion?: string
    kind?: string
    metadata?: { name?: string; namespace?: string }
    spec?: Record<string, unknown>
  }
  if (doc.apiVersion !== 'csi.hitachi.com/v1') {
    throw new Error(`${path}: apiVersion "${doc.apiVersion ?? ''}" !== wizard state`)
  }
  if (doc.kind !== 'HSPC') {
    throw new Error(`${path}: kind "${doc.kind ?? ''}" !== wizard state`)
  }
  if (doc.metadata?.name !== 'hspc') {
    throw new Error(`${path}: metadata.name "${doc.metadata?.name ?? ''}" !== wizard state`)
  }
  if (doc.metadata?.namespace !== state.driverNamespace) {
    throw new Error(
      `${path}: namespace "${doc.metadata?.namespace ?? ''}" !== wizard state`,
    )
  }
  const sample = parse(readFileSync(join(samplesDir, 'hspc_v1_hspc.yaml'), 'utf8')) as {
    spec?: Record<string, unknown>
  }
  const allowedSpec = new Set(Object.keys(sample.spec ?? {}))
  for (const key of Object.keys(doc.spec ?? {})) {
    if (!allowedSpec.has(key)) {
      throw new Error(`${path}: unknown parameter "${key}" (not in sample or catalog)`)
    }
  }
}

function assertHrpcStorageSecrets(path: string, content: string, state: WizardState): void {
  const doc = parse(content) as {
    metadata?: { name?: string }
    stringData?: Record<string, string>
  }
  if (doc.metadata?.name !== 'hspc-replication-operator-storage-secrets') {
    throw new Error(
      `${path}: metadata.name "${doc.metadata?.name ?? ''}" !== wizard state`,
    )
  }
  const inner = parse(String(doc.stringData?.['storage-secrets.yaml'] ?? '')) as {
    storages?: Array<{ serial?: string; url?: string; user?: string; password?: string; journal?: string }>
  }
  const storages = inner.storages ?? []
  for (const item of storages) {
    for (const key of ['serial', 'url', 'user', 'password', 'journal'] as const) {
      const value = item[key]
      if (value === undefined || value === null || String(value).trim() === '') {
        throw new Error(`${path}: HRPC storage-secrets requires ${key}`)
      }
    }
    const expected = resolvedReplicationStorageSecrets(state).find(
      (secret) => String(secret.serial) === String(item.serial),
    )
    if (!expected) {
      throw new Error(`${path}: serial "${item.serial}" !== wizard state`)
    }
    if (String(item.url) !== expected.url) {
      throw new Error(`${path}: url "${item.url}" !== wizard state`)
    }
    if (String(item.user) !== expected.user) {
      throw new Error(`${path}: user "${item.user}" !== wizard state`)
    }
    if (String(item.password) !== expected.password) {
      throw new Error(`${path}: password does not match wizard state`)
    }
    if (String(item.journal) !== String(expected.journal)) {
      throw new Error(`${path}: journal "${item.journal}" !== wizard state`)
    }
  }
}

function assertRemoteKubeconfig(path: string, content: string): void {
  const doc = parse(content) as {
    metadata?: { name?: string }
    data?: Record<string, string>
  }
  if (doc.metadata?.name !== 'hspc-replication-operator-remote-kubeconfig') {
    throw new Error(
      `${path}: metadata.name "${doc.metadata?.name ?? ''}" !== wizard state`,
    )
  }
  const dataKeys = Object.keys(doc.data ?? {})
  if (dataKeys.length !== 1 || dataKeys[0] !== 'remote-kubeconfig') {
    throw new Error(`${path}: unknown parameter "${dataKeys.join(',')}" (not in sample or catalog)`)
  }
}

function assertDrRemoteKubeconfig(path: string, content: string, state: WizardState): void {
  const doc = parse(content) as {
    metadata?: { name?: string }
    data?: Record<string, string>
  }
  if (doc.metadata?.name !== 'remote-kubeconfig') {
    throw new Error(
      `${path}: metadata.name "${doc.metadata?.name ?? ''}" !== wizard state`,
    )
  }
  const dataKeys = Object.keys(doc.data ?? {})
  if (dataKeys.length !== 1) {
    throw new Error(`${path}: expected exactly one data key, got "${dataKeys.join(',')}"`)
  }
  const names = resolvedDrClusterNames(state)
  const expectedKey = path.includes('primary/') ? names.secondary : names.primary
  if (dataKeys[0] !== expectedKey) {
    throw new Error(`${path}: data key "${dataKeys[0]}" !== wizard state "${expectedKey}"`)
  }
}

export function assertCsiContract(
  files: Array<{ path: string; content: string }>,
  state: WizardState,
): void {
  for (const file of files) {
    if (!CSI_PATH.test(file.path)) continue
    if (!state.storageClassesEnabled) {
      if (file.path.includes('storageclass-') || file.path.includes('volumesnapshotclass-')) {
        throw new Error(`${file.path}: StorageClasses are off but this file was generated`)
      }
    }
    const { systems, classes } = storageForPath(state, file.path)
    if (file.path.includes('/storageclass-') || /(?:^|\/)01-storage\/storageclass-/.test(file.path)) {
      assertStorageClassFile(file.path, file.content, classes, systems)
    } else if (file.path.includes('/volumesnapshotclass-') || /(?:^|\/)01-storage\/volumesnapshotclass-/.test(file.path)) {
      if (classes.length > 0 && !supportsCsiVolumeSnapshots(classes)) {
        throw new Error(`${file.path}: VolumeSnapshotClass is not supported for VSP One SDS Block`)
      }
      assertSnapshotFile(file.path, file.content, {
        ...state,
        storageClasses: classes,
      })
    } else if (file.path.includes('/secret-') || /(?:^|\/)01-storage\/secret-/.test(file.path)) {
      assertSecretFile(file.path, file.content, systems, classes)
    } else if (file.path.endsWith('02-driver/hspc-cr.yaml')) {
      assertHspcCr(file.path, file.content, state)
    } else if (file.path.endsWith('03-replication/storage-secrets.yaml')) {
      assertHrpcStorageSecrets(file.path, file.content, state)
    } else if (file.path.endsWith('03-replication/remote-kubeconfig.yaml')) {
      assertDrRemoteKubeconfig(file.path, file.content, state)
    } else if (
      file.path.includes('03-replication/remote-kubeconfig-for-') ||
      file.path.includes('03-replication/remote-kubeconfig-')
    ) {
      assertRemoteKubeconfig(file.path, file.content)
    }
  }
}
