const api = require('../../utils/api');
const { enableMockLogin } = require('../../config/index');

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

function localOpenid() {
  const generated = `dev-local-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  wx.setStorageSync('miniapp_openid', generated);
  return generated;
}

Page({
  data: {
    openid: '',
    enableMockLogin,
    loading: false,
    autoRouting: false,
    forceBind: false
  },

  onLoad(options = {}) {
    this.setData({
      openid: '',
      forceBind: options.force_bind === '1'
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
    const staffUser = result.staff_user || null;
    const defaultRole = result.default_role || (result.has_customer_access ? 'customer' : '');
    const role = result.requires_role_select ? '' : defaultRole;
    getApp().setSession(openid, customer, employee, role, staffUser);

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
    if (defaultRole === 'staff') {
      wx.showToast({ title: '登录成功', icon: 'success' });
      wx.redirectTo({ url: '/pages/ayi-search/index' });
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
    if (this.data.forceBind || enableMockLogin) return;

    const openid = wx.getStorageSync('miniapp_openid');
    if (!openid) return;

    const role = wx.getStorageSync('miniapp_role');
    const customer = wx.getStorageSync('miniapp_customer');
    const employee = wx.getStorageSync('miniapp_employee');
    const staffUser = wx.getStorageSync('miniapp_staff_user');
    if (role === 'staff' || (!role && staffUser)) {
      wx.redirectTo({ url: '/pages/ayi-search/index' });
      return;
    }
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
      if (enableMockLogin) {
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
      const generatedOpenid = localOpenid();
      getApp().setSession(generatedOpenid, null, null, '', null);
      wx.showToast({ title: '请先绑定身份', icon: 'none' });
      wx.redirectTo({ url: '/pages/employee-bind/index' });
      return;
    }
    const result = await api.login({ mock_openid: openid });
    this.routeAfterLogin(result, openid);
  }
});
