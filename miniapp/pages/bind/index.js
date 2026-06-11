const api = require('../../utils/api');

Page({
  data: {
    form: {
      name: '',
      phone_number: '',
      id_card_last4: ''
    },
    loading: false
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: event.detail.value });
  },

  async bindCustomer() {
    const { form } = this.data;
    const openid = api.getOpenid();
    if (!openid || !form.name || !form.phone_number) {
      wx.showToast({ title: '请填写姓名和手机号', icon: 'none' });
      return;
    }

    this.setData({ loading: true });
    try {
      const result = await api.bindPhone({ ...form, openid });
      getApp().setSession(openid, result.customer || null);
      wx.showToast({ title: '绑定成功', icon: 'success' });
      wx.redirectTo({ url: '/pages/home/index' });
    } catch (error) {
      wx.showToast({ title: error.message || '绑定失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  }
});
