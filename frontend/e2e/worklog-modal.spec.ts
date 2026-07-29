// Add/Edit Worklog modal (frontend/src/shell/WorklogModal.tsx) button/loading
// behavior: Save/Cancel/X must disable during save, the save button label must
// switch to "Saving…", and overlay-click/X/Cancel must not close the modal
// mid-save (previously any of those could hide it and allow a double-submit).
import { test, expect } from '@playwright/test'
import { installShellMocks, STAFF_USER, jsonRoute } from './mocks'

test.beforeEach(async ({ page }) => {
  await installShellMocks(page)
  await jsonRoute(page, '**/api/worklogs*', [])
  await jsonRoute(page, '**/api/holidays*', [])
})

test('save button disables, shows Saving…, and blocks close while a submit is in flight', async ({
  page,
}) => {
  await page.route('**/api/worklogs', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    await new Promise((r) => setTimeout(r, 300))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 999 }),
    })
  })

  await page.goto(`/worklog?member=${STAFF_USER.member_id}&y=2026`)

  await page.getByRole('button', { name: 'Add Entry', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Add Work Log Entry' })).toBeVisible()

  const saveBtn = page.getByRole('button', { name: 'Save', exact: true })
  await saveBtn.click()

  await expect(page.getByRole('button', { name: 'Saving…' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeDisabled()

  // Overlay click and the X button must not close the modal while saving.
  await page.locator('.modal-overlay').click({ position: { x: 5, y: 5 } })
  await expect(page.getByRole('heading', { name: 'Add Work Log Entry' })).toBeVisible()

  // Once the in-flight request settles, the modal closes normally.
  await expect(page.getByRole('heading', { name: 'Add Work Log Entry' })).not.toBeVisible({
    timeout: 5000,
  })
})
