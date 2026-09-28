import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const dir = join(fileURLToPath(new URL('.', import.meta.url)), 'v3.18.3')

const files = [
  'sc-sample.yaml',
  'sc-sample-vsp-one-sds-block.yaml',
  'sc-sample-stretched.yaml',
  'sc-sample-stretched-adr.yaml',
  'secret-sample.yaml',
  'secret-sample-stretched.yaml',
  'volumesnapshotclass-sample.yaml',
  'volumesnapshotclass-immutable-sample.yaml',
  'hspc_v1_hspc.yaml',
  'storage-secrets-sample.yaml',
  'remote-kubeconfig-sample.yaml',
] as const

describe('vendored Hitachi samples v3.18.3', () => {
  it.each(files)('has parseable %s', (name) => {
    const path = join(dir, name)
    expect(existsSync(path), `missing ${path}`).toBe(true)
    const doc = parse(readFileSync(path, 'utf8')) as { kind?: string }
    expect(doc.kind).toBeTruthy()
  })

  it('standard StorageClass sample includes Hitachi parameter names', () => {
    const doc = parse(readFileSync(join(dir, 'sc-sample.yaml'), 'utf8')) as {
      parameters: Record<string, unknown>
    }
    expect(Object.keys(doc.parameters)).toEqual(
      expect.arrayContaining(['serialNumber', 'poolID', 'portID', 'connectionType']),
    )
  })
})
