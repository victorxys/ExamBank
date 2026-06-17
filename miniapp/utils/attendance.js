const TYPE_MAP = {
  normal: { label: '出勤', key: 'normal', tone: 'normal' },
  rest: { label: '休息', key: 'rest_records', tone: 'rest' },
  leave: { label: '请假', key: 'leave_records', tone: 'leave' },
  overtime: { label: '加班', key: 'overtime_records', tone: 'overtime' },
  out_of_beijing: { label: '出京', key: 'out_of_beijing_records', tone: 'out-beijing' },
  out_of_country: { label: '出境', key: 'out_of_country_records', tone: 'out-country' },
  paid_leave: { label: '带薪休假', key: 'paid_leave_records', tone: 'paid-leave' },
  onboarding: { label: '上户', key: 'onboarding_records', tone: 'onboarding' },
  offboarding: { label: '下户', key: 'offboarding_records', tone: 'offboarding' }
};

const TYPE_OPTIONS = [
  TYPE_MAP.normal,
  TYPE_MAP.rest,
  TYPE_MAP.leave,
  TYPE_MAP.overtime,
  TYPE_MAP.out_of_beijing,
  TYPE_MAP.out_of_country,
  TYPE_MAP.paid_leave,
  TYPE_MAP.onboarding,
  TYPE_MAP.offboarding
].map((item) => ({ ...item, value: item.key === 'normal' ? 'normal' : item.key.replace('_records', '') }));

const RECORD_KEYS = [
  'rest_records',
  'leave_records',
  'overtime_records',
  'out_of_beijing_records',
  'out_of_country_records',
  'paid_leave_records',
  'onboarding_records',
  'offboarding_records'
];

const FALLBACK_HOLIDAYS = {
  2025: {
    '01-01': { holiday: true, name: '元旦', wage: 3 },
    '01-28': { holiday: true, name: '春节', wage: 3 },
    '01-29': { holiday: true, name: '春节', wage: 3 },
    '01-30': { holiday: true, name: '春节', wage: 3 },
    '01-31': { holiday: true, name: '春节', wage: 3 },
    '04-04': { holiday: true, name: '清明节', wage: 3 },
    '05-01': { holiday: true, name: '劳动节', wage: 3 },
    '05-02': { holiday: true, name: '劳动节', wage: 3 },
    '05-31': { holiday: true, name: '端午节', wage: 3 },
    '10-01': { holiday: true, name: '国庆节', wage: 3 },
    '10-02': { holiday: true, name: '国庆节', wage: 3 },
    '10-03': { holiday: true, name: '国庆节', wage: 3 },
    '10-06': { holiday: true, name: '中秋节', wage: 3 },
    '01-26': { holiday: false, name: '春节调休', wage: 1 },
    '02-08': { holiday: false, name: '春节调休', wage: 1 },
    '04-27': { holiday: false, name: '劳动节调休', wage: 1 },
    '09-28': { holiday: false, name: '国庆节、中秋节调休', wage: 1 },
    '10-11': { holiday: false, name: '国庆节、中秋节调休', wage: 1 }
  },
  2026: {
    '01-01': { holiday: true, name: '元旦', wage: 3 },
    '02-16': { holiday: true, name: '春节', wage: 3 },
    '02-17': { holiday: true, name: '春节', wage: 3 },
    '02-18': { holiday: true, name: '春节', wage: 3 },
    '02-19': { holiday: true, name: '春节', wage: 3 },
    '04-05': { holiday: true, name: '清明节', wage: 3 },
    '05-01': { holiday: true, name: '劳动节', wage: 3 },
    '05-02': { holiday: true, name: '劳动节', wage: 3 },
    '06-19': { holiday: true, name: '端午节', wage: 3 },
    '09-25': { holiday: true, name: '中秋节', wage: 3 },
    '10-01': { holiday: true, name: '国庆节', wage: 3 },
    '10-02': { holiday: true, name: '国庆节', wage: 3 },
    '10-03': { holiday: true, name: '国庆节', wage: 3 },
    '01-04': { holiday: false, name: '元旦调休', wage: 1 },
    '02-14': { holiday: false, name: '春节调休', wage: 1 },
    '02-28': { holiday: false, name: '春节调休', wage: 1 },
    '05-09': { holiday: false, name: '劳动节调休', wage: 1 },
    '09-20': { holiday: false, name: '国庆节调休', wage: 1 },
    '10-10': { holiday: false, name: '国庆节调休', wage: 1 }
  }
};

function getFallbackHolidays(year) {
  return FALLBACK_HOLIDAYS[Number(year)] || {};
}

function mergeHolidays(holidays = {}, year) {
  return {
    ...getFallbackHolidays(year),
    ...(holidays || {})
  };
}

