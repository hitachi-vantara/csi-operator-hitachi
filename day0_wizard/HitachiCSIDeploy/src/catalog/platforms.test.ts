import { describe, expect, it } from 'vitest'
import {
  defaultOpenShiftTopology,
  effectiveMultipathDelivery,
  multipathFlagsForDelivery,
  PLATFORM_PICKER_IDS,
  PLATFORMS,
  supportsStretchedGad,
} from './platforms'

describe('platform defaults and constraints', () => {
  it('defaults OpenShift to classic topology', () => {
    expect(defaultOpenShiftTopology('openshift')).toBe('classic')
  })

  it('defaults ROSA to hosted topology', () => {
    expect(defaultOpenShiftTopology('rosa')).toBe('hosted')
  })

  it('uses a MachineConfig for classic OpenShift dm-multipath', () => {
    expect(
      effectiveMultipathDelivery({
        platform: 'openshift',
        openshiftTopology: 'classic',
        needsDm: true,
      }),
    ).toBe('machineconfig')
  })

  it('uses a DaemonSet for hosted OpenShift dm-multipath', () => {
    expect(
      effectiveMultipathDelivery({
        platform: 'openshift',
        openshiftTopology: 'hosted',
        needsDm: true,
      }),
    ).toBe('daemonset')
  })

  it('uses a multipath.conf for Kubernetes dm-multipath', () => {
    expect(
      effectiveMultipathDelivery({
        platform: 'kubernetes',
        openshiftTopology: 'classic',
        needsDm: true,
      }),
    ).toBe('conf')
  })

  it('sets only the DaemonSet flag for DaemonSet delivery', () => {
    const flags = multipathFlagsForDelivery('daemonset')

    expect(flags.includeDaemonSet).toBe(true)
    expect(flags.includeMachineConfig).toBe(false)
  })

  it('does not support the console plugin on Kubernetes, RKE2, or EKS', () => {
    expect(PLATFORMS.kubernetes.supportsConsolePlugin).toBe(false)
    expect(PLATFORMS.rke2.supportsConsolePlugin).toBe(false)
    expect(PLATFORMS.eks.supportsConsolePlugin).toBe(false)
  })

  it('omits ROSA and EKS from the Platform picker', () => {
    expect([...PLATFORM_PICKER_IDS]).toEqual(['openshift', 'kubernetes', 'rke2'])
    expect(PLATFORMS.rosa).toBeDefined()
    expect(PLATFORMS.eks).toBeDefined()
  })

  it('uses a loose multipath.conf for RKE2 and EKS dm-multipath', () => {
    expect(
      effectiveMultipathDelivery({
        platform: 'rke2',
        openshiftTopology: 'classic',
        needsDm: true,
      }),
    ).toBe('conf')
    expect(
      effectiveMultipathDelivery({
        platform: 'eks',
        openshiftTopology: 'classic',
        needsDm: true,
      }),
    ).toBe('conf')
  })

  it('skips dm-multipath packaging when the protocol is native NVMe', () => {
    expect(
      effectiveMultipathDelivery({
        platform: 'openshift',
        openshiftTopology: 'classic',
        needsDm: false,
      }),
    ).toBe('none')
  })

  it('installs through OperatorHub on OpenShift', () => {
    expect(PLATFORMS.openshift.operatorHub).toBe(true)
  })

  it('does not support stretched GAD on VSP One SDS Block', () => {
    expect(supportsStretchedGad('vsp-one-sds-block')).toBe(false)
  })

  it('supports stretched GAD on VSP arrays', () => {
    expect(supportsStretchedGad('vsp-5000-g-e-f')).toBe(true)
  })
})
