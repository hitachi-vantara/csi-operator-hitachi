/** Wizard step catalog and sidebar nav model. */

export type StepGroup = 'prerequisites'

export type WizardStepDef = {
  id: string
  title: string
  description: string
  /** Children of a labeled group (e.g. Prerequisites → 3.1 / 3.2) */
  group?: StepGroup
}

export const STEPS_BASE: WizardStepDef[] = [
  { id: 'platform', title: 'Platform', description: 'Cluster platform and protocol' },
  { id: 'components', title: 'Components', description: 'Select Hitachi CSI components' },
  {
    id: 'prerequisites-multipath',
    title: 'Multipath',
    description: 'Device Mapper Multipath packaging',
    group: 'prerequisites',
  },
  {
    id: 'prerequisites-checklist',
    title: 'Checklist',
    description: 'Environment checks',
    group: 'prerequisites',
  },
  { id: 'storage', title: 'Storage systems', description: 'Arrays and credentials' },
  { id: 'storageclasses', title: 'StorageClasses', description: 'Volume provisioning profiles' },
  { id: 'replication', title: 'Replication', description: 'Cross-site replication' },
  { id: 'metrics', title: 'Performance Metrics', description: 'Prometheus observability' },
  { id: 'console', title: 'Console Plugin', description: 'OpenShift UI plugin' },
  { id: 'quickstart', title: 'Test volume', description: 'Sample PVC and Pod for install.sh' },
  { id: 'export', title: 'Review & export', description: 'Download manifests and guide' },
]

export type VisibleStep = {
  id: string
  title: string
  description: string
  group?: StepGroup
}

export type NavEntry =
  | {
      kind: 'parent'
      major: number
      title: string
      /** True when any child is the active step */
      childActive: boolean
      /** True when all children are before the active step */
      done: boolean
    }
  | {
      kind: 'step'
      stepIndex: number
      /** Display number: "3", "3.1", "4", … */
      label: string
      title: string
      description: string
      nested: boolean
      active: boolean
      done: boolean
    }

/** Build sidebar entries with major / decimal numbering for prerequisite substeps. */
export function buildNavEntries(steps: VisibleStep[], stepIndex: number): NavEntry[] {
  const entries: NavEntry[] = []
  let major = 1
  let i = 0

  while (i < steps.length) {
    const step = steps[i]
    if (step.group === 'prerequisites') {
      const group: { step: VisibleStep; index: number }[] = []
      while (i < steps.length && steps[i].group === 'prerequisites') {
        group.push({ step: steps[i], index: i })
        i++
      }

      if (group.length > 1) {
        const childIndexes = group.map((g) => g.index)
        const childActive = childIndexes.includes(stepIndex)
        const done = childIndexes.every((idx) => idx < stepIndex)
        entries.push({
          kind: 'parent',
          major,
          title: 'Prerequisites',
          childActive,
          done,
        })
        group.forEach((g, j) => {
          entries.push({
            kind: 'step',
            stepIndex: g.index,
            label: `${major}.${j + 1}`,
            title: g.step.title,
            description: g.step.description,
            nested: true,
            active: g.index === stepIndex,
            done: g.index < stepIndex,
          })
        })
        major++
      } else {
        const g = group[0]
        const alone = g.step.id === 'prerequisites-checklist'
        entries.push({
          kind: 'step',
          stepIndex: g.index,
          label: String(major),
          title: alone ? 'Prerequisites' : g.step.title,
          description: alone ? 'Environment checklist' : g.step.description,
          nested: false,
          active: g.index === stepIndex,
          done: g.index < stepIndex,
        })
        major++
      }
      continue
    }

    entries.push({
      kind: 'step',
      stepIndex: i,
      label: String(major),
      title: step.title,
      description: step.description,
      nested: false,
      active: i === stepIndex,
      done: i < stepIndex,
    })
    major++
    i++
  }

  return entries
}

export function footerStepLabel(entries: NavEntry[], stepIndex: number): string {
  const step = entries.find((e) => e.kind === 'step' && e.stepIndex === stepIndex)
  if (!step || step.kind !== 'step') return ''
  return `Step ${step.label} — ${step.title}`
}
