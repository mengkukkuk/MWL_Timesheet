// Dashboard tab (frontend/src/dashboard/DashboardIsland.tsx) error/loading
// state: a failed /api/dashboard fetch must render an error message (distinct
// from the "no data" placeholder) plus a Retry button, and clicking Retry
// must re-fetch and render successfully.
import { test, expect } from '@playwright/test'
import { installShellMocks, STAFF_USER, jsonRoute } from './mocks'

const DASHBOARD_OK = {
  member: {
    name: 'Staff One',
    department: 'Engineering',
    position: 'Engineer',
    level: 'L1',
    staff_id: '1001',
    avatar_url: null,
  },
  months: [],
  total_hours: 0,
  total_done: 0,
  total_in_progress: 0,
  total_overtime: 0,
  total_OT1: 0,
  total_OT1_5: 0,
  total_OT3: 0,
}

test.beforeEach(async ({ page }) => {
  await installShellMocks(page)
  await jsonRoute(page, '**/api/employees', [])
  await jsonRoute(page, `**/api/members/${STAFF_USER.member_id}/skills`, [])
  await jsonRoute(page, `**/api/members/${STAFF_USER.member_id}/project-roles`, {
    main: [],
    support: [],
  })
})

test('shows an error message with Retry on a failed fetch, and Retry recovers', async ({
  page,
}) => {
  // React's <StrictMode> (enabled in main.tsx) double-invokes the mount
  // effect in dev, so two requests can fire before the user ever clicks
  // Retry. Keep the mock failing until the test explicitly swaps it to
  // succeed (right before the Retry click) instead of counting calls, so
  // the race between the two mount-time requests can't flip the result.
  await page.route('**/api/dashboard*', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'internal error' }),
    })
  })

  await page.goto(`/dashboard?member=${STAFF_USER.member_id}&y=2026`)

  await expect(page.getByText('internal error')).toBeVisible()
  const retryBtn = page.getByRole('button', { name: 'Retry' })
  await expect(retryBtn).toBeVisible()

  await page.unroute('**/api/dashboard*')
  await page.route('**/api/dashboard*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(DASHBOARD_OK),
    })
  })

  await retryBtn.click()

  await expect(page.getByText('internal error')).not.toBeVisible()
  await expect(page.getByRole('heading', { name: 'Staff One' })).toBeVisible()
})