function emptyAttendanceData() {
  return RECORD_KEYS.reduce((acc, key) => {
    acc[key] = [];
    return acc;
  }, {});
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const text = String(value).slice(0, 10);
  const parts = text.split('-').map(Number);
  if (parts.length !== 3 || parts.some((item) => Number.isNaN(item))) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function formatDate(date) {
  const parsed = parseDate(date);
  if (!parsed) return '';
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
}

function formatMonthDay(date) {
  const parsed = parseDate(date);
  if (!parsed) return '';
  return `${parsed.getMonth() + 1}月${parsed.getDate()}日`;
}

function formatWeekday(date) {
  const parsed = parseDate(date);
  if (!parsed) return '';
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return weekdays[parsed.getDay()];
}

function formatChineseDate(date) {
  const parsed = parseDate(date);
  if (!parsed) return '';
  return `${parsed.getFullYear()}年${parsed.getMonth() + 1}月${parsed.getDate()}日 ${formatWeekday(parsed)}`;
}

function addDays(date, days) {
  const parsed = parseDate(date);
  if (!parsed) return null;
  parsed.setDate(parsed.getDate() + days);
  return parsed;
}

function diffDays(end, start) {
  const endDate = parseDate(end);
  const startDate = parseDate(start);
  if (!endDate || !startDate) return 0;
  return Math.round((endDate.getTime() - startDate.getTime()) / 86400000);
}

function sameDay(a, b) {
  return formatDate(a) === formatDate(b);
}

function sameMonth(date, year, month) {
  const parsed = parseDate(date);
  return Boolean(parsed && parsed.getFullYear() === Number(year) && parsed.getMonth() + 1 === Number(month));
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function buildMonthDays(cycleStart, cycleEnd) {
  const start = parseDate(cycleStart);
  const days = [];
  if (!start) return days;
  let current = new Date(start.getFullYear(), start.getMonth(), 1);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  while (current <= end) {
    days.push(new Date(current));
    current = addDays(current, 1);
  }
  return days;
}

function timeToMinutes(time, fallback = 0) {
  if (!time) return fallback;
  const [rawHour, rawMinute] = String(time).split(':').map(Number);
  if (!Number.isFinite(rawHour) || !Number.isFinite(rawMinute)) return fallback;
  return rawHour * 60 + rawMinute;
}

function minutesToTime(minutes) {
  const clamped = Math.max(0, Math.min(24 * 60, Number(minutes) || 0));
  if (clamped >= 24 * 60) return '24:00';
  return `${pad(Math.floor(clamped / 60))}:${pad(clamped % 60)}`;
}

function calculateTotalDuration(record = {}) {
  const daysOffset = Number(record.daysOffset || 0) || 0;
  const startMinutes = timeToMinutes(record.startTime || '09:00', 9 * 60);
  const endMinutes = timeToMinutes(record.endTime || '18:00', 18 * 60);
  let totalMinutes;

  if (daysOffset === 0) {
    totalMinutes = endMinutes - startMinutes;
    if (totalMinutes <= 0) totalMinutes += 24 * 60;
  } else {
    totalMinutes = daysOffset * 24 * 60 + endMinutes - startMinutes;
  }

  const totalHours = totalMinutes / 60;
  return {
    totalHours,
    hours: Math.floor(totalHours),
    minutes: Math.round((totalHours - Math.floor(totalHours)) * 60),
    days: daysOffset
  };
}

function formatDuration(hours, minutes = 0) {
  const totalHours = hours % 1 !== 0 ? Number(hours || 0) : Number(hours || 0) + Number(minutes || 0) / 60;
  return `${(totalHours / 24).toFixed(2)}天`;
}

function isFullDayRecord(record = {}) {
  const startMinutes = timeToMinutes(record.startTime || '00:00', 0);
  const endMinutes = timeToMinutes(record.endTime || '24:00', 24 * 60);
  return startMinutes <= 0 && endMinutes >= 24 * 60;
}

function formatRecordDateRange(actualStart, actualEnd) {
  return diffDays(actualEnd, actualStart) > 0
    ? `${formatMonthDay(actualStart)} ~ ${formatMonthDay(actualEnd)}`
    : formatMonthDay(actualStart);
}

function formatRecordTimeLabel(record, actualStart, actualEnd) {
  if (record.type === 'onboarding') return `${formatMonthDay(actualStart)} ${record.startTime || '待填写'}`;
  if (record.type === 'offboarding') return `${formatMonthDay(actualStart)} ${record.endTime || '待填写'}`;
  if (record.is_auto || isFullDayRecord(record)) return formatRecordDateRange(actualStart, actualEnd);
  return diffDays(actualEnd, actualStart) > 0
    ? `${formatMonthDay(actualStart)} ${record.startTime || '00:00'} ~ ${formatMonthDay(actualEnd)} ${record.endTime || '24:00'}`
    : `${formatMonthDay(actualStart)} ${record.startTime || '00:00'}~${record.endTime || '24:00'}`;
}

function formatDays(value) {
  const total = Number(value || 0);
  return `${total.toFixed(2)}天`;
}

function formatDayTextForNote(value) {
  const total = Number(value || 0);
  if (Math.abs(total - 1) < 0.005) return '1天';
  return formatDays(total);
}

function normalizeAttendanceTimeText(time) {
  if (!time) return '';
  const minutes = timeToMinutes(time, NaN);
  if (!Number.isFinite(minutes)) return String(time);
  if (minutes >= 24 * 60) return '24:00';
  return minutesToTime(minutes);
}

function getOnboardingReferenceForAttendance(form, attendanceData) {
  const info = form?.onboarding_time_info || {};
  if (info.onboarding_time) {
    return {
      date: info.onboarding_date || '',
      time: info.onboarding_time,
      contractId: info.contract_id || '',
      signatureToken: info.customer_signature_token || ''
    };
  }

  const normalized = normalizeAttendanceData(attendanceData || form?.form_data || {});
  const onboardingRecord = (normalized.onboarding_records || []).find((record) => record.startTime);
  if (!onboardingRecord) return null;
  return {
    date: onboardingRecord.date || '',
    time: onboardingRecord.startTime,
    contractId: onboardingRecord.contract_id || '',
    signatureToken: onboardingRecord.customer_signature_token || ''
  };
}

function getOnboardingTimeForAttendance(form, attendanceData) {
  return getOnboardingReferenceForAttendance(form, attendanceData)?.time || '';
}

function getSpecialRecordDetailNote(record, form, attendanceData) {
  if (record?.type === 'onboarding') {
    const onboardingTime = normalizeAttendanceTimeText(record.startTime);
    if (!onboardingTime) return '';
    return `上户日 ${onboardingTime}~24:00 会在下户日当天计算考勤，本月不计算上户日当天考勤`;
  }

  if (record?.type === 'offboarding') {
    const ref = getOnboardingReferenceForAttendance(form, attendanceData);
    const onboardingTime = normalizeAttendanceTimeText(ref?.time);
    const offboardingTime = normalizeAttendanceTimeText(record.endTime);
    if (!onboardingTime || !offboardingTime) return '';

    const onboardingMinutes = timeToMinutes(ref.time, 0);
    const offboardingMinutes = timeToMinutes(record.endTime, 0);
    const refDateText = formatMonthDay(ref.date);
    const offboardingDateText = formatMonthDay(record.date);
    const baseText = `${refDateText ? `${refDateText} ` : '上户日 '}${onboardingTime}~${offboardingDateText ? `${offboardingDateText} ` : '下户日 '}${onboardingTime} 算作1天`;
    const deltaMinutes = offboardingMinutes - onboardingMinutes;

    if (deltaMinutes > 0) {
      return `${baseText}；下户日 ${onboardingTime}~${offboardingTime} 另计${formatDays(deltaMinutes / (24 * 60))}`;
    }
    if (deltaMinutes < 0) {
      const combinedDays = ((24 * 60 - onboardingMinutes) + offboardingMinutes) / (24 * 60);
      return `${baseText}；下户早于上户时间，合并计${formatDayTextForNote(combinedDays)}`;
    }
    return baseText;
  }

  return '';
}

function getOnboardingAttendanceLink(record, form, attendanceData) {
  if (record?.type !== 'offboarding') return null;
  const ref = getOnboardingReferenceForAttendance(form, attendanceData);
  const date = parseDate(ref?.date);
  if (!date) return null;
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    date: formatDate(date),
    contractId: ref.contractId || '',
    signatureToken: ref.signatureToken || '',
    text: '查看上户考勤'
  };
}

function calculateOnboardingDaysToExclude(attendanceData, form) {
  const normalized = normalizeAttendanceData(attendanceData);
  const cycleStart = parseDate(form?.cycle_start_date);
  const cycleEnd = parseDate(form?.cycle_end_date);
  if (!cycleStart || !cycleEnd) return 0;

  const dates = new Set();
  (normalized.onboarding_records || []).forEach((record) => {
    const onboardingDate = parseDate(record.date);
    if (onboardingDate && onboardingDate >= cycleStart && onboardingDate <= cycleEnd) {
      dates.add(formatDate(onboardingDate));
    }
  });

  const infoDate = parseDate(form?.onboarding_time_info?.onboarding_date);
  if (infoDate && infoDate >= cycleStart && infoDate <= cycleEnd) {
    dates.add(formatDate(infoDate));
  }

  return dates.size;
}

function calculateOffboardingAdjustment(attendanceData, form) {
  const normalized = normalizeAttendanceData(attendanceData);
  const offboardingRecord = (normalized.offboarding_records || []).find((record) => record.endTime);
  const onboardingTime = getOnboardingTimeForAttendance(form, normalized);
  const offboardingTime = offboardingRecord?.endTime;
  if (!onboardingTime || !offboardingTime) return 0;

  const onboardingMinutes = timeToMinutes(onboardingTime, NaN);
  const offboardingMinutes = timeToMinutes(offboardingTime, NaN);
  if (!Number.isFinite(onboardingMinutes) || !Number.isFinite(offboardingMinutes)) return 0;

  return ((24 * 60 - onboardingMinutes) + offboardingMinutes) / (24 * 60) - 1;
}

function getHolidayInfo(date, holidays = {}) {
  const parsed = parseDate(date);
  if (!parsed || !holidays) return null;
  const key = `${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
  return holidays[key] || getFallbackHolidays(parsed.getFullYear())[key] || null;
}

function getHolidayLabel(date, holidays = {}) {
  const info = getHolidayInfo(date, holidays);
  if (!info) return null;
  if (info.holiday === true && Number(info.wage) === 3) {
    return {
      text: '法定',
      fullText: '法定节假日',
      type: 'holiday',
      name: info.name || '',
      wage: info.wage
    };
  }
  if (info.holiday === false) {
    return {
      text: '班',
      fullText: '补班日',
      type: 'workday',
      name: info.name || '',
      wage: info.wage
    };
  }
  return null;
}

function isStatutoryHoliday(date, holidays = {}) {
  const label = getHolidayLabel(date, holidays);
  return Boolean(label && label.type === 'holiday' && Number(label.wage) === 3);
}

function isDateCoveredByRecord(targetDateStr, record) {
  const start = parseDate(record.date);
  const target = parseDate(targetDateStr);
  if (!start || !target) return false;
  const end = addDays(start, record.daysOffset || 0);
  return target >= start && target <= end;
}

function getTypeLabel(type) {
  return TYPE_MAP[type]?.label || '出勤';
}

function shouldShowAttendanceType(targetDateStr, record) {
  const start = parseDate(record.date);
  const target = parseDate(targetDateStr);
  if (!start || !target) return false;
  const daysOffset = record.daysOffset || 0;
  if (record.type === 'overtime' && record.is_auto) return true;
  if (daysOffset === 0) return true;

  const end = addDays(start, daysOffset);
  const isStartDay = sameDay(target, start);
  const isEndDay = sameDay(target, end);
  if (record.type === 'out_of_beijing' || record.type === 'out_of_country') return true;

  const startMinutes = timeToMinutes(record.startTime || '09:00', 9 * 60);
  if (isStartDay) return startMinutes < 12 * 60;
  if (isEndDay) {
    if (startMinutes >= 12 * 60) return true;
    const endMinutes = timeToMinutes(record.endTime || '18:00', 18 * 60);
    return endMinutes >= 24 * 60;
  }

  if (startMinutes >= 12 * 60) {
    const dayDiff = diffDays(target, start);
    return dayDiff >= 1 && dayDiff <= daysOffset;
  }
  return true;
}

function calculateDailyHours(record, targetDateStr) {
  const start = parseDate(record.date);
  const target = parseDate(targetDateStr);
  if (!start || !target) return 0;
  const daysOffset = record.daysOffset || 0;
  if (daysOffset === 0) return Number(record.hours || 0) + Number(record.minutes || 0) / 60;

  const end = addDays(start, daysOffset);
  if (sameDay(target, start)) return 24 - timeToMinutes(record.startTime || '09:00', 9 * 60) / 60;
  if (sameDay(target, end)) return timeToMinutes(record.endTime || '18:00', 18 * 60) / 60;
  return 24;
}

function calculateActualWorkHours(targetDateStr, records) {
  let nonWorkHours = 0;
  let overtimeHours = 0;
  records.forEach((record) => {
    if (!isDateCoveredByRecord(targetDateStr, record)) return;
    const hours = calculateDailyHours(record, targetDateStr);
    if (record.type === 'rest' || record.type === 'leave') nonWorkHours += hours;
    if (record.type === 'overtime') overtimeHours += hours;
  });
  return Math.max(0, 24 - nonWorkHours + overtimeHours);
}

function isFirstDisplayDay(targetDateStr, record) {
  const start = parseDate(record.date);
  if (!start) return false;
  const daysOffset = record.daysOffset || 0;
  for (let i = 0; i <= daysOffset; i += 1) {
    const current = addDays(start, i);
    const currentStr = formatDate(current);
    if (shouldShowAttendanceType(currentStr, record)) return currentStr === targetDateStr;
  }
  return false;
}

function flattenRecords(attendanceData = {}) {
  const records = [];
  RECORD_KEYS.forEach((key) => {
    const type = key.replace('_records', '');
    (attendanceData[key] || []).forEach((record) => {
      records.push({ ...record, type: record.type || type });
    });
  });
  return records;
}

function findOriginalRecord(attendanceData, date) {
  const dateStr = formatDate(date);
  let original = null;
  const normalized = normalizeAttendanceData(attendanceData);
  RECORD_KEYS.forEach((key) => {
    (normalized[key] || []).forEach((record) => {
      if (formatDate(record.date) === dateStr) {
        original = { ...record, type: record.type || key.replace('_records', '') };
      }
    });
  });
  return original;
}

function findCoveringRecord(attendanceData, date) {
  const dateStr = formatDate(date);
  const records = flattenRecords(attendanceData);
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    const start = parseDate(record.date);
    const target = parseDate(dateStr);
    const end = addDays(start, record.daysOffset || 0);
    if (!start || !target || !end) continue;
    if (dateStr !== formatDate(start) && target > start && target <= end) {
      return {
        ...record,
        typeLabel: getTypeLabel(record.type),
        startText: formatMonthDay(start),
        endText: formatMonthDay(end)
      };
    }
  }
  return null;
}

function getDayDisplay(targetDateStr, attendanceData) {
  const records = flattenRecords(attendanceData);
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (isDateCoveredByRecord(targetDateStr, record) && shouldShowAttendanceType(targetDateStr, record)) {
      const duration = isFirstDisplayDay(targetDateStr, record) ? calculateTotalDuration(record) : { totalHours: 0, hours: 0, minutes: 0 };
      return {
        ...record,
        type: record.type,
        typeLabel: TYPE_MAP[record.type]?.label || '出勤',
        tone: TYPE_MAP[record.type]?.tone || 'normal',
        hours: duration.hours,
        minutes: duration.minutes,
        isFirstDisplayDay: isFirstDisplayDay(targetDateStr, record)
      };
    }
  }

  const actualWorkHours = calculateActualWorkHours(targetDateStr, records);
  return {
    type: 'normal',
    typeLabel: '出勤',
    tone: 'normal',
    hours: Math.floor(actualWorkHours),
    minutes: Math.round((actualWorkHours - Math.floor(actualWorkHours)) * 60),
    hasPartialNonWork: actualWorkHours !== 24
  };
}

function normalizeAttendanceData(formData = {}) {
  return {
    ...emptyAttendanceData(),
    ...(formData || {})
  };
}

function latestRecordDate(records = []) {
  let latest = null;
  (records || []).forEach((record) => {
    const date = parseDate(record.date);
    if (date && (!latest || date > latest)) latest = date;
  });
  return latest ? formatDate(latest) : '';
}

function resolveContractEndDate(contractInfo = {}, attendanceData = null) {
  if (contractInfo.attendance_end_date) return contractInfo.attendance_end_date;
  const terminationDate = parseDate(contractInfo.termination_date);
  const offboardingDate = attendanceData
    ? parseDate(latestRecordDate(normalizeAttendanceData(attendanceData).offboarding_records))
    : null;

  if (contractInfo.status === 'terminated') {
    if (terminationDate) return contractInfo.termination_date;
    return offboardingDate ? formatDate(offboardingDate) : '';
  }
  if (offboardingDate) {
    return formatDate(offboardingDate);
  }
  if (contractInfo.is_monthly_auto_renew) {
    return '';
  }
  return contractInfo.end_date;
}

function normalizeContractInfoForAttendance(form = {}, attendanceData = null) {
  const contractInfo = form?.contract_info || {};
  const effectiveEnd = resolveContractEndDate(contractInfo, attendanceData || form?.form_data);
  if (!effectiveEnd || effectiveEnd === contractInfo.attendance_end_date) return contractInfo;
  return {
    ...contractInfo,
    attendance_end_date: effectiveEnd
  };
}

function getOnboardingReference(form = {}, attendanceData = null) {
  const normalized = normalizeAttendanceData(attendanceData || form?.form_data || {});
  const onboardingRecord = (normalized.onboarding_records || []).find((record) => record.startTime);
  if (onboardingRecord) {
    return {
      date: formatDate(onboardingRecord.date),
      time: onboardingRecord.startTime,
      text: `对应上户时间：${formatDate(onboardingRecord.date)} ${onboardingRecord.startTime}`,
      shortText: `上户 ${onboardingRecord.startTime}`
    };
  }

  const info = form?.onboarding_time_info || {};
  if (info.has_onboarding && info.onboarding_time) {
    return {
      date: info.onboarding_date || '',
      time: info.onboarding_time,
      text: `对应上户时间：${info.onboarding_date || ''} ${info.onboarding_time}`,
      shortText: `上户 ${info.onboarding_time}`
    };
  }

  return null;
}

function getRecordRange(record) {
  const start = parseDate(record.date);
  const end = addDays(start, record.daysOffset || 0);
  return { start, end };
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && aEnd >= bStart;
}

function upsertRecord(attendanceData, record) {
  const next = normalizeAttendanceData(attendanceData);
  const type = record.type;
  const recordKey = TYPE_MAP[type]?.key;
  const range = getRecordRange(record);

  RECORD_KEYS.forEach((key) => {
    next[key] = (next[key] || []).filter((item) => {
      const current = getRecordRange(item);
      return !rangesOverlap(range.start, range.end, current.start, current.end);
    });
  });

  if (type !== 'normal' && recordKey) {
    next[recordKey] = [...(next[recordKey] || []), record].sort((a, b) => formatDate(a.date).localeCompare(formatDate(b.date)));
  }

  return next;
}

function isDateDisabled(date, contractInfo) {
  if (!contractInfo) return false;
  const target = parseDate(date);
  if (!target) return false;
  const start = parseDate(contractInfo.start_date);
  if (start && target < start) return true;

  const endSource = resolveContractEndDate(contractInfo);
  if (contractInfo.is_monthly_auto_renew && contractInfo.status === 'active' && !endSource) return false;
  const end = parseDate(endSource);
  return Boolean(end && target > end);
}

function isFirstMonth(form) {
  const contractInfo = form?.contract_info || {};
  if (!contractInfo.start_date || !form?.cycle_start_date) return false;
  const start = parseDate(contractInfo.start_date);
  const cycleStart = parseDate(form.cycle_start_date);
  return Boolean(start && cycleStart && start > cycleStart);
}

function getContractEndDate(contractInfo = {}) {
  return resolveContractEndDate(contractInfo);
}

function isLastMonth(form) {
  const contractInfo = form?.contract_info || {};
  if (!form?.cycle_end_date) return false;
  const cycleEnd = parseDate(form.cycle_end_date);
  const end = parseDate(getContractEndDate(contractInfo));
  return Boolean(end && cycleEnd && end < cycleEnd);
}

function isHistoricalView(form, selectedYear, selectedMonth, now = new Date()) {
  if (!selectedYear || !selectedMonth) return false;

  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  if (selectedYear > currentYear || (selectedYear === currentYear && selectedMonth > currentMonth)) {
    return true;
  }

  let minYear = currentYear;
  let minMonth = currentMonth - 1;
  if (minMonth === 0) {
    minYear -= 1;
    minMonth = 12;
  }

  if (selectedYear > minYear || (selectedYear === minYear && selectedMonth >= minMonth)) {
    return false;
  }

  const contractInfo = form?.contract_info || {};
  if (sameMonth(contractInfo.start_date, selectedYear, selectedMonth)) return false;
  if (sameMonth(resolveContractEndDate(contractInfo), selectedYear, selectedMonth)) return false;
  if (
    contractInfo.is_monthly_auto_renew
    && contractInfo.status === 'terminated'
    && sameMonth(contractInfo.termination_date, selectedYear, selectedMonth)
  ) {
    return false;
  }

  return true;
}

function getValidDaysCount(monthDays, contractInfo) {
  return monthDays.filter((day) => !isDateDisabled(day, contractInfo)).length;
}

function calculateStats(attendanceData, monthDays, form, holidays = {}) {
  const normalized = normalizeAttendanceData(attendanceData);
  const holidayData = mergeHolidays(holidays, form?.actual_year || form?.year);
  const cycleStart = parseDate(form?.cycle_start_date);
  const cycleEnd = parseDate(form?.cycle_end_date);
  const contractInfo = normalizeContractInfoForAttendance(form, normalized);
  const validDays = getValidDaysCount(monthDays, contractInfo);
  let totalLeaveDays = 0;
  let totalManualOvertimeDays = 0;
  let autoOvertimeDays = 0;
  let manualNormalOvertimeDays = 0;
  let holidayOvertimeDays = 0;

  function hoursInCycle(record) {
    const start = parseDate(record.date);
    const end = addDays(start, record.daysOffset || 0);
    if (!start || !end || !cycleStart || !cycleEnd || start > cycleEnd || end < cycleStart) return 0;
    const actualStart = start < cycleStart ? cycleStart : start;
    const actualEnd = end > cycleEnd ? cycleEnd : end;
    const daysInCurrentMonth = diffDays(actualEnd, actualStart) + 1;
    const duration = calculateTotalDuration(record);
    const totalDaysSpan = (record.daysOffset || 0) + 1;
    if (formatDate(actualStart) === formatDate(start) && formatDate(actualEnd) === formatDate(end)) return duration.totalHours;
    return duration.totalHours * (daysInCurrentMonth / totalDaysSpan);
  }

  ['rest_records', 'leave_records'].forEach((key) => {
    (normalized[key] || []).forEach((record) => {
      totalLeaveDays += hoursInCycle(record) / 24;
    });
  });

  (normalized.overtime_records || []).forEach((record) => {
    const days = hoursInCycle(record) / 24;
    if (record.is_auto) {
      autoOvertimeDays += days;
      return;
    }

    totalManualOvertimeDays += days;
    const start = parseDate(record.date);
    const end = addDays(start, record.daysOffset || 0);
    if (!start || !end || !cycleStart || !cycleEnd || start > cycleEnd || end < cycleStart) return;
    const actualStart = start < cycleStart ? cycleStart : start;
    const actualEnd = end > cycleEnd ? cycleEnd : end;
    const daysInSpan = diffDays(actualEnd, actualStart) + 1;
    const dailyOvertime = daysInSpan > 0 ? days / daysInSpan : 0;

    let current = actualStart;
    while (current <= actualEnd) {
      let holidayLike = isStatutoryHoliday(current, holidayData);
      if (!holidayLike) {
        ['rest_records', 'leave_records'].forEach((key) => {
          (normalized[key] || []).forEach((otherRecord) => {
            if (isDateCoveredByRecord(formatDate(current), otherRecord)) holidayLike = true;
          });
        });
      }
      if (holidayLike) {
        holidayOvertimeDays += dailyOvertime;
      } else {
        manualNormalOvertimeDays += dailyOvertime;
      }
      current = addDays(current, 1);
    }
  });

  const onboardingDays = calculateOnboardingDaysToExclude(normalized, form);
  const offboardingAdjustment = calculateOffboardingAdjustment(normalized, form);

  const totalWorkBeforeCap = validDays - onboardingDays + offboardingAdjustment - totalLeaveDays;
  const recalculatedAuto = Math.max(0, totalWorkBeforeCap - 26 - manualNormalOvertimeDays);
  const totalWorkDays = Math.min(26, totalWorkBeforeCap);
  const totalOvertimeDays = totalManualOvertimeDays + (autoOvertimeDays > 0 ? recalculatedAuto : autoOvertimeDays);

  return {
    workDays: totalWorkDays,
    leaveDays: totalLeaveDays,
    overtimeDays: totalOvertimeDays,
    holidayOvertimeDays,
    normalOvertimeDays: Math.max(0, totalOvertimeDays - holidayOvertimeDays),
    autoOvertimeDays: autoOvertimeDays > 0 ? recalculatedAuto : 0,
    workDaysText: formatDays(totalWorkDays),
    leaveDaysText: formatDays(totalLeaveDays),
    overtimeDaysText: formatDays(totalOvertimeDays),
    holidayOvertimeDaysText: formatDays(holidayOvertimeDays),
    normalOvertimeDaysText: formatDays(Math.max(0, totalOvertimeDays - holidayOvertimeDays)),
    autoOvertimeDaysText: formatDays(autoOvertimeDays > 0 ? recalculatedAuto : 0)
  };
}

function buildCalendar(form, attendanceData, holidays = {}) {
  const holidayData = mergeHolidays(holidays, form?.actual_year || form?.year);
  const monthDays = buildMonthDays(form?.cycle_start_date, form?.cycle_end_date);
  const contractInfo = normalizeContractInfoForAttendance(form, attendanceData);
  const first = monthDays[0];
  const leadingBlanks = first ? (first.getDay() === 0 ? 6 : first.getDay() - 1) : 0;
  const cells = [];
  for (let i = 0; i < leadingBlanks; i += 1) cells.push({ blank: true, key: `blank-${i}` });

  monthDays.forEach((day) => {
    const dateStr = formatDate(day);
    const display = getDayDisplay(dateStr, attendanceData);
    const disabled = isDateDisabled(day, contractInfo);
    const weekday = day.getDay();
    const holidayLabel = getHolidayLabel(day, holidayData);
    const isHoliday = holidayLabel?.type === 'holiday';
    const isWorkday = holidayLabel?.type === 'workday';
    cells.push({
      key: dateStr,
      date: dateStr,
      day: day.getDate(),
      weekday,
      disabled,
      weekend: weekday === 0 || weekday === 6,
      holidayLabelText: holidayLabel ? holidayLabel.text : '',
      holidayLabelClass: holidayLabel ? `holiday-badge ${holidayLabel.type}` : '',
      isHoliday,
      isWorkday,
      today: dateStr === formatDate(new Date()),
      type: disabled ? 'disabled' : display.type,
      typeLabel: disabled ? '' : (display.is_auto ? '自动补齐' : display.typeLabel),
      tone: disabled ? 'disabled' : display.tone,
      className: [
        'day-cell',
        `tone-${disabled ? 'disabled' : display.tone}`,
        dateStr === formatDate(new Date()) ? 'today' : '',
        weekday === 0 || weekday === 6 ? 'weekend' : '',
        !disabled && isHoliday && display.type === 'normal' ? 'holiday' : '',
        !disabled && isWorkday ? 'workday' : '',
        display.type === 'overtime' && display.is_auto ? 'auto-overtime' : '',
        disabled ? 'disabled' : ''
      ].filter(Boolean).join(' '),
      hasPartialNonWork: display.hasPartialNonWork,
      displayTime: display.type === 'onboarding'
        ? (display.startTime || '待填写')
        : display.type === 'offboarding'
          ? (display.endTime || '待填写')
          : display.hasPartialNonWork
            ? `${display.hours}h`
            : '',
      isAuto: Boolean(display.is_auto)
    });
  });

  return { monthDays, cells };
}

function buildSpecialRecords(attendanceData, form) {
  const normalized = normalizeAttendanceData(attendanceData);
  const cycleStart = parseDate(form?.cycle_start_date);
  const cycleEnd = cycleStart ? new Date(cycleStart.getFullYear(), cycleStart.getMonth() + 1, 0) : null;
  return flattenRecords(normalized)
    .filter((record) => record.type !== 'normal')
    .filter((record) => {
      if (record.type === 'onboarding') return Boolean(record.startTime);
      if (record.type === 'offboarding') return Boolean(record.endTime);
      return true;
    })
    .map((record) => {
      const start = parseDate(record.date);
      const end = addDays(start, record.daysOffset || 0);
      if (!start || !end || !cycleStart || !cycleEnd || start > cycleEnd || end < cycleStart) return null;
      const actualStart = start < cycleStart ? cycleStart : start;
      const actualEnd = end > cycleEnd ? cycleEnd : end;
      const duration = calculateTotalDuration(record);
      const typeLabel = record.is_auto ? '自动补齐加班' : (TYPE_MAP[record.type]?.label || '考勤');
      const durationHours = record.type === 'onboarding'
        ? Math.max(0, 24 - timeToMinutes(record.startTime, 24 * 60) / 60)
        : record.type === 'offboarding'
          ? Math.max(0, (calculateOffboardingAdjustment(normalized, form) + 1) * 24)
          : duration.totalHours;
      const durationText = formatDuration(durationHours);
      return {
        ...record,
        typeLabel,
        timeLabel: formatRecordTimeLabel(record, actualStart, actualEnd),
        detailNote: getSpecialRecordDetailNote(record, form, normalized),
        onboardingAttendanceLink: getOnboardingAttendanceLink(record, form, normalized),
        showReturnAttendanceAction: record.type === 'onboarding',
        durationText,
        showDuration: !record.is_auto,
        showAutoReason: Boolean(record.is_auto),
        autoReasonText: record.is_auto ? `补齐${durationText}，因出勤超26天自动折算` : '',
        tone: TYPE_MAP[record.type]?.tone || 'normal',
        className: `detail-row tone-left-${TYPE_MAP[record.type]?.tone || 'normal'}`,
        dateText: formatMonthDay(record.date),
        editDate: (record.type === 'out_of_beijing' || record.type === 'out_of_country')
          ? formatDate(end)
          : formatDate(record.date)
      };
    })
    .filter(Boolean)
    .sort((a, b) => formatDate(a.date).localeCompare(formatDate(b.date)));
}

function autoConvertOvertimeIfNeeded(attendanceData, form, monthDays, holidays = {}) {
  const data = normalizeAttendanceData(attendanceData);
  data.overtime_records = (data.overtime_records || []).filter((record) => !record.is_auto);
  const holidayData = mergeHolidays(holidays, form?.actual_year || form?.year);
  const contractInfo = normalizeContractInfoForAttendance(form, data);
  const cycleStart = parseDate(form?.cycle_start_date);
  const cycleEnd = parseDate(form?.cycle_end_date);
  const validDays = getValidDaysCount(monthDays, contractInfo);
  let leaveDays = 0;
  let normalOvertimeDays = 0;

  function hoursInCycle(record) {
    const start = parseDate(record.date);
    const end = addDays(start, record.daysOffset || 0);
    if (!start || !end || !cycleStart || !cycleEnd || start > cycleEnd || end < cycleStart) return 0;
    const actualStart = start < cycleStart ? cycleStart : start;
    const actualEnd = end > cycleEnd ? cycleEnd : end;
    const daysInCurrentMonth = diffDays(actualEnd, actualStart) + 1;
    const duration = calculateTotalDuration(record);
    const totalDaysSpan = (record.daysOffset || 0) + 1;
    if (formatDate(actualStart) === formatDate(start) && formatDate(actualEnd) === formatDate(end)) return duration.totalHours;
    return duration.totalHours * (daysInCurrentMonth / totalDaysSpan);
  }

  ['rest_records', 'leave_records'].forEach((key) => {
    (data[key] || []).forEach((record) => {
      leaveDays += hoursInCycle(record) / 24;
    });
  });

  (data.overtime_records || []).forEach((record) => {
    const start = parseDate(record.date);
    const end = addDays(start, record.daysOffset || 0);
    if (!start || !end || !cycleStart || !cycleEnd || start > cycleEnd || end < cycleStart) return;
    const actualStart = start < cycleStart ? cycleStart : start;
    const actualEnd = end > cycleEnd ? cycleEnd : end;
    const days = hoursInCycle(record) / 24;
    const daysInSpan = diffDays(actualEnd, actualStart) + 1;
    const dailyOvertime = daysInSpan > 0 ? days / daysInSpan : 0;

    let current = actualStart;
    while (current <= actualEnd) {
      let holidayLike = isStatutoryHoliday(current, holidayData);
      if (!holidayLike) {
        ['rest_records', 'leave_records'].forEach((key) => {
          (data[key] || []).forEach((otherRecord) => {
            if (isDateCoveredByRecord(formatDate(current), otherRecord)) holidayLike = true;
          });
        });
      }
      if (!holidayLike) normalOvertimeDays += dailyOvertime;
      current = addDays(current, 1);
    }
  });

  const onboardingDays = calculateOnboardingDaysToExclude(data, form);
  const offboardingAdjustment = calculateOffboardingAdjustment(data, form);
  const currentWorkDays = validDays - onboardingDays + offboardingAdjustment - leaveDays - normalOvertimeDays;
  if (currentWorkDays <= 26) return { data, converted: false, overtimeDays: 0 };

  const exactDaysToConvert = currentWorkDays - 26;
  const daysToConvert = Math.ceil(exactDaysToConvert);
  const occupied = new Set();
  flattenRecords(data).forEach((record) => {
    const start = parseDate(record.date);
    for (let i = 0; i <= (record.daysOffset || 0); i += 1) occupied.add(formatDate(addDays(start, i)));
  });

  const available = monthDays
    .filter((day) => !isDateDisabled(day, contractInfo) && !occupied.has(formatDate(day)))
    .slice(-daysToConvert)
    .sort((a, b) => a - b);

  if (!available.length) return { data, converted: false, overtimeDays: 0 };

  let remainingHours = exactDaysToConvert * 24;
  let group = [];
  const groups = [];
  available.forEach((day) => {
    if (!group.length || diffDays(day, group[group.length - 1]) === 1) {
      group.push(day);
    } else {
      groups.push(group);
      group = [day];
    }
  });
  if (group.length) groups.push(group);

  groups.forEach((item) => {
    const maxHours = item.length * 24;
    const hours = Math.min(maxHours, remainingHours);
    if (hours <= 0.01) return;
    const totalMinutes = Math.round(hours * 60);
    let startTime = '00:00';
    if (Math.abs(hours - maxHours) > 0.01) {
      startTime = minutesToTime(maxHours * 60 - totalMinutes);
    }
    data.overtime_records.push({
      date: formatDate(item[0]),
      type: 'overtime',
      startTime,
      endTime: '24:00',
      hours: Math.floor(totalMinutes / 60),
      minutes: totalMinutes % 60,
      daysOffset: item.length - 1,
      is_auto: true
    });
    remainingHours -= hours;
  });

  return { data, converted: true, overtimeDays: exactDaysToConvert };
}

function normalizeAutoOvertime(attendanceData, form, monthDays, holidays = {}) {
  const current = normalizeAttendanceData(attendanceData);
  const existingAuto = (current.overtime_records || []).filter((record) => record.is_auto);
  const result = autoConvertOvertimeIfNeeded(current, form, monthDays, holidays);
  if (result.converted) return result.data;
  if (!existingAuto.length) return current;
  return {
    ...current,
    overtime_records: (current.overtime_records || []).filter((record) => !record.is_auto)
  };
}

function removeAutoOvertime(attendanceData) {
  const current = normalizeAttendanceData(attendanceData);
  return {
    ...current,
    overtime_records: (current.overtime_records || []).filter((record) => !record.is_auto)
  };
}

function defaultRecordForType(type, date) {
  const dateStr = formatDate(date);
  if (type === 'normal') return { type, date: dateStr, daysOffset: 0, startTime: '', endTime: '' };
  if (type === 'overtime') return { type, date: dateStr, daysOffset: 0, startTime: '00:00', endTime: '24:00' };
  if (type === 'out_of_beijing' || type === 'out_of_country') return { type, date: dateStr, daysOffset: -1, startTime: '00:00', endTime: '24:00' };
  if (type === 'onboarding' || type === 'offboarding') return { type, date: dateStr, daysOffset: 0, startTime: '', endTime: '' };
  return { type, date: dateStr, daysOffset: 0, startTime: '00:00', endTime: '24:00' };
}

function recordToSave(tempRecord, options = {}) {
  if (!tempRecord || tempRecord.type === 'normal') return { type: 'normal', date: tempRecord?.date };
  const isOut = tempRecord.type === 'out_of_beijing' || tempRecord.type === 'out_of_country';
  let date = tempRecord.date;
  let daysOffset = Number(tempRecord.daysOffset || 0) || 0;

  if (isOut) {
    const editingDate = formatDate(options.editingDate || tempRecord.date);
    const hasContinuation = Boolean(options.hasContinuation);
    if (hasContinuation) {
      date = formatDate(options.cycleStartDate || options.form?.cycle_start_date || tempRecord.date);
      daysOffset = Math.max(0, diffDays(editingDate, date));
    } else {
      daysOffset = Number(tempRecord.daysOffset || 0);
      date = formatDate(addDays(editingDate, -daysOffset));
    }
  }

  const record = {
    date,
    type: tempRecord.type,
    daysOffset,
    startTime: isOut ? '00:00' : (tempRecord.startTime || ''),
    endTime: tempRecord.endTime || ''
  };
  if (record.type === 'onboarding' && record.startTime) record.endTime = '24:00';
  if (record.type === 'offboarding' && record.startTime) {
    record.endTime = record.startTime;
    record.startTime = '00:00';
  }
  const duration = calculateTotalDuration({
    ...record,
    startTime: record.startTime || '00:00',
    endTime: record.endTime || '24:00'
  });
  record.hours = duration.hours;
  record.minutes = duration.minutes;
  return record;
}

module.exports = {
  TYPE_MAP,
  TYPE_OPTIONS,
  RECORD_KEYS,
  emptyAttendanceData,
  normalizeAttendanceData,
  parseDate,
  formatDate,
  formatMonthDay,
  formatWeekday,
  formatChineseDate,
  addDays,
  diffDays,
  sameDay,
  daysInMonth,
  buildMonthDays,
  calculateTotalDuration,
  formatDuration,
  formatDays,
  getHolidayInfo,
  getHolidayLabel,
  isStatutoryHoliday,
  getTypeLabel,
  isDateDisabled,
  normalizeContractInfoForAttendance,
  getOnboardingReference,
  isFirstMonth,
  isLastMonth,
  isHistoricalView,
  getContractEndDate,
  findOriginalRecord,
  findCoveringRecord,
  buildCalendar,
  buildSpecialRecords,
  calculateStats,
  autoConvertOvertimeIfNeeded,
  normalizeAutoOvertime,
  removeAutoOvertime,
  defaultRecordForType,
  recordToSave,
  upsertRecord,
  minutesToTime,
  timeToMinutes
};
