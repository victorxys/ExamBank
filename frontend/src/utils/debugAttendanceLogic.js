/**
 * 调试考勤显示逻辑
 */

import { AttendanceDisplayLogic } from './attendanceDisplayLogic.js';

// 测试场景4：当天中午12点后开始的休假
const testRecord = {
    date: '2024-03-03',
    type: 'rest',
    startTime: '13:00', // 下午1点开始
    endTime: '18:00',
    daysOffset: 1,
    hours: 29,
    minutes: 0
};

console.log('🧪 测试场景：12点后开始的休假');
console.log('记录:', testRecord);

// 测试第一天（开始日）
const day1Result = AttendanceDisplayLogic.getDisplayTypeForDate('2024-03-03', [testRecord]);
console.log('2024-03-03 (开始日):', day1Result);

// 测试第二天（结束日）
const day2Result = AttendanceDisplayLogic.getDisplayTypeForDate('2024-03-04', [testRecord]);
console.log('2024-03-04 (结束日):', day2Result);

// 详细调试第二天的逻辑
console.log('\n🔍 详细调试第二天逻辑:');
const targetDate = new Date('2024-03-04');
const startDate = new Date(testRecord.date);
const daysOffset = testRecord.daysOffset || 0;
const endDate = new Date(startDate);
endDate.setDate(startDate.getDate() + daysOffset);

console.log('目标日期:', targetDate);
console.log('开始日期:', startDate);
console.log('结束日期:', endDate);
console.log('天数偏移:', daysOffset);

const isStartDay = targetDate.getTime() === startDate.getTime();
const isEndDay = targetDate.getTime() === endDate.getTime();

console.log('是开始日:', isStartDay);
console.log('是结束日:', isEndDay);

if (isEndDay) {
    console.log('应用结束日规则...');
    const result = AttendanceDisplayLogic.applyEndDayRule(testRecord);
    console.log('结束日规则结果:', result);
}

// 测试更长的跨天记录
console.log('\n🧪 测试更长的跨天记录（3天）:');
const longRecord = {
    date: '2024-03-03',
    type: 'leave',
    startTime: '13:00', // 下午1点开始
    endTime: '09:00',   // 第三天上午9点结束
    daysOffset: 2,      // 跨2天
    hours: 44,          // 总共44小时
    minutes: 0
};

console.log('记录:', longRecord);

// 测试每一天
for (let i = 0; i <= 2; i++) {
    const testDate = new Date('2024-03-03');
    testDate.setDate(testDate.getDate() + i);
    const dateStr = testDate.toISOString().split('T')[0];
    const result = AttendanceDisplayLogic.getDisplayTypeForDate(dateStr, [longRecord]);
    console.log(`${dateStr} (第${i+1}天):`, result);
}

export { testRecord, longRecord };