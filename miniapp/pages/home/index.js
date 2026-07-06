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

function moneyText(value) {
  const number = Number(value || 0);
  if (Number.isNaN(number)) return value || '0.00';
  return number.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function buildPayrollTodo(item = {}) {
  return {
    ...item,
    amount_due_text: moneyText(item.amount_due),
    period_text: `${item.year || ''}年${item.month || '-'}月`,
    date_range: `${formatDate(item.cycle_start_date)} - ${formatDate(item.cycle_end_date)}`
  };
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

function clearCustomerSession() {
  const app = getApp();
  app.globalData.customer = null;
  if (app.globalData.role === 'customer') app.globalData.role = '';
  wx.removeStorageSync('miniapp_customer');
  if (wx.getStorageSync('miniapp_role') === 'customer') {
    wx.removeStorageSync('miniapp_role');
  }
}

function inferCustomerName(result = {}, lists = {}) {
  const customer = result.customer || {};
  if (customer.name && customer.name !== '微信用户') return customer.name;
  const sources = [
    ...(lists.pendingContracts || []),
    ...(lists.pendingAttendance || []),
    ...(lists.recentContracts || []),
    ...(lists.activeContracts || [])
  ];
  const matched = sources.find((item) => item.customer_name);
  return (matched && matched.customer_name) || customer.name || '客户';
}

Page({
  data: {
    customer: {},
    pendingContracts: [],
    pendingAttendance: [],
    pendingPayrolls: [],
    pendingEvaluations: [],
    activeContracts: [],
    recentContracts: [],
    servingContracts: [],
    upcomingContracts: [],
    serviceContractCount: 0,
    payrollContractId: '',
    todoCount: 0,
    overviewLoaded: false,
    canAccessAyiProfiles: false,
    icons: {
      contractSign: '/assets/ui/icons/contract_sign.svg',
      evaluation: '/assets/ui/icons/evaluation.svg',
      ayiSearch: '/assets/ui/icons/ayi_search.svg',
      payroll: '/assets/ui/icons/payroll.svg'
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
      const pendingPayrolls = (todos.payrolls || []).map(buildPayrollTodo);
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
      const customer = {
        ...(result.customer || {}),
        name: inferCustomerName(result, {
          pendingContracts,
          pendingAttendance,
          recentContracts,
          activeContracts
        })
      };
      this.setData({
        customer,
        pendingContracts,
        pendingAttendance,
        pendingPayrolls,
        pendingEvaluations,
        activeContracts,
        recentContracts,
        servingContracts,
        upcomingContracts,
        serviceContractCount: recentContracts.length,
        payrollContractId: (recentContracts[0] || {}).id || '',
        todoCount: pendingContracts.length + pendingAttendance.length + pendingPayrolls.length + pendingEvaluations.length,
        overviewLoaded: true,
        canAccessAyiProfiles: false
      });
      getApp().setSession(api.getOpenid(), customer, null, 'customer', null);
    } catch (error) {
      this.setData({ overviewLoaded: true });
      wx.showToast({ title: error.message || '加载失败', icon: 'none' });
      if (/未绑定|无权|401|403/.test(error.message || '')) {
        clearCustomerSession();
        wx.redirectTo({ url: '/pages/login/index?force_bind=1' });
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

  goPayrollDue(event) {
    const id = event.currentTarget.dataset.id || this.data.payrollContractId;
    const payrollId = event.currentTarget.dataset.payrollId || '';
    if (payrollId) {
      wx.navigateTo({ url: `/pages/payroll-due/index?payrollId=${payrollId}` });
      return;
    }
    if (id) {
      const now = new Date();
      wx.navigateTo({ url: `/pages/payroll-due/index?contractId=${id}&year=${now.getFullYear()}&month=${now.getMonth() + 1}` });
    }
  },

  goEvaluation(event) {
    const id = event.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/evaluation/index?contractId=${id}` });
  },

  goAyiSearch() {
    wx.navigateTo({ url: '/pages/ayi-search/index' });
  },

  logoutFallback() {
    wx.showModal({
      title: '退出当前身份',
      content: '仅在身份异常或需要切换微信绑定时使用。退出后需要重新登录或绑定身份。',
      confirmText: '退出',
      confirmColor: '#dc2626',
      success: (res) => {
        if (!res.confirm) return;
        getApp().clearSession();
        wx.redirectTo({ url: '/pages/login/index?force_bind=1' });
      }
    });
  }
});
