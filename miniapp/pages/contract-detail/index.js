const api = require('../../utils/api');
const { contractView, formatDate } = require('../../utils/format');
const { markdownToNodes } = require('../../utils/markdown');

function attendanceStatusText(status) {
  const labels = {
    draft: '待填写',
    employee_confirmed: '待客户确认',
    customer_signed: '已签署',
    synced: '已归档'
  };
  return labels[status] || status || '考勤';
}

function attendanceBadge(form = {}) {
  if (form.status === 'employee_confirmed') {
    return { text: '未签署', className: 'danger' };
  }
  if (['customer_signed', 'synced'].includes(form.status)) {
    return { text: '已签署', className: 'signed' };
  }
  return { text: attendanceStatusText(form.status), className: 'pending' };
}

function attendanceStatText(stats = {}, key, fallback = '0') {
  return stats[key] || fallback;
}

function evaluationText(evaluation) {
  const tags = (evaluation.tags || []).join('、');
  return [tags, evaluation.comment].filter(Boolean).join(' · ') || '已提交评价';
}

function contractReadyForEvaluation(contract = {}) {
  return ['finished', 'completed', 'terminated', 'trial_succeeded'].includes(contract.status)
    && ['SIGNED', 'NOT_REQUIRED'].includes(contract.signing_status);
}

function contractAllowsEvaluationEntry(contract = {}) {
  return Boolean(contract.employee_id)
    && ['active', 'trial_active', 'finished', 'completed', 'terminated', 'trial_succeeded'].includes(contract.status)
    && ['SIGNED', 'NOT_REQUIRED'].includes(contract.signing_status);
}

function customerCanSign(contract = {}) {
  return ['UNSIGNED', 'EMPLOYEE_SIGNED'].includes(contract.signing_status) && Boolean(contract.customer_signing_token);
}

function employeeCanSign(contract = {}) {
  return ['UNSIGNED', 'CUSTOMER_SIGNED'].includes(contract.signing_status) && Boolean(contract.employee_signing_token);
}

function contractShareTitle(contract = {}) {
  const typeLabel = contract.type_label || '服务合同';
  if (contract.customer_signing_token) {
    return `请签署${typeLabel}`;
  }
  return `${typeLabel}详情`;
}

function contractSharePath(contract = {}) {
  if (contract.customer_signing_token) {
    return `/pages/contract-sign/index?token=${contract.customer_signing_token}`;
  }
  if (contract.id) {
    return `/pages/contract-detail/index?id=${contract.id}&role=customer`;
  }
  return '/pages/home/index';
}

