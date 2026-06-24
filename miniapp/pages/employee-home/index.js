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
      contractSign: api.miniappIconUrl('contract_sign'),
      attendanceFill: api.miniappIconUrl('attendance_fill'),
      ayiSearch: api.miniappIconUrl('ayi_search')
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
      const attendanceForms = (todos.attendance_forms || []).map((item) => ({
        ...item,
        cycle_start_date_text: formatDate(item.cycle_start_date),
        cycle_end_date_text: formatDate(item.cycle_end_date),
        date_range: `${formatDate(item.cycle_start_date)} - ${formatDate(item.cycle_end_date)}`
      }));
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
    const id = event.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/attendance-fill/index?id=${id}` });
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
      const form = forms.find((item) => item.status === 'draft')
        || forms.find((item) => item.status === 'employee_confirmed')
        || forms[0];
      if (form && form.id) {
        wx.navigateTo({ url: `/pages/attendance-fill/index?id=${form.id}` });
      }
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
