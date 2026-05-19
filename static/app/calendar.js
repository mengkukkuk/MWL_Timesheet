// ── Calendar Rendering ──
const MAX_CHIPS = 3;  // max visible entries per day before "+N more"

function renderCalendar(data) {
    const year  = parseInt(document.getElementById('year-select').value);
    const month = parseInt(document.getElementById('month-select').value);
    const body  = document.getElementById('cal-body');
    body.innerHTML = '';

    // Build lookup: day -> [entries]
    const byDay = {};
    data.forEach(w => {
        if (!w.log_date) return;
        const day = parseInt(w.log_date.split('-')[2]);
        if (!byDay[day]) byDay[day] = [];
        byDay[day].push(w);
    });

    // Build holiday lookup: day-of-month -> trimmed description
    const byHoliday = {};
    (Array.isArray(holidayData) ? holidayData : []).forEach(h => {
        if (!h || !h.date) return;
        const parts = h.date.split('-').map(Number);
        const [hy, hm, hd] = parts;
        if (hy === year && hm === month) {
            byHoliday[hd] = (h.description || '').trim();
        }
    });

    // Calendar math
    const firstOfMonth = new Date(year, month - 1, 1);
    const daysInMonth  = new Date(year, month, 0).getDate();
    // Monday = 0 ... Sunday = 6
    let startDow = (firstOfMonth.getDay() + 6) % 7;

    // Previous month fill
    const prevMonthDays = new Date(year, month - 1, 0).getDate();

    // Total cells: fill to complete weeks
    const totalCells = Math.ceil((startDow + daysInMonth) / 7) * 7;

    const today = new Date();
    const isThisMonth = today.getFullYear() === year && today.getMonth() + 1 === month;
    const todayDay = today.getDate();

    const canEdit = canEditMember(currentMemberId);

    let totalHours = 0;
    let totalEntries = data.length;

    for (let i = 0; i < totalCells; i++) {
        const cell = document.createElement('div');
        cell.className = 'cal-cell';

        const dayNum = i - startDow + 1;
        const isOutside = dayNum < 1 || dayNum > daysInMonth;
        const colIdx = i % 7;
        const isWeekend = colIdx >= 5;

        if (isOutside) cell.classList.add('cal-outside');
        if (isWeekend) cell.classList.add('cal-weekend');
        if (!isOutside && isThisMonth && dayNum === todayDay) cell.classList.add('cal-today');

        // Day number
        let displayDay;
        if (dayNum < 1) {
            displayDay = prevMonthDays + dayNum;
        } else if (dayNum > daysInMonth) {
            displayDay = dayNum - daysInMonth;
        } else {
            displayDay = dayNum;
        }

        const numEl = document.createElement('span');
        numEl.className = 'cal-day-num';
        numEl.textContent = displayDay;
        cell.appendChild(numEl);

        if (!isOutside) {
            const entries = byDay[dayNum] || [];
            const isHoliday = Object.prototype.hasOwnProperty.call(byHoliday, dayNum);
            if (isHoliday) cell.classList.add('cal-holiday');

            // Red background for weekdays with no entries (skip today and holidays)
            const isToday = isThisMonth && dayNum === todayDay;
            if (!isWeekend && !isToday && !isHoliday && entries.length === 0) {
                cell.classList.add('cal-missing');
            }

            // Holiday description label (inserted right after day number, before entries)
            if (isHoliday) {
                const holEl = document.createElement('div');
                holEl.className = 'cal-holiday-label';
                holEl.textContent = byHoliday[dayNum];
                holEl.title = byHoliday[dayNum];
                cell.appendChild(holEl);
            }

            // Day hours: span from earliest start_time to latest end_time
            if (entries.length > 0) {
                let dayHours = 0;
                entries.forEach(e => { if (e.hours) dayHours += e.hours; });
                totalHours += dayHours;

                const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
                const timed = entries.filter(e => e.start_time && e.end_time);
                let displayHours = 0;
                if (timed.length > 0) {
                    const minStart = Math.min(...timed.map(e => toMin(e.start_time)));
                    const maxEnd   = Math.max(...timed.map(e => toMin(e.end_time)));
                    displayHours = (maxEnd - minStart) / 60;
                } else {
                    displayHours = Math.max(0, ...entries.map(e => e.hours || 0));
                }

                if (displayHours > 0) {
                    const hoursEl = document.createElement('span');
                    hoursEl.className = 'cal-day-hours';
                    hoursEl.textContent = displayHours.toFixed(1) + 'h';
                    cell.appendChild(hoursEl);
                }
            }

            // Entry chips
            const entriesContainer = document.createElement('div');
            entriesContainer.className = 'cal-entries';

            const visible = entries.slice(0, MAX_CHIPS);
            const overflow = entries.length - MAX_CHIPS;

            visible.forEach(w => {
                const chip = document.createElement('div');
                const cls = w.status === 'Done' ? 'cal-chip-done'
                          : w.status === 'In Progress' ? 'cal-chip-progress'
                          : w.status === 'Man day' ? 'cal-chip-manday'
                          : 'cal-chip-pending';
                chip.className = 'cal-chip ' + cls;
                chip.innerHTML = `<span class="cal-chip-dot"></span><span class="cal-chip-text">${esc(w.project || w.task || 'Entry')}</span>`;
                chip.title = `${w.project || ''} — ${w.task || ''}\n${w.start_time || ''} - ${w.end_time || ''}${w.hours ? ' (' + w.hours.toFixed(1) + 'h)' : ''}`;
                if (canEdit) {
                    chip.onclick = (e) => { e.stopPropagation(); editWorklog(w); };
                }
                entriesContainer.appendChild(chip);
            });

            if (overflow > 0) {
                const more = document.createElement('div');
                more.className = 'cal-more';
                more.textContent = `+${overflow} more`;
                more.onclick = (e) => {
                    e.stopPropagation();
                    openDayPopover(e, dayNum, entries, year, month);
                };
                entriesContainer.appendChild(more);
            }

            cell.appendChild(entriesContainer);

            // Click on empty space to add entry (suppressed on holidays)
            if (canEdit && !isHoliday) {
                const addBtn = document.createElement('button');
                addBtn.className = 'cal-add-btn';
                addBtn.textContent = '+';
                addBtn.title = 'Add entry';
                addBtn.onclick = (e) => {
                    e.stopPropagation();
                    openAddWorklogForDate(year, month, dayNum);
                };
                cell.appendChild(addBtn);

                cell.addEventListener('dblclick', (e) => {
                    openAddWorklogForDate(year, month, dayNum);
                });
            }
        }

        body.appendChild(cell);
    }

    // Summary
    const summaryEl = document.getElementById('cal-summary-text');
    summaryEl.textContent = t('cal.summary', totalEntries, totalHours.toFixed(1));
}

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