Page({
  data: {
    id: '',
    token: '',
    role: 'customer',
    contract: {},
    attendanceForms: [],
    attendancePreviewForms: [],
    pendingAttendanceForms: [],
    evaluations: [],
    markdownNodes: [],
    canCustomerSign: false,
    canEmployeeSign: false,
    canEvaluate: false,
    canEvaluationEntry: false,
    evaluationEntryText: '填写评价',
    hasCustomerActions: false,
    hasEmployeeActions: false,
    canShareContract: false,
    loadedOnce: false,
    loadError: '',
    shareTitle: '服务合同',
    sharePath: ''
  },

  onLoad(options) {
    if (options.token) {
      wx.redirectTo({ url: `/pages/contract-sign/index?token=${options.token}` });
      return;
    }
    this.setData({
      id: options.id || '',
      token: options.token || '',
      role: options.role || 'customer',
      loadError: ''
    });
    this.loadContract();
  },

  onShow() {
    if (this.data.id && this.data.loadedOnce) {
      this.loadContract();
    }
  },

  async loadContract() {
    if (!this.data.id) {
      this.setData({ loadError: '缺少合同信息，请从运营分享的签署链接进入。' });
      wx.showToast({ title: '缺少合同ID', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '加载中' });
    try {
      const result = this.data.role === 'employee'
        ? await api.employeeContractDetail(this.data.id)
        : await api.contractDetail(this.data.id);
      const contract = contractView(result.contract || {});
      const markdown = contract.template_content || contract.service_content || '';
      const attachmentMarkdown = contract.attachment_content || '';
      const attendanceForms = (contract.attendance_forms || []).filter((item) => (
        ['employee_confirmed', 'customer_signed', 'synced'].includes(item.status)
      )).map((item) => {
        const badge = attendanceBadge(item);
        const stats = item.stats || {};
        return {
          ...item,
          status_text: attendanceStatusText(item.status),
          status_badge_text: badge.text,
          status_class: badge.className,
          date_range: `${formatDate(item.cycle_start_date)} - ${formatDate(item.cycle_end_date)}`,
          work_days_text: attendanceStatText(stats, 'work_days_text'),
          overtime_text: attendanceStatText(stats, 'overtime_text'),
          leave_days_text: attendanceStatText(stats, 'leave_days_text')
        };
      });
      const attendancePreviewForms = attendanceForms.slice(0, 3);
      const pendingAttendanceForms = attendanceForms.filter((item) => (
        item.status === 'employee_confirmed' && item.customer_signature_token
      ));
      const evaluations = (contract.evaluations || []).map((item) => ({
        ...item,
        rating_text: `${item.rating || '-'} 星`,
        summary_text: evaluationText(item),
        created_at_text: formatDate(item.created_at)
      }));
      const hasEvaluationRecord = evaluations.length > 0;
      const canCustomerSign = this.data.role === 'customer' && customerCanSign(contract);
      const canEmployeeSign = this.data.role === 'employee' && employeeCanSign(contract);
      const canEvaluate = this.data.role === 'customer' && contractReadyForEvaluation(contract) && !hasEvaluationRecord;
      const canEvaluationEntry = this.data.role === 'customer' && contractAllowsEvaluationEntry(contract);
      this.setData({
        contract: {
          ...contract,
          employee_level_text: contract.employee_level ? `${contract.employee_level} 元/月` : '-',
          management_fee_text: contract.management_fee_amount ? `${contract.management_fee_amount} 元/月` : '-'
        },
        attendanceForms,
        attendancePreviewForms,
        pendingAttendanceForms,
        evaluations,
        canCustomerSign,
        canEmployeeSign,
        canEvaluate,
        canEvaluationEntry,
        evaluationEntryText: evaluations.length > 0 ? '继续填写评价' : '填写评价',
        hasCustomerActions: canCustomerSign || canEvaluate || pendingAttendanceForms.length > 0,
        hasEmployeeActions: canEmployeeSign,
        canShareContract: Boolean(contract.customer_signing_token || contract.id),
        loadedOnce: true,
        loadError: '',
        shareTitle: contractShareTitle(contract),
        sharePath: contractSharePath(contract),
        markdownNodes: markdownToNodes(markdown),
        attachmentNodes: markdownToNodes(attachmentMarkdown)
      });
    } catch (error) {
      const message = error.message || '加载失败';
      this.setData({
        loadedOnce: true,
        loadError: message === '合同不存在或无权访问'
          ? '当前微信暂未获得该合同访问权限。请从运营分享的合同签署链接进入，完成签署后即可查看合同。'
          : message
      });
      wx.showToast({ title: error.message || '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  goEvaluation() {
    if (!this.data.id) return;
    wx.navigateTo({ url: `/pages/evaluation/index?contractId=${this.data.id}` });
  },

  goContractSign() {
    const token = this.data.role === 'employee'
      ? this.data.contract.employee_signing_token
      : this.data.contract.customer_signing_token;
    if (token) wx.navigateTo({ url: `/pages/contract-sign/index?token=${token}` });
  },

  goAttendanceSign(event) {
    const token = event.currentTarget.dataset.token;
    if (token) wx.navigateTo({ url: `/pages/attendance-sign/index?token=${token}` });
  },

  goAllAttendance() {
    if (!this.data.id) return;
    wx.navigateTo({ url: `/pages/contract-attendance/index?id=${this.data.id}&role=${this.data.role}` });
  },

  goExitSummary() {
    if (!this.data.id) return;
    wx.navigateTo({ url: `/pages/exit-summary/index?contractId=${this.data.id}` });
  },

  onShareAppMessage() {
    return {
      title: this.data.shareTitle || '服务合同',
      path: this.data.sharePath || `/pages/contract-detail/index?id=${this.data.id}&role=customer`
    };
  }
});
