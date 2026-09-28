import { ensureSitesForReplication } from '../catalog/sites'
import { createDefaultState, type WizardState } from '../catalog/types'

type NestedObjectKey =
  | 'components'
  | 'multipath'
  | 'replication'
  | 'snapshotClass'
  | 'metrics'
  | 'consolePlugin'
  | 'quickstart'
  | 'versions'

type FilledStateOverrides = Partial<Omit<WizardState, NestedObjectKey>> & {
  [Key in NestedObjectKey]?: Partial<WizardState[Key]>
}

export function filledState(overrides: FilledStateOverrides = {}): WizardState {
  const base = createDefaultState()
  const state: WizardState = {
    ...base,
    storageSystems: [
      {
        ...base.storageSystems[0],
        family: 'vsp-5000-g-e-f',
        serial: '400001',
        url: 'https://192.0.2.10',
        user: 'maintenance',
        password: 'fixture-password',
        csiSecretName: 'hitachi-csi-secret',
      },
    ],
    storageClasses: [
      {
        ...base.storageClasses[0],
        name: 'hitachi-csi',
        connectionType: 'fc',
        poolID: '0',
        portID: 'CL1-A',
        serialNumber: '400001',
        storageSystemId: base.storageSystems[0].id,
      },
    ],
  }

  return {
    ...state,
    ...overrides,
    components: { ...state.components, ...overrides.components },
    multipath: { ...state.multipath, ...overrides.multipath },
    replication: { ...state.replication, ...overrides.replication },
    snapshotClass: { ...state.snapshotClass, ...overrides.snapshotClass },
    metrics: { ...state.metrics, ...overrides.metrics },
    consolePlugin: { ...state.consolePlugin, ...overrides.consolePlugin },
    quickstart: { ...state.quickstart, ...overrides.quickstart },
    versions: { ...state.versions, ...overrides.versions },
  }
}

/** Two-site Replication with journals filled. Kubeconfigs are left empty unless the caller sets them. */
export function filledReplicationState(overrides: FilledStateOverrides = {}): WizardState {
  const state = ensureSitesForReplication(
    filledState({
      ...overrides,
      components: { replication: true, disasterRecovery: true, ...overrides.components },
      replication: {
        enabled: true,
        disasterRecovery: true,
        storageSecrets: [
          {
            serial: '400001',
            url: 'https://192.0.2.10',
            user: 'maintenance',
            password: 'fixture-password',
            journal: '0',
          },
          {
            serial: '400002',
            url: 'https://192.0.2.11',
            user: 'maintenance',
            password: 'fixture-password',
            journal: '1',
          },
        ],
        ...overrides.replication,
      },
    }),
  )

  return {
    ...state,
    sites: {
      primary: state.sites!.primary,
      secondary: {
        storageSystems: state.sites!.secondary.storageSystems.map((system) => ({
          ...system,
          family: 'vsp-5000-g-e-f',
          serial: '400002',
          url: 'https://192.0.2.11',
          user: 'maintenance',
          password: 'fixture-password',
        })),
        storageClasses: state.sites!.secondary.storageClasses.map((storageClass) => ({
          ...storageClass,
          serialNumber: '400002',
          poolID: '1',
          portID: 'CL2-A',
        })),
      },
    },
  }
}
