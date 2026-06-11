const api = require('../../utils/api');
const { contractView } = require('../../utils/format');

Page({
  data: {
    role: 'customer',
    subjectLabel: '服务人员',
    activeContracts: [],
    servingContracts: [],
    upcomingContracts: [],
    serviceContractCount: 0,
    historyContracts: [],
    loaded: false
  },

  onLoad(options) {
    const role = options.role || getApp().globalData.role || wx.getStorageSync('miniapp_role') || 'customer';
    this.setData({
      role,
      subjectLabel: role === 'employee' ? '客户' : '服务人员'
    });
    this.loadContracts();
  },

  onPullDownRefresh() {
    this.loadContracts().finally(() => wx.stopPullDownRefresh());
  },

  async loadContracts() {
    wx.showLoading({ title: '加载中' });
    try {
      const listApi = this.data.role === 'employee' ? api.employeeContractList : api.contractList;
      const [active, history] = await Promise.all([
        listApi('active'),
        listApi('history')
      ]);
      const activeContracts = (active.contracts || []).map(contractView);
      const upcomingContracts = activeContracts.filter((item) => item.status === 'pending');
      const servingContracts = activeContracts.filter((item) => item.status !== 'pending');
      this.setData({
        activeContracts,
        servingContracts,
        upcomingContracts,
        serviceContractCount: activeContracts.length,
        historyContracts: (history.contracts || []).map(contractView),
        loaded: true
      });
    } catch (error) {
      this.setData({ loaded: true });
      wx.showToast({ title: error.message || '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  goDetail(event) {
    const id = event.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/contract-detail/index?id=${id}&role=${this.data.role}` });
  }
});
