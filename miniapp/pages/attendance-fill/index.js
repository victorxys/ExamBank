const api = require('../../utils/api');
const {
  TYPE_MAP,
  TYPE_OPTIONS,
  normalizeAttendanceData,
  buildCalendar,
  buildSpecialRecords,
  calculateStats,
  autoConvertOvertimeIfNeeded,
  normalizeAutoOvertime,
  removeAutoOvertime,
  getHolidayLabel,
  getOnboardingReference,
  defaultRecordForType,
  recordToSave,
  upsertRecord,
  formatDate,
  formatMonthDay,
  addDays,
  diffDays,
  isHistoricalView,
  isFirstMonth,
  isLastMonth,
  getContractEndDate,
  normalizeContractInfoForAttendance,
  findOriginalRecord,
  findCoveringRecord,
  formatChineseDate,
  calculateTotalDuration,
  formatDuration,
  minutesToTime,
  timeToMinutes
} = require('../../utils/attendance');
const { formatDate: formatFullDate } = require('../../utils/format');

function buildTimeColumns() {
  const hours = [];
  const minutes = [];
  for (let i = 0; i <= 24; i += 1) hours.push(`${String(i).padStart(2, '0')}`);
  for (let i = 0; i < 60; i += 10) minutes.push(`${String(i).padStart(2, '0')}`);
  return { hours, minutes };
}

function monthTitle(form) {
  if (!form) return '考勤填报';
  return `${form.actual_year || form.year || ''}年${form.actual_month || form.month || ''}月考勤填报`;
}

function isSameDate(left, right) {
  return formatDate(left) === formatDate(right);
}

function hasOutContinuation(form, type) {
  const continuation = form && form.previous_month_continuation;
  return Boolean(
    continuation
    && continuation.has_continuation
    && continuation.continuation_type === type
  );
}

function buildTypeOptions(selectedType, form, editingDate, modalReadOnly = false) {
  const contractInfo = (form && form.contract_info) || {};
  const options = TYPE_OPTIONS.filter((item) => {
    if (item.value === 'onboarding') {
      return isFirstMonth(form) && contractInfo.start_date && isSameDate(editingDate, contractInfo.start_date);
    }
    if (item.value === 'offboarding') {
      const endDate = getContractEndDate(contractInfo);
      return isLastMonth(form) && endDate && isSameDate(editingDate, endDate);
    }
    return true;
  });

  return options.map((item) => ({
    ...item,
    className: `type-btn ${item.value === selectedType ? 'active' : ''} ${modalReadOnly ? 'disabled' : ''}`
  }));
}

function buildMonthButtonClass(enabled) {
  return enabled ? 'month-btn' : 'month-btn disabled';
}

function buildStatus(form, readOnly, historicalView) {
  if (['customer_signed', 'synced'].includes(form.status)) return '客户已签署';
  if (historicalView) return '历史记录，仅供查看';
  if (form.status === 'employee_confirmed') return '已提交，等待客户签署（仍可修改）';
  return '可编辑，修改会自动保存';
}

function buildAttendanceSharePath(form) {
  const token = form.customer_signature_token || '';
  return token ? `/pages/attendance-sign/index?token=${encodeURIComponent(token)}` : '';
}

function buildAttendanceShareTitle(form) {
  const contractInfo = (form && form.contract_info) || {};
  const employeeName = contractInfo.employee_name || '服务人员';
  const month = form.actual_month || form.month || '';
  return `请确认${employeeName}${month ? `${month}月` : ''}考勤`;
}

function buildBottomActions(form, readOnly, historicalView) {
  const confirmed = form.status === 'employee_confirmed';
  const hasMiniappShare = Boolean(form.customer_signature_token);

  if (readOnly) {
    return {
      submitText: historicalView ? '历史记录' : '已完成',
      showSubmitButton: false,
      showShareButton: false,
      showSubmittedHint: false,
      submittedHintText: ''
    };
  }

  if (confirmed) {
    return {
      submitText: '',
      showSubmitButton: false,
      showShareButton: hasMiniappShare,
      showSubmittedHint: true,
      submittedHintText: hasMiniappShare
        ? '已生成小程序确认页，修改会自动同步给客户'
        : '已提交给客户确认，正在生成小程序确认页'
    };
  }

  return {
    submitText: '提交考勤',
    showSubmitButton: true,
    showShareButton: false,
    showSubmittedHint: false,
    submittedHintText: ''
  };
}

