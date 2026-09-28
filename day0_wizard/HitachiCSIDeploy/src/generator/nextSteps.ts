import { PLATFORMS } from '../catalog/platforms'
import { resolvedStorageClassName, type SiteId } from '../catalog/sites'
import { quickstartForSite, quickstartInstalledForSite } from '../catalog/siteQuickstart'
import type { WizardState } from '../catalog/types'
import { offlineRegistryPaths } from './offline'
import { resolvedDrClusterNames } from './remoteKubeconfig'

export interface NextStep {
  id: string
  title: string
  body: string
  command?: string
}

function formatList(items: string[]): string {
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`
}

function testVolumeSites(state: WizardState): SiteId[] {
  const sites: SiteId[] = []
  if (quickstartInstalledForSite(state, 'primary')) sites.push('primary')
  if (quickstartInstalledForSite(state, 'secondary')) sites.push('secondary')
  return sites
}

function buildVerifyTestVolumeStep(state: WizardState, clusterCommand: string): NextStep | null {
  const sites = testVolumeSites(state)
  if (sites.length === 0) return null

  if (!state.components.replication || sites.length === 1) {
    const site = sites[0]
    const qs = quickstartForSite(state, site)
    const clusterHint =
      state.components.replication && site === 'secondary'
        ? ' on the secondary cluster'
        : state.components.replication && site === 'primary'
          ? ' on the primary cluster'
          : ''
    return {
      id: 'verify-test-volume',
      title: 'Confirm the test volume',
      body: `Confirm PVC ${qs.pvcName} is Bound and Pod ${qs.podName} is Running${clusterHint}.`,
      command: `${clusterCommand} get pvc ${qs.pvcName}\n${clusterCommand} get pod ${qs.podName}`,
    }
  }

  const bodyParts: string[] = []
  const commandParts: string[] = []
  for (const site of sites) {
    const qs = quickstartForSite(state, site)
    const label = site === 'primary' ? 'primary' : 'secondary'
    bodyParts.push(
      `On the ${label} cluster, confirm PVC ${qs.pvcName} is Bound and Pod ${qs.podName} is Running.`,
    )
    commandParts.push(
      `# ${label.charAt(0).toUpperCase()}${label.slice(1)} cluster\n${clusterCommand} get pvc ${qs.pvcName}\n${clusterCommand} get pod ${qs.podName}`,
    )
  }

  return {
    id: 'verify-test-volume',
    title: 'Confirm the test volume',
    body: bodyParts.join(' '),
    command: commandParts.join('\n'),
  }
}

