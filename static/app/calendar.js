// The Work Log calendar grid + day popover are now rendered by the React
// island (#worklog-view-root, WorklogCalendar.tsx). This file keeps only the
// modal opener React delegates "+"/dbl-click-to-add to, so the existing
// add/edit modal stays completely untouched.
function openAddWorklogForDate(year, month, day) {
    if (!currentMemberId) { toast(t('toast.select_member'), 'error'); return; }
    if (!canEditMember(currentMemberId)) { toast(t('toast.own_entries_only'), 'error'); return; }
    const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    document.getElementById('modal-title').textContent = t('modal.add_entry');
    document.getElementById('wl-id').value = '';
    document.getElementById('wl-date-from').value = dateStr;
    document.getElementById('wl-project').value = '';
    document.getElementById('wl-task').value = '';
    setTimeInputs('wl-start', '08:30');
    setTimeInputs('wl-end', '');
    document.getElementById('wl-status').value = 'Pending';
    document.getElementById('wl-note').value = '';
    setDateRangeMode(true);
    populateProjectDropdown();
    document.getElementById('modal-overlay').classList.remove('hidden');
}

try {
    window.openAddWorklogForDate = openAddWorklogForDate;
} catch (e) {}