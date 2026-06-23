const api = require('../../utils/api');

function sectionList(sections = {}) {
  return ['working', 'cook', 'storage', 'certificate', 'video', 'other']
    .map((key) => sections[key])
    .filter((section) => section && section.items && section.items.length);
}

Page({
  data: {
    id: '',
    item: null,
    sections: [],
    loaded: false
  },

  onLoad(options = {}) {
    this.setData({ id: options.id || '' });
    this.loadDetail();
  },

  onPullDownRefresh() {
    this.loadDetail().finally(() => wx.stopPullDownRefresh());
  },

  async loadDetail() {
    if (!this.data.id) {
      wx.showToast({ title: '缺少阿姨ID', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '加载中' });
    try {
      const result = await api.ayiDetail(this.data.id);
      const item = result.item || {};
      this.setData({
        item,
        sections: sectionList(item.media_sections || {}),
        loaded: true
      });
    } catch (error) {
      this.setData({ loaded: true });
      wx.showToast({ title: error.message || '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  previewMedia(event) {
    const url = event.currentTarget.dataset.url;
    const type = event.currentTarget.dataset.type;
    const sectionKey = event.currentTarget.dataset.section;
    if (!url) return;
    if (type === 'video') {
      wx.showToast({ title: '视频请在详情中播放', icon: 'none' });
      return;
    }
    const section = this.data.sections.find((item) => item.key === sectionKey);
    const urls = section ? section.items.filter((item) => item.type === 'image').map((item) => item.url) : [url];
    wx.previewImage({ current: url, urls: urls.length ? urls : [url] });
  },

  onShareAppMessage() {
    const item = this.data.item || {};
    return {
      title: item.share_title || `${item.full_name || item.name || '阿姨'}资料`,
      path: `/pages/ayi-detail/index?id=${this.data.id}`,
      imageUrl: item.share_image_url || item.avatar_url || ''
    };
  }
});
