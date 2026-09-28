import { getMultipathConf } from './multipath'

const DEFAULT_NAME = 'hitachi-csi-multipath'
const DEFAULT_NS = 'kube-system'

export function expectedMultipathDaemonSet(opts?: {
  name?: string
  namespace?: string
}): { name: string; namespace: string } {
  return {
    name: opts?.name || DEFAULT_NAME,
    namespace: opts?.namespace || DEFAULT_NS,
  }
}

function indentYamlBlock(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces)
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\s+$/, '')
    .split('\n')
    .map((line) => (line.length ? pad + line : pad.trimEnd() ? pad : ''))
    .join('\n')
}

/**
 * Hosted/HCP OpenShift/ROSA: DaemonSet that writes Hitachi multipath.conf on nodes
 * (shaped after upstream rosa-daemonset.yaml, with full Hitachi sample + own SA).
 */
export function generateMultipathDaemonSetYaml(opts: {
  name?: string
  namespace?: string
  conf?: string
  enableIscsi: boolean
  /** Optional air-gapped registry base (extras); flattened image layout */
  registryPath?: string
}): string {
  const { name, namespace } = expectedMultipathDaemonSet(opts)
  const conf = getMultipathConf(opts.conf).replace(/\s+$/, '\n')
  const registry = (opts.registryPath || '').trim()
  const initImage = registry ? `${registry}/alpine:3.19` : 'alpine:3.19'
  const pauseImage = registry ? `${registry}/pause:3.9` : 'registry.k8s.io/pause:3.9'

  const iscsiBits = opts.enableIscsi
    ? `
if [ -f /etc/iscsi/iscsid.conf ]; then
  sed -i 's/^\\(node.session.scan\\).*/\\1 = manual/' /etc/iscsi/iscsid.conf || true
fi
systemctl enable --now iscsid 2>/dev/null || true
systemctl enable --now iscsi 2>/dev/null || true
`
    : ''

  const startupScript = `set -e
cat <<'EOF' > /etc/multipath.conf
${conf}EOF
systemctl enable --now multipathd
${iscsiBits}multipath -ll || true
`

  return `apiVersion: v1
kind: ServiceAccount
metadata:
  name: ${name}
  namespace: ${namespace}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: ${name}-privileged
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: system:openshift:scc:privileged
subjects:
- kind: ServiceAccount
  name: ${name}
  namespace: ${namespace}
---
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: ${name}
  namespace: ${namespace}
  labels:
    app.kubernetes.io/name: ${name}
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: ${name}
  updateStrategy:
    type: RollingUpdate
  template:
    metadata:
      labels:
        app.kubernetes.io/name: ${name}
    spec:
      hostNetwork: true
      hostPID: true
      serviceAccountName: ${name}
      tolerations:
      - effect: NoSchedule
        key: node-role.kubernetes.io/master
      - effect: NoSchedule
        key: node-role.kubernetes.io/control-plane
      initContainers:
      - name: init-node
        image: ${initImage}
        command:
        - nsenter
        - --mount=/proc/1/ns/mnt
        - --
        - sh
        - -c
        - $(STARTUP_SCRIPT)
        env:
        - name: STARTUP_SCRIPT
          value: |
${indentYamlBlock(startupScript, 12)}
        securityContext:
          privileged: true
      containers:
      - name: pause
        image: ${pauseImage}
`
}

export function generateMultipathDaemonSetFiles(opts: {
  name?: string
  namespace?: string
  conf?: string
  enableIscsi: boolean
  registryPath?: string
}): { path: string; content: string; description: string }[] {
  const name = opts.name || DEFAULT_NAME
  return [
    {
      path: `00-prereq/${name}-daemonset.yaml`,
      content: generateMultipathDaemonSetYaml(opts),
      description: 'Hosted/HCP DaemonSet for /etc/multipath.conf + multipathd',
    },
  ]
}
