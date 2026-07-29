// Full-teardown React shell — the single top-level component that replaces the
// vanilla templates/app.html chrome (top nav, member/year selector bar, tab
// switching) plus the LegacyRoute/showTab bridge. Composes the shared bits
// (ToastHost, the Add/Edit Worklog modal, the Squad Draft panel) and swaps in
// each tab's island as page content. Heavy islands are React.lazy so only the
// active tab's chunk loads. Renders inside main.tsx's RouterProvider, so the
// URL path is the active tab and ?member=&y= is the shared context (owned by
// useShellState). NOT wired into router.tsx/main.tsx yet — that is the
// deferred destructive step (see purring-weaving-pillow.md PR10).
import { Suspense, lazy, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { t } from '../lib'
import { Nav, type TabName } from './Nav'
import { Selector } from './Selector'
import { ToastHost } from './ToastHost'
import { WorklogModal } from './WorklogModal'
import { DraftPanel } from './DraftPanel'
import { AllowanceTab } from './AllowanceTab'
import { useShellState } from './useShellState'
import { usePendingCount } from '../settings/useSettingsData'

const DashboardTab = lazy(() =>
  import('./DashboardTab').then((m) => ({ default: m.DashboardTab })),
)
const WorklogIsland = lazy(() =>
  import('../worklog/WorklogIsland').then((m) => ({ default: m.WorklogIsland })),
)
const FilesIsland = lazy(() =>
  import('../files/FilesIsland').then((m) => ({ default: m.FilesIsland })),
)
const ProjectsSummaryIsland = lazy(() =>
  import('../projects-summary/ProjectsSummaryIsland').then((m) => ({
    default: m.ProjectsSummaryIsland,
  })),
)
const SettingsIsland = lazy(() =>
  import('../settings/SettingsIsland').then((m) => ({ default: m.SettingsIsland })),
)

// Warms a tab's lazy chunk ahead of the click (Nav calls this on
// hover/focus) so the actual tab switch just swaps in an already-downloaded
// module instead of waiting on a fresh network round-trip. Safe to call
// redundantly — dynamic import() is cached per specifier by the module
// system, so this and the lazy() import above resolve to the same fetch.
function prefetchTab(tab: TabName): void {
  switch (tab) {
    case 'dashboard':
      void import('./DashboardTab')
      break
    case 'worklog':
      void import('../worklog/WorklogIsland')
      break
    case 'files':
      void import('../files/FilesIsland')
      break
    case 'projects-summary':
      void import('../projects-summary/ProjectsSummaryIsland')
      break
    case 'settings':
      void import('../settings/SettingsIsland')
      break
    default:
      break
  }
}

const TAB_NAMES: readonly TabName[] = [
  'dashboard',
  'worklog',
  'allowance',
  'files',
  'projects-summary',
  'settings',
]
const ELEVATED_TABS: ReadonlySet<TabName> = new Set(['projects-summary', 'settings'])
// Tabs whose content is scoped to a single member; show the "select a member"
// placeholder (instead of the island) until one is chosen. Elevated "Overall"
// mode is empty-member on the dashboard only, so dashboard is excluded here.
const MEMBER_SCOPED: ReadonlySet<TabName> = new Set(['worklog', 'allowance'])

function tabFromPath(pathname: string): TabName {
  const seg = pathname.replace(/^\/+/, '').split('/')[0]
  return (TAB_NAMES as readonly string[]).includes(seg) ? (seg as TabName) : 'dashboard'
}

function TabFallback() {
  return <div className="py-16 text-center text-gray-400 mwl-fadein">Loading…</div>
}

function SelectMemberPlaceholder() {
  return <div className="py-16 text-center text-gray-400">{t('toast.select_member')}</div>
}

export function AppShell() {
  const shell = useShellState()
  const {
    user,
    elevated,
    canViewOthers,
    members,
    memberId,
    year,
    month,
    yearDisabled,
    setMemberId,
    setYear,
    setMonth,
    selectOverall,
    retryMembers,
  } = shell

  const location = useLocation()
  const navigate = useNavigate()
  const activeTab = tabFromPath(location.pathname)

  const pendingQuery = usePendingCount({ enabled: elevated })
  const pendingCount = elevated ? pendingQuery.data?.count ?? 0 : 0

  const onNavigate = (tab: TabName) => {
    navigate({ pathname: '/' + tab, search: location.search })
  }

  const showOverallMonth = activeTab === 'dashboard' && canViewOthers && !memberId

  const content = useMemo(() => {
    if (ELEVATED_TABS.has(activeTab) && !elevated) {
      return <SelectMemberPlaceholder />
    }
    if (MEMBER_SCOPED.has(activeTab) && !memberId) {
      return <SelectMemberPlaceholder />
    }
    switch (activeTab) {
      case 'dashboard':
        return (
          <DashboardTab
            canViewOthers={canViewOthers}
            memberId={memberId}
            onSelectMember={setMemberId}
          />
        )
      case 'worklog':
        return (
          <WorklogIsland memberId={memberId} year={year} month={month} onMonthChange={setMonth} />
        )
      case 'allowance':
        return <AllowanceTab />
      case 'files':
        return <FilesIsland />
      case 'projects-summary':
        return <ProjectsSummaryIsland />
      case 'settings':
        return <SettingsIsland />
      default:
        return null
    }
  }, [activeTab, elevated, canViewOthers, memberId, year, month, setMonth, setMemberId])

  return (
    <>
      <Nav
        elevated={elevated}
        user={user}
        pendingCount={pendingCount}
        activeTab={activeTab}
        onNavigate={onNavigate}
        onPrefetch={prefetchTab}
      />
      <Selector
        canViewOthers={canViewOthers}
        members={members}
        memberId={memberId}
        year={year}
        yearDisabled={yearDisabled}
        showOverallMonth={showOverallMonth}
        setMemberId={setMemberId}
        setYear={setYear}
        selectOverall={selectOverall}
        retryMembers={retryMembers}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Suspense fallback={<TabFallback />}>{content}</Suspense>
      </main>

      <ToastHost />
      <WorklogModal />
      <DraftPanel />
    </>
  )
}
