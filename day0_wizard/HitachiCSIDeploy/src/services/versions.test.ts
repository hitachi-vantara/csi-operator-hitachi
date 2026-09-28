import { describe, expect, it } from 'vitest'
import {
  FALLBACK_VERSIONS,
  MIN_COMPONENT_VERSION,
  filterSupportedVersions,
  pickListedVersion,
  versionAtLeast,
} from './versions'

describe('component version floor', () => {
  it('treats 3.18.0 as the minimum offered tag', () => {
    expect(MIN_COMPONENT_VERSION).toBe('v3.18.0')
    expect(versionAtLeast('v3.18.0', MIN_COMPONENT_VERSION)).toBe(true)
    expect(versionAtLeast('v3.18.3', MIN_COMPONENT_VERSION)).toBe(true)
    expect(versionAtLeast('v3.19.0', MIN_COMPONENT_VERSION)).toBe(true)
    expect(versionAtLeast('v3.17.4', MIN_COMPONENT_VERSION)).toBe(false)
    expect(versionAtLeast('v1.4.1', MIN_COMPONENT_VERSION)).toBe(false)
  })

  it('drops tags older than 3.18 from all three component lists', () => {
    expect(
      filterSupportedVersions(['v3.18.3', 'v3.18.0', 'v3.17.4', 'v1.4.0', 'v3.19.0']),
    ).toEqual(['v3.19.0', 'v3.18.3', 'v3.18.0'])
  })

  it('keeps fallback lists at 3.18 or newer for driver, replication, and metrics', () => {
    for (const list of [FALLBACK_VERSIONS.hspc, FALLBACK_VERSIONS.hrpc, FALLBACK_VERSIONS.hspp]) {
      expect(list.length).toBeGreaterThan(0)
      expect(list).toEqual(filterSupportedVersions(list))
    }
  })

  it('replaces a saved tag that is no longer listed', () => {
    expect(pickListedVersion('v3.17.4', ['v3.18.3', 'v3.18.0'], 'v3.18.3')).toBe('v3.18.3')
    expect(pickListedVersion('v3.18.0', ['v3.18.3', 'v3.18.0'], 'v3.18.3')).toBe('v3.18.0')
  })
})
