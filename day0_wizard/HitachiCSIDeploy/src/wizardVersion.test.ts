import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { wizardVersion } from './wizardVersion'

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }

describe('wizardVersion', () => {
  it('returns package version plus git short SHA or unknown', () => {
    const value = wizardVersion()
    expect(value === `${pkg.version}+unknown` || /^\d+\.\d+\.\d+\+[0-9a-f]+$/.test(value)).toBe(true)
    expect(value.startsWith(`${pkg.version}+`)).toBe(true)
  })
})
