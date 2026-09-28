import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { filledReplicationState } from '../src/test/fixtures'
import {
  STORAGE_KEY,
  choice,
  continueButton,
  continueTo,
  continueToStorageSystems,
  downloadZip,
  field,
  fillArray,
  fillStandardStorageClass,
  openFresh,
  seedWizardState,
  sidebar,
} from './helpers'

async function startWizard(page: Parameters<typeof openFresh>[0]) {
  await openFresh(page)
  await page.getByRole('button', { name: 'Get started' }).click()
}

test('exports classic OpenShift Fibre Channel with MachineConfig and telemetry opt-out', async ({
  page,
}) => {
  await startWizard(page)
  await choice(page, 'Red Hat OpenShift').click()
  await choice(page, 'Fibre Channel (FC)').click()
  await continueTo(page, 'CSI components')
  await page.getByRole('checkbox', { name: /Hitachi Telemetry/ }).uncheck()

  await continueTo(page, 'Multipath')
  await choice(page, 'Self-managed (MachineConfig)').click()
  await continueTo(page, 'Checklist')
  await continueTo(page, 'Storage systems')
  await fillArray(page)
  await continueTo(page, 'StorageClasses & snapshots')
  await fillStandardStorageClass(page)
  await continueTo(page, 'Test volume')
  await continueTo(page, 'Review & export')

  const zip = await downloadZip(page)
  const paths = Object.keys(zip.files)
  const installScript = await zip.file('install.sh')!.async('string')
  const telemetry = await zip.file('02-driver/hspc-csi-telemetry-config.yaml')!.async('string')

  expect(paths).toContain('00-prereq/hitachi-csi-multipath.yaml')
  expect(paths.some((path) => path.toLowerCase().includes('daemonset'))).toBe(false)
  expect(await zip.file('00-prereq/hitachi-csi-multipath.yaml')!.async('string')).toContain(
    'kind: MachineConfig',
  )
  expect(installScript).toContain('wait_mcp_healthy')
  expect(telemetry).toContain('awsEnabled: "false"')
})

test('exports OpenShift virtual-machine iSCSI with a lowercase IQN warning', async ({ page }) => {
  await startWizard(page)
  await choice(page, 'Red Hat OpenShift').click()
  await choice(page, 'Virtual machine').click()
  await choice(page, 'iSCSI').click()
  await expect(page.getByText(/IQNs must be lowercase/)).toBeVisible()
  await continueTo(page, 'CSI components')
  await continueToStorageSystems(page)
  await fillArray(page)
  await continueTo(page, 'StorageClasses & snapshots')
  await fillStandardStorageClass(page)
  await continueTo(page, 'Test volume')
  await continueTo(page, 'Review & export')

  const zip = await downloadZip(page)
  const storageClass = await zip.file('01-storage/storageclass-hitachi-csi.yaml')!.async('string')

  expect(storageClass).toContain('connectionType: iscsi')
  expect(Object.keys(zip.files)).toContain('00-prereq/hitachi-csi-multipath.yaml')
})

test('hides Multipath for NVMe/TCP and requires an NVMe subsystem ID', async ({ page }) => {
  await startWizard(page)
  await choice(page, 'Red Hat OpenShift').click()
  await choice(page, 'NVMe/TCP').click()
  await continueTo(page, 'CSI components')
  await expect(sidebar(page)).not.toContainText('Multipath')
  await continueToStorageSystems(page)
  await fillArray(page)
  await continueTo(page, 'StorageClasses & snapshots')

  await expect(page.locator('.field').filter({ hasText: 'Port ID(s)' })).toHaveCount(0)
  await field(page, 'Pool ID').locator('input').fill('0')
  await expect(continueButton(page)).toBeDisabled()
  await field(page, 'NVMe subsystem ID').locator('input').fill('1')
  await continueTo(page, 'Test volume')
  await continueTo(page, 'Review & export')

  const zip = await downloadZip(page)
  const paths = Object.keys(zip.files)
  const storageClass = await zip.file('01-storage/storageclass-hitachi-csi.yaml')!.async('string')

  expect(paths.some((path) => path.startsWith('00-prereq/'))).toBe(false)
  expect(storageClass).toContain('connectionType: nvme-tcp')
  expect(storageClass).toContain('nvmSubsystemID: "1"')
})

test('omits StorageClass artifacts and hides Test volume when generation is off', async ({
  page,
}) => {
  await startWizard(page)
  await continueTo(page, 'CSI components')
  await continueToStorageSystems(page)
  await fillArray(page)
  await continueTo(page, 'StorageClasses & snapshots')
  await page.getByRole('checkbox', { name: /Generate StorageClass/ }).uncheck()
  await expect(sidebar(page)).not.toContainText('Test volume')
  await continueTo(page, 'Review & export')

  const zip = await downloadZip(page)
  const paths = Object.keys(zip.files)

  expect(paths.some((path) => path.startsWith('01-storage/storageclass-'))).toBe(false)
  expect(paths.some((path) => path.startsWith('06-quickstart/'))).toBe(false)
  expect(paths).toContain('install.sh')
})

