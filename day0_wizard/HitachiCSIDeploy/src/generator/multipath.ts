import { MULTIPATH_CONF } from '../catalog/platforms'

export type MachineConfigRole = 'worker' | 'master' | 'all'

/** Hitachi CSI basic Device Mapper Multipath sample (upstream multipath-sample.conf). */
export function getMultipathConf(customConf?: string): string {
  const conf = (customConf ?? MULTIPATH_CONF).replace(/\r\n/g, '\n').trimEnd() + '\n'
  return conf
}

function toDataUrlBase64(text: string): string {
  // UTF-8 safe base64 for Ignition data URL
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  bytes.forEach((b) => {
    binary += String.fromCharCode(b)
  })
  return btoa(binary)
}

/**
 * OpenShift MachineConfig that writes /etc/multipath.conf via Ignition.
 * Matches upstream multipath-machineconfig-sample.yaml structure.
 */
export function generateMultipathMachineConfig(opts: {
  name?: string
  role?: MachineConfigRole
  conf?: string
}): string {
  const name = opts.name || 'hitachi-csi-multipath'
  const role = opts.role || 'worker'
  const conf = getMultipathConf(opts.conf)
  const b64 = toDataUrlBase64(conf)

  const labels =
    role === 'all'
      ? `    # Apply to all MachineConfigPools by omitting role label, or duplicate for master+worker.
    machineconfiguration.openshift.io/role: worker`
      : `    machineconfiguration.openshift.io/role: ${role}`

  return `apiVersion: machineconfiguration.openshift.io/v1
kind: MachineConfig
metadata:
  name: ${name}
  labels:
${labels}
spec:
  config:
    ignition:
      version: 3.2.0
    storage:
      files:
      - contents:
          source: data:text/plain;charset=utf-8;base64,${b64}
          verification: {}
        filesystem: root
        mode: 400
        path: /etc/multipath.conf
`
}

/** When role is "all", emit worker + master MachineConfigs. */
export function generateMultipathMachineConfigs(opts: {
  name?: string
  role?: MachineConfigRole
  conf?: string
}): { path: string; content: string; description: string }[] {
  const baseName = opts.name || 'hitachi-csi-multipath'
  const conf = opts.conf
  if (opts.role === 'all') {
    return [
      {
        path: `00-prereq/${baseName}-worker.yaml`,
        content: generateMultipathMachineConfig({ name: `${baseName}-worker`, role: 'worker', conf }),
        description: 'OpenShift MachineConfig for worker nodes (/etc/multipath.conf)',
      },
      {
        path: `00-prereq/${baseName}-master.yaml`,
        content: generateMultipathMachineConfig({ name: `${baseName}-master`, role: 'master', conf }),
        description: 'OpenShift MachineConfig for master/control-plane nodes (/etc/multipath.conf)',
      },
    ]
  }
  return [
    {
      path: `00-prereq/${baseName}.yaml`,
      content: generateMultipathMachineConfig({ name: baseName, role: opts.role || 'worker', conf }),
      description: `OpenShift MachineConfig (${opts.role || 'worker'}) for /etc/multipath.conf`,
    },
  ]
}

/** Metadata.name values produced for the chosen role — used by install.sh detection. */
export function expectedMultipathMachineConfigNames(opts: {
  name?: string
  role?: MachineConfigRole
}): string[] {
  const baseName = opts.name || 'hitachi-csi-multipath'
  if (opts.role === 'all') return [`${baseName}-worker`, `${baseName}-master`]
  return [baseName]
}
