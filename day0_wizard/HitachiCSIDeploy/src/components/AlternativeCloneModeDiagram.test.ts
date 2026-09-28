import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AlternativeCloneModeDiagram } from './AlternativeCloneModeDiagram'

const ARIA_LABEL =
  'Turn this on to create VMs from a template, or to clone a volume, and still grow those disks. Off, a pod connects to one volume and there is no parent volume. On, a pod connects to the child volume. CSI creates a parent volume and a child volume for every new volume from this Secret. The parent volume stays hidden. Volume expansion: you ask to expand the child volume, CSI checks the parent volume, expands the parent first if it is too small, then expands the child volume. Delete the child volume, and CSI deletes the parent volume. You do not delete the parent yourself. Every new volume needs about twice the pool space, even if you never clone. A 100 Gi volume needs about 200 Gi free.'

describe('AlternativeCloneModeDiagram', () => {
  const html = renderToStaticMarkup(createElement(AlternativeCloneModeDiagram))

  it('exposes the full story to assistive tech', () => {
    expect(html).toContain(`aria-label="${ARIA_LABEL}"`)
  })

  it('shows off, on, the expansion flow, delete, and cost', () => {
    const visible = [
      'Alternative clone mode',
      'Turn this on to create VMs from a template, or to clone a volume, and still grow those disks.',
      'Pod',
      'The workload uses this volume.',
      'No parent volume.',
      'Child volume',
      'Parent volume',
      'The workload uses the child volume.',
      'The parent volume stays hidden.',
      'CSI creates both for every new volume from this Secret.',
      'Volume expansion flow',
      'Expansion request',
      'You ask to expand',
      'the child volume.',
      'Capacity check',
      'CSI checks the',
      'parent volume.',
      'Expand the parent volume',
      'if required',
      'If it is too small,',
      'CSI expands it first.',
      'Expand the child volume',
      'CSI expands it after the',
      'parent volume is large enough.',
      'Delete the child volume, and CSI deletes the parent volume.',
      'You do not delete the parent yourself.',
      'about twice the pool space',
      'A 100 Gi volume needs about 200 Gi free.',
    ]
    for (const line of visible) {
      expect(html).toContain(line)
    }
  })

  it('is a static diagram', () => {
    expect(html).not.toContain('<animate')
    expect(html).not.toContain('animateMotion')
    expect(html).not.toContain('acm-grow')
    expect(html).not.toContain('acm-delete')
  })
})

describe('alternative clone mode animation css', () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../styles/theme.css'),
    'utf8',
  )

  it('keeps the off and on card treatments and a muted parent', () => {
    expect(css).toContain('.acm-without > rect')
    expect(css).toContain('.acm-with > rect')
    expect(css).toContain('.acm-parent')
  })

  it('removes the looping animations', () => {
    expect(css).not.toContain('@keyframes acm-grow')
    expect(css).not.toContain('@keyframes acm-delete-clone')
    expect(css).not.toContain('@keyframes acm-delete-parent')
    expect(css).not.toContain('@keyframes acm-panel-focus')
    expect(css).not.toContain('@keyframes acm-packet-phase')
    expect(css).not.toContain('.acm-packet')
    expect(css).not.toContain('.acm-later-expand')
  })
})
