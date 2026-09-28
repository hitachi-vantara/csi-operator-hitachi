import { describe, expect, it } from 'vitest'
import { filledReplicationState } from '../test/fixtures'
import {
  applyReplicationSecretPatch,
  resolvedReplicationStorageSecrets,
} from './replicationSecrets'
import { getSiteStorage } from './sites'

describe('resolvedReplicationStorageSecrets', () => {
  it('uses each site’s Replication array when storageSecrets is empty', () => {
    const state = filledReplicationState({
      replication: { storageSecrets: [] },
    })

    expect(resolvedReplicationStorageSecrets(state)).toEqual([
      {
        serial: '400001',
        url: 'https://192.0.2.10',
        user: 'maintenance',
        password: 'fixture-password',
        journal: '',
      },
      {
        serial: '400002',
        url: 'https://192.0.2.11',
        user: 'maintenance',
        password: 'fixture-password',
        journal: '',
      },
    ])
  })

  it('keeps journals but refreshes secondary credentials after Storage systems change', () => {
    const state = filledReplicationState({
      replication: {
        storageSecrets: [
          {
            serial: '400001',
            url: 'https://192.0.2.10',
            user: 'primary-user',
            password: 'primary-password',
            journal: '10',
          },
          {
            serial: '400001',
            url: 'https://192.0.2.10',
            user: 'primary-user',
            password: 'primary-password',
            journal: '20',
          },
        ],
      },
    })

    expect(resolvedReplicationStorageSecrets(state)).toEqual([
      {
        serial: '400001',
        url: 'https://192.0.2.10',
        user: 'maintenance',
        password: 'fixture-password',
        journal: '10',
      },
      {
        serial: '400002',
        url: 'https://192.0.2.11',
        user: 'maintenance',
        password: 'fixture-password',
        journal: '20',
      },
    ])
  })
})

describe('applyReplicationSecretPatch', () => {
  it('writes credential edits back to that site’s Replication array', () => {
    const state = applyReplicationSecretPatch(filledReplicationState(), 1, {
      user: 'secondary-metrics',
      password: 'secondary-secret',
    })

    const secondary = getSiteStorage(state, 'secondary').storageSystems[0]
    expect(secondary.user).toBe('secondary-metrics')
    expect(secondary.password).toBe('secondary-secret')
    expect(resolvedReplicationStorageSecrets(state)[1]).toMatchObject({
      user: 'secondary-metrics',
      password: 'secondary-secret',
      serial: '400002',
    })
  })
})
