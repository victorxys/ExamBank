const api = require('../../utils/api');
const { devMockOpenid, enableMockLogin } = require('../../config/index');

function wxLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => {
        if (res.code) {
          resolve(res.code);
        } else {
          reject(new Error('微信登录未返回 code'));
        }
      },
      fail: reject
    });
  });
}

Page({
  data: {
    openid: '',
    role: 'customer',
    enableMockLogin,
    loading: false
  },

  onLoad(options) {
    this.setData({
      openid: enableMockLogin ? (wx.getStorageSync('miniapp_openid') || devMockOpenid) : '',
      role: options.role || wx.getStorageSync('miniapp_role') || 'customer'
    });
  },

  selectRole(event) {
    this.setData({ role: event.currentTarget.dataset.role });
  },

  onOpenidInput(event) {
    this.setData({ openid: event.detail.value });
  },

  async login() {
    this.setData({ loading: true });
    try {
      if (enableMockLogin && this.data.openid.trim()) {
        await this.loginWithMock();
        return;
      }
      const code = await wxLogin();
      const result = await api.login({ code });
      const role = this.data.role;
      getApp().setSession(result.openid, result.customer || null, result.employee || null, role);
      if (role === 'employee') {
        wx.showToast({ title: result.employee_bound ? '登录成功' : '请先绑定员工身份', icon: 'none' });
        wx.redirectTo({ url: result.employee_bound ? '/pages/employee-home/index' : '/pages/employee-bind/index' });
        return;
      }
      wx.showToast({ title: result.has_customer_access ? '登录成功' : '暂无关联服务', icon: 'none' });
      wx.redirectTo({ url: '/pages/home/index' });
    } catch (error) {
      if (enableMockLogin) {
        try {
          await this.loginWithMock(error);
        } catch (mockError) {
          wx.showToast({ title: mockError.message || error.message || '登录失败', icon: 'none' });
        }
        return;
      }
      wx.showToast({ title: error.message || '登录失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loginWithMock(originalError = {}) {
    const openid = this.data.openid.trim();
    if (!openid) {
      wx.showToast({ title: originalError.message || '登录失败', icon: 'none' });
      return;
    }
    const result = await api.login({ mock_openid: openid });
    const role = this.data.role;
    getApp().setSession(result.openid || openid, result.customer || null, result.employee || null, role);
    if (role === 'employee') {
      wx.showToast({ title: result.employee_bound ? '登录成功' : '请先绑定员工身份', icon: 'none' });
      wx.redirectTo({ url: result.employee_bound ? '/pages/employee-home/index' : '/pages/employee-bind/index' });
      return;
    }
    wx.showToast({ title: result.has_customer_access ? '登录成功' : '暂无关联服务', icon: 'none' });
    wx.redirectTo({ url: '/pages/home/index' });
  }
});
