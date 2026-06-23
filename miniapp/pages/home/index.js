const api = require('../../utils/api');
const { formatDate, contractView } = require('../../utils/format');
const {
  buildCalendar,
  calculateStats,
  normalizeAttendanceData,
  normalizeAutoOvertime
} = require('../../utils/attendance');

function compactDaysText(value) {
  return String(value || '0').replace(/天$/, '');
}

function buildAttendancePreview(item = {}) {
  const attendanceData = normalizeAttendanceData(item.form_data || {});
  const firstCalendar = buildCalendar(item, attendanceData, {});
  const normalizedData = normalizeAutoOvertime(attendanceData, item, firstCalendar.monthDays, {});
  const calendar = buildCalendar(item, normalizedData, {});
  const stats = calculateStats(normalizedData, calendar.monthDays, item, {});
  return {
    workDaysText: compactDaysText(stats.workDaysText),
    overtimeText: compactDaysText(stats.overtimeDaysText),
    leaveDaysText: compactDaysText(stats.leaveDaysText),
    previewDays: calendar.cells.map((cell) => {
      if (cell.blank) {
        return {
          key: cell.key,
          blank: true,
          className: 'calendar-day blank'
        };
      }
      const tone = cell.tone || 'normal';
      return {
        ...cell,
        label: cell.typeLabel,
        className: [
          'calendar-day',
          `tone-${tone}`,
          cell.weekend ? 'weekend' : '',
          cell.isHoliday && cell.type === 'normal' ? 'holiday' : '',
          cell.isWorkday ? 'workday' : '',
          cell.isAuto ? 'auto-overtime' : '',
          cell.disabled ? 'disabled' : ''
        ].filter(Boolean).join(' ')
      };
    })
  };
}

function contractFallbackFromAttendance(attendance = {}) {
  if (!attendance.contract_id) return null;
  return contractView({
    id: attendance.contract_id,
    type_label: '服务合同',
    employee_name: attendance.employee_name || '',
    customer_name: attendance.customer_name || '',
    start_date: attendance.cycle_start_date,
    end_date: attendance.cycle_end_date,
    status: 'active',
    signing_status: 'SIGNED'
  });
}

Page({
  data: {
    customer: {},
    pendingContracts: [],
    pendingAttendance: [],
    pendingEvaluations: [],
    activeContracts: [],
    recentContracts: [],
    servingContracts: [],
    upcomingContracts: [],
    serviceContractCount: 0,
    todoCount: 0,
    overviewLoaded: false,
    icons: {
      contractSign: api.miniappIconUrl('contract_sign'),
      evaluation: api.miniappIconUrl('evaluation')
    }
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
        ...buildAttendancePreview(item),
        cycle_start_date_text: formatDate(item.cycle_start_date),
        cycle_end_date_text: formatDate(item.cycle_end_date),
        date_range: `${formatDate(item.cycle_start_date)} - ${formatDate(item.cycle_end_date)}`
      })).map((item) => ({
        ...item,
        work_days_text: item.workDaysText,
        overtime_text: item.overtimeText,
        leave_days_text: item.leaveDaysText
      }));
      const pendingEvaluations = (todos.evaluations || []).map(contractView);
      const activeContracts = (result.active_contracts || []).map(contractView);
      const recentContracts = ((result.recent_contracts && result.recent_contracts.length)
        ? result.recent_contracts
        : result.active_contracts || []).slice(0, 1).map(contractView);
      if (!recentContracts.length && pendingAttendance.length) {
        const fallbackContract = contractFallbackFromAttendance(pendingAttendance[0]);
        if (fallbackContract) recentContracts.push(fallbackContract);
      }
      const upcomingContracts = activeContracts.filter((item) => item.status === 'pending');
      const servingContracts = activeContracts.filter((item) => item.status !== 'pending');
      this.setData({
        customer: result.customer || {},
        pendingContracts,
        pendingAttendance,
        pendingEvaluations,
        activeContracts,
        recentContracts,
        servingContracts,
        upcomingContracts,
        serviceContractCount: recentContracts.length,
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
          recentContracts: [],
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
