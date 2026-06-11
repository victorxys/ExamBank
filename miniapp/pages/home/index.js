const api = require('../../utils/api');
const { formatDate, contractView } = require('../../utils/format');

function dateText(value) {
  return value ? String(value).slice(0, 10) : '';
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function buildFallbackCalendarDays(item = {}, stats = {}) {
  const start = new Date(item.cycle_start_date);
  const end = new Date(item.cycle_end_date);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const days = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const effectiveStart = dateText(stats.effective_start_date);
  const effectiveEnd = dateText(stats.effective_end_date);
  while (cursor <= last) {
    const current = `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}-${pad(cursor.getDate())}`;
    const disabled = Boolean((effectiveStart && current < effectiveStart) || (effectiveEnd && current > effectiveEnd));
    days.push({
      date: current,
      day: cursor.getDate(),
      tone: disabled ? 'disabled' : 'normal',
      label: disabled ? '' : '出勤',
      disabled
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function normalizeCalendarDay(day, stats = {}) {
  const current = dateText(day.date);
  const effectiveStart = dateText(stats.effective_start_date);
  const effectiveEnd = dateText(stats.effective_end_date);
  const disabled = Boolean(
    day.disabled
    || day.tone === 'disabled'
    || (effectiveStart && current && current < effectiveStart)
    || (effectiveEnd && current && current > effectiveEnd)
  );
  const tone = disabled ? 'disabled' : (day.tone || 'normal');
  return {
    ...day,
    disabled,
    tone,
    className: `calendar-day ${tone}`
  };
}

function previewDays(days = [], stats = {}) {
  return (Array.isArray(days) ? days : []).map((item) => normalizeCalendarDay(item, stats));
}

function formatAmount(value) {
  const number = Number(value || 0);
  if (Math.abs(number) < 0.001) return '0';
  if (Math.abs(number - Math.round(number)) < 0.001) return String(Math.round(number));
  return number.toFixed(1).replace(/\.0$/, '');
}

function attendanceCardStats(stats = {}, item = {}) {
  const sourceDays = (Array.isArray(stats.calendar_days) && stats.calendar_days.length)
    ? stats.calendar_days
    : buildFallbackCalendarDays(item, stats);
  const days = previewDays(sourceDays, stats);
  if (!days.length) {
    return {
      workDaysText: stats.work_days_text || '0',
      overtimeText: stats.overtime_text || '0',
      leaveDaysText: stats.leave_days_text || '0'
    };
  }

  const activeDays = days.filter((day) => !day.disabled && day.tone !== 'disabled');
  const leaveDays = activeDays.filter((day) => day.tone === 'rest').length;
  const overtimeDays = activeDays.filter((day) => day.tone === 'overtime').length;
  return {
    workDaysText: formatAmount(Math.min(26, Math.max(0, activeDays.length - leaveDays))),
    overtimeText: formatAmount(overtimeDays || stats.overtime_days || 0),
    leaveDaysText: formatAmount(leaveDays || stats.leave_days || 0)
  };
}

Page({
  data: {
    customer: {},
    pendingContracts: [],
    pendingAttendance: [],
    pendingEvaluations: [],
    activeContracts: [],
    servingContracts: [],
    upcomingContracts: [],
    serviceContractCount: 0,
    todoCount: 0,
    overviewLoaded: false
  },

  onShow() {
    this.loadOverview();
  },

  onPullDownRefresh() {
    this.loadOverview().finally(() => wx.stopPullDownRefresh());
  },

  async loadOverview() {
    if (!api.getOpenid()) {
      wx.redirectTo({ url: '/pages/login/index' });
      return;
    }

    wx.showLoading({ title: '加载中' });
    try {
      const result = await api.overview();
      const todos = result.todos || {};
      const pendingContracts = (todos.contracts || []).map((item) => ({
        ...contractView(item),
        start_date_text: formatDate(item.start_date)
      }));
      const pendingAttendance = (todos.attendance_forms || []).map((item) => ({
        ...item,
        ...attendanceCardStats(item.stats || {}, item),
        cycle_start_date_text: formatDate(item.cycle_start_date),
        cycle_end_date_text: formatDate(item.cycle_end_date),
        date_range: `${formatDate(item.cycle_start_date)} - ${formatDate(item.cycle_end_date)}`,
        preview_days: previewDays(
          (item.stats && item.stats.calendar_days && item.stats.calendar_days.length)
            ? item.stats.calendar_days
            : buildFallbackCalendarDays(item, item.stats || {}),
          item.stats || {}
        )
      })).map((item) => ({
        ...item,
        work_days_text: item.workDaysText,
        overtime_text: item.overtimeText,
        leave_days_text: item.leaveDaysText
      }));
      const pendingEvaluations = (todos.evaluations || []).map(contractView);
      const activeContracts = (result.active_contracts || []).map(contractView);
      const upcomingContracts = activeContracts.filter((item) => item.status === 'pending');
      const servingContracts = activeContracts.filter((item) => item.status !== 'pending');
      this.setData({
        customer: result.customer || {},
        pendingContracts,
        pendingAttendance,
        pendingEvaluations,
        activeContracts,
        servingContracts,
        upcomingContracts,
        serviceContractCount: activeContracts.length,
        todoCount: pendingContracts.length + pendingAttendance.length + pendingEvaluations.length,
        overviewLoaded: true
      });
      getApp().setSession(api.getOpenid(), result.customer || null, null, 'customer');
    } catch (error) {
      this.setData({ overviewLoaded: true });
      wx.showToast({ title: error.message || '加载失败', icon: 'none' });
      if (/未绑定/.test(error.message || '')) {
        this.setData({
          customer: { name: '微信用户', auto_discovered: true },
          pendingContracts: [],
          pendingAttendance: [],
          pendingEvaluations: [],
          activeContracts: [],
          servingContracts: [],
          upcomingContracts: [],
          serviceContractCount: 0,
          todoCount: 0
        });
      }
    } finally {
      wx.hideLoading();
    }
  },

  goContracts() {
    wx.navigateTo({ url: '/pages/contracts/index' });
  },

  goContractSign(event) {
    const token = event.currentTarget.dataset.token;
    if (token) wx.navigateTo({ url: `/pages/contract-sign/index?token=${token}` });
  },

  goAttendanceSign(event) {
    const token = event.currentTarget.dataset.token;
    if (token) wx.navigateTo({ url: `/pages/attendance-sign/index?token=${token}` });
  },

  goContractDetail(event) {
    const id = event.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/contract-detail/index?id=${id}` });
  },

  goEvaluation(event) {
    const id = event.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/evaluation/index?contractId=${id}` });
  }
});
