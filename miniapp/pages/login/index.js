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
    enableMockLogin,
    loading: false
  },

  onLoad() {
    this.setData({
      openid: enableMockLogin ? (wx.getStorageSync('miniapp_openid') || devMockOpenid) : ''
    });
  },

  onOpenidInput(event) {
    this.setData({ openid: event.detail.value });
  },

  routeAfterLogin(result, fallbackOpenid = '') {
    const openid = result.openid || fallbackOpenid;
    const customer = result.customer || null;
    const employee = result.employee || null;
    const defaultRole = result.default_role || (result.has_customer_access ? 'customer' : '');
    const role = result.requires_role_select ? '' : defaultRole;
    getApp().setSession(openid, customer, employee, role);

    if (result.requires_role_select) {
      wx.showToast({ title: '请选择进入身份', icon: 'none' });
      wx.redirectTo({ url: '/pages/role-select/index' });
      return;
    }
    if (defaultRole === 'employee') {
      wx.showToast({ title: '登录成功', icon: 'success' });
      wx.redirectTo({ url: '/pages/employee-home/index' });
      return;
    }
    if (defaultRole === 'customer') {
      wx.showToast({ title: '登录成功', icon: 'success' });
      wx.redirectTo({ url: '/pages/home/index' });
      return;
    }

    wx.showToast({ title: '请先绑定员工身份', icon: 'none' });
    wx.redirectTo({ url: '/pages/employee-bind/index' });
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
      this.routeAfterLogin(result);
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
    this.routeAfterLogin(result, openid);
  }
});
