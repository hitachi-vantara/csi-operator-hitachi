import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ResourceGroupOverviewDiagram } from './ResourceGroupOverviewDiagram'

const SECRETS_ARIA =
  'One cluster can use more than one resource group. This Secret selects one resource group. Another Secret in the same cluster selects a different resource group. LDEV IDs and host groups stay in each resource group. Pools and ports in the Meta resource are shared. A pool belongs to one group.'

const USERS_ARIA =
  'user 1 can access resource groups 1 and 2. user 2 can access resource group 2 only. The pool belongs to resource group 2. user 1 can provision into resource group 1 from that pool. user 2 can use it only for resource group 2. The Meta resource holds shared ports and shared host groups.'

function render(resourceGroupID?: string): string {
  return renderToStaticMarkup(createElement(ResourceGroupOverviewDiagram, { resourceGroupID }))
}

function labelAfter(html: string, marker: string): string {
  const start = html.indexOf(`>${marker}<`)
  const slice = html.slice(start, start + 500)
  const match = slice.match(/Resource group [^<]+/)
  return match?.[0] ?? ''
}

describe('ResourceGroupOverviewDiagram', () => {
  const html = render()

  it('exposes both stories to assistive tech', () => {
    expect(html).toContain(`aria-label="${SECRETS_ARIA}"`)
    expect(html).toContain(`aria-label="${USERS_ARIA}"`)
  })

  it('shows the cluster scene and the user scene', () => {
    for (const text of [
      'Resource groups',
      'One cluster can use more than one resource group.',
      'Cluster',
      'CSI Driver',
      'This Secret',
      'Another Secret',
      'provisions into',
      'LDEV IDs',
      'Host groups',
      'Meta resource',
      'Shared pool',
      'Shared ports',
      'Pools and ports in the Meta resource are shared.',
      'A pool belongs to one group.',
      'Storage users',
      'A storage user can access one resource group, or more than one.',
      'user 1',
      'resource groups 1 and 2',
      'user 2',
      'resource group 2 only',
      'the pool that belongs to this group',
      'Shared host groups',
      'The pool belongs to resource group 2.',
      'user 1 can provision into resource group 1 from that pool.',
      'user 2 can use it only for resource group 2.',
    ]) {
      expect(html).toContain(text)
    }
  })

  it('uses digits for this Secret and the other Secret', () => {
    expect(labelAfter(html, 'This Secret')).toBe('Resource group 1')
    expect(labelAfter(html, 'Another Secret')).toBe('Resource group 2')

    const swapped = render('2')
    expect(labelAfter(swapped, 'This Secret')).toBe('Resource group 2')
    expect(labelAfter(swapped, 'Another Secret')).toBe('Resource group 1')

    const typed = render('  5  ')
    expect(labelAfter(typed, 'This Secret')).toBe('Resource group 5')
    expect(labelAfter(typed, 'Another Secret')).toBe('Resource group 2')
    expect(typed).toContain('resource groups 1 and 2')
    expect(typed).toContain('resource group 2 only')
  })

  it('does not keep the old multi-cluster story or letter labels', () => {
    const combined = `${html}\n${render('2')}\n${render('5')}`
    expect(combined).not.toContain('several clusters')
    expect(combined).not.toContain('exactly one resource group')
    expect(combined).not.toContain('Resource group A')
    expect(combined).not.toContain('Resource group B')
    expect(combined).not.toContain('RSG1')
    expect(combined).not.toContain('RSG2')
    expect(combined).not.toContain('<animate')
  })
})
