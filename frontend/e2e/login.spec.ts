// Login page (frontend/src/login/LoginApp.tsx) loading + lockout states.
// login.html is a real static file (Vite multi-page entry, see vite.config.ts)
// so the dev server serves it directly at /login.html — no shell mocking is
// needed since this page never mounts AppShell.
import { test, expect } from '@playwright/test'
import { jsonRoute } from './mocks'

test('disables submit and shows signing-in state while /api/login is in flight', async ({
  page,
}) => {
  await page.route('**/api/login', async (route) => {
    await new Promise((r) => setTimeout(r, 300))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, role: 'Staff', member_id: '1001' }),
    })
  })

  await page.goto('/login.html')

  await page.getByLabel('Username').fill('staff1')
  await page.getByLabel('Password').fill('secret123')
  await page.getByRole('button', { name: 'Login' }).click()

  await expect(page.getByRole('button', { name: 'Signing in...' })).toBeDisabled()
})

test('shows lockout countdown and blocks resubmission after a 429', async ({ page }) => {
  await jsonRoute(page, '**/api/login', { error: 'locked', locked_for_seconds: 5 }, 429)

  await page.goto('/login.html')

  await page.getByLabel('Username').fill('staff1')
  await page.getByLabel('Password').fill('wrongpass')
  await page.getByRole('button', { name: 'Login' }).click()

  const lockedBtn = page.getByRole('button', { name: /^Locked \(/ })
  await expect(lockedBtn).toBeVisible()
  await expect(lockedBtn).toBeDisabled()
  await expect(page.getByText(/Too many failed attempts/)).toBeVisible()
})
