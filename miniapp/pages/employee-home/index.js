const api = require('../../utils/api');
const { formatDate, contractView } = require('../../utils/format');

Page({
  data: {
    employee: {},
    pendingContracts: [],
    attendanceForms: [],
    activeContracts: [],
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
      this.setData({
        employee: result.employee || {},
        pendingContracts,
        attendanceForms,
        activeContracts,
        todoCount: pendingContracts.length + attendanceForms.length,
        overviewLoaded: true
      });
      getApp().setSession(api.getOpenid(), null, result.employee || null, 'employee');
    } catch (error) {
      this.setData({ overviewLoaded: true });
      wx.showToast({ title: error.message || '加载失败', icon: 'none' });
      if (/未绑定/.test(error.message || '')) {
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

  goContractDetail(event) {
    const id = event.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/contract-detail/index?id=${id}&role=employee` });
  }
});
