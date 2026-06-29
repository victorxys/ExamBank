const api = require('../../utils/api');

function staffUserFromSession() {
  return getApp().globalData.staffUser || wx.getStorageSync('miniapp_staff_user') || null;
}

Page({
  data: {
    staffUser: null,
    icons: {
      ayi: api.miniappIconUrl('ayi_search'),
      contract: api.miniappIconUrl('contract_search')
    }
  },

  onLoad() {
    if (!this.ensureStaffAccess()) return;
    this.setData({ staffUser: staffUserFromSession() });
  },

  onShow() {
    this.ensureStaffAccess();
  },

  ensureStaffAccess() {
    const role = getApp().globalData.role || wx.getStorageSync('miniapp_role');
    const staffUser = staffUserFromSession();
    if (role === 'staff' && staffUser) return true;
    wx.showToast({ title: '请先登录后台人员身份', icon: 'none' });
    wx.redirectTo({ url: '/pages/login/index?force_bind=1' });
    return false;
  },

  goAyiSearch() {
    wx.navigateTo({ url: '/pages/ayi-search/index' });
  },

  goContracts() {
    wx.navigateTo({ url: '/pages/staff-contracts/index' });
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
