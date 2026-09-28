import { expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'

export const STORAGE_KEY = 'hitachi-csi-wizard-state'
export const WELCOME_SEEN_KEY = 'hitachi-csi-wizard-welcome-seen'

export async function openFresh(page: Page) {
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
}

export function choice(page: Page, title: string) {
  return page.locator('button.choice-card').filter({
    has: page.getByRole('heading', { name: title, exact: true }),
  })
}

export function field(page: Page, label: string) {
  return page.locator('.field').filter({ hasText: label }).first()
}

export function continueButton(page: Page) {
  return page.locator('footer').locator('button.btn-primary')
}

export function sidebar(page: Page) {
  return page.locator('aside.app-sidebar ol.step-list')
}

export async function continueTo(page: Page, heading: string) {
  await continueButton(page).click()
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
}

export async function continueToStorageSystems(page: Page) {
  if ((await sidebar(page).getByRole('button', { name: /Multipath/ }).count()) > 0) {
    await continueTo(page, 'Multipath')
    await continueTo(page, 'Checklist')
  } else {
    await continueTo(page, 'Prerequisites')
  }
  await continueTo(page, 'Storage systems')
}

export async function fillArray(
  page: Page,
  family = 'VSP 5000 / G / E / F',
) {
  await field(page, 'Storage family').locator('select').selectOption({ label: family })
  if (family !== 'VSP One SDS Block') {
    await field(page, 'Serial number').locator('input').fill('400001')
  }
  await field(page, 'REST URL').locator('input').fill('https://192.0.2.10')
  await field(page, 'Username').locator('input').fill('maintenance')
  await field(page, 'Password').locator('input').fill('fixture-password')
}

export async function fillStandardStorageClass(page: Page) {
  await field(page, 'Pool ID').locator('input').fill('0')
  await field(page, 'Port ID(s)').locator('input').fill('CL1-A')
}

export async function seedWizardState(page: Page, seededState: unknown) {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  const reloaded = page.waitForEvent('framenavigated', (frame) => frame === page.mainFrame())
  await page.evaluate(
    ({ storageKey, welcomeSeenKey, seededState: state }) => {
      localStorage.clear()
      localStorage.setItem(storageKey, JSON.stringify(state))
      localStorage.setItem(welcomeSeenKey, '1')
      window.location.reload()
    },
    {
      storageKey: STORAGE_KEY,
      welcomeSeenKey: WELCOME_SEEN_KEY,
      seededState,
    },
  )
  await reloaded
  await page.waitForLoadState('domcontentloaded')
}

export async function downloadZip(page: Page) {
  const downloadButton = page.getByRole('button', { name: 'Download ZIP' })
  await expect(downloadButton).toBeEnabled({ timeout: 30_000 })
  const downloadPromise = page.waitForEvent('download')
  await downloadButton.click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('hitachi-csi-deployment.zip')
  return JSZip.loadAsync(await readFile(await download.path()))
}
