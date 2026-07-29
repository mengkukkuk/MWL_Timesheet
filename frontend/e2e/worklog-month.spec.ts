// Work Log tab (frontend/src/worklog/WorklogIsland.tsx) month switching:
// changing the month via the <select>, the prev/next arrow buttons, or the
// Dashboard's Monthly Breakdown row-click hand-off must all update the
// displayed records to the newly selected month.
//
// Regression coverage for the DOM-derived-context bug: the island used to read
// member/year/month off the <select> elements and only re-read on native
// `change` events. Those selects are React-controlled, so (a) #member-select's
// .value was '' until /api/members resolved and React never fires `change` when
// it later fills it in — the table stayed blank forever; and (b) because the
// island returned null on that first commit, #month-select wasn't in the DOM
// when the mount effect ran, so no month listener was ever attached.
import { test, expect } from '@playwright/test'
import { installShellMocks, STAFF_USER, STAFF_MEMBER, jsonRoute } from './mocks'

function worklogsForMonth(month: number) {
  return [
    {
      id: month,
      member_id: STAFF_USER.member_id,
      log_date: `2026-${String(month).padStart(2, '0')}-01`,
      project: 'PRJ',
      project_description: 'Project',
      task: 'Task',
      start_time: '09:00',
      end_time: '18:00',
      hours: 8,
      status: 'Done',
      note: `note-month-${month}`,
      IsEditRow: 1,
      is_allowance: 0,
    },
  ]
}

async function routeWorklogsByMonth(page: import('@playwright/test').Page, onRequest?: (month: number) => void) {
  await page.route('**/api/worklogs*', async (route) => {
    const url = new URL(route.request().url())
    const month = parseInt(url.searchParams.get('month') || '0', 10)
    onRequest?.(month)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(worklogsForMonth(month)),
    })
  })
}

test.beforeEach(async ({ page }) => {
  await installShellMocks(page)
  await jsonRoute(page, '**/api/holidays*', [])
  await routeWorklogsByMonth(page)
})

test('changing the month via the select updates the displayed records', async ({ page }) => {
  await page.goto(`/worklog?member=${STAFF_USER.member_id}&y=2026`)

  await page.selectOption('#month-select', '5')
  await expect(page.getByText('note-month-5')).toBeVisible()

  await page.selectOption('#month-select', '9')
  await expect(page.getByText('note-month-9')).toBeVisible()
  await expect(page.getByText('note-month-5')).not.toBeVisible()
})

test('the prev/next month arrow buttons update the displayed records', async ({ page }) => {
  await page.goto(`/worklog?member=${STAFF_USER.member_id}&y=2026`)

  await page.selectOption('#month-select', '6')
  await expect(page.getByText('note-month-6')).toBeVisible()

  const prev = page.getByRole('button', { name: 'Previous month' })
  const next = page.getByRole('button', { name: 'Next month' })

  await next.click() // -> 7
  await expect(page.getByText('note-month-7')).toBeVisible()

  await prev.click() // -> 6
  await prev.click() // -> 5
  await expect(page.getByText('note-month-5')).toBeVisible()
})

test('the arrows wrap around the year boundary in both directions', async ({ page }) => {
  await page.goto(`/worklog?member=${STAFF_USER.member_id}&y=2026&m=12`)
  await expect(page.getByText('note-month-12')).toBeVisible()

  await page.getByRole('button', { name: 'Next month' }).click()
  await expect(page.getByText('note-month-1')).toBeVisible()

  await page.getByRole('button', { name: 'Previous month' }).click()
  await expect(page.getByText('note-month-12')).toBeVisible()
})

// Bug 1: landing straight on /worklog as Staff used to render nothing, because
// the island derived its member from #member-select's .value while /api/members
// was still in flight (so the <option> didn't exist yet and the browser forced
// .value === ''), and React never fires a `change` event when it later fills
// the select in. Delaying /api/members reproduces that race deterministically.
test('the table renders on first load even when /api/members resolves late', async ({ page }) => {
  await page.route('**/api/members', async (route) => {
    await new Promise((r) => setTimeout(r, 500))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([STAFF_MEMBER]),
    })
  })

  await page.goto(`/worklog?member=${STAFF_USER.member_id}&y=2026&m=4`)

  await expect(page.getByText('note-month-4')).toBeVisible()
})

test('clicking a month row on the Dashboard opens Work Log already showing that month', async ({ page }) => {
  const requestedMonths: number[] = []
  await routeWorklogsByMonth(page, (month) => requestedMonths.push(month))

  await jsonRoute(page, '**/api/dashboard*', {
    member: {
      name: STAFF_MEMBER.name,
      department: STAFF_MEMBER.department,
      position: STAFF_MEMBER.position,
      level: STAFF_MEMBER.level,
      staff_id: STAFF_MEMBER.staff_id,
      avatar_url: null,
    },
    months: [{ month: 3, total_hours: 100, done: 10, missing: 0, man_day: 0 }],
    total_hours: 100,
    total_done: 10,
    total_in_progress: 0,
    total_overtime: 0,
    total_OT1: 0,
    total_OT1_5: 0,
    total_OT3: 0,
  })
  await jsonRoute(page, '**/api/employees', [])
  await jsonRoute(page, `**/api/members/${STAFF_USER.member_id}/skills`, [])
  await jsonRoute(page, `**/api/members/${STAFF_USER.member_id}/project-roles`, { main: [], support: [] })

  await page.goto(`/dashboard?member=${STAFF_USER.member_id}&y=2026`)
  await page.getByRole('row', { name: /March/ }).click()

  await expect(page.getByText('note-month-3')).toBeVisible()
  // The very first /api/worklogs request must already target the clicked
  // month — not today's real month — otherwise the fix regressed.
  expect(requestedMonths[0]).toBe(3)
})
