import { describe, expect, it } from 'vitest'
import { HELP } from './help'

describe('resource group help copy', () => {
  it('matches the help paragraph', () => {
    expect(HELP.resourceGroupId).toBe('This Secret’s ID is the resource group CSI provisions into.')
  })

  it('matches the field hint', () => {
    expect(HELP.resourceGroupIdHint).toBe(
      'Required if the storage user can access more than one resource group, or a resource group and the Meta resource.',
    )
  })
})
