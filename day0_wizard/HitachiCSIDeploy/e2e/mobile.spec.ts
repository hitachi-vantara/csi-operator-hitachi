import { expect, test, type Page } from '@playwright/test'
import { filledState } from '../src/test/fixtures'
import {
  choice,
  continueTo,
  downloadZip,
  openFresh,
  seedWizardState,
} from './helpers'

async function dismissWelcome(page: Page) {
  await page.getByRole('button', { name: 'Get started' }).click()
}

async function openStepPicker(page: Page) {
  await page.locator('.footer-step-picker').click()
  await expect(page.locator('.step-picker-dialog')).toBeVisible()
}

async function jumpToStep(page: Page, name: string | RegExp) {
  await openStepPicker(page)
  await page.locator('.step-picker-dialog').getByRole('button', { name }).click()
  await expect(page.locator('.step-picker-dialog')).not.toBeVisible()
}

test('header does not overflow on phone', async ({ page }) => {
  await openFresh(page)
  await dismissWelcome(page)

  const header = page.locator('.app-header')
  const sizes = await header.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }))
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth)

  await expect(page.getByRole('button', { name: 'More', exact: true })).toBeVisible()
  await expect(page.locator('.header-action-desktop').filter({ hasText: 'About' })).toBeHidden()
})

test('More menu opens About', async ({ page }) => {
  await openFresh(page)
  await dismissWelcome(page)

  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('menuitem', { name: 'About' }).click()

  await expect(
    page.getByRole('heading', { name: 'Configure Hitachi Vantara CSI for your cluster' }),
  ).toBeVisible()
})

test('More menu Reset wizard asks for confirmation before clearing answers', async ({ page }) => {
  await openFresh(page)
  await dismissWelcome(page)
  await choice(page, 'Kubernetes').click()

  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Reset wizard' }).click()

  const dialog = page.getByRole('dialog', { name: 'Reset wizard?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(choice(page, 'Kubernetes')).toHaveClass(/selected/)

  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Reset wizard' }).click()
  await dialog.getByRole('button', { name: 'Reset wizard', exact: true }).click()
  await expect(choice(page, 'Red Hat OpenShift')).toHaveClass(/selected/)
})

test('step picker jumps to Storage systems', async ({ page }) => {
  await openFresh(page)
  await dismissWelcome(page)

  await jumpToStep(page, /Storage systems/)

  await expect(page.getByRole('heading', { name: 'Storage systems', exact: true })).toBeVisible()
})

test('Continue advances on a short path', async ({ page }) => {
  await openFresh(page)
  await dismissWelcome(page)

  await choice(page, 'Kubernetes').click()
  await continueTo(page, 'CSI components')
})

test('ZIP download works on a short path', async ({ page }) => {
  await seedWizardState(page, filledState())
  await jumpToStep(page, /Review & export/)

  const zip = await downloadZip(page)
  expect(Object.keys(zip.files)).toContain('install.sh')
})
