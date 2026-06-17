const {
  buildCalendar,
  calculateStats,
  normalizeAutoOvertime,
  normalizeContractInfoForAttendance,
  normalizeAttendanceData
} = require('./attendance');
const { formatDate } = require('./format');

function stripDayUnit(value) {
  return String(value || '0天').replace(/天$/, '') || '0';
}

function attendanceStatusText(status) {
  const labels = {
    draft: '待填写',
    employee_confirmed: '待客户确认',
    customer_signed: '已签署',
    synced: '已归档'
  };
  return labels[status] || status || '考勤';
}

function attendanceBadge(form = {}) {
  if (form.status === 'employee_confirmed') {
    return { text: '未签署', className: 'danger' };
  }
  if (['customer_signed', 'synced'].includes(form.status)) {
    return { text: form.status === 'synced' ? '已归档' : '已签署', className: 'signed' };
  }
  return { text: attendanceStatusText(form.status), className: 'pending' };
}

function calculateAttendanceCardStats(form = {}, holidays = {}) {
  const normalizedForm = {
    ...form,
    contract_info: form.contract_info || {}
  };
  const initialData = normalizeAttendanceData(form.form_data || {});
  normalizedForm.contract_info = normalizeContractInfoForAttendance(normalizedForm, initialData);
  const initialCalendar = buildCalendar(normalizedForm, initialData, holidays);
  const attendanceData = normalizeAutoOvertime(initialData, normalizedForm, initialCalendar.monthDays, holidays);
  const calendar = buildCalendar(normalizedForm, attendanceData, holidays);
  const stats = calculateStats(attendanceData, calendar.monthDays, normalizedForm, holidays);
  return {
    work_days_text: stripDayUnit(stats.workDaysText),
    overtime_text: stripDayUnit(stats.overtimeDaysText),
    leave_days_text: stripDayUnit(stats.leaveDaysText)
  };
}

function fallbackAttendanceCardStats(form = {}) {
  const stats = form.stats || {};
  return {
    work_days_text: stats.work_days_text || '0',
    overtime_text: stats.overtime_text || '0',
    leave_days_text: stats.leave_days_text || '0'
  };
}

function normalizeAttendanceCard(form = {}, holidays = {}) {
  const badge = attendanceBadge(form);
  let cardStats;
  try {
    cardStats = calculateAttendanceCardStats(form, holidays);
  } catch (error) {
    cardStats = fallbackAttendanceCardStats(form);
  }
  return {
    ...form,
    status_text: attendanceStatusText(form.status),
    status_badge_text: badge.text,
    status_class: badge.className,
    date_range: `${formatDate(form.cycle_start_date)} - ${formatDate(form.cycle_end_date)}`,
    ...cardStats
  };
}

module.exports = {
  attendanceStatusText,
  attendanceBadge,
  normalizeAttendanceCard
};
