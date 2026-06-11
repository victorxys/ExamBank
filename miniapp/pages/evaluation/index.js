const api = require('../../utils/api');
const { contractView } = require('../../utils/format');

const GOOD_TAGS = ['专业细心', '沟通顺畅', '守时负责', '服务主动', '照顾周到', '卫生整洁', '经验丰富', '情绪稳定'];
const IMPROVE_TAGS = ['沟通反馈', '时间安排', '服务细节', '专业技能', '耐心程度', '需要跟进'];
const QUICK_COMMENTS = [
  '服务过程比较专业，沟通也顺畅，整体比较满意。',
  '服务人员守时负责，日常照顾比较细致。',
  '希望后续能加强沟通反馈，让家里更及时了解服务情况。',
  '有些服务细节还需要继续磨合，希望后续重点关注。'
];

const RATING_LABELS = {
  1: '很不满意',
  2: '不太满意',
  3: '一般',
  4: '满意',
  5: '非常满意'
};

function ratingLabel(rating) {
  return RATING_LABELS[rating] || '请选择';
}

function stars(rating) {
  return [1, 2, 3, 4, 5].map((value) => ({
    value,
    text: value <= rating ? '★' : '☆',
    className: value <= rating ? 'star active' : 'star'
  }));
}

function tagItems(labels, selected = []) {
  return labels.map((label) => ({
    label,
    selected: selected.includes(label),
    className: selected.includes(label) ? 'tag-chip active' : 'tag-chip'
  }));
}

Page({
  data: {
    contractId: '',
    contract: {},
    rating: 5,
    ratingLabel: ratingLabel(5),
    starItems: stars(5),
    selectedTags: [],
    goodTags: tagItems(GOOD_TAGS, []),
    improveTags: tagItems(IMPROVE_TAGS, []),
    quickComments: QUICK_COMMENTS,
    comment: '',
    commentCount: 0,
    loading: false,
    submitted: false
  },

  onLoad(options) {
    this.setData({ contractId: options.contractId || options.id || '' });
    this.loadEvaluation();
  },

  async loadEvaluation() {
    if (!this.data.contractId) {
      wx.showToast({ title: '缺少合同ID', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '加载中' });
    try {
      await api.ensureOpenid('customer');
      const result = await api.contractEvaluation(this.data.contractId);
      const evaluation = result.evaluation || null;
      const rating = evaluation ? evaluation.rating : 5;
      const selectedTags = evaluation ? (evaluation.tags || []) : [];
      this.setData({
        contract: contractView(result.contract || {}),
        rating,
        ratingLabel: ratingLabel(rating),
        starItems: stars(rating),
        selectedTags,
        goodTags: tagItems(GOOD_TAGS, selectedTags),
        improveTags: tagItems(IMPROVE_TAGS, selectedTags),
        comment: evaluation ? evaluation.comment || '' : '',
        commentCount: evaluation ? (evaluation.comment || '').length : 0,
        submitted: Boolean(evaluation)
      });
    } catch (error) {
      wx.showToast({ title: error.message || '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  setRating(event) {
    const rating = Number(event.currentTarget.dataset.value || 5);
    this.setData({
      rating,
      ratingLabel: ratingLabel(rating),
      starItems: stars(rating)
    });
  },

  toggleTag(event) {
    const label = event.currentTarget.dataset.label;
    const selected = this.data.selectedTags.slice();
    const index = selected.indexOf(label);
    if (index >= 0) {
      selected.splice(index, 1);
    } else {
      selected.push(label);
    }
    this.setData({
      selectedTags: selected,
      goodTags: tagItems(GOOD_TAGS, selected),
      improveTags: tagItems(IMPROVE_TAGS, selected)
    });
  },

  onCommentInput(event) {
    const comment = event.detail.value || '';
    this.setData({
      comment,
      commentCount: comment.length
    });
  },

  useQuickComment(event) {
    const text = event.currentTarget.dataset.text || '';
    if (!text) return;
    const current = (this.data.comment || '').trim();
    const comment = current ? `${current}\n${text}` : text;
    this.setData({
      comment,
      commentCount: comment.length
    });
  },

  async submit() {
    this.setData({ loading: true });
    try {
      const result = await api.submitContractEvaluation(this.data.contractId, {
        openid: api.getOpenid(),
        rating: this.data.rating,
        tags: this.data.selectedTags,
        comment: this.data.comment
      });
      const evaluation = result.evaluation || {};
      this.setData({
        submitted: true,
        rating: evaluation.rating || this.data.rating,
        ratingLabel: ratingLabel(evaluation.rating || this.data.rating),
        starItems: stars(evaluation.rating || this.data.rating),
        selectedTags: evaluation.tags || this.data.selectedTags,
        goodTags: tagItems(GOOD_TAGS, evaluation.tags || this.data.selectedTags),
        improveTags: tagItems(IMPROVE_TAGS, evaluation.tags || this.data.selectedTags),
        comment: evaluation.comment || this.data.comment,
        commentCount: (evaluation.comment || this.data.comment || '').length
      });
      wx.showToast({ title: '评价已提交', icon: 'success' });
      setTimeout(() => {
        wx.navigateBack({ delta: 1 });
      }, 700);
    } catch (error) {
      wx.showToast({ title: error.message || '提交失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  }
});
