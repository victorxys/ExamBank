const api = require('../../utils/api');

Page({
  data: {
    form: {
      phone_number: '',
      id_card_last6: ''
    },
    redirect: '',
    loading: false
  },

  onLoad(options) {
    this.setData({ redirect: options.redirect ? decodeURIComponent(options.redirect) : '' });
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: event.detail.value });
  },

  async bindEmployee() {
    const { form } = this.data;
    const openid = api.getOpenid();
    if (!openid || !form.phone_number || !form.id_card_last6) {
      wx.showToast({ title: '请填写手机号和身份证后6位', icon: 'none' });
      return;
    }

    this.setData({ loading: true });
    try {
      const result = await api.bindEmployee({ ...form, openid });
      getApp().setSession(openid, null, result.employee || null, 'employee');
      wx.showToast({ title: '绑定成功', icon: 'success' });
      wx.redirectTo({ url: this.data.redirect || '/pages/employee-home/index' });
    } catch (error) {
      wx.showToast({ title: error.message || '绑定失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  }
});
