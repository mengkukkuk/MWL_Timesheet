// ── MeterWorklog i18n — TH / EN ──
const _i18n = {
    en: {
        // Nav
        'nav.dashboard': 'Dashboard',
        'nav.worklog': 'Work Log',
        'nav.allowance': 'Allowance',
        'nav.files': 'File Share',
        'nav.projects_summary': 'Projects Summary',
        'nav.settings': 'Settings',
        'nav.logout': 'Logout',

        // Projects Summary
        'ps.title': 'Projects Summary',
        'ps.subtitle': 'Monthly worklog analytics',
        'ps.empty': 'No project activity in this period.',
        'ps.col_project': 'PD',
        'ps.col_employees': 'Members',
        'ps.col_hours': 'Hours',
        'ps.col_share': 'Share',
        'ps.kpi_projects': 'Active Projects',
        'ps.kpi_hours': 'Total Man-Day Hours',
        'ps.kpi_employees': 'Active Employees',
        'ps.kpi_avg': 'Avg hrs / Project',
        'ps.chart_hours_title': 'Hours by Project',
        'ps.chart_dist_title': 'Distribution',
        'ps.detail_title': 'Project Breakdown',

        // File Share
        'files.title': 'File Share',
        'files.subtitle': 'Shared files for the team. All users can upload and download.',
        'files.new_folder': 'New Folder',
        'files.upload': 'Upload to ',
        'files.folders': 'Folders',
        'files.subfolders': 'Subfolders',
        'files.files': 'Files',
        'files.empty': 'No files here yet. Drop files anywhere in this panel to upload.',
        'files.drop_here': 'Drop to upload',
        'files.new_folder_title': 'New Folder',
        'files.folder_name': 'Folder name',
        'files.classified': 'Classified (elevated only)',
        'files.classified_hint': 'Classified items are hidden from Staff.',
        'files.edit': 'Edit',
        'files.edit_file_title': 'Edit File',
        'files.edit_folder_title': 'Edit Folder',
        'files.expand': 'Expand',
        'files.collapse': 'Collapse',
        'files.move_title': 'Move to',
        'files.move_confirm': 'Move here',

        // Shared buttons
        'btn.cancel': 'Cancel',
        'btn.create': 'Create',
        'btn.save': 'Save',

        // Selector bar
        'sel.member': 'Team Member:',
        'sel.select_ph': 'Select a member...',
        'sel.year': 'Year:',
        'sel.overall': 'Overall',

        // Team overview
        'dash.team_overview': 'Team Overview',
        'dash.has_project': 'Has project',
        'dash.no_project': 'No project',
        'dash.members_count': n => `${n} member${n !== 1 ? 's' : ''}`,
        'dash.overall_month_label': 'Month:',
        'dash.missing_n_days': n => `Missing ${n} day${n !== 1 ? 's' : ''}`,

        // Dashboard cards
        'dash.total_hours': 'Total Hours',
        'dash.tasks_done': 'Tasks Done',
        'dash.in_progress_card': 'Total Man day Hrs',
        'dash.avg_monthly': 'Avg Monthly',

        // Project roles
        'dash.main_project': 'Main Project',
        'dash.support': 'Support',

        // Monthly breakdown
        'dash.monthly_breakdown': 'Monthly Breakdown',
        'dash.col_month': 'Month',
        'dash.col_hours': 'Hours',
        'dash.col_done': 'Done',
        'dash.col_in_progress': 'In Progress',
        'dash.col_missing': 'Missing entry',
        'dash.col_man_day': 'Man day',

        // Export
        'dash.export_excel': 'Export to Excel',
        'dash.export_multiple': 'Export Multiple',

        // Worklog empty states
        'wl.no_member_title': 'Select a team member to view work logs',
        'wl.no_member_hint': 'Choose a member from the selector above',
        'wl.no_member_hint2': 'Or go to',
        'wl.no_member_settings': 'Settings',
        'wl.no_member_hint3': 'to add one',

        // Worklog toolbar
        'wl.month_label': 'Month:',
        'wl.add_entry': 'Add Entry',
        'wl.add_multi': '+ Add Entry for Multiple',

        // Filters
        'wl.search_ph': '       Search by project, task, or note...',
        'wl.all_status': 'All Status',
        'wl.all_projects': 'All Projects',
        'wl.clear': 'Clear',
        'wl.filter_count': (f, t) => `${f} of ${t} entries`,

        // Table headers
        'wl.col_date': 'Date',
        'wl.col_project': 'Project',
        'wl.col_task': 'Task',
        'wl.col_start': 'Start',
        'wl.col_end': 'End',
        'wl.col_hours': 'Hours',
        'wl.col_status': 'Status',
        'wl.col_note': 'Note',

        // Table empty state
        'wl.no_entries': 'No entries for this month yet',
        'wl.add_first': 'Add your first entry',
        'wl.bulk_selected': 'selected',
        'wl.bulk_edit': 'Bulk Edit',
        'wl.bulk_delete': 'Bulk Delete',
        'wl.bulk_edit_title': 'Bulk Edit Selected Entries',
        'wl.bulk_edit_hint': 'Only checked fields will be applied to all selected entries.',

        //Allowance
        'al.title': 'Allowance',
        'al.no_member_title': 'Select a team member to view allowance',
        'al.month_label': 'Month:',
        'al.add_entry': 'Add Allowance',
        'al.col_date': 'Date',
        'al.col_project': 'Project',
        'al.col_type': 'Type',
        'al.no_entries': 'No allowance entries for this month yet',
        'al.type_label': 'Type',
        'al.type_normal': 'Normal',
        'al.type_special': 'Special',
        'al.modal_add_title': 'Add Allowance',
        'al.modal_edit_title': 'Edit Allowance',
        'al.confirm_delete': 'Delete this allowance entry?',
        'al.locked_msg': 'This row is locked and cannot be edited',
        'al.toast_added': 'Allowance added',
        'al.toast_updated': 'Allowance updated',
        'al.toast_deleted': 'Allowance deleted',

        // Calendar day-of-week
        'cal.mon': 'Mon', 'cal.tue': 'Tue', 'cal.wed': 'Wed',
        'cal.thu': 'Thu', 'cal.fri': 'Fri', 'cal.sat': 'Sat', 'cal.sun': 'Sun',
        'cal.summary': (e, h) => `${e} entries · ${h} hours this month`,

        // Calendar legend
        'legend.done': 'Done',
        'legend.in_progress': 'In Progress',
        'legend.pending': 'Pending',

        // Status values (display only — DB values stay English)
        'status.Done': 'Done',
        'status.In Progress': 'In Progress',
        'status.Pending': 'Pending',
        'status.Man day': 'Man day',

        // Month names (full + abbr)
        'months.full': ['', 'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'],
        'months.abbr': ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],

        // Settings
        'set.team_members': 'Team Members',
        'set.name_ph': 'Name',
        'set.dept_ph': 'Department',
        'set.empid_ph': 'Staff ID',
        'set.position_ph': 'Position (optional)',
        'set.add_member': 'Add Member',
        'set.projects': 'Projects',
        'set.project_name_ph': 'Project name',
        'set.add': 'Add',
        'set.user_accounts': 'User Accounts',
        'set.account_approvals': 'Account Approvals',
        'set.account_approvals_desc': 'New self-registered accounts must be approved before they can log in.',
        'set.no_pending': 'No pending registrations.',
        'set.refresh': 'Refresh',
        'set.accept': 'Accept',
        'set.decline': 'Decline',
        'set.wl_visibility': 'Worklog Visibility',
        'set.wl_visibility_desc': "Controls whether Staff members can view each other's worklogs.",
        'set.vis_on': "ON — All members can view each other's worklogs",
        'set.vis_on_desc': 'Staff, Leaders, and Admins can browse any member\'s worklog data.',
        'set.vis_off': 'OFF — Staff can only view their own worklogs',
        'set.vis_off_desc': 'Elevated roles (Admin, Leader) are unaffected and retain full access.',

        // Modal — worklog
        'modal.add_entry': 'Add Work Log Entry',
        'modal.edit_entry': 'Edit Work Log Entry',
        'modal.add_multi_entry': 'Add Work Log Entry for Multiple Members',
        'modal.date': 'Date',
        'modal.from': 'From',
        'modal.to': 'To',
        'modal.to_opt': '(optional)',
        'modal.project': 'Project',
        'modal.task': 'Task',
        'modal.task_ph': 'What did you work on?',
        'modal.existing_ranges_title': 'Existing time ranges on this date',
        'modal.start_time': 'Start Time',
        'modal.end_time': 'End Time',
        'modal.status': 'Status',
        'modal.is_allowance': 'Is allowance (no overtime)',
        'modal.note': 'Note',
        'modal.note_ph': 'Optional note',
        'modal.apply_members': 'Apply to members',
        'modal.all': 'All',
        'modal.none': 'None',
        'modal.cancel': 'Cancel',
        'modal.save': 'Save',
        'modal.save_selected': 'Save for Selected',

        // Modal — bulk export
        'modal.export_title': 'Export Multiple Members',
        'modal.year': 'Year',
        'modal.select_all': 'Select All',
        'modal.download_zip': 'Download ZIP',

        // Modal — project role
        'modal.add_main_project': 'Add Main Project',
        'modal.add_support_project': 'Add Support Project',

        // Modal — month filter
        'modal.select_months': 'Select Months to Export',
        'modal.download': 'Download',

        // Modal — edit email
        'modal.edit_email': 'Edit Email',
        'modal.edit_email_hint': 'Leave blank to remove the email.',
        'settings.no_email': 'no email',

        // Modal — reset password
        'modal.reset_password': 'Reset Password',
        'modal.new_password': 'New Password',
        'modal.new_pw_ph': 'Min. 8 characters',
        'modal.confirm_password': 'Confirm Password',
        'modal.repeat_pw_ph': 'Repeat password',

        // Modal — change role
        'modal.change_role': 'Change Role',
        'modal.admin_desc': 'Department administrator',
        'modal.leader_desc': 'Team lead',
        'modal.staff_desc': 'Regular staff member',

        // Login page
        'login.title': 'MWL-Timesheet',
        'login.sign_in': 'Sign In',
        'login.sign_in_sub': 'Access your timesheet and work logs',
        'login.create_sub': 'Set up your team work log account',
        'login.username': 'Username',
        'login.password': 'Password',
        'login.login_btn': 'Login',
        'login.signing_in': 'Signing in...',
        'login.no_account': "Don't have an account?",
        'login.create_link': 'Create Account',
        'login.create_title': 'Create Account',
        'login.confirm_password': 'Confirm Password',
        'login.emp_record_label': 'In Record',
        'login.member_profile': 'Your member profile:',
        'login.full_name': 'Full Name',
        'login.department': 'Department',
        'login.employee_lookup_hint':'Enter Your Employee ID',
        'login.employee_id': 'Employee ID',
        'login.position': 'Position',
        'login.have_account': 'Already have an account?',
        'login.sign_in_link': 'Sign In',
        'login.creating': 'Creating...',
        'login.pw_mismatch': 'Passwords do not match',
        'login.network_error': 'Network error',
        'login.account_created': 'Account created! Please sign in.',
        'login.forgot_pw': 'Forgot password?',
        'login.forgot_title': 'Forgot Password',
        'login.forgot_desc': "Enter your username and we'll email a reset link to the address on file.",
        'login.forgot_btn': 'Send reset link',
        'login.sending': 'Sending...',
        'login.forgot_sent': 'If the account exists and has an email on file, a reset link has been sent.',
        'login.email': 'Email',
        'login.email_hint': 'Used for password reset (optional but recommended)',
        'reset.title': 'Set a New Password',
        'reset.desc': 'Choose a new password for your account.',
        'reset.submit_btn': 'Set new password',
        'reset.success': 'Password updated! Redirecting to sign in...',
        'reset.invalid_link': 'This reset link is invalid or has expired. Request a new one from the sign-in page.',
        'reset.back_to_login': 'Back to sign in',
        'login.remember': 'Remember me',
        'login.pending_approval': 'Your account is awaiting approval by an administrator.',
        'login.declined': 'Your account has been declined. Please contact an administrator.',
        'login.pending_approval_after_register': 'Account created. Please wait for an administrator to approve your account before signing in.',

        // Toast messages
        'toast.member_added': 'Member added',
        'toast.member_updated': 'Member updated',
        'toast.member_removed': 'Member removed',
        'toast.project_added': 'Project added',
        'toast.project_removed': 'Project removed',
        'toast.entry_added': 'Entry added',
        'toast.entry_updated': 'Entry updated',
        'toast.entry_deleted': 'Entry deleted',
        'toast.added_multi': (ok, mems, dayLabel) => `Added ${ok} entr${ok === 1 ? 'y' : 'ies'} across ${mems} member${mems > 1 ? 's' : ''}${dayLabel}`,
        'toast.added_days': (ok, days) => `Added ${ok} entries over ${days} days`,
        'toast.user_removed': 'User removed',
        'toast.role_updated': 'Role updated',
        'toast.pw_updated': 'Password updated',
        'toast.email_updated': 'Email updated',
        'toast.select_member': 'Select a member first',
        'toast.select_project': 'Select a project',
        'toast.select_one_member': 'Select at least one member',
        'toast.select_one_month': 'Select at least one month',
        'toast.failed_save': 'Failed to save entry',
        'toast.overlap': 'Time range overlaps with another worklog',
        'toast.own_entries_only': 'You can only add entries for yourself',
        'toast.own_edit_only': 'You can only edit your own entries',
        'toast.name_dept_required': 'Name and department are required',
    },

    th: {
        // Nav
        'nav.dashboard': 'แดชบอร์ด',
        'nav.worklog': 'บันทึกงาน',
        'nav.allowance': 'เบี้ยเลี้ยง',
        'nav.files': 'แชร์ไฟล์',
        'nav.projects_summary': 'สรุปโปรเจกต์',
        'nav.settings': 'ตั้งค่า',
        'nav.logout': 'ออกจากระบบ',

        // Projects Summary
        'ps.title': 'สรุปโปรเจกต์',
        'ps.subtitle': 'วิเคราะห์ชั่วโมงการทำงานรายเดือน',
        'ps.empty': 'ไม่มีกิจกรรมโปรเจกต์ในช่วงเวลานี้',
        'ps.col_project': 'PD',
        'ps.col_employees': 'สมาชิก',
        'ps.col_hours': 'ชั่วโมง',
        'ps.col_share': 'สัดส่วน',
        'ps.kpi_projects': 'โปรเจกต์ที่ใช้งาน',
        'ps.kpi_hours': 'ชั่วโมงรวม Man-Day',
        'ps.kpi_employees': 'พนักงานที่ใช้งาน',
        'ps.kpi_avg': 'ชม. เฉลี่ย / โปรเจกต์',
        'ps.chart_hours_title': 'ชั่วโมงตามโปรเจกต์',
        'ps.chart_dist_title': 'การกระจาย',
        'ps.detail_title': 'รายละเอียดของโปรเจกต์',

        // File Share
        'files.title': 'แชร์ไฟล์',
        'files.subtitle': 'พื้นที่แชร์ไฟล์สำหรับทีม ผู้ใช้ทุกคนสามารถอัปโหลดและดาวน์โหลดได้',
        'files.new_folder': 'โฟลเดอร์ใหม่',
        'files.upload': 'อัปโหลดไปที่ ',
        'files.folders': 'โฟลเดอร์',
        'files.subfolders': 'โฟลเดอร์ย่อย',
        'files.files': 'ไฟล์',
        'files.empty': 'ยังไม่มีไฟล์ในโฟลเดอร์นี้ ลากไฟล์มาวางเพื่ออัปโหลด',
        'files.drop_here': 'วางเพื่ออัปโหลด',
        'files.new_folder_title': 'สร้างโฟลเดอร์ใหม่',
        'files.folder_name': 'ชื่อโฟลเดอร์',
        'files.classified': 'ลับ (เฉพาะผู้มีสิทธิ์)',
        'files.classified_hint': 'รายการลับจะถูกซ่อนจากพนักงานทั่วไป',
        'files.edit': 'แก้ไข',
        'files.edit_file_title': 'แก้ไขไฟล์',
        'files.edit_folder_title': 'แก้ไขโฟลเดอร์',
        'files.expand': 'ขยาย',
        'files.collapse': 'ย่อ',
        'files.move_title': 'ย้ายไปที่',
        'files.move_confirm': 'ย้ายมาที่นี่',

        // Shared buttons
        'btn.cancel': 'ยกเลิก',
        'btn.create': 'สร้าง',
        'btn.save': 'บันทึก',

        // Selector bar
        'sel.member': 'สมาชิกทีม:',
        'sel.select_ph': 'เลือกสมาชิก...',
        'sel.year': 'ปี:',
        'sel.overall': 'ภาพรวม',

        // Team overview
        'dash.team_overview': 'ภาพรวมทีม',
        'dash.has_project': 'มีโปรเจกต์',
        'dash.no_project': 'ไม่มีโปรเจกต์',
        'dash.members_count': n => `${n} คน`,
        'dash.overall_month_label': 'เดือน:',
        'dash.missing_n_days': n => `ขาดการบันทึก ${n} วัน`,

        // Dashboard cards
        'dash.total_hours': 'ชั่วโมงรวม',
        'dash.tasks_done': 'งานเสร็จ',
        'dash.in_progress_card': 'ชั่วโมง Man day',
        'dash.avg_monthly': 'เฉลี่ยต่อเดือน',

        // Project roles
        'dash.main_project': 'โปรเจกต์หลัก',
        'dash.support': 'สนับสนุน',

        // Monthly breakdown
        'dash.monthly_breakdown': 'สรุปรายเดือน',
        'dash.col_month': 'เดือน',
        'dash.col_hours': 'ชั่วโมง',
        'dash.col_done': 'เสร็จ',
        'dash.col_in_progress': 'กำลังทำ',
        'dash.col_missing': 'ขาดบันทึก',
        'dash.col_man_day': 'Man day',

        // Export
        'dash.export_excel': 'ส่งออก Excel',
        'dash.export_multiple': 'ส่งออกหลายคน',

        // Worklog empty states
        'wl.no_member_title': 'เลือกสมาชิกทีมเพื่อดูบันทึกงาน',
        'wl.no_member_hint': 'เลือกสมาชิกจากแถบด้านบน',
        'wl.no_member_hint2': 'หรือไปที่',
        'wl.no_member_settings': 'ตั้งค่า',
        'wl.no_member_hint3': 'เพื่อเพิ่มสมาชิก',

        // Worklog toolbar
        'wl.month_label': 'เดือน:',
        'wl.add_entry': 'เพิ่มรายการ',
        'wl.add_multi': '+ เพิ่มรายการสำหรับหลายคน',

        // Filters
        'wl.search_ph': '   ค้นหาโปรเจกต์ งาน หมายเหตุ...',
        'wl.all_status': 'ทุกสถานะ',
        'wl.all_projects': 'ทุกโปรเจกต์',
        'wl.clear': 'ล้าง',
        'wl.filter_count': (f, t) => `${f} จาก ${t} รายการ`,

        // Table headers
        'wl.col_date': 'วันที่',
        'wl.col_project': 'โปรเจกต์',
        'wl.col_task': 'งาน',
        'wl.col_start': 'เริ่ม',
        'wl.col_end': 'สิ้นสุด',
        'wl.col_hours': 'ชั่วโมง',
        'wl.col_status': 'สถานะ',
        'wl.col_note': 'หมายเหตุ',

        // Table empty state
        'wl.no_entries': 'ยังไม่มีรายการในเดือนนี้',
        'wl.add_first': 'เพิ่มรายการแรกของคุณ',
        'wl.bulk_selected': 'ที่เลือก',
        'wl.bulk_edit': 'แก้ไขหลายรายการ',
        'wl.bulk_delete': 'ลบหลายรายการ',
        'wl.bulk_edit_title': 'แก้ไขรายการที่เลือก',
        'wl.bulk_edit_hint': 'จะนำไปใช้กับทุกรายการที่เลือกเฉพาะฟิลด์ที่ติ๊กถูก',

        // Allowance
        'al.title': 'เบี้ยเลี้ยง',
        'al.no_member_title': 'เลือกพนักงานเพื่อดูข้อมูลเบี้ยเลี้ยง',
        'al.month_label': 'เดือน:',
        'al.add_entry': 'เพิ่มเบี้ยเลี้ยง',
        'al.col_date': 'วันที่',
        'al.col_project': 'โปรเจกต์',
        'al.col_type': 'ประเภท',
        'al.no_entries': 'ยังไม่มีรายการเบี้ยเลี้ยงในเดือนนี้',
        'al.type_label': 'ประเภท',
        'al.type_normal': 'ปกติ',
        'al.type_special': 'พิเศษ',
        'al.modal_add_title': 'เพิ่มเบี้ยเลี้ยง',
        'al.modal_edit_title': 'แก้ไขเบี้ยเลี้ยง',
        'al.confirm_delete': 'ลบรายการเบี้ยเลี้ยงนี้?',
        'al.locked_msg': 'รายการนี้ถูกล็อคและไม่สามารถแก้ไขได้',
        'al.toast_added': 'เพิ่มเบี้ยเลี้ยงแล้ว',
        'al.toast_updated': 'อัปเดตเบี้ยเลี้ยงแล้ว',
        'al.toast_deleted': 'ลบเบี้ยเลี้ยงแล้ว',
        
        // Calendar day-of-week
        'cal.mon': 'จ.', 'cal.tue': 'อ.', 'cal.wed': 'พ.',
        'cal.thu': 'พฤ.', 'cal.fri': 'ศ.', 'cal.sat': 'ส.', 'cal.sun': 'อา.',
        'cal.summary': (e, h) => `${e} รายการ · ${h} ชั่วโมงในเดือนนี้`,

        // Calendar legend
        'legend.done': 'เสร็จ',
        'legend.in_progress': 'กำลังทำ',
        'legend.pending': 'รอดำเนินการ',

        // Status values
        'status.Done': 'เสร็จ',
        'status.In Progress': 'กำลังทำ',
        'status.Pending': 'รอดำเนินการ',
        'status.Man day': 'Man day',

        // Month names
        'months.full': ['', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
            'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'],
        'months.abbr': ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
            'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'],

        // Settings
        'set.team_members': 'สมาชิกทีม',
        'set.name_ph': 'ชื่อ',
        'set.dept_ph': 'แผนก',
        'set.empid_ph': 'รหัสพนักงาน',
        'set.position_ph': 'ตำแหน่ง (ไม่บังคับ)',
        'set.add_member': 'เพิ่มสมาชิก',
        'set.projects': 'โปรเจกต์',
        'set.project_name_ph': 'ชื่อโปรเจกต์',
        'set.add': 'เพิ่ม',
        'set.user_accounts': 'บัญชีผู้ใช้',
        'set.account_approvals': 'อนุมัติบัญชีผู้ใช้',
        'set.account_approvals_desc': 'บัญชีที่สมัครใหม่ต้องได้รับการอนุมัติก่อนเข้าใช้งาน',
        'set.no_pending': 'ไม่มีบัญชีที่รอการอนุมัติ',
        'set.refresh': 'รีเฟรช',
        'set.accept': 'อนุมัติ',
        'set.decline': 'ปฏิเสธ',
        'set.wl_visibility': 'การมองเห็นบันทึกงาน',
        'set.wl_visibility_desc': 'ควบคุมว่าสมาชิก Staff สามารถดูบันทึกงานของกันและกันได้หรือไม่',
        'set.vis_on': 'เปิด — สมาชิกทุกคนสามารถดูบันทึกงานของกันได้',
        'set.vis_on_desc': 'Staff, Leader และ Admin สามารถดูข้อมูลบันทึกงานของสมาชิกทุกคน',
        'set.vis_off': 'ปิด — Staff ดูได้เฉพาะบันทึกงานของตัวเอง',
        'set.vis_off_desc': 'ตำแหน่งสูงกว่า (Admin, Leader) ยังคงมีสิทธิ์เข้าถึงทั้งหมด',

        // Modal — worklog
        'modal.add_entry': 'เพิ่มรายการบันทึกงาน',
        'modal.edit_entry': 'แก้ไขรายการบันทึกงาน',
        'modal.add_multi_entry': 'เพิ่มรายการบันทึกงานสำหรับหลายคน',
        'modal.date': 'วันที่',
        'modal.from': 'ตั้งแต่',
        'modal.to': 'ถึง',
        'modal.to_opt': '(ไม่บังคับ)',
        'modal.project': 'โปรเจกต์',
        'modal.task': 'งาน',
        'modal.task_ph': 'คุณทำงานอะไร?',
        'modal.existing_ranges_title': 'ช่วงเวลาที่มีการบันทึกไว้แล้ว(ไม่สามารถลงซ้ำได้)',
        'modal.start_time': 'เวลาเริ่ม',
        'modal.end_time': 'เวลาสิ้นสุด',
        'modal.status': 'สถานะ',
        'modal.is_allowance': 'เป็นเบี้ยเลี้ยง (ไม่คิดค่า OT)',
        'modal.note': 'หมายเหตุ',
        'modal.note_ph': 'หมายเหตุ (ไม่บังคับ)',
        'modal.apply_members': 'ใช้กับสมาชิก',
        'modal.all': 'ทั้งหมด',
        'modal.none': 'ยกเลิกทั้งหมด',
        'modal.cancel': 'ยกเลิก',
        'modal.save': 'บันทึก',
        'modal.save_selected': 'บันทึกสำหรับที่เลือก',

        // Modal — bulk export
        'modal.export_title': 'ส่งออกสำหรับหลายคน',
        'modal.year': 'ปี',
        'modal.select_all': 'เลือกทั้งหมด',
        'modal.download_zip': 'ดาวน์โหลด ZIP',

        // Modal — project role
        'modal.add_main_project': 'เพิ่มโปรเจกต์หลัก',
        'modal.add_support_project': 'เพิ่มโปรเจกต์สนับสนุน',

        // Modal — month filter
        'modal.select_months': 'เลือกเดือนที่จะส่งออก',
        'modal.download': 'ดาวน์โหลด',

        // Modal — edit email
        'modal.edit_email': 'แก้ไขอีเมล',
        'modal.edit_email_hint': 'เว้นว่างเพื่อลบอีเมลออก',
        'settings.no_email': 'ไม่มีอีเมล',

        // Modal — reset password
        'modal.reset_password': 'รีเซ็ตรหัสผ่าน',
        'modal.new_password': 'รหัสผ่านใหม่',
        'modal.new_pw_ph': 'อย่างน้อย 8 ตัวอักษร',
        'modal.confirm_password': 'ยืนยันรหัสผ่าน',
        'modal.repeat_pw_ph': 'ยืนยันรหัสผ่านอีกครั้ง',

        // Modal — change role
        'modal.change_role': 'เปลี่ยนตำแหน่ง',
        'modal.admin_desc': 'Admin',
        'modal.leader_desc': 'Leader',
        'modal.staff_desc': 'Staff',

        // Login page
        'login.title': 'MWL-Timesheet',
        'login.sign_in': 'เข้าสู่ระบบ',
        'login.sign_in_sub': 'เข้าถึงตารางเวลาและบันทึกการทำงานของคุณ',
        'login.create_sub': 'ตั้งค่าบัญชีบันทึกการทำงานของคุณ',
        'login.username': 'ชื่อผู้ใช้',
        'login.password': 'รหัสผ่าน',
        'login.login_btn': 'เข้าสู่ระบบ',
        'login.signing_in': 'กำลังเข้าสู่ระบบ...',
        'login.no_account': 'ยังไม่มีบัญชีผู้ใช้?',
        'login.create_link': 'สร้างบัญชี',
        'login.create_title': 'สร้างบัญชีผู้ใช้',
        'login.confirm_password': 'ยืนยันรหัสผ่าน',
        'login.emp_record_label': 'In Record',
        'login.member_profile': 'ข้อมูลสมาชิกของคุณ:',
        'login.full_name': 'ชื่อ-นามสกุล',
        'login.department': 'แผนก',
        'login.staff_id': 'รหัสพนักงาน',
        'login.employee_lookup_hint':'ใส่รหัสพนักงานของคุณ',
        'login.position': 'ตำแหน่ง',
        'login.have_account': 'มีบัญชีอยู่แล้ว?',
        'login.sign_in_link': 'เข้าสู่ระบบ',
        'login.creating': 'กำลังสร้าง...',
        'login.pw_mismatch': 'รหัสผ่านไม่ตรงกัน',
        'login.network_error': 'เกิดข้อผิดพลาดในการเชื่อมต่อ',
        'login.account_created': 'สร้างบัญชีสำเร็จ! กรุณาเข้าสู่ระบบ',
        'login.forgot_pw': 'ลืมรหัสผ่าน?',
        'login.forgot_title': 'ลืมรหัสผ่าน',
        'login.forgot_desc': 'กรอกชื่อผู้ใช้ ลิงก์รีเซ็ตรหัสผ่านจะถูกส่งไปยังอีเมลที่ลงทะเบียนไว้',
        'login.forgot_btn': 'ส่งลิงก์รีเซ็ต',
        'login.sending': 'กำลังส่ง...',
        'login.forgot_sent': 'หากบัญชีนี้มีอยู่และมีอีเมลลงทะเบียนไว้ ระบบได้ส่งลิงก์รีเซ็ตให้แล้ว',
        'login.email': 'อีเมล',
        'login.email_hint': 'ใช้สำหรับรีเซ็ตรหัสผ่าน (ไม่บังคับ แต่แนะนำ)',
        'reset.title': 'ตั้งรหัสผ่านใหม่',
        'reset.desc': 'เลือกรหัสผ่านใหม่สำหรับบัญชีของคุณ',
        'reset.submit_btn': 'ตั้งรหัสผ่านใหม่',
        'reset.success': 'อัปเดตรหัสผ่านแล้ว! กำลังพาไปหน้าเข้าสู่ระบบ...',
        'reset.invalid_link': 'ลิงก์รีเซ็ตนี้ไม่ถูกต้องหรือหมดอายุแล้ว กรุณาขอลิงก์ใหม่จากหน้าเข้าสู่ระบบ',
        'reset.back_to_login': 'กลับไปเข้าสู่ระบบ',
        'login.remember': 'Remember me',
        'login.pending_approval': 'บัญชีของคุณรอการอนุมัติจากผู้ดูแลระบบ',
        'login.declined': 'บัญชีของคุณถูกปฏิเสธ กรุณาติดต่อผู้ดูแลระบบ',
        'login.pending_approval_after_register': 'สร้างบัญชีสำเร็จ กรุณารอผู้ดูแลระบบอนุมัติก่อนเข้าใช้งาน',

        // Toast
        'toast.member_added': 'เพิ่มสมาชิกแล้ว',
        'toast.member_updated': 'อัปเดตสมาชิกแล้ว',
        'toast.member_removed': 'ลบสมาชิกแล้ว',
        'toast.project_added': 'เพิ่มโปรเจกต์แล้ว',
        'toast.project_removed': 'ลบโปรเจกต์แล้ว',
        'toast.entry_added': 'เพิ่มรายการแล้ว',
        'toast.entry_updated': 'อัปเดตรายการแล้ว',
        'toast.entry_deleted': 'ลบรายการแล้ว',
        'toast.added_multi': (ok, mems, dayLabel) => `เพิ่ม ${ok} รายการ สำหรับ ${mems} คน${dayLabel}`,
        'toast.added_days': (ok, days) => `เพิ่ม ${ok} รายการ ใน ${days} วัน`,
        'toast.user_removed': 'ลบผู้ใช้แล้ว',
        'toast.role_updated': 'อัปเดตตำแหน่งแล้ว',
        'toast.pw_updated': 'อัปเดตรหัสผ่านแล้ว',
        'toast.email_updated': 'อัปเดตอีเมลแล้ว',
        'toast.select_member': 'กรุณาเลือกสมาชิกก่อน',
        'toast.select_project': 'กรุณาเลือกโปรเจกต์',
        'toast.select_one_member': 'กรุณาเลือกสมาชิกอย่างน้อย 1 คน',
        'toast.select_one_month': 'กรุณาเลือกอย่างน้อย 1 เดือน',
        'toast.failed_save': 'บันทึกไม่สำเร็จ',
        'toast.own_entries_only': 'คุณสามารถเพิ่มรายการของตัวเองเท่านั้น',
        'toast.own_edit_only': 'คุณสามารถแก้ไขรายการของตัวเองเท่านั้น',
        'toast.name_dept_required': 'กรุณากรอกชื่อและแผนก',
    }
};

