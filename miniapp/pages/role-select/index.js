Page({
  data: {
    customer: null,
    employee: null,
    staffUser: null
  },

  onLoad() {
    const app = getApp();
    const customer = app.globalData.customer || wx.getStorageSync('miniapp_customer');
    const employee = app.globalData.employee || wx.getStorageSync('miniapp_employee');
    const staffUser = app.globalData.staffUser || wx.getStorageSync('miniapp_staff_user');
    this.setData({ customer: customer || null, employee: employee || null, staffUser: staffUser || null });

    if (!customer && !staffUser && employee) {
      this.selectEmployee();
    } else if (customer && !employee && !staffUser) {
      this.selectCustomer();
    } else if (!customer && !employee && staffUser) {
      this.selectStaff();
    } else if (!customer && !employee && !staffUser) {
      wx.redirectTo({ url: '/pages/employee-bind/index' });
    }
  },

  selectCustomer() {
    const app = getApp();
    const customer = app.globalData.customer || wx.getStorageSync('miniapp_customer');
    const employee = app.globalData.employee || wx.getStorageSync('miniapp_employee');
    const staffUser = app.globalData.staffUser || wx.getStorageSync('miniapp_staff_user');
    app.setSession(app.globalData.openid || wx.getStorageSync('miniapp_openid'), customer || null, employee || null, 'customer', staffUser || null);
    wx.redirectTo({ url: '/pages/home/index' });
  },

  selectEmployee() {
    const app = getApp();
    const customer = app.globalData.customer || wx.getStorageSync('miniapp_customer');
    const employee = app.globalData.employee || wx.getStorageSync('miniapp_employee');
    const staffUser = app.globalData.staffUser || wx.getStorageSync('miniapp_staff_user');
    app.setSession(app.globalData.openid || wx.getStorageSync('miniapp_openid'), customer || null, employee || null, 'employee', staffUser || null);
    wx.redirectTo({ url: '/pages/employee-home/index' });
  },

  selectStaff() {
    const app = getApp();
    const customer = app.globalData.customer || wx.getStorageSync('miniapp_customer');
    const employee = app.globalData.employee || wx.getStorageSync('miniapp_employee');
    const staffUser = app.globalData.staffUser || wx.getStorageSync('miniapp_staff_user');
    app.setSession(app.globalData.openid || wx.getStorageSync('miniapp_openid'), customer || null, employee || null, 'staff', staffUser || null);
    wx.redirectTo({ url: '/pages/staff-home/index' });
  }
});
