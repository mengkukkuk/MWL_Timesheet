// Shared Playwright mocking helpers. Every e2e test runs against the Vite dev
// server with no live Flask backend, so every /api/* call the mounted
// component tree makes must be intercepted via page.route().
import type { Page } from '@playwright/test'

export interface MockUser {
  id: number
  username: string
  role: string
  member_id: string
}

// Non-elevated by default: avoids needing to mock elevated-only endpoints
// (e.g. /api/users/pending/count) and gets auto-pinned to member_id by
// useShellState, so tests don't need to drive the (disabled) member select.
export const STAFF_USER: MockUser = {
  id: 1,
  username: 'staff1',
  role: 'Staff',
  member_id: '1001',
}

export const STAFF_MEMBER = {
  id: '1001',
  name: 'Staff One',
  department: 'Engineering',
  staff_id: '1001',
  position: 'Engineer',
  level: 'L1',
  jg: 'JG1',
  avatar_url: null,
}

export function jsonRoute(page: Page, url: string, body: unknown, status = 200) {
  return page.route(url, (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }),
  )
}

// Mocks the endpoints every AppShell mount fetches unconditionally, regardless
// of which tab is active: /api/me (useCurrentUser), /api/members (both
// useShellState and WorklogModal), /api/settings/time-presets and
// /api/description (both WorklogModal, always mounted by AppShell).
export async function installShellMocks(page: Page, user: MockUser = STAFF_USER): Promise<void> {
  await jsonRoute(page, '**/api/me', user)
  await jsonRoute(page, '**/api/members', [STAFF_MEMBER])
  await jsonRoute(page, '**/api/settings/time-presets', { start: [], end: [] })
  await jsonRoute(page, '**/api/description', [])
}
