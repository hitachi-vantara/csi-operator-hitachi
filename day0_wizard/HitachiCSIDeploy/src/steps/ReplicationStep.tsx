import { useRef, useState } from 'react'
import { useWizard } from '../state/WizardContext'
import { ResourcePartitioningDiagram } from '../components/ResourcePartitioningDiagram'
import { Callout, ChoiceCard, CodeBlock, DownloadButton, Field, HelpTip, PasswordInput, Section } from '../components/ui'
import { PLATFORMS } from '../catalog/platforms'
import { HELP } from '../catalog/help'
import {
  applyReplicationSecretPatch,
  resolvedReplicationStorageSecrets,
} from '../catalog/replicationSecrets'
import { ensureSitesForReplication, getSiteStorage, hrpcPairSystem } from '../catalog/sites'
import { hrpcPairResourceGroupIds, hrpcResourceGroupIdReason } from '../catalog/validation'
import type { RemoteKubeconfigSource } from '../catalog/types'
import { useUiMode } from '../state/UiModeContext'
import {
  generateDrRemoteKubeconfigSecret,
  generateRemoteKubeconfigSecret,
  generateRemoteKubeconfigScript,
  REMOTE_KUBECONFIG_SECRET_NAME,
  resolvedDrClusterNames,
} from '../generator/remoteKubeconfig'

const RESOURCE_PARTITIONING_ITEMS = [
  {
    id: 'journal-access',
    title: 'Journal',
    body: 'Create the journal from the resource group configured for CSI Driver, and confirm the Replication user can access it.',
  },
  {
    id: 'both-sites',
    title: 'Both sites configured',
    body: 'Resource partitioning must be set on both the primary and secondary arrays — one-sided is not supported.',
  },
  {
    id: 'host-group',
    title: 'Host group',
    body: (
      <>
        Allocate one undefined host group ID for each port in that resource group. A host group named{' '}
        <code>spc-replication</code> is created when you create a Replication. If a host group with that name
        already exists on the same port in a different resource group, delete it first.
      </>
    ),
  },
  {
    id: 'csi-driver-user',
    title: 'Same user as CSI Driver',
    body: 'On each array, use the same storage system user that CSI Driver is configured with. Primary and secondary sites may use different users.',
  },
] as const

