import type { WizardState } from '../catalog/types'

/** Certified Operators package for Hitachi Storage Plug-in for Containers */
export const HSPC_OLM_PACKAGE = 'hspc-operator'
export const HSPC_OLM_CHANNEL = 'stable'
export const HSPC_OLM_SOURCE = 'certified-operators'
export const HSPC_OLM_SOURCE_NS = 'openshift-marketplace'

export function generateOperatorHubNamespace(namespace: string): string {
  return `apiVersion: v1
kind: Namespace
metadata:
  name: ${namespace}
  labels:
    openshift.io/cluster-monitoring: "true"
`
}

export function generateOperatorGroup(namespace: string): string {
  return `apiVersion: operators.coreos.com/v1
kind: OperatorGroup
metadata:
  name: hspc-operator-group
  namespace: ${namespace}
spec:
  targetNamespaces:
  - ${namespace}
`
}

export function generateOperatorSubscription(namespace: string, source: string): string {
  return `apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: ${HSPC_OLM_PACKAGE}
  namespace: ${namespace}
spec:
  channel: ${HSPC_OLM_CHANNEL}
  name: ${HSPC_OLM_PACKAGE}
  source: ${source}
  sourceNamespace: ${HSPC_OLM_SOURCE_NS}
  installPlanApproval: Manual
`
}

export function generateOperatorHubCatalogSource(opts: {
  name: string
  indexImage: string
}): string {
  return `apiVersion: operators.coreos.com/v1alpha1
kind: CatalogSource
metadata:
  name: ${opts.name}
  namespace: ${HSPC_OLM_SOURCE_NS}
spec:
  sourceType: grpc
  image: ${opts.indexImage}
  displayName: ${JSON.stringify(`Mirrored ${opts.name} catalog`)}
  publisher: ${JSON.stringify('Mirrored')}
`
}

/** OLM manifests for OpenShift/ROSA OperatorHub day-0 install (Manual approval). */
export function generateOperatorHubFiles(state: WizardState): {
  path: string
  content: string
  description: string
}[] {
  const ns = state.operatorNamespace
  const source = state.airGapped
    ? (state.offline?.catalogSourceName || '').trim() || HSPC_OLM_SOURCE
    : HSPC_OLM_SOURCE
  const indexImage = (state.offline?.catalogIndexImage || '').trim()
  return [
    {
      path: '02-driver/operatorhub-namespace.yaml',
      content: generateOperatorHubNamespace(ns),
      description: 'Namespace for CSI Driver operator (OwnNamespace)',
    },
    {
      path: '02-driver/operatorhub-operatorgroup.yaml',
      content: generateOperatorGroup(ns),
      description: 'OperatorGroup targeting the operator namespace',
    },
    ...(state.airGapped && indexImage
      ? [
          {
            path: '02-driver/operatorhub-catalogsource.yaml',
            content: generateOperatorHubCatalogSource({ name: source, indexImage }),
            description: `CatalogSource for mirrored OperatorHub catalog (${source})`,
          },
        ]
      : []),
    {
      path: '02-driver/operatorhub-subscription.yaml',
      content: generateOperatorSubscription(ns, source),
      description: `Subscription (${source}, Manual update approval)`,
    },
  ]
}
