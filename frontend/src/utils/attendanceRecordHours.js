// 时间字段与填报时长一致时按实际日期交集分配；历史不完整记录保留填报时长。
function recordHoursInRange(record, rangeStart, rangeEnd) {
  const start = new Date(`${String(record.date).slice(0, 10)}T00:00:00`);
  const offset = Math.max(0, Number(record.daysOffset || 0));
  const dayIndex = day => Math.round((day - start) / 86400000);
  const first = Math.max(0, dayIndex(rangeStart));
  const last = Math.min(offset, dayIndex(rangeEnd));
  if (!Number.isFinite(first) || !Number.isFinite(last) || first > last) return 0;
  let hours = Number(record.hours || 0) + Number(record.minutes || 0) / 60;
  if (!hours && offset > 0) hours = (offset + 1) * 24;
  const time = value => {
    if (!/^\d{1,2}:\d{2}$/.test(value || '')) return NaN;
    const [h, m] = value.split(':').map(Number);
    return h >= 0 && h <= 24 && m >= 0 && m < 60 && (h < 24 || m === 0) ? h * 60 + m : NaN;
  };
  const begin = time(record.startTime);
  const end = offset * 1440 + time(record.endTime);
  if (Number.isFinite(begin) && Number.isFinite(end) && Math.abs((end - begin) / 60 - hours) < 0.001) {
    return Math.max(0, Math.min(end, (last + 1) * 1440) - Math.max(begin, first * 1440)) / 60;
  }
  return hours * (last - first + 1) / (offset + 1);
}

function buildAutoOvertimeRecords(dates, totalMinutes, data) {
  const allocations = dates.map(day => {
    const unavailable = ['rest_records', 'leave_records'].reduce((sum, key) => sum +
      (data[key] || []).reduce((hours, record) => hours + recordHoursInRange(record, day, day), 0), 0);
    return { day, minutes: Math.max(0, 1440 - Math.round(unavailable * 60)) };
  });
  let remove = Math.max(0, allocations.reduce((sum, item) => sum + item.minutes, 0) - totalMinutes);
  const groups = [];
  let group = [];
  allocations.forEach(item => {
    const removed = Math.min(remove, item.minutes);
    item.minutes -= removed;
    remove -= removed;
    if (!item.minutes) {
      if (group.length) groups.push(group);
      group = [];
    } else if (group.length && Math.round((item.day - group[group.length - 1].day) / 86400000) === 1 && item.minutes === 1440) {
      group.push(item);
    } else {
      if (group.length) groups.push(group);
      group = [item];
    }
  });
  if (group.length) groups.push(group);
  return groups.map(items => {
    const minutes = items.reduce((sum, item) => sum + item.minutes, 0);
    const missing = 1440 - items[0].minutes;
    const day = items[0].day;
    return {
      date: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`,
      type: 'overtime', startTime: `${String(Math.floor(missing / 60)).padStart(2, '0')}:${String(missing % 60).padStart(2, '0')}`,
      endTime: '24:00', hours: Math.floor(minutes / 60), minutes: minutes % 60,
      daysOffset: items.length - 1, is_auto: true
    };
  });
}

export { recordHoursInRange, buildAutoOvertimeRecords };