export function ReplicationStep() {
  const { state, setState, goToFix } = useWizard()
  const { isAdvanced } = useUiMode()
  const [stepAdvanced, setStepAdvanced] = useState(false)
  const showFull = isAdvanced || stepAdvanced
  const plat = PLATFORMS[state.platform]
  const cmd = plat.useOc ? 'oc' : 'kubectl'
  const primaryFileRef = useRef<HTMLInputElement>(null)
  const secondaryFileRef = useRef<HTMLInputElement>(null)

  const ensured = ensureSitesForReplication(state)
  const primarySite = getSiteStorage(ensured, 'primary')
  const secondarySite = getSiteStorage(ensured, 'secondary')
  const primaryPair = hrpcPairSystem(primarySite.storageSystems) ?? primarySite.storageSystems[0]
  const secondaryPair = hrpcPairSystem(secondarySite.storageSystems) ?? secondarySite.storageSystems[0]

  const secrets = resolvedReplicationStorageSecrets(state)

  const secretName =
    state.replication.remoteKubeconfigSecretName || REMOTE_KUBECONFIG_SECRET_NAME
  const ns = state.replication.namespace
  const drClusterNames = resolvedDrClusterNames(state)

  const helperScript = generateRemoteKubeconfigScript({
    namespace: ns,
    cmd: cmd as 'oc' | 'kubectl',
    secretName,
    primaryClusterName: drClusterNames.primary,
    secondaryClusterName: drClusterNames.secondary,
  })

  const primarySecretYaml = state.replication.secondaryKubeconfig?.trim()
    ? generateRemoteKubeconfigSecret({
        namespace: ns,
        kubeconfig: state.replication.secondaryKubeconfig,
        secretName,
      })
    : null

  const primaryDrSecretYaml = state.replication.secondaryKubeconfig?.trim()
    ? generateDrRemoteKubeconfigSecret({
        namespace: ns,
        kubeconfig: state.replication.secondaryKubeconfig,
        clusterName: drClusterNames.secondary,
      })
    : null

  const secondarySecretYaml = state.replication.primaryKubeconfig?.trim()
    ? generateRemoteKubeconfigSecret({
        namespace: ns,
        kubeconfig: state.replication.primaryKubeconfig,
        secretName,
      })
    : null

  const secondaryDrSecretYaml = state.replication.primaryKubeconfig?.trim()
    ? generateDrRemoteKubeconfigSecret({
        namespace: ns,
        kubeconfig: state.replication.primaryKubeconfig,
        clusterName: drClusterNames.primary,
      })
    : null

  const rpAck = state.replication.resourcePartitioningAcknowledged ?? {}
  const rgIds = hrpcPairResourceGroupIds(state)
  const partitioningOn = !!(rgIds.primary || rgIds.secondary)
  const rgReason = hrpcResourceGroupIdReason(state, { requireBoth: true })
  const rgReady = !rgReason
  const partitioningDiagram = (
    <ResourcePartitioningDiagram
      primary={{
        serial: primaryPair?.serial,
        resourceGroupID: primaryPair?.resourceGroupID,
        journal:
          secrets.find((s) => s.serial.trim() && s.serial.trim() === (primaryPair?.serial || '').trim())
            ?.journal ?? secrets[0]?.journal,
      }}
      secondary={{
        serial: secondaryPair?.serial,
        resourceGroupID: secondaryPair?.resourceGroupID,
        journal:
          secrets.find((s) => s.serial.trim() && s.serial.trim() === (secondaryPair?.serial || '').trim())
            ?.journal ?? secrets[1]?.journal,
      }}
    />
  )
  const goToStorage = () => {
    const focus: 'primary' | 'secondary' = rgIds.primary ? 'secondary' : 'primary'
    goToFix({ message: '', stepId: 'storage', site: focus })
  }
  const storageJump = (
    <button type="button" className="btn btn-secondary" onClick={goToStorage}>
      Go to Storage systems
    </button>
  )
  const toggleRpItem = (id: string) => {
    setState((s) => ({
      ...s,
      replication: {
        ...s.replication,
        resourcePartitioningAcknowledged: {
          ...(s.replication.resourcePartitioningAcknowledged ?? {}),
          [id]: !s.replication.resourcePartitioningAcknowledged?.[id],
        },
      },
    }))
  }

  const updateSecret = (idx: number, patch: Partial<(typeof secrets)[number]>) => {
    setState((s) => applyReplicationSecretPatch(s, idx, patch))
  }

  const readFile = (file: File, which: 'primary' | 'secondary') => {
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result || '')
      patchKubeconfig(which, text)
    }
    reader.readAsText(file)
  }

  const setKubeconfigSource = (source: RemoteKubeconfigSource) => {
    setState((s) => ({
      ...s,
      replication: { ...s.replication, remoteKubeconfigSource: source },
    }))
  }

  const patchKubeconfig = (which: 'primary' | 'secondary', value: string) => {
    setState((s) => ({
      ...s,
      replication: {
        ...s.replication,
        [which === 'primary' ? 'primaryKubeconfig' : 'secondaryKubeconfig']: value,
        remoteKubeconfigSource:
          s.replication.remoteKubeconfigSource === 'install-time' ? 'install-time' : 'wizard',
      },
    }))
  }

  const siteLabel = (idx: number) => (idx === 0 ? 'Primary' : 'Secondary')

  const kubeconfigFields = (
    <div className="field-grid" style={{ marginTop: showFull ? '0.75rem' : 0 }}>
      <Field label="Primary site kubeconfig" hint="Becomes the Secret applied on the secondary site.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <input
            ref={primaryFileRef}
            type="file"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) readFile(f, 'primary')
            }}
          />
          <textarea
            rows={6}
            style={{ fontFamily: 'var(--hv-mono)', fontSize: '0.75rem', width: '100%' }}
            placeholder="Paste primary kubeconfig YAML…"
            value={state.replication.primaryKubeconfig || ''}
            onChange={(e) => patchKubeconfig('primary', e.target.value)}
          />
          {(state.replication.primaryKubeconfig || '').trim() && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                setState((s) => ({
                  ...s,
                  replication: { ...s.replication, primaryKubeconfig: '' },
                }))
              }
            >
              Clear primary
            </button>
          )}
        </div>
      </Field>

      <Field label="Secondary site kubeconfig" hint="Becomes the Secret applied on the primary site.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <input
            ref={secondaryFileRef}
            type="file"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) readFile(f, 'secondary')
            }}
          />
          <textarea
            rows={6}
            style={{ fontFamily: 'var(--hv-mono)', fontSize: '0.75rem', width: '100%' }}
            placeholder="Paste secondary kubeconfig YAML…"
            value={state.replication.secondaryKubeconfig || ''}
            onChange={(e) => patchKubeconfig('secondary', e.target.value)}
          />
          {(state.replication.secondaryKubeconfig || '').trim() && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                setState((s) => ({
                  ...s,
                  replication: { ...s.replication, secondaryKubeconfig: '' },
                }))
              }
            >
              Clear secondary
            </button>
          )}
        </div>
      </Field>
    </div>
  )

  const secretYamlDownloads = (primarySecretYaml || secondarySecretYaml) && (
    <div style={{ marginTop: '1rem' }}>
      {primarySecretYaml && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '0.9rem' }}>
              Secret for primary site (contains secondary kubeconfig)
            </strong>
            <DownloadButton
              filename="remote-kubeconfig-for-primary-site.yaml"
              content={primarySecretYaml}
              label="Download Replication operator"
            />
          </div>
          {showFull && (
            <CodeBlock
              className="yaml-preview"
              style={{ maxHeight: 180, marginTop: '0.35rem' }}
              text={primarySecretYaml}
            >
              {primarySecretYaml.slice(0, 400)}…
            </CodeBlock>
          )}
          {primaryDrSecretYaml && (
            <>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: '0.75rem',
                }}
              >
                <strong style={{ fontSize: '0.9rem' }}>
                  DR Operator Secret for primary site (data key {drClusterNames.secondary})
                </strong>
                <DownloadButton
                  filename="remote-kubeconfig.yaml"
                  content={primaryDrSecretYaml}
                  label="Download DR Operator"
                />
              </div>
              {showFull && (
                <CodeBlock
                  className="yaml-preview"
                  style={{ maxHeight: 180, marginTop: '0.35rem' }}
                  text={primaryDrSecretYaml}
                >
                  {primaryDrSecretYaml.slice(0, 400)}…
                </CodeBlock>
              )}
            </>
          )}
        </>
      )}
      {secondarySecretYaml && (
        <>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '0.75rem',
            }}
          >
            <strong style={{ fontSize: '0.9rem' }}>
              Secret for secondary site (contains primary kubeconfig)
            </strong>
            <DownloadButton
              filename="remote-kubeconfig-for-secondary-site.yaml"
              content={secondarySecretYaml}
              label="Download Replication operator"
            />
          </div>
          {showFull && (
            <CodeBlock
              className="yaml-preview"
              style={{ maxHeight: 180, marginTop: '0.35rem' }}
              text={secondarySecretYaml}
            >
              {secondarySecretYaml.slice(0, 400)}…
            </CodeBlock>
          )}
          {secondaryDrSecretYaml && (
            <>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: '0.75rem',
                }}
              >
                <strong style={{ fontSize: '0.9rem' }}>
                  DR Operator Secret for secondary site (data key {drClusterNames.primary})
                </strong>
                <DownloadButton
                  filename="remote-kubeconfig.yaml"
                  content={secondaryDrSecretYaml}
                  label="Download DR Operator"
                />
              </div>
              {showFull && (
                <CodeBlock
                  className="yaml-preview"
                  style={{ maxHeight: 180, marginTop: '0.35rem' }}
                  text={secondaryDrSecretYaml}
                >
                  {secondaryDrSecretYaml.slice(0, 400)}…
                </CodeBlock>
              )}
            </>
          )}
        </>
      )}
    </div>
  )

  const kubeconfigSource = state.replication.remoteKubeconfigSource
  const kubeconfigChoice = (
    <>
      <p style={{ marginTop: 0, fontSize: '0.9rem', color: 'var(--hv-text-subtle)' }}>
        Each site needs Secret <code>{secretName}</code> and <code>remote-kubeconfig</code> in{' '}
        <code>{ns}</code>, each containing the <em>other</em> site&apos;s kubeconfig. Choose how you
        will create them before Continue — kubeconfig files are not saved with the wizard config.
      </p>
      {showFull && (
        <div className="field-grid" style={{ marginBottom: '0.75rem' }}>
          <Field
            label="Primary cluster name"
            hint="DR Operator data key on the secondary site; DRPolicy clusterName for the primary cluster."
          >
            <input
              value={state.replication.primaryClusterName}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  replication: { ...s.replication, primaryClusterName: e.target.value },
                }))
              }
            />
          </Field>
          <Field
            label="Secondary cluster name"
            hint="DR Operator data key on the primary site; DRPolicy clusterName for the secondary cluster."
          >
            <input
              value={state.replication.secondaryClusterName}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  replication: { ...s.replication, secondaryClusterName: e.target.value },
                }))
              }
            />
          </Field>
        </div>
      )}
      {!showFull && (
        <p style={{ margin: '0.35rem 0 0', fontSize: '0.9rem', color: 'var(--hv-text-subtle)' }}>
          DR Operator registers the other site as primary / secondary — open Advanced to change the names.
        </p>
      )}
      <div className="card-grid" style={{ marginTop: '0.75rem' }}>
        <ChoiceCard
          title="In this wizard"
          description="Paste both kubeconfigs to package Secret YAML in the ZIP. Values stay in this session only."
          selected={kubeconfigSource === 'wizard'}
          onClick={() => setKubeconfigSource('wizard')}
        />
        <ChoiceCard
          title="At install time"
          description="Set KUBECONFIG_P and KUBECONFIG_S (or apply the Secrets another way) when you run install.sh."
          selected={kubeconfigSource === 'install-time'}
          onClick={() => setKubeconfigSource('install-time')}
        />
      </div>
      {kubeconfigSource === 'wizard' && (
        <>
          <p style={{ margin: '0.85rem 0 0', fontSize: '0.9rem', color: 'var(--hv-text-subtle)' }}>
            Upload or paste both kubeconfigs. Reloading a saved config clears these fields — paste them
            again, or switch to At install time.
          </p>
          {kubeconfigFields}
          {secretYamlDownloads}
        </>
      )}
      {kubeconfigSource === 'install-time' && (
        <div className="option-panel" style={{ marginTop: '0.85rem' }}>
          <p className="option-panel-body">
            The export ZIP includes <code>create-remote-kubeconfig-secrets.sh</code>. Set these paths on
            the machine that runs <code>install.sh</code> (or run the helper alone); the script builds
            and applies both Secrets on each site.
          </p>
          <CodeBlock>{`export KUBECONFIG_P=/path/to/primary-kubeconfig
export KUBECONFIG_S=/path/to/secondary-kubeconfig`}</CodeBlock>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
            <DownloadButton
              filename="create-remote-kubeconfig-secrets.sh"
              content={helperScript}
              label="Download helper script (.sh)"
              mime="text/x-shellscript"
            />
          </div>
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.8rem', color: 'var(--hv-text-subtle)' }}>
            Optional early download — the same script ships in <code>03-replication/</code> inside the ZIP.
            You can also apply the Secrets another way before continuing install.sh.
          </p>
        </div>
      )}
    </>
  )

  return (
    <div className="step-panel">
      <h2>Replication</h2>
      <p className="lede">
        {showFull
          ? 'Configure journals and remote access for the primary and secondary sites. The export packages both sites (including the Replication operator and the included DR Operator) — you do not run install commands by hand on this step.'
          : 'Provide the journal IDs for both sites, and choose how you will create the remote kubeconfig Secrets (paste them here, or create them at install time).'}
      </p>

      {!partitioningOn ? (
        <Callout>
          <strong>Resource partitioning is off.</strong>{' '}
          <HelpTip text={HELP.replicationResourcePartitioningHint} diagram={partitioningDiagram} />
          <p style={{ margin: '0.35rem 0 0' }}>
            It stays unavailable until you set Resource group ID on both sites’ Replication arrays. That field
            is on the Storage systems step, on the array marked for Replication (Primary and Secondary site
            tabs).
          </p>
          <div style={{ marginTop: '0.65rem' }}>{storageJump}</div>
        </Callout>
      ) : (
        <Section
          title="Resource partitioning checklist"
          help={HELP.replicationResourcePartitioningHint}
          helpDiagram={partitioningDiagram}
        >
          <ul className="checklist">
            <li>
              <input
                type="checkbox"
                checked={rgReady}
                readOnly
                disabled
                style={{ width: 18, height: 18, accentColor: 'var(--hv-primary)', marginTop: 4 }}
              />
              <div>
                <strong>Resource group IDs</strong>
                <p style={{ margin: '0.25rem 0', fontSize: '0.9rem', color: 'var(--hv-text-subtle)' }}>
                  {rgReady
                    ? `Primary resource group ID ${rgIds.primary}; secondary resource group ID ${rgIds.secondary}. Each array has its own ID — they do not need to match.`
                    : rgReason}
                </p>
                {!rgReady && <div style={{ marginTop: '0.65rem' }}>{storageJump}</div>}
              </div>
            </li>
            {RESOURCE_PARTITIONING_ITEMS.map((item) => (
              <li key={item.id}>
                <input
                  type="checkbox"
                  checked={!!rpAck[item.id]}
                  onChange={() => toggleRpItem(item.id)}
                  style={{ width: 18, height: 18, accentColor: 'var(--hv-primary)', marginTop: 4 }}
                />
                <div>
                  <strong>{item.title}</strong>
                  <p style={{ margin: '0.25rem 0', fontSize: '0.9rem', color: 'var(--hv-text-subtle)' }}>
                    {item.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {showFull ? (
        <>
          <Section title="Operator namespace">
            <Field
              label="Replication operator namespace"
              hint="Upstream default is hspc-replication-operator-system."
            >
              <input
                value={state.replication.namespace}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    replication: { ...s.replication, namespace: e.target.value },
                  }))
                }
              />
            </Field>
          </Section>

          <Section title="Storage secrets (journals)" help={HELP.journalsVsRemote}>
            <p style={{ marginTop: 0, fontSize: '0.9rem', color: 'var(--hv-text-subtle)' }}>
              Array serial, URL, user, and password stay in sync with each site’s Replication array on Storage
              systems. Set journal IDs here — they become <code>storage-secrets.yaml</code> in the export.
            </p>
            {secrets.map((sec, idx) => (
              <div key={idx} className="field-grid" style={{ marginBottom: '0.75rem' }}>
                <Field label={`${siteLabel(idx)} serial`} hint="Array serial for this replication site.">
                  <input value={sec.serial} onChange={(e) => updateSecret(idx, { serial: e.target.value })} />
                </Field>
                <Field label={`${siteLabel(idx)} URL`} hint="Array REST endpoint for this site.">
                  <input value={sec.url} onChange={(e) => updateSecret(idx, { url: e.target.value })} />
                </Field>
                <Field label={`${siteLabel(idx)} user`}>
                  <input value={sec.user} onChange={(e) => updateSecret(idx, { user: e.target.value })} />
                </Field>
                <Field label={`${siteLabel(idx)} password`}>
                  <PasswordInput
                    value={sec.password}
                    onChange={(value) => updateSecret(idx, { password: value })}
                  />
                </Field>
                <Field label={`${siteLabel(idx)} journal ID`} help={HELP.journal}>
                  <input value={sec.journal} onChange={(e) => updateSecret(idx, { journal: e.target.value })} />
                </Field>
              </div>
            ))}
          </Section>

          <Section title="Remote kubeconfig (both sites)" help={HELP.remoteKubeconfig}>
            {kubeconfigChoice}
          </Section>
        </>
      ) : (
        <>
          <Section title="Storage secrets (journals)" help={HELP.journal}>
            <p style={{ marginTop: 0, fontSize: '0.9rem', color: 'var(--hv-text-subtle)' }}>
              Journal volume IDs on each site’s Replication array. Array credentials come from the Storage
              systems step.
            </p>
            <div className="field-grid" style={{ marginBottom: '0.75rem' }}>
              <Field label="Primary journal ID" help={HELP.journal}>
                <input
                  value={secrets[0]?.journal || ''}
                  onChange={(e) => updateSecret(0, { journal: e.target.value })}
                />
              </Field>
              <Field label="Secondary journal ID" help={HELP.journal}>
                <input
                  value={secrets[1]?.journal || ''}
                  onChange={(e) => updateSecret(1, { journal: e.target.value })}
                />
              </Field>
            </div>
          </Section>

          <Section title="Remote kubeconfig (both sites)" help={HELP.remoteKubeconfig}>
            {kubeconfigChoice}
          </Section>
        </>
      )}

      {!isAdvanced && (
        <div className="advanced-section">
          <button
            type="button"
            className="advanced-section-toggle"
            onClick={() => setStepAdvanced((v) => !v)}
          >
            {stepAdvanced ? 'Hide advanced on this step' : 'Show advanced on this step'}
          </button>
        </div>
      )}
    </div>
  )
}
