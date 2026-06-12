Page({
  data: {
    customer: null,
    employee: null
  },

  onLoad() {
    const app = getApp();
    const customer = app.globalData.customer || wx.getStorageSync('miniapp_customer');
    const employee = app.globalData.employee || wx.getStorageSync('miniapp_employee');
    this.setData({ customer: customer || null, employee: employee || null });

    if (!customer && employee) {
      this.selectEmployee();
    } else if (customer && !employee) {
      this.selectCustomer();
    } else if (!customer && !employee) {
      wx.redirectTo({ url: '/pages/employee-bind/index' });
    }
  },

  selectCustomer() {
    const app = getApp();
    const customer = app.globalData.customer || wx.getStorageSync('miniapp_customer');
    const employee = app.globalData.employee || wx.getStorageSync('miniapp_employee');
    app.setSession(app.globalData.openid || wx.getStorageSync('miniapp_openid'), customer || null, employee || null, 'customer');
    wx.redirectTo({ url: '/pages/home/index' });
  },

  selectEmployee() {
    const app = getApp();
    const customer = app.globalData.customer || wx.getStorageSync('miniapp_customer');
    const employee = app.globalData.employee || wx.getStorageSync('miniapp_employee');
    app.setSession(app.globalData.openid || wx.getStorageSync('miniapp_openid'), customer || null, employee || null, 'employee');
    wx.redirectTo({ url: '/pages/employee-home/index' });
  }
});
