// Small display helpers shared by the worklog table/calendar. Ports the
// vanilla formatDate() (static/app/worklogs.js) and the status->pill-class
// mapping used by both the table badge and the calendar chip/legend/popover.

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

export function statusClass(status: string | null | undefined): string {
  switch (status) {
    case 'Done':
      return 'wl-pill--done'
    case 'In Progress':
      return 'wl-pill--progress'
    case 'Man day':
      return 'wl-pill--manday'
    default:
      return 'wl-pill--pending'
  }
}