export function buildNextSteps(state: WizardState): NextStep[] {
  const plat = PLATFORMS[state.platform]
  const clusterCommand = plat.useOc ? 'oc' : 'kubectl'
  const archiveName = 'hitachi-csi-deployment'
  const steps: NextStep[] = [
    {
      id: 'download',
      title: 'Download the deployment ZIP',
      body: 'Download the generated ZIP and keep it secure because it contains the configuration for this deployment.',
    },
    {
      id: 'unzip',
      title: 'Unzip the package',
      body: `Unzip the package on a machine that can reach the cluster, with the correct ${clusterCommand} context ready.${
        state.components.replication
          ? ' Replication exports a two-site package with primary/ and secondary/ install trees.'
          : ''
      }`,
      command: `unzip ${archiveName}.zip -d ${archiveName}\ncd ${archiveName}`,
    },
  ]

  if (!plat.useOc && state.multipath.enabled && state.multipath.includeConf) {
    steps.push({
      id: 'multipath-workers',
      title: 'Configure multipath on worker nodes',
      body: 'Copy the packaged multipath configuration to every worker node, then enable and verify multipathd on each node before installing the stack.',
      command:
        'sudo cp 00-prereq/multipath.conf /etc/multipath.conf\nsudo systemctl enable --now multipathd\nsudo multipath -ll',
    })
  }

  if (plat.useOc && state.multipath.enabled) {
    let body: string
    if (state.openshiftTopology === 'classic') {
      body = state.multipath.alreadyApplied
        ? 'Multipath was marked as already applied, so install.sh skips the MachineConfig apply and waits for the MachineConfigPools to become healthy. MachineConfig changes may have caused rolling node reboots.'
        : 'install.sh applies the packaged MachineConfig and waits for the MachineConfigPools to become healthy; the change may cause rolling node reboots.'
    } else {
      body = state.multipath.alreadyApplied
        ? 'Multipath was marked as already applied, so install.sh skips the DaemonSet apply. Hosted/HCP delivery does not cause a MachineConfigPool reboot cycle.'
        : 'install.sh applies the packaged multipath DaemonSet and waits for its rollout; hosted/HCP delivery does not cause a MachineConfigPool reboot cycle.'
    }
    steps.push({
      id: 'openshift-multipath',
      title: 'Allow for OpenShift multipath setup',
      body,
    })
  }

  if (state.airGapped) {
    const paths = offlineRegistryPaths(state)
    const mirrorExtrasRelevant =
      Boolean(paths.extras?.trim()) &&
      (state.storageClassesEnabled ||
        (plat.useOc && state.multipath.enabled && state.multipath.includeDaemonSet) ||
        (state.components.consolePlugin && plat.supportsConsolePlugin))

    steps.push({
      id: 'air-gapped',
      title: 'Mirror offline content',
      body: `Mirroring means copying container images into your private registry so the cluster does not need the public internet. On a connected computer (public internet access + access to your private registry), run \`chmod +x mirror.sh hvcsi-offline-bundle.sh && ./mirror.sh\` to mirror the enabled components${
        mirrorExtrasRelevant
          ? ', then optionally run \`./mirror.sh extras\` for gap-fill images not covered by \`hvcsi-offline-bundle.sh\`'
          : ''
      }.${
        plat.useOc
          ? ' OpenShift/ROSA also needs a mirrored OperatorHub catalog so OLM (the operator manager) can discover the CSI Driver operator offline. Mirror the catalog with oc-mirror and apply the generated mirror policy (for example ImageDigestMirrorSet / IDMS) and the mirrored CatalogSource manifests on the cluster before install.sh. See INSTALL.md and the notes at the top of mirror.sh.'
          : ''
      }`,
    })
  }

  const hasPrimaryKubeconfig = Boolean(state.replication.primaryKubeconfig?.trim())
  const hasSecondaryKubeconfig = Boolean(state.replication.secondaryKubeconfig?.trim())
  const packagedRemoteKubeconfig = hasPrimaryKubeconfig && hasSecondaryKubeconfig
  const drClusterNames = resolvedDrClusterNames(state)
  const drPolicyHint = `Later DRPolicy clusterName values must match the data keys in each site’s remote-kubeconfig Secret (${drClusterNames.primary} / ${drClusterNames.secondary}).`
  if (state.components.replication && packagedRemoteKubeconfig) {
    steps.push({
      id: 'replication-kubeconfigs',
      title: 'Remote kubeconfig Secrets are already in the ZIP',
      body: `You generated the Secret YAML in the wizard (In this wizard). install.sh applies both Secrets from each site’s folder: hspc-replication-operator-remote-kubeconfig (Replication operator) and remote-kubeconfig (DR Operator). Do not set KUBECONFIG_P or KUBECONFIG_S — those are only for the helper-script path. ${drPolicyHint}`,
    })
  } else if (state.components.replication) {
    steps.push({
      id: 'replication-kubeconfigs',
      title: 'Remote kubeconfig at install time',
      body: `If you did not generate Secret YAML in the wizard, set both kubeconfig paths on the install host so install.sh can create both Secrets on each site (hspc-replication-operator-remote-kubeconfig and remote-kubeconfig). Skip this if those YAML files are already in 03-replication/ from the wizard. ${drPolicyHint}`,
      command:
        'export KUBECONFIG_P=/path/to/primary-kubeconfig\nexport KUBECONFIG_S=/path/to/secondary-kubeconfig',
    })
  }

  const installedItems = ['the CSI Driver', 'storage resources']
  if (state.components.replication) installedItems.push('Replication and the DR Operator')
  if (state.components.metrics) installedItems.push('Performance Metrics')
  if (state.components.consolePlugin) installedItems.push('the OpenShift Console Plugin')
  if (testVolumeSites(state).length > 0) installedItems.push('the test volume')

  if (state.components.replication) {
    steps.push(
      {
        id: 'install-primary',
        title: 'Run the installer (primary site)',
        body: `Set your ${clusterCommand} context to the primary cluster. The script installs ${formatList(
          installedItems,
        )} in the required order.`,
        command: 'cd primary\nchmod +x install.sh && ./install.sh',
      },
      {
        id: 'install-secondary',
        title: 'Run the installer (secondary site)',
        body: `Switch your ${clusterCommand} context to the secondary cluster, then run the installer from the secondary folder.`,
        command:
          'cd secondary || cd ../secondary\nchmod +x install.sh && ./install.sh',
      },
    )
  } else {
    steps.push({
      id: 'install',
      title: 'Run the installer',
      body: `The script installs ${formatList(installedItems)} in the required order.`,
      command: 'chmod +x install.sh && ./install.sh',
    })
  }

  const verifyTestVolume = buildVerifyTestVolumeStep(state, clusterCommand)
  if (verifyTestVolume) steps.push(verifyTestVolume)

  if (state.components.consolePlugin) {
    const exampleSc = resolvedStorageClassName(state)
    const scHint = exampleSc
      ? ` Open a Hitachi-backed StorageClass such as ${exampleSc}.`
      : ' Open a StorageClass provisioned by the Hitachi CSI Driver.'
    steps.push({
      id: 'open-console-dashboard',
      title: 'Open the HitachiCSI tab on a StorageClass',
      body: `In the OpenShift web console, go to Storage → StorageClasses.${scHint} The HitachiCSI tab on that StorageClass is the dashboard. install.sh already applied the plugin and enabled it — you do not turn it on by hand.`,
    })
  }

  return steps
}

export function nextStepsToMarkdown(
  steps: NextStep[],
  meta?: {
    platformDisplayName?: string
    platformVersion?: string
    driverVersion?: string
  },
): string {
  const metadata = [
    meta?.platformDisplayName ? `- Platform: ${meta.platformDisplayName}` : undefined,
    meta?.platformVersion ? `- Platform version: ${meta.platformVersion}` : undefined,
    meta?.driverVersion ? `- CSI Driver version: ${meta.driverVersion}` : undefined,
  ].filter((line): line is string => Boolean(line))

  const sections = steps.map((step, index) => {
    const command = step.command ? `\n\n\`\`\`bash\n${step.command}\n\`\`\`` : ''
    return `## ${index + 1}. ${step.title}\n\n${step.body}${command}`
  })

  return ['# Deployment next steps', metadata.join('\n'), ...sections].filter(Boolean).join('\n\n') + '\n'
}