function shouldApplyAutoOvertime(form = {}) {
  return ['employee_confirmed', 'customer_signed', 'synced'].includes(form.status);
}

function boolDataset(value) {
  return value === true || value === 'true' || value === '1';
}

function pickerDefaultTime(record, field) {
  const type = record.type || 'normal';
  const isOut = type === 'out_of_beijing' || type === 'out_of_country';
  const current = record[field];

  if (field === 'startTime') {
    if (isOut) return current || '00:00';
    if (current && current !== '00:00') return current;
    return '09:00';
  }

  if (current && current !== '24:00') return current;
  return '18:00';
}

function defaultModalUi(record, form, editingDate, modalReadOnly = false) {
  const type = record.type || 'normal';
  const isOut = type === 'out_of_beijing' || type === 'out_of_country';
  const isOnOff = type === 'onboarding' || type === 'offboarding';
  const hasContinuation = isOut && hasOutContinuation(form, type);
  const daysOffset = Math.max(0, Number(record.daysOffset || 0));
  const startDate = isOut
    ? (
      hasContinuation
        ? formatDate(form.cycle_start_date)
        : Number(record.daysOffset) >= 0
          ? formatDate(addDays(editingDate, -Number(record.daysOffset || 0)))
          : ''
    )
    : formatDate(editingDate);
  const endDate = isOut
    ? formatDate(editingDate)
    : formatDate(addDays(editingDate, daysOffset));
  const latestOutStartDate = isOut ? formatDate(addDays(editingDate, -29)) : '';

  const startTimeText = record.startTime || (isOut || !isOnOff ? '请选择' : '请选择时间');
  const endTimeText = record.endTime || '请选择';
  const typeInfo = TYPE_MAP[type] || TYPE_MAP.normal;

  return {
    typeOptions: buildTypeOptions(type, form, editingDate, modalReadOnly),
    timePanelTitle: type === 'onboarding'
      ? '上户时间'
      : type === 'offboarding'
        ? '下户时间'
        : `${typeInfo.label}时长设置`,
    timeHintText: type === 'onboarding'
      ? '请确认上户到达客户家的时间'
      : type === 'offboarding'
        ? '请确认下户离开客户家的时间'
        : '',
    isNormalType: type === 'normal',
    isOnboardingOrOffboarding: isOnOff,
    isOnboardingType: type === 'onboarding',
    isOffboardingType: type === 'offboarding',
    isOutType: isOut,
    hasOutContinuation: hasContinuation,
    isOutNoContinuation: isOut && !hasContinuation,
    showTimePanel: type !== 'normal',
    showStartTimePicker: !isOnOff && !hasContinuation,
    showOutContinuationTime: isOut && hasContinuation,
    showRegularStartDate: !isOnOff && !isOut,
    showDurationBlock: !isOnOff,
    showEndDateAndTime: !isOnOff,
    durationFieldLabel: isOut ? '持续天数' : '持续时长',
    startTimeLabel: type === 'onboarding' ? '到达时间' : '开始时间',
    singleTimeLabel: type === 'onboarding' ? '到达时间' : '离开时间',
    startTimeText,
    endTimeText,
    startDateText: startDate ? formatChineseDate(startDate) : '请选择开始日期',
    endDateText: endDate ? formatChineseDate(endDate) : '',
    outRuleTitle: `${type === 'out_of_country' ? '出境' : '出京'}考勤规则`,
    outRuleText: hasContinuation
      ? `延续上月${type === 'out_of_country' ? '出境' : '出京'}记录，本月无需重新满足30天`
      : `连续${type === 'out_of_country' ? '出境' : '出京'}满30天才计入考勤，不满30天不计算额外费用`,
    outStartDatePicked: Number(record.daysOffset) >= 0 || hasContinuation,
    outStartDateValue: startDate || latestOutStartDate,
    outStartMaxDate: latestOutStartDate,
    outStartPickerDisabled: modalReadOnly || hasContinuation,
    dayCountText: isOut && hasContinuation
      ? `${diffDays(editingDate, form.cycle_start_date) + 1}`
      : Number(record.daysOffset) >= 0
        ? `${Number(record.daysOffset || 0) + 1}`
        : '--',
    dayCountDisabled: !isOut && Number(record.daysOffset || 0) <= 0,
    canDecreaseDays: isOut
      ? Number(record.daysOffset) > 29
      : Number(record.daysOffset || 0) > 0,
    disableDecreaseDays: isOut
      ? Number(record.daysOffset) <= 29
      : Number(record.daysOffset || 0) <= 0,
    decreaseButtonClass: (isOut ? Number(record.daysOffset) <= 29 : Number(record.daysOffset || 0) <= 0)
      ? 'step-btn disabled'
      : 'step-btn',
    closeButtonText: modalReadOnly ? '我知道了' : '关闭',
    showConfirmButton: !modalReadOnly,
    sheetActionsClass: modalReadOnly ? 'sheet-actions single' : 'sheet-actions',
    tempDurationText: type === 'normal' ? '正常出勤' : ''
  };
}

