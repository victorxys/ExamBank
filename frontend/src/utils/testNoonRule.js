/**
 * 测试中午12点规则的实现
 */

import { AttendanceDisplayLogic } from './attendanceDisplayLogic.js';

console.log('🧪 测试中午12点规则实现\n');

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

console.log('📋 测试记录:', testRecord);
console.log('期望结果:');
console.log('  - 2024-03-03 (开始日): 出勤 (13点开始，12点后)');
console.log('  - 2024-03-04 (结束日): 休息 (第二天应显示考勤类型)\n');

// 测试第一天（开始日）
const day1Result = AttendanceDisplayLogic.getDisplayTypeForDate('2024-03-03', [testRecord]);
console.log('✅ 2024-03-03 (开始日):', day1Result.type, '-', day1Result.typeLabel);

// 测试第二天（结束日）
const day2Result = AttendanceDisplayLogic.getDisplayTypeForDate('2024-03-04', [testRecord]);
console.log('✅ 2024-03-04 (结束日):', day2Result.type, '-', day2Result.typeLabel);

// 验证结果
const day1Correct = day1Result.type === 'normal';
const day2Correct = day2Result.type === 'rest';

console.log('\n📊 测试结果:');
console.log('开始日正确:', day1Correct ? '✅' : '❌');
console.log('结束日正确:', day2Correct ? '✅' : '❌');
console.log('整体测试:', (day1Correct && day2Correct) ? '✅ 通过' : '❌ 失败');

// 测试更复杂的场景：3天跨度，12点后开始
console.log('\n🧪 测试复杂场景：3天跨度，12点后开始\n');

const complexRecord = {
    date: '2024-03-03',
    type: 'leave',
    startTime: '14:00', // 下午2点开始
    endTime: '10:00',   // 第三天上午10点结束
    daysOffset: 2,      // 跨2天
    hours: 44,          // 总共44小时
    minutes: 0
};

console.log('📋 测试记录:', complexRecord);
console.log('期望结果:');
console.log('  - 2024-03-03 (开始日): 出勤 (14点开始，12点后)');
console.log('  - 2024-03-04 (中间日): 请假 (第二天应显示考勤类型)');
console.log('  - 2024-03-05 (结束日): 请假 (结束日应显示考勤类型)\n');

// 测试每一天
const complexResults = [];
for (let i = 0; i <= 2; i++) {
    const testDate = new Date('2024-03-03');
    testDate.setDate(testDate.getDate() + i);
    const dateStr = testDate.toISOString().split('T')[0];
    const result = AttendanceDisplayLogic.getDisplayTypeForDate(dateStr, [complexRecord]);
    complexResults.push(result);
    
    const dayType = i === 0 ? '开始日' : (i === 1 ? '中间日' : '结束日');
    console.log(`✅ ${dateStr} (${dayType}):`, result.type, '-', result.typeLabel);
}

// 验证复杂场景结果
const complex1Correct = complexResults[0].type === 'normal';  // 开始日应该是出勤
const complex2Correct = complexResults[1].type === 'leave';   // 中间日应该是请假
const complex3Correct = complexResults[2].type === 'leave';   // 结束日应该是请假

console.log('\n📊 复杂场景测试结果:');
console.log('开始日正确:', complex1Correct ? '✅' : '❌');
console.log('中间日正确:', complex2Correct ? '✅' : '❌');
console.log('结束日正确:', complex3Correct ? '✅' : '❌');
console.log('整体测试:', (complex1Correct && complex2Correct && complex3Correct) ? '✅ 通过' : '❌ 失败');

// 对比测试：12点前开始的情况
console.log('\n🧪 对比测试：12点前开始的情况\n');

const beforeNoonRecord = {
    date: '2024-03-03',
    type: 'rest',
    startTime: '11:00', // 上午11点开始
    endTime: '18:00',
    daysOffset: 1,
    hours: 31,
    minutes: 0
};

console.log('📋 测试记录:', beforeNoonRecord);
console.log('期望结果:');
console.log('  - 2024-03-03 (开始日): 休息 (11点开始，12点前)');
console.log('  - 2024-03-04 (结束日): 休息 (满足24小时规则)\n');

const beforeNoon1 = AttendanceDisplayLogic.getDisplayTypeForDate('2024-03-03', [beforeNoonRecord]);
const beforeNoon2 = AttendanceDisplayLogic.getDisplayTypeForDate('2024-03-04', [beforeNoonRecord]);

console.log('✅ 2024-03-03 (开始日):', beforeNoon1.type, '-', beforeNoon1.typeLabel);
console.log('✅ 2024-03-04 (结束日):', beforeNoon2.type, '-', beforeNoon2.typeLabel);

const beforeNoon1Correct = beforeNoon1.type === 'rest';
const beforeNoon2Correct = beforeNoon2.type === 'rest';

console.log('\n📊 12点前开始测试结果:');
console.log('开始日正确:', beforeNoon1Correct ? '✅' : '❌');
console.log('结束日正确:', beforeNoon2Correct ? '✅' : '❌');
console.log('整体测试:', (beforeNoon1Correct && beforeNoon2Correct) ? '✅ 通过' : '❌ 失败');

export { testRecord, complexRecord, beforeNoonRecord };