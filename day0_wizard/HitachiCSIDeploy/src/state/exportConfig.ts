import type { WizardState } from '../catalog/types'
import { wizardVersion } from '../wizardVersion'

export function exportConfigJson(state: WizardState): string {
  const safe = {
    ...state,
    wizardVersion: wizardVersion(),
    replication: {
      ...state.replication,
      primaryKubeconfig: undefined,
      secondaryKubeconfig: undefined,
    },
  }

  return JSON.stringify(safe, null, 2)
}

export function parseWizardConfigJson(json: string): WizardState {
  const parsed = JSON.parse(json) as WizardState & { wizardVersion?: string }
  const { wizardVersion: _ignored, ...rest } = parsed
  return rest as WizardState
}