Page({
  data: {
    id: '',
    employeeToken: '',
    selectedYear: null,
    selectedMonth: null,
    form: { contract_info: {} },
    attendanceData: normalizeAttendanceData({}),
    monthDays: [],
    calendarCells: [],
    specialRecords: [],
    showSpecialRecords: false,
    typeOptions: buildTypeOptions('normal'),
    stats: {
      workDaysText: '0',
      leaveDaysText: '0',
      overtimeDaysText: '0',
      holidayOvertimeDaysText: '0'
    },
    showHolidayOvertimeStat: false,
    holidays: {},
    title: '考勤填报',
    pageTitleText: '考勤填报',
    customerNameText: '请确认考勤信息',
    monthText: '-',
    avatarText: '员工',
    dateRange: '',
    canGoPrev: true,
    canGoNext: false,
    prevMonthClass: buildMonthButtonClass(true),
    nextMonthClass: buildMonthButtonClass(false),
    readOnly: false,
    historicalView: false,
    showReadonlyBanner: false,
    showAutoBanner: false,
    showAutoSave: true,
    showShareButton: false,
    showSubmitButton: true,
    showSubmittedHint: false,
    submittedHintText: '',
    readonlyBannerTitle: '',
    readonlyBannerText: '',
    autoSaveStatus: 'saved',
    saveStateText: '已自动保存',
    saveStateClass: 'save-state ok',
    saving: false,
    submitting: false,
    modalOpen: false,
    editingDate: '',
    editingDateText: '',
    modalReadOnly: false,
    coveringRecordText: '',
    tempRecord: defaultRecordForType('normal', new Date()),
    tempDurationText: '0小时',
    timePanelTitle: '',
    timeHintText: '',
    startTimeLabel: '开始时间',
    singleTimeLabel: '时间',
    startTimeText: '请选择',
    endTimeText: '请选择',
    startDateText: '',
    endDateText: '',
    dayCountText: '1',
    canDecreaseDays: false,
    isNormalType: true,
    isOnboardingOrOffboarding: false,
    isOnboardingType: false,
    isOffboardingType: false,
    isOutType: false,
    hasOutContinuation: false,
    isOutNoContinuation: false,
    showTimePanel: false,
    showStartTimePicker: false,
    showOutContinuationTime: false,
    showRegularStartDate: false,
    showDurationBlock: false,
    showEndDateAndTime: false,
    durationFieldLabel: '持续时长',
    outRuleTitle: '',
    outRuleText: '',
    outStartDatePicked: false,
    outStartDateValue: '',
    outStartMaxDate: '',
    outStartPickerDisabled: false,
    onboardingReferenceText: '',
    showOnboardingReference: false,
    disableDecreaseDays: true,
    decreaseButtonClass: 'step-btn disabled',
    closeButtonText: '关闭',
    showConfirmButton: true,
    sheetActionsClass: 'sheet-actions',
    timeField: '',
    timePickerOpen: false,
    timeColumns: buildTimeColumns(),
    timeValue: [0, 0],
    selectedTypeIndex: 0,
    holidayYear: null,
    holidayBadgeText: '',
    holidayBadgeClass: '',
    showHolidayBadge: false,
    holidayHintText: '',
    showHolidayHint: false,
    customerSignatureToken: '',
    sharePath: '',
    shareTitle: '请确认月度考勤'
  },

  onLoad(options) {
    const id = options.id || '';
    this.autoSaveTimer = null;
    this.setData({ id, employeeToken: options.employee_token || '' });
    this.loadForm();
  },

  onUnload() {
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
  },

  async loadForm(year = this.data.selectedYear, month = this.data.selectedMonth) {
    const token = this.data.employeeToken || this.data.id;
    if (!token) {
      wx.showToast({ title: '缺少考勤表ID', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '加载中' });
    try {
      const result = year && month
        ? await api.employeeAttendanceByToken(token, { year, month, contractId: this.data.form.contract_id })
        : await api.employeeAttendanceByToken(token);
      const form = result.attendance_form || {};
      const formYear = form.actual_year || form.year;
      if (formYear && formYear !== this.data.holidayYear) {
        this.setData({ holidays: {}, holidayYear: formYear });
      }
      this.applyForm(form);
      this.loadHolidays(formYear);
    } catch (error) {
      wx.showToast({ title: error.message || '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async loadHolidays(year) {
    if (!year) return;
    try {
      const result = await api.holidays(year);
      const holidays = result.holidays || {};
      const form = this.data.form || {};
      const monthDays = buildCalendar(form, this.data.attendanceData, holidays).monthDays;
      const attendanceData = shouldApplyAutoOvertime(form)
        ? normalizeAutoOvertime(this.data.attendanceData, form, monthDays, holidays)
        : removeAutoOvertime(this.data.attendanceData);
      const calendar = buildCalendar(form, attendanceData, holidays);
      const stats = calculateStats(attendanceData, calendar.monthDays, form, holidays);
      const modalPatch = this.data.modalOpen
        ? this.buildModalState(this.data.tempRecord, this.data.editingDate, this.data.modalReadOnly, null, holidays)
        : {};
      this.setData({
        holidays,
        holidayYear: year,
        attendanceData,
        monthDays: calendar.monthDays.map(formatDate),
        calendarCells: calendar.cells,
        stats,
        showHolidayOvertimeStat: Number(stats.holidayOvertimeDays || 0) > 0,
        showAutoBanner: Number(stats.autoOvertimeDays || 0) > 0,
        ...modalPatch
      });
    } catch (error) {
      this.setData({ holidays: {} });
    }
  },

  applyForm(form) {
    const holidays = this.data.holidays || {};
    const normalizedForm = {
      ...form,
      contract_info: form.contract_info || {}
    };
    const initialData = normalizeAttendanceData(form.form_data || {});
    normalizedForm.contract_info = normalizeContractInfoForAttendance(normalizedForm, initialData);
    const initialCalendar = buildCalendar(normalizedForm, initialData, holidays);
    const attendanceData = shouldApplyAutoOvertime(normalizedForm)
      ? normalizeAutoOvertime(initialData, normalizedForm, initialCalendar.monthDays, holidays)
      : removeAutoOvertime(initialData);
    const calendar = buildCalendar(normalizedForm, attendanceData, holidays);
    const stats = calculateStats(attendanceData, calendar.monthDays, normalizedForm, holidays);
    const selectedYear = form.actual_year || form.year;
    const selectedMonth = form.actual_month || form.month;
    const current = new Date();
    const currentYear = current.getFullYear();
    const currentMonth = current.getMonth() + 1;
    const historicalView = isHistoricalView(normalizedForm, selectedYear, selectedMonth, current);
    const completed = ['customer_signed', 'synced'].includes(form.status);
    const readOnly = completed || historicalView;
    const canGoNext = selectedYear < currentYear || (selectedYear === currentYear && selectedMonth < currentMonth);
    const statusText = buildStatus(normalizedForm, completed, historicalView);
    const monthText = String(selectedMonth || form.month || '-');
    const bottomActions = buildBottomActions(normalizedForm, readOnly, historicalView);

    this.setData({
      form: normalizedForm,
      id: form.id || this.data.id,
      employeeToken: form.employee_access_token || this.data.employeeToken || form.employee_id || this.data.id,
      selectedYear,
      selectedMonth,
      attendanceData,
      monthDays: calendar.monthDays.map(formatDate),
      calendarCells: calendar.cells,
      specialRecords: buildSpecialRecords(attendanceData, form),
      showSpecialRecords: buildSpecialRecords(attendanceData, form).length > 0,
      stats,
      showHolidayOvertimeStat: Number(stats.holidayOvertimeDays || 0) > 0,
      title: monthTitle(form),
      pageTitleText: `${monthText}月考勤${historicalView ? '记录' : '填报'}`,
      customerNameText: normalizedForm.contract_info.customer_name || '请确认考勤信息',
      monthText,
      submitText: bottomActions.submitText,
      statusText,
      avatarText: (form.contract_info && form.contract_info.employee_name)
        ? String(form.contract_info.employee_name).slice(-2)
        : '员工',
      dateRange: `${formatFullDate(form.cycle_start_date)} - ${formatFullDate(form.cycle_end_date)}`,
      canGoPrev: selectedYear >= 2024,
      canGoNext,
      prevMonthClass: buildMonthButtonClass(selectedYear >= 2024),
      nextMonthClass: buildMonthButtonClass(canGoNext),
      readOnly,
      historicalView,
      showReadonlyBanner: readOnly,
      showAutoBanner: Number(stats.autoOvertimeDays || 0) > 0,
      showAutoSave: !readOnly,
      showShareButton: bottomActions.showShareButton,
      showSubmitButton: bottomActions.showSubmitButton,
      showSubmittedHint: bottomActions.showSubmittedHint,
      submittedHintText: bottomActions.submittedHintText,
      readonlyBannerTitle: historicalView ? '历史考勤记录' : '客户已签署',
      readonlyBannerText: historicalView ? '仅供查看，不可修改' : '考勤已完成，不能继续修改',
      autoSaveStatus: 'saved',
      saveStateText: '已自动保存',
      saveStateClass: 'save-state ok',
      customerSignatureToken: form.customer_signature_token || '',
      sharePath: buildAttendanceSharePath(normalizedForm),
      shareTitle: buildAttendanceShareTitle(normalizedForm)
    });
  },

  refreshDerived(attendanceData, autoSave = true) {
    const form = this.data.form;
    const holidays = this.data.holidays || {};
    const initialCalendar = buildCalendar(form, attendanceData, holidays);
    const normalized = shouldApplyAutoOvertime(form)
      ? normalizeAutoOvertime(attendanceData, form, initialCalendar.monthDays, holidays)
      : removeAutoOvertime(attendanceData);
    const calendar = buildCalendar(form, normalized, holidays);
    const stats = calculateStats(normalized, calendar.monthDays, form, holidays);
    const specialRecords = buildSpecialRecords(normalized, form);
    this.setData({
      attendanceData: normalized,
      monthDays: calendar.monthDays.map(formatDate),
      calendarCells: calendar.cells,
      specialRecords,
      showSpecialRecords: specialRecords.length > 0,
      stats,
      showHolidayOvertimeStat: Number(stats.holidayOvertimeDays || 0) > 0,
      showAutoBanner: Number(stats.autoOvertimeDays || 0) > 0
    });
    if (autoSave && !this.data.readOnly) this.scheduleAutoSave();
  },

  scheduleAutoSave() {
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.setData({
      autoSaveStatus: 'saving',
      saveStateText: '保存中...',
      saveStateClass: 'save-state saving'
    });
    this.autoSaveTimer = setTimeout(() => this.saveDraft(true), 600);
  },

  async saveDraft(isAuto = false) {
    if (this.data.readOnly) return;
    if (!isAuto) this.setData({ saving: true });
    try {
      const result = await api.updateEmployeeAttendance(this.data.id, {
        form_data: this.data.attendanceData
      });
      const form = result.attendance_form || {};
      const mergedForm = {
        ...this.data.form,
        ...form,
        contract_info: form.contract_info || this.data.form.contract_info,
        customer_signature_token: form.customer_signature_token || this.data.customerSignatureToken
      };
      const bottomActions = buildBottomActions(mergedForm, this.data.readOnly, this.data.historicalView);
      this.setData({
        autoSaveStatus: 'saved',
        saveStateText: '已自动保存',
        saveStateClass: 'save-state ok',
        form: mergedForm,
        submitText: bottomActions.submitText,
        showShareButton: bottomActions.showShareButton,
        showSubmitButton: bottomActions.showSubmitButton,
        showSubmittedHint: bottomActions.showSubmittedHint,
        submittedHintText: bottomActions.submittedHintText,
        customerSignatureToken: mergedForm.customer_signature_token || '',
        sharePath: buildAttendanceSharePath(mergedForm),
        shareTitle: buildAttendanceShareTitle(mergedForm)
      });
      if (!isAuto) wx.showToast({ title: '已保存', icon: 'success' });
    } catch (error) {
      this.setData({
        autoSaveStatus: 'error',
        saveStateText: '保存失败，请手动保存',
        saveStateClass: 'save-state error'
      });
      if (!isAuto) wx.showToast({ title: error.message || '保存失败', icon: 'none' });
    } finally {
      if (!isAuto) this.setData({ saving: false });
    }
  },

  goPrevMonth() {
    if (!this.data.canGoPrev || !this.data.selectedYear || !this.data.selectedMonth) return;
    const date = new Date(this.data.selectedYear, this.data.selectedMonth - 2, 1);
    this.loadForm(date.getFullYear(), date.getMonth() + 1);
  },

  goNextMonth() {
    if (!this.data.canGoNext || !this.data.selectedYear || !this.data.selectedMonth) return;
    const date = new Date(this.data.selectedYear, this.data.selectedMonth, 1);
    this.loadForm(date.getFullYear(), date.getMonth() + 1);
  },

  buildModalState(record, editingDate, modalReadOnly = false, coveringRecord = null, holidays = this.data.holidays || {}) {
    const ui = defaultModalUi(record, this.data.form, editingDate, modalReadOnly);
    const holidayLabel = getHolidayLabel(editingDate, holidays);
    const onboardingReference = record.type === 'offboarding'
      ? getOnboardingReference(this.data.form, this.data.attendanceData)
      : null;
    const onboardingReferenceText = onboardingReference ? onboardingReference.text : '';

    return {
      ...ui,
      modalOpen: true,
      modalReadOnly,
      editingDate,
      editingDateText: `${formatMonthDay(editingDate)} ${formatChineseDate(editingDate).split(' ').pop() || ''}`,
      tempRecord: record,
      selectedTypeIndex: Math.max(0, TYPE_OPTIONS.findIndex((item) => item.value === record.type)),
      tempDurationText: this.durationText(record, editingDate),
      holidayBadgeText: holidayLabel ? holidayLabel.fullText || holidayLabel.text : '',
      holidayBadgeClass: holidayLabel ? `holiday-title-badge ${holidayLabel.type}` : '',
      showHolidayBadge: Boolean(holidayLabel),
      holidayHintText: holidayLabel && holidayLabel.type === 'holiday'
        ? '法定节假日填写加班时，将按法定节假日加班单独统计，不占用26天封顶名额。'
        : holidayLabel && holidayLabel.type === 'workday'
          ? '该日期为补班日，按普通工作日处理。'
          : '',
      showHolidayHint: Boolean(holidayLabel),
      onboardingReferenceText,
      showOnboardingReference: Boolean(onboardingReferenceText),
      coveringRecordText: coveringRecord
        ? `属于 ${coveringRecord.startText} 开始的「${coveringRecord.typeLabel}」记录，如需修改，请前往开始日期。`
        : ''
    };
  },

  applyTempRecord(record, extra = {}) {
    const editingDate = extra.editingDate || this.data.editingDate || record.date;
    this.setData({
      ...this.buildModalState(record, editingDate, this.data.modalReadOnly, null),
      ...extra
    });
  },

  openEdit(event) {
    const date = event.currentTarget.dataset.date;
    const isAuto = boolDataset(event.currentTarget.dataset.auto);
    const disabled = boolDataset(event.currentTarget.dataset.disabled);
    if (!date || this.data.readOnly) return;
    if (disabled) {
      wx.showToast({ title: '该日期不在合同服务期内', icon: 'none' });
      return;
    }
    if (isAuto) {
      wx.showModal({
        title: '自动补齐加班',
        content: '这是系统根据本月出勤超过26天的规则自动生成的加班记录。如需调整，请修改本月其他考勤后重新提交。',
        showCancel: false
      });
      return;
    }

    const editDate = event.currentTarget.dataset.editDate || date;
    const covering = findCoveringRecord(this.data.attendanceData, date);
    if (covering && formatDate(covering.date) !== formatDate(date)) {
      const isLastDay = formatDate(addDays(covering.date, covering.daysOffset || 0)) === formatDate(date);
      const readonlyRecord = {
        type: covering.type,
        date,
        daysOffset: 0,
        startTime: '00:00',
        endTime: isLastDay ? (covering.endTime || '24:00') : '24:00'
      };
      this.setData(this.buildModalState(readonlyRecord, date, true, covering));
      return;
    }

    let original = findOriginalRecord(this.data.attendanceData, date) || findOriginalRecord(this.data.attendanceData, editDate);
    let editingDate = editDate;
    if (original && (original.type === 'out_of_beijing' || original.type === 'out_of_country') && original.daysOffset > 0) {
      editingDate = formatDate(addDays(original.date, original.daysOffset));
    }

    if (original && original.type === 'offboarding') {
      original = { ...original, startTime: original.endTime || original.startTime || '' };
    }

    const record = original ? { ...original } : defaultRecordForType('normal', editingDate);
    if (original && (original.type === 'out_of_beijing' || original.type === 'out_of_country')) {
      record.date = editingDate;
    }

    this.setData(this.buildModalState(record, editingDate, false, null));
  },

  closeModal() {
    this.setData({ modalOpen: false, timePickerOpen: false });
  },

  selectType(event) {
    if (this.data.modalReadOnly) return;
    const type = event.currentTarget.dataset.type;
    const record = {
      ...defaultRecordForType(type, this.data.editingDate),
      date: this.data.editingDate
    };
    this.setData(this.buildModalState(record, this.data.editingDate, false, null));
  },

  changeDays(event) {
    if (this.data.modalReadOnly) return;
    if (Number(event.currentTarget.dataset.delta || 0) < 0 && this.data.disableDecreaseDays) return;
    const delta = Number(event.currentTarget.dataset.delta || 0);
    const record = { ...this.data.tempRecord };
    const isOut = record.type === 'out_of_beijing' || record.type === 'out_of_country';
    const min = isOut ? 29 : 0;
    if (isOut && record.daysOffset < 0 && delta > 0) {
      record.daysOffset = 29;
    } else {
      record.daysOffset = Math.max(min, Number(record.daysOffset || 0) + delta);
    }
    this.setData(this.buildModalState(record, this.data.editingDate, false, null));
  },

  pickOutStartDate(event) {
    if (this.data.modalReadOnly) return;
    const days = Number(event.currentTarget.dataset.days || 29);
    const record = { ...this.data.tempRecord };
    record.daysOffset = Math.max(29, days);
    this.setData(this.buildModalState(record, this.data.editingDate, false, null));
  },

  chooseOutStartPreset(event) {
    this.pickOutStartDate(event);
  },

  onOutStartDateChange(event) {
    if (this.data.modalReadOnly) return;
    const startDate = event.detail.value;
    const daysOffset = diffDays(this.data.editingDate, startDate);
    if (daysOffset < 29) {
      wx.showToast({ title: '出京/出境需连续满30天', icon: 'none' });
      return;
    }
    const record = { ...this.data.tempRecord, daysOffset };
    this.setData(this.buildModalState(record, this.data.editingDate, false, null));
  },

  openTimePicker(event) {
    if (this.data.modalReadOnly) return;
    const field = event.currentTarget.dataset.field;
    const value = pickerDefaultTime(this.data.tempRecord, field);
    this.setData({
      timeField: field,
      timePickerOpen: true,
      timeValue: this.timeToPickerValue(value)
    });
  },

  timeToPickerValue(time) {
    const minutes = timeToMinutes(time || '00:00', 0);
    return [
      Math.min(24, Math.floor(minutes / 60)),
      Math.min(5, Math.floor((minutes % 60) / 10))
    ];
  },

  onTimePickerChange(event) {
    this.setData({ timeValue: event.detail.value });
  },

  confirmTime() {
    const [hourIndex, minuteIndex] = this.data.timeValue;
    const hour = Number(hourIndex || 0);
    const minute = hour === 24 ? 0 : Number(minuteIndex || 0) * 10;
    const value = minutesToTime(hour * 60 + minute);
    const record = { ...this.data.tempRecord, [this.data.timeField]: value };
    this.setData(this.buildModalState(record, this.data.editingDate, false, null));
    this.setData({ timePickerOpen: false });
  },

  cancelTime() {
    this.setData({ timePickerOpen: false });
  },

  durationText(record, editingDate = this.data.editingDate) {
    if (!record || record.type === 'normal') return '正常出勤';
    if (record.type === 'onboarding') return record.startTime ? `到达 ${record.startTime}` : '待填写到达时间';
    if (record.type === 'offboarding') return record.startTime ? `离开 ${record.startTime}` : '待填写离开时间';

    if ((record.type === 'out_of_beijing' || record.type === 'out_of_country') && hasOutContinuation(this.data.form, record.type)) {
      const offset = Math.max(0, diffDays(editingDate, this.data.form.cycle_start_date));
      const duration = calculateTotalDuration({
        ...record,
        date: this.data.form.cycle_start_date,
        daysOffset: offset,
        startTime: '00:00',
        endTime: record.endTime || '24:00'
      });
      return formatDuration(duration.totalHours);
    }

    if ((record.type === 'out_of_beijing' || record.type === 'out_of_country') && Number(record.daysOffset) < 0) {
      return '请选择开始日期';
    }

    const duration = calculateTotalDuration({
      ...record,
      startTime: record.startTime || '00:00',
      endTime: record.endTime || '24:00'
    });
    return formatDuration(duration.totalHours);
  },

  getTimePanelTitle(type) {
    if (type === 'onboarding') return '上户时间';
    if (type === 'offboarding') return '下户时间';
    return '时长设置';
  },

  getTimeHintText(type) {
    if (type === 'onboarding') return '请确认上户到达客户家的时间';
    if (type === 'offboarding') return '请确认下户离开客户家的时间';
    return '';
  },

  getStartTimeLabel(type) {
    if (type === 'onboarding') return '到达时间';
    return '开始时间';
  },

  saveRecord() {
    if (this.data.modalReadOnly) {
      this.closeModal();
      return;
    }
    const temp = this.data.tempRecord;
    if (!temp || !temp.date) return;
    const isOnOff = temp.type === 'onboarding' || temp.type === 'offboarding';
    const isOut = temp.type === 'out_of_beijing' || temp.type === 'out_of_country';
    const hasContinuation = isOut && hasOutContinuation(this.data.form, temp.type);

    if (isOut && !hasContinuation && Number(temp.daysOffset) < 29) {
      wx.showToast({ title: '请选择满足30天的开始日期', icon: 'none' });
      return;
    }

    if (temp.type !== 'normal' && !isOnOff) {
      if ((!hasContinuation && !temp.startTime) || !temp.endTime) {
        wx.showToast({ title: '请选择开始和结束时间', icon: 'none' });
        return;
      }
    }
    if (isOnOff && !temp.startTime) {
      wx.showToast({ title: temp.type === 'onboarding' ? '请选择上户到达时间' : '请选择下户离开时间', icon: 'none' });
      return;
    }
    const record = recordToSave(temp, {
      editingDate: this.data.editingDate,
      form: this.data.form,
      cycleStartDate: this.data.form.cycle_start_date,
      hasContinuation
    });
    const next = upsertRecord(this.data.attendanceData, record);
    this.setData({ modalOpen: false });
    this.refreshDerived(next, true);
  },

  async submitConfirm() {
    if (this.data.readOnly) return;
    const monthDays = (this.data.monthDays || []).map((item) => new Date(item));
    const processedResult = autoConvertOvertimeIfNeeded(this.data.attendanceData, this.data.form, monthDays, this.data.holidays || {});
    const processedData = processedResult.data;
    const processedStats = calculateStats(processedData, monthDays, this.data.form, this.data.holidays || {});
    const converted = Number(processedStats.autoOvertimeDays || 0) > 0;
    const overtimeDays = Number(processedStats.autoOvertimeDays || 0);
    const content = converted
      ? `本月普通出勤超过26天，系统将自动把超出的 ${overtimeDays.toFixed(2)} 天折算为加班。法定节假日加班会单独统计，不占用26天封顶名额。确认提交给客户签署？`
      : '确认提交考勤表给客户签署？客户签署前仍可修改。';

    wx.showModal({
      title: '提交考勤',
      content,
      confirmText: '提交',
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ submitting: true, attendanceData: processedData });
        try {
          const result = await api.updateEmployeeAttendance(this.data.id, {
            form_data: processedData,
            action: 'confirm'
          });
          const form = result.attendance_form || {};
          this.applyForm(form);
          wx.showToast({ title: '已生成小程序确认页', icon: 'success' });
        } catch (error) {
          const message = error.message || '提交失败';
          wx.showToast({ title: message, icon: 'none' });
          const contractInfo = this.data.form.contract_info || {};
          if (message.indexOf('上户') >= 0 && contractInfo.start_date) {
            setTimeout(() => this.openEdit({ currentTarget: { dataset: { date: contractInfo.start_date } } }), 500);
          } else if (message.indexOf('下户') >= 0) {
            const endDate = getContractEndDate(contractInfo);
            if (endDate) setTimeout(() => this.openEdit({ currentTarget: { dataset: { date: endDate } } }), 500);
          }
        } finally {
          this.setData({ submitting: false });
        }
      }
    });
  },

  onShareAppMessage() {
    return {
      title: this.data.shareTitle || '请确认月度考勤',
      path: this.data.sharePath || '/pages/home/index'
    };
  }
});
