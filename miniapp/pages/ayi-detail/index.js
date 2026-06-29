const api = require('../../utils/api');

const SECTION_META = {
  working: {
    icon: '/assets/ui/icons/work-photo.svg',
    tone: 'teal'
  },
  cook: {
    icon: '/assets/ui/icons/meal-photo.svg',
    tone: 'purple'
  },
  storage: {
    icon: '/assets/ui/icons/other.svg',
    tone: 'blue'
  },
  certificate: {
    icon: '/assets/ui/icons/certificate.svg',
    tone: 'blue'
  },
  video: {
    icon: '/assets/ui/icons/other.svg',
    tone: 'blue'
  },
  other: {
    icon: '/assets/ui/icons/other.svg',
    tone: 'blue'
  }
};

function sectionList(sections = {}) {
  return ['working', 'cook', 'storage', 'certificate', 'video', 'other']
    .map((key) => {
      const section = sections[key];
      if (!section) return null;
      return {
        ...section,
        icon: SECTION_META[key] ? SECTION_META[key].icon : '/assets/ui/icons/other.svg',
        tone: SECTION_META[key] ? SECTION_META[key].tone : 'blue'
      };
    })
    .filter((section) => section && section.items && section.items.length);
}

function hasDisplayValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function appendYearUnit(value) {
  if (!hasDisplayValue(value)) return '-';
  const text = String(value).trim();
  if (!text) return '-';
  const numeric = Number(text.replace(/年$/, ''));
  if (!Number.isNaN(numeric)) {
    return `${Math.ceil(Math.max(numeric, 0))}年`;
  }
  return /年$/.test(text) ? text : `${text}年`;
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const normalized = String(value).trim().replace(/\./g, '-').replace(/\//g, '-');
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function tenureYears(startDateValue) {
  const startDate = parseDate(startDateValue);
  if (!startDate) return '-';
  const now = new Date();
  let years = now.getFullYear() - startDate.getFullYear();
  const monthDiff = now.getMonth() - startDate.getMonth();
  const hasPartialYear = monthDiff > 0 || (monthDiff === 0 && now.getDate() > startDate.getDate());
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < startDate.getDate())) {
    return `${Math.max(years, 0)}年`;
  }
  return `${Math.max(years + (hasPartialYear ? 1 : 0), 0)}年`;
}

function normalizeAyiDetail(item = {}) {
  const workExperience = item.work_experience
    || item.workExperience
    || item.work_history
    || item.workHistory
    || item.experience
    || item.experience_text
    || '';
  return {
    ...item,
    work_years_text: appendYearUnit(item.experience_years),
    baby_count_text: hasDisplayValue(item.baby_count) ? String(item.baby_count) : '-',
    tenure_text: tenureYears(item.work_start_date),
    work_experience_text: workExperience
  };
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
      const item = normalizeAyiDetail(result.item || {});
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
