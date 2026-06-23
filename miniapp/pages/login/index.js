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
    loading: false,
    autoRouting: false
  },

  onLoad() {
    this.setData({
      openid: enableMockLogin ? (wx.getStorageSync('miniapp_openid') || devMockOpenid) : ''
    });
    this.routeFromExistingSession();
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

  routeFromExistingSession() {
    if (enableMockLogin) return;

    const openid = wx.getStorageSync('miniapp_openid');
    if (!openid) return;

    const role = wx.getStorageSync('miniapp_role');
    const customer = wx.getStorageSync('miniapp_customer');
    const employee = wx.getStorageSync('miniapp_employee');
    if (role === 'employee' || (!role && employee)) {
      wx.redirectTo({ url: '/pages/employee-home/index' });
      return;
    }
    if (role === 'customer' || (!role && customer)) {
      wx.redirectTo({ url: '/pages/home/index' });
      return;
    }

    this.refreshExistingSession(openid);
  },

  async refreshExistingSession(openid) {
    if (this.data.autoRouting) return;
    this.setData({ autoRouting: true });
    try {
      let result;
      if (enableMockLogin) {
        result = await api.login({ mock_openid: openid });
      } else {
        const code = await wxLogin();
        result = await api.login({ code });
      }
      this.routeAfterLogin(result, openid);
    } catch (error) {
      this.setData({ autoRouting: false });
    }
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
