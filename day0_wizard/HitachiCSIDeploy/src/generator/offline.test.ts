import { describe, expect, it } from 'vitest'
import { extractImages, offlineRegistryPaths, rewriteImagesToRegistry } from './offline'

const REGISTRY = 'myreg.local:5000/hspc'

describe('rewriteImagesToRegistry', () => {
  it('rewrites quoted multi-component image paths', () => {
    const yaml = '          image: "registry.hitachivantara.com/ns/storage-plugin:1.2.3"\n'
    expect(rewriteImagesToRegistry(yaml, REGISTRY)).toBe(
      `          image: "${REGISTRY}/storage-plugin:1.2.3"\n`,
    )
  })

  it('rewrites digest refs and keeps the digest', () => {
    const yaml = '          image: registry.example.com/ns/repo@sha256:abcdef0123456789\n'
    expect(rewriteImagesToRegistry(yaml, REGISTRY)).toBe(
      `          image: ${REGISTRY}/repo@sha256:abcdef0123456789\n`,
    )
  })

  it('rewrites bare image names to registry paths with :latest', () => {
    const yaml = '        image: busybox\n'
    expect(rewriteImagesToRegistry(yaml, REGISTRY)).toBe(
      `        image: ${REGISTRY}/busybox:latest\n`,
    )
  })

  it('rewrites list-item bare image lines', () => {
    const yaml = '      - image: pause\n'
    expect(rewriteImagesToRegistry(yaml, REGISTRY)).toBe(
      `      - image: ${REGISTRY}/pause:latest\n`,
    )
  })

  it('flattens multi-component tagged refs to the last path segment', () => {
    const yaml = '          image: reg.hv.com/ns/repo:tag\n'
    expect(rewriteImagesToRegistry(yaml, REGISTRY)).toBe(
      `          image: ${REGISTRY}/repo:tag\n`,
    )
  })

  it('does not rewrite non-image fields', () => {
    const yaml = '          name: image: should-not-change\n'
    expect(rewriteImagesToRegistry(yaml, REGISTRY)).toBe(yaml)
  })
})

describe('extractImages', () => {
  it('returns unique sorted image refs from image lines', () => {
    const yaml = [
      '          image: registry.k8s.io/pause:3.9',
      '          image: "registry.k8s.io/pause:3.9"',
      '          image: busybox',
    ].join('\n')

    expect(extractImages(yaml)).toEqual(['busybox', 'registry.k8s.io/pause:3.9'])
  })
})

describe('offlineRegistryPaths', () => {
  it('derives plugin paths from the trimmed registry base', () => {
    expect(
      offlineRegistryPaths({
        offline: { registryBase: 'myreg.local:5000/csi/' },
      }),
    ).toEqual({
      hspc: 'myreg.local:5000/csi/hspc',
      hrpc: 'myreg.local:5000/csi/hrpc',
      hspp: 'myreg.local:5000/csi/hspp',
      extras: 'myreg.local:5000/csi',
    })
  })

  it('uses non-empty per-plugin overrides', () => {
    expect(
      offlineRegistryPaths({
        offline: {
          registryBase: 'myreg.local:5000/csi',
          hspcPath: 'mirror.local/hspc-custom',
          hrpcPath: 'mirror.local/hrpc-custom',
          hsppPath: 'mirror.local/hspp-custom',
        },
      }),
    ).toEqual({
      hspc: 'mirror.local/hspc-custom',
      hrpc: 'mirror.local/hrpc-custom',
      hspp: 'mirror.local/hspp-custom',
      extras: 'myreg.local:5000/csi',
    })
  })

  it('returns empty strings when registry base is empty', () => {
    expect(offlineRegistryPaths({ offline: { registryBase: '' } })).toEqual({
      hspc: '',
      hrpc: '',
      hspp: '',
      extras: '',
    })
    expect(offlineRegistryPaths({})).toEqual({
      hspc: '',
      hrpc: '',
      hspp: '',
      extras: '',
    })
  })
})