// Day detail popover
let _activePopover = null;

function closeDayPopover() {
    if (_activePopover) {
        _activePopover.remove();
        _activePopover = null;
    }
    document.removeEventListener('click', _popoverOutsideClick);
}

function _popoverOutsideClick(e) {
    if (_activePopover && !_activePopover.contains(e.target)) {
        closeDayPopover();
    }
}

function openDayPopover(event, day, entries, year, month) {
    closeDayPopover();

    const popover = document.createElement('div');
    popover.className = 'cal-popover';

    const dateLabel = new Date(year, month - 1, day)
        .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

    let totalH = 0;
    entries.forEach(e => { if (e.hours) totalH += e.hours; });

    const canEdit = canEditMember(currentMemberId);

    let html = `
        <div class="cal-popover-header">
            <div>
                <div class="cal-popover-title">${dateLabel}</div>
                <div style="font-size:0.65rem;color:#9ca3af">${entries.length} entries · ${totalH.toFixed(1)}h</div>
            </div>
            <button class="cal-popover-close" onclick="closeDayPopover()">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                </svg>
            </button>
        </div>
        <div style="max-height:240px;overflow-y:auto">
    `;

    entries.forEach((w, idx) => {
        const dotColor = w.status === 'Done' ? '#059669'
                       : w.status === 'In Progress' ? '#d97706'
                       : w.status === 'Man day' ? '#4f46e5'
                       : '#9ca3af';
        const time = [w.start_time, w.end_time].filter(Boolean).join(' – ');
        const hours = w.hours ? w.hours.toFixed(1) + 'h' : '';
        const meta = [time, hours].filter(Boolean).join(' · ');
        html += `
            <div class="cal-popover-entry" ${canEdit ? `onclick="closeDayPopover(); editWorklog(worklogData.find(x=>x.id===${w.id}))"` : ''}>
                <span class="cal-popover-entry-dot" style="background:${dotColor}"></span>
                <div class="cal-popover-entry-content">
                    <div class="cal-popover-entry-project">${esc(w.project || '(no project)')}</div>
                    <div class="cal-popover-entry-task">${esc(w.task || '')}</div>
                    ${meta ? `<div class="cal-popover-entry-meta">${meta}</div>` : ''}
                </div>
            </div>`;
    });

    html += '</div>';

    if (canEdit) {
        html += `
            <div style="padding-top:8px;margin-top:4px;border-top:1px solid #f0f0f0">
                <button onclick="closeDayPopover(); openAddWorklogForDate(${year},${month},${day})"
                        class="btn-primary text-xs w-full justify-center" style="padding:0.35rem 0.75rem">
                    <svg class="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                    </svg>
                    Add Entry
                </button>
            </div>`;
    }

    popover.innerHTML = html;
    document.body.appendChild(popover);
    _activePopover = popover;

    // Position near click
    const rect = popover.getBoundingClientRect();
    let x = event.clientX + 8;
    let y = event.clientY - 20;
    if (x + rect.width > window.innerWidth - 16) x = window.innerWidth - rect.width - 16;
    if (y + rect.height > window.innerHeight - 16) y = window.innerHeight - rect.height - 16;
    if (y < 8) y = 8;
    popover.style.left = x + 'px';
    popover.style.top  = y + 'px';

    setTimeout(() => document.addEventListener('click', _popoverOutsideClick), 10);
}
