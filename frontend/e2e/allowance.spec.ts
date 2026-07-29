// Allowance tab (frontend/src/shell/AllowanceTab.tsx) delete guard: the
// delete button must disable immediately after the first click and cannot be
// re-triggered while the DELETE request is still in flight.
import { test, expect } from '@playwright/test'
import { installShellMocks, STAFF_USER, jsonRoute } from './mocks'

const ROW = {
  ID: 501,
  log_date: '2026-01-15',
  ProjectCode: 'P-001',
  Description: 'Sample Project',
  type: 'Normal',
  IsEditRow: 1,
}

test.beforeEach(async ({ page }) => {
  await installShellMocks(page)
  await jsonRoute(page, '**/api/allowance*', [ROW])

  page.on('dialog', (dialog) => dialog.accept())
})

test('delete button disables after first click and ignores repeat clicks while pending', async ({
  page,
}) => {
  let deleteCalls = 0
  await page.route('**/api/allowance/501', async (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback()
    deleteCalls++
    await new Promise((r) => setTimeout(r, 400))
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })

  await page.goto(`/allowance?member=${STAFF_USER.member_id}&y=2026`)

  const deleteBtn = page.getByTitle('Delete')
  await expect(deleteBtn).toBeVisible()

  await deleteBtn.click()
  await expect(deleteBtn).toBeDisabled()

  // Force-click again while disabled — must not fire a second DELETE.
  await deleteBtn.click({ force: true }).catch(() => {})
  await page.waitForTimeout(500)

  expect(deleteCalls).toBe(1)
})
