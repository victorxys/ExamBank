const api = require('../../utils/api');
const { formatDate, contractView } = require('../../utils/format');

function clearEmployeeSession() {
  const app = getApp();
  app.globalData.employee = null;
  if (app.globalData.role === 'employee') app.globalData.role = '';
  wx.removeStorageSync('miniapp_employee');
  if (wx.getStorageSync('miniapp_role') === 'employee') {
    wx.removeStorageSync('miniapp_role');
  }
}

Page({
  data: {
    employee: {},
    pendingContracts: [],
    attendanceForms: [],
    activeContracts: [],
    recentContracts: [],
    todoCount: 0,
    overviewLoaded: false,
    canAccessAyiProfiles: false,
    icons: {
      contractSign: '/assets/ui/icons/contract_sign.svg',
      attendanceFill: '/assets/ui/icons/attendance_fill.svg',
      ayiSearch: '/assets/ui/icons/ayi_search.svg'
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
      const result = await api.employeeOverview();
      const todos = result.todos || {};
      const pendingContracts = (todos.contracts || []).map((item) => ({
        ...contractView(item),
        start_date_text: formatDate(item.start_date)
      }));
      const attendanceForms = (todos.attendance_forms || []).map((item) => {
        const start = item.attendance_start_date || item.cycle_start_date;
        const end = item.attendance_end_date || item.cycle_end_date;
        const isMaternity = Boolean(item.is_maternity || item.attendance_cycle_type === 'maternity_26d');
        const needsOnboarding = Boolean(item.needs_onboarding_date || item.status === 'need_onboarding_date');
        let actionTitle;
        if (needsOnboarding) {
          actionTitle = item.todo_title || '月嫂考勤待确认上户';
        } else if (isMaternity) {
          actionTitle = item.todo_title
            || (item.status === 'employee_confirmed' ? '月嫂考勤待客户确认' : '月嫂考勤待填写');
        } else {
          actionTitle = `${item.month || '-'} 月考勤${item.status === 'employee_confirmed' ? '待客户确认' : '待填写'}`;
        }
        let actionDesc = `${item.customer_name || '客户'}`;
        if (needsOnboarding) {
          actionDesc += ` · ${item.todo_desc_suffix || '请先确认实际上户日期与时间'}`;
        } else if (start && end) {
          actionDesc += ` · ${formatDate(start)} - ${formatDate(end)}`;
        }
        return {
          ...item,
          list_key: item.id || `ph_${item.contract_id}`,
          is_maternity: isMaternity,
          needs_onboarding_date: needsOnboarding,
          cycle_start_date_text: formatDate(start),
          cycle_end_date_text: formatDate(end),
          date_range: start && end ? `${formatDate(start)} - ${formatDate(end)}` : '',
          action_title: actionTitle,
          action_desc: actionDesc,
          badge_text: needsOnboarding
            ? '待上户'
            : (item.status === 'employee_confirmed' ? '已提交' : '待填')
        };
      });
      const activeContracts = (result.active_contracts || []).map(contractView);
      const recentContracts = ((result.recent_contracts && result.recent_contracts.length)
        ? result.recent_contracts
        : result.active_contracts || []).slice(0, 1).map(contractView);
      this.setData({
        employee: result.employee || {},
        pendingContracts,
        attendanceForms,
        activeContracts,
        recentContracts,
        todoCount: pendingContracts.length + attendanceForms.length,
        overviewLoaded: true,
        canAccessAyiProfiles: false
      });
      getApp().setSession(api.getOpenid(), null, result.employee || null, 'employee', null);
    } catch (error) {
      this.setData({ overviewLoaded: true });
      wx.showToast({ title: error.message || '加载失败', icon: 'none' });
      if (/未绑定/.test(error.message || '')) {
        clearEmployeeSession();
        wx.redirectTo({ url: '/pages/employee-bind/index' });
      }
    } finally {
      wx.hideLoading();
    }
  },

  goContractSign(event) {
    const token = event.currentTarget.dataset.token;
    if (token) wx.navigateTo({ url: `/pages/contract-sign/index?token=${token}` });
  },

  goContracts() {
    wx.navigateTo({ url: '/pages/contracts/index?role=employee' });
  },

  goAttendanceFill(event) {
    const {
      id,
      contractId,
      cycleStart,
      employeeId,
      needsOnboarding
    } = event.currentTarget.dataset;
    const resolvedEmployeeId = employeeId
      || (this.data.employee && this.data.employee.id)
      || '';

    // 月嫂待确认上户：用员工 ID + contractId 进入上户引导
    if (needsOnboarding === true || needsOnboarding === 'true' || !id) {
      const token = resolvedEmployeeId;
      if (!token && !contractId) {
        wx.showToast({ title: '缺少考勤信息', icon: 'none' });
        return;
      }
      const now = new Date();
      const query = [
        token ? `id=${encodeURIComponent(token)}` : '',
        token ? `employee_token=${encodeURIComponent(token)}` : '',
        `year=${now.getFullYear()}`,
        `month=${now.getMonth() + 1}`,
        contractId ? `contractId=${encodeURIComponent(contractId)}` : '',
        cycleStart ? `cycleStart=${encodeURIComponent(cycleStart)}` : ''
      ].filter(Boolean).join('&');
      wx.navigateTo({ url: `/pages/attendance-fill/index?${query}` });
      return;
    }

    const parts = [
      `id=${id}`,
      contractId ? `contractId=${encodeURIComponent(contractId)}` : '',
      cycleStart ? `cycleStart=${encodeURIComponent(cycleStart)}` : '',
      resolvedEmployeeId ? `employee_token=${encodeURIComponent(resolvedEmployeeId)}` : ''
    ].filter(Boolean);
    wx.navigateTo({ url: `/pages/attendance-fill/index?${parts.join('&')}` });
  },

  openAttendanceForm(form, year, month) {
    const employeeId = (this.data.employee && this.data.employee.id) || '';
    if (!form) return;
    // 月嫂无上户日或无 form id：走 by-token + contractId
    if (!form.id || form.needs_onboarding_date || form.status === 'need_onboarding_date') {
      const token = form.employee_id || employeeId;
      const query = [
        token ? `id=${encodeURIComponent(token)}` : '',
        token ? `employee_token=${encodeURIComponent(token)}` : '',
        year ? `year=${year}` : '',
        month ? `month=${month}` : '',
        form.contract_id ? `contractId=${encodeURIComponent(form.contract_id)}` : '',
        form.cycle_start_date ? `cycleStart=${encodeURIComponent(form.cycle_start_date)}` : ''
      ].filter(Boolean).join('&');
      wx.navigateTo({ url: `/pages/attendance-fill/index?${query}` });
      return;
    }
    const parts = [
      `id=${form.id}`,
      form.contract_id ? `contractId=${encodeURIComponent(form.contract_id)}` : '',
      form.cycle_start_date ? `cycleStart=${encodeURIComponent(form.cycle_start_date)}` : '',
      year ? `year=${year}` : '',
      month ? `month=${month}` : ''
    ].filter(Boolean);
    wx.navigateTo({ url: `/pages/attendance-fill/index?${parts.join('&')}` });
  },

  async goAttendanceEntry() {
    wx.showLoading({ title: '加载考勤' });
    try {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      const result = await api.employeeAttendanceList({ year, month });
      const forms = result.attendance_forms || [];
      if (!forms.length) {
        wx.showToast({ title: '本月暂无可填写考勤', icon: 'none' });
        return;
      }
      if (forms.length > 1) {
        wx.navigateTo({ url: `/pages/attendance-select/index?year=${year}&month=${month}` });
        return;
      }
      const form = forms.find((item) => item.status === 'draft')
        || forms.find((item) => item.status === 'need_onboarding_date')
        || forms.find((item) => item.status === 'employee_confirmed')
        || forms[0];
      this.openAttendanceForm(form, year, month);
    } catch (error) {
      wx.showToast({ title: error.message || '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  goContractDetail(event) {
    const id = event.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/contract-detail/index?id=${id}&role=employee` });
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
