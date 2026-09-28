import { describe, expect, it } from 'vitest'
import { filledReplicationState } from '../test/fixtures'
import {
  DEFAULT_PRIMARY_CLUSTER_NAME,
  DEFAULT_SECONDARY_CLUSTER_NAME,
  DR_REMOTE_KUBECONFIG_SECRET_NAME,
  generateDrRemoteKubeconfigSecret,
  generateRemoteKubeconfigScript,
  resolvedDrClusterNames,
} from './remoteKubeconfig'

describe('resolvedDrClusterNames', () => {
  it('defaults to primary and secondary', () => {
    expect(resolvedDrClusterNames(filledReplicationState())).toEqual({
      primary: DEFAULT_PRIMARY_CLUSTER_NAME,
      secondary: DEFAULT_SECONDARY_CLUSTER_NAME,
    })
  })

  it('trims and falls back when empty', () => {
    const state = filledReplicationState({
      replication: { primaryClusterName: '  ', secondaryClusterName: ' dc2 ' },
    })
    expect(resolvedDrClusterNames(state)).toEqual({ primary: 'primary', secondary: 'dc2' })
  })
})

describe('DR secret constants', () => {
  it('names the in-cluster Secret remote-kubeconfig', () => {
    expect(DR_REMOTE_KUBECONFIG_SECRET_NAME).toBe('remote-kubeconfig')
  })
})

describe('generateDrRemoteKubeconfigSecret', () => {
  it('emits Secret remote-kubeconfig with the other site name as the data key', () => {
    const yaml = generateDrRemoteKubeconfigSecret({
      namespace: 'hspc-replication-operator-system',
      kubeconfig: 'dummy-secondary\n',
      clusterName: 'secondary',
    })
    expect(yaml).toContain('name: remote-kubeconfig')
    expect(yaml).toContain('namespace: hspc-replication-operator-system')
    expect(yaml).toMatch(/data:\n  "secondary": /)
    expect(yaml).not.toContain('hspc-replication-operator-remote-kubeconfig')
  })
})

describe('generateRemoteKubeconfigScript DR apply', () => {
  it('helper script writes DR Secret YAML under primary/ and secondary/ without APPLY=1', () => {
    const script = generateRemoteKubeconfigScript({
      namespace: 'ns-a',
      cmd: 'oc',
      primaryClusterName: 'dc1',
      secondaryClusterName: 'dc2',
    })
    expect(script).toContain('name: remote-kubeconfig')
    expect(script).toContain('"dc1"')
    expect(script).toContain('"dc2"')
    expect(script).toContain('primary/remote-kubeconfig.yaml')
    expect(script).toContain('secondary/remote-kubeconfig.yaml')
    expect(script).toContain('Apply manually:')
    expect(script).toMatch(/apply -f .*primary\/remote-kubeconfig\.yaml/)
    expect(script).toMatch(/apply -f .*secondary\/remote-kubeconfig\.yaml/)
    expect(script).not.toContain('mktemp')
    expect(script).not.toContain('jq')
    expect(script).not.toContain('remote-cluster-management.sh')
  })
})