// ── Core functions ──
let _lang = 'en';
try { const s = localStorage.getItem('appLang'); if (s === 'th' || s === 'en') _lang = s; } catch (e) {}

function t(key, ...args) {
    const dict = _i18n[_lang] || _i18n.en;
    const val = (dict[key] !== undefined) ? dict[key] : (_i18n.en[key] !== undefined ? _i18n.en[key] : key);
    return typeof val === 'function' ? val(...args) : val;
}

function applyTranslations() {
    // Text content
    document.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.dataset.i18n);
    });
    // Placeholder attributes
    document.querySelectorAll('[data-i18n-ph]').forEach(el => {
        el.placeholder = t(el.dataset.i18nPh);
    });
    // Update member select first option (placeholder)
    const sel = document.getElementById('member-select');
    if (sel && sel.options[0]) sel.options[0].text = t('sel.select_ph');
    // Update toggle button label
    const btn = document.getElementById('lang-toggle-btn');
    if (btn) btn.textContent = _lang === 'th' ? 'EN' : 'TH';
    document.documentElement.lang = _lang;
}

function toggleLang() {
    _lang = _lang === 'en' ? 'th' : 'en';
    try { localStorage.setItem('appLang', _lang); } catch (e) {}
    applyTranslations();
    // Re-render currently visible tab
    try {
        const active = document.querySelector('.tab-btn.active');
        const mid = typeof currentMemberId !== 'undefined' ? currentMemberId : null;
        if (active) {
            if (active.id === 'tab-dashboard') {
                if (mid && typeof loadDashboard === 'function') loadDashboard();
                else if (typeof loadOverallDashboard === 'function') loadOverallDashboard();
            } else if (active.id === 'tab-worklog' && mid && typeof loadWorklogs === 'function') {
                loadWorklogs();
            } else if (active.id === 'tab-settings') {
                if (typeof loadMembersList === 'function') loadMembersList();
                if (typeof loadProjectsList === 'function') loadProjectsList();
                if (typeof loadUsersList === 'function') loadUsersList();
            }
        }
    } catch (e) {}
}

// Apply immediately on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyTranslations);
} else {
    applyTranslations();
}
