// Dashboard tab composition for the React shell. Replaces the three separate
// dashboard bundle roots (dashboard/main.tsx mounted DashboardIsland,
// ExportControls and TeamOverviewIsland into distinct legacy DOM nodes) with a
// single component tree:
//   - elevated + no member selected -> the Overall team grid (TeamOverviewIsland),
//     with the member-count label it writes into imperatively (#overall-member-count).
//   - otherwise (a member is selected) -> the export buttons (ExportControls)
//     above the per-employee monthly dashboard (DashboardIsland).
// The islands themselves are unchanged: they read member/year/month from the
// shared #member-select / #year-select / #overall-month-select controls (which
// AppShell's Selector renders) via the DOM-event bus.
import { t } from '../lib'
import { DashboardIsland } from '../dashboard/DashboardIsland'
import { ExportControls } from '../dashboard/ExportControls'
import { TeamOverviewIsland } from '../dashboard/TeamOverviewIsland'

interface DashboardTabProps {
  elevated: boolean
  memberId: string
}

export function DashboardTab({ elevated, memberId }: DashboardTabProps) {
  if (elevated && !memberId) {
    return (
      <div className="mwl-fadein">
        <div className="flex items-center justify-between mb-4">
          <p className="mwl-eyebrow">{t('dash.overall_title') || 'Team Overview'}</p>
          <span id="overall-member-count" className="text-sm text-gray-500" />
        </div>
        <TeamOverviewIsland />
      </div>
    )
  }

  return (
    <>
      <ExportControls />
      <DashboardIsland />
    </>
  )
}