test('enabling the OpenShift Console Plugin also packages Performance Metrics', async ({
  page,
}) => {
  await startWizard(page)
  await continueTo(page, 'CSI components')
  await page.getByRole('checkbox', { name: /OpenShift Console Plugin/ }).check()
  await expect(page.getByRole('checkbox', { name: /Performance Metrics/ })).toBeChecked()
  await expect(sidebar(page)).toContainText('Performance Metrics')
  await expect(sidebar(page)).toContainText('Console Plugin')

  await continueToStorageSystems(page)
  await fillArray(page)
  await continueTo(page, 'StorageClasses & snapshots')
  await fillStandardStorageClass(page)
  await continueTo(page, 'Performance Metrics')
  await continueTo(page, 'OpenShift Console Plugin')
  await continueTo(page, 'Test volume')
  await continueTo(page, 'Review & export')

  const zip = await downloadZip(page)
  const paths = Object.keys(zip.files)

  expect(paths.some((path) => path.startsWith('04-metrics/'))).toBe(true)
  expect(paths.some((path) => path.startsWith('05-console/'))).toBe(true)
})

test('coerces a VSP One SDS Block array to the SDS StorageClass shape', async ({ page }) => {
  await startWizard(page)
  await continueTo(page, 'CSI components')
  await continueToStorageSystems(page)
  await fillArray(page, 'VSP One SDS Block')
  await continueTo(page, 'StorageClasses & snapshots')

  await expect(page.getByText(/VSP One SDS Block supports FC, iSCSI, and NVMe\/TCP/)).toBeVisible()
  await expect(page.locator('.field').filter({ hasText: 'Pool ID' })).toHaveCount(0)
  await expect(continueButton(page)).toBeEnabled()
  await continueTo(page, 'Test volume')
  await continueTo(page, 'Review & export')

  const zip = await downloadZip(page)
  const storageClass = await zip.file('01-storage/storageclass-hitachi-csi.yaml')!.async('string')

  expect(storageClass).toContain('storageType: vsp-one-sds-block')
})

test('exports RKE2 with kubectl and a loose multipath.conf', async ({ page }) => {
  await startWizard(page)
  await choice(page, 'Rancher Kubernetes Engine 2 (RKE2)').click()
  await expect(sidebar(page)).not.toContainText('Console Plugin')
  await continueTo(page, 'CSI components')
  await continueToStorageSystems(page)
  await fillArray(page)
  await continueTo(page, 'StorageClasses & snapshots')
  await fillStandardStorageClass(page)
  await continueTo(page, 'Test volume')
  await continueTo(page, 'Review & export')

  const zip = await downloadZip(page)
  const paths = Object.keys(zip.files)
  const installScript = await zip.file('install.sh')!.async('string')

  expect(paths).toContain('00-prereq/multipath.conf')
  expect(paths.some((path) => path.includes('operatorhub-'))).toBe(false)
  expect(installScript).toContain('CMD="kubectl"')
})

test('enables Replication ZIP download when journals are set', async ({ page }) => {
  const state = filledReplicationState({
    replication: {
      primaryKubeconfig: 'dummy-primary-kubeconfig',
      secondaryKubeconfig: 'dummy-secondary-kubeconfig',
    },
  })
  await seedWizardState(page, state)
  await expect
    .poll(() =>
      page.evaluate((storageKey) => {
        const stored = JSON.parse(localStorage.getItem(storageKey) || '{}')
        return stored.components?.replication
      }, STORAGE_KEY),
    )
    .toBe(true)

  await sidebar(page).getByRole('button', { name: /Replication/ }).click()
  await expect(page.getByRole('heading', { name: 'Replication', exact: true })).toBeVisible()
  await choice(page, 'In this wizard').click()
  await field(page, 'Primary site kubeconfig').locator('textarea').fill('dummy-primary-kubeconfig')
  await field(page, 'Secondary site kubeconfig').locator('textarea').fill('dummy-secondary-kubeconfig')

  await sidebar(page).getByRole('button', { name: /Review & export/ }).click()
  await expect(page.getByRole('heading', { name: 'Review & export' })).toBeVisible()

  const zip = await downloadZip(page)
  const paths = Object.keys(zip.files)
  const config = JSON.parse(await zip.file('wizard-config.json')!.async('string'))
  const versionFiles = paths.filter((path) => path === 'VERSION' || path.endsWith('/VERSION'))
  expect(versionFiles).toEqual(['VERSION'])
  const versionText = (await zip.file('VERSION')!.async('string')).trim()
  expect(versionText).toBe(config.wizardVersion)
  const pkg = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'),
  ) as { version: string }
  expect(config.wizardVersion).toMatch(new RegExp(`^${pkg.version.replaceAll('.', '\\.')}\\+`))

  expect(paths).toEqual(
    expect.arrayContaining([
      'INSTALL.md',
      'primary/install.sh',
      'secondary/install.sh',
      'primary/03-replication/remote-kubeconfig.yaml',
      'secondary/03-replication/remote-kubeconfig.yaml',
    ]),
  )
  expect(config.replication.primaryKubeconfig).toBeUndefined()
  expect(config.replication.secondaryKubeconfig).toBeUndefined()
})
