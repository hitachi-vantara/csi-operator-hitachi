import { describe, expect, it } from 'vitest'
import { HELP } from './help'
import { SECRET_FIELDS_STANDARD } from './parameters'

const HELP_TEXT = 'Turn this on only if you create VMs from a template or clone volumes.'

const FIELD_DESCRIPTION =
  'On, CSI creates a hidden parent volume and a child volume for every new volume so VMs from templates and cloned volumes can grow. The workload uses the child volume. CSI expands the parent volume first, then the child volume, and deletes the parent volume when you delete the child. About twice the pool space: 100 Gi needs about 200 Gi free. VSP One Block High End (B85) and 20 Series only.'

describe('alternative clone mode help copy', () => {
  it('matches the help paragraph', () => {
    expect(HELP.alternativeCloneMode).toBe(HELP_TEXT)
  })

  it('matches the Secret field description', () => {
    const field = SECRET_FIELDS_STANDARD.find((item) => item.key === 'alternativeCloneMode')
    expect(field?.description).toBe(FIELD_DESCRIPTION)
  })

  it('matches the checkbox hint', () => {
    expect(HELP.alternativeCloneModeHint).toBe(
      'Create VMs from a template, or clone a volume, and still grow those disks. On, CSI creates a hidden parent volume and a child volume the workload uses. A 100 Gi volume needs about 200 Gi free. 20 Series and High End (B85) only.',
    )
  })

  it('does not restate the array clone limits', () => {
    const combined = `${HELP.alternativeCloneMode} ${HELP.alternativeCloneModeHint} ${FIELD_DESCRIPTION}`
    expect(combined).not.toMatch(/cannot grow past/i)
    expect(combined).not.toMatch(/cannot be deleted while/i)
    expect(combined).not.toMatch(/hidden original/i)
  })
})
