import { describe, expect, it } from 'vitest'
import { filledState } from '../test/fixtures'
import { exportConfigJson, parseWizardConfigJson } from './exportConfig'
import { wizardVersion } from '../wizardVersion'

describe('exportConfigJson', () => {
  it('keeps DR cluster names and still omits kubeconfigs', () => {
    const state = filledState()
    state.replication.primaryKubeconfig = 'primary-kubeconfig'
    state.replication.secondaryKubeconfig = 'secondary-kubeconfig'
    state.replication.primaryClusterName = 'dc1'
    state.replication.secondaryClusterName = 'dc2'
    state.replication.remoteKubeconfigSource = 'install-time'

    const exported = JSON.parse(exportConfigJson(state))
    expect(exported.replication.primaryKubeconfig).toBeUndefined()
    expect(exported.replication.secondaryKubeconfig).toBeUndefined()
    expect(exported.replication.primaryClusterName).toBe('dc1')
    expect(exported.replication.secondaryClusterName).toBe('dc2')
    expect(exported.replication.remoteKubeconfigSource).toBe('install-time')
  })

  it('omits kubeconfig values from exported state', () => {
    const state = filledState()
    state.replication.primaryKubeconfig = 'primary-kubeconfig'
    state.replication.secondaryKubeconfig = 'secondary-kubeconfig'

    const exported = JSON.parse(exportConfigJson(state))

    expect(exported.replication.primaryKubeconfig).toBeUndefined()
    expect(exported.replication.secondaryKubeconfig).toBeUndefined()
  })

  it('adds wizardVersion and parseWizardConfigJson strips it', () => {
    const exported = JSON.parse(exportConfigJson(filledState()))
    expect(exported.wizardVersion).toBe(wizardVersion())
    expect(exported.version).toBe(1)

    const parsed = parseWizardConfigJson(JSON.stringify(exported))
    expect('wizardVersion' in parsed).toBe(false)
    expect(parsed.platform).toBe('openshift')
  })

  it('parses configs that omit wizardVersion', () => {
    const parsed = parseWizardConfigJson(JSON.stringify({ version: 1, platform: 'kubernetes' }))
    expect('wizardVersion' in parsed).toBe(false)
    expect(parsed.platform).toBe('kubernetes')
  })
})

describe('filledState', () => {
  it('provides a configured storage system and StorageClass', () => {
    const state = filledState()

    expect(state.storageSystems[0].family).toBe('vsp-5000-g-e-f')
    expect(state.storageSystems[0].serial).toBe('400001')
    expect(state.storageClasses[0].poolID).toBe('0')
  })

  it('deep-merges nested object overrides', () => {
    const state = filledState({ components: { replication: true } })

    expect(state.components.driver).toBe(true)
    expect(state.components.replication).toBe(true)
  })

  it('replaces nested array overrides', () => {
    const oneSystem = filledState().storageSystems[0]
    const state = filledState({ storageSystems: [oneSystem] })

    expect(state.storageSystems).toEqual([oneSystem])
    expect(state.storageSystems).toHaveLength(1)
  })
})
