/**
 * 调试特定考勤场景
 * 测试11月6号下午13点开始休假，第二天18点结束的情况
 */

import { AttendanceDisplayLogic } from './attendanceDisplayLogic.js';

// 测试您的具体场景
export function debugSpecificCase() {
    console.log('🧪 开始调试特定考勤场景...\n');
    
    // 您的场景：11月6号下午13点开始休假，第二天18点结束
    const testRecord = {
        date: '2025-11-06',  // 更新为2025年，匹配您的实际数据
        type: 'rest',
        startTime: '13:00',  // 下午13点开始
        endTime: '18:00',    // 第二天18点结束
        daysOffset: 1,       // 跨1天
        hours: 29,           // 总共29小时
        minutes: 0
    };
    
    console.log('📋 测试记录:');
    console.log(`   日期: ${testRecord.date}`);
    console.log(`   类型: ${testRecord.type}`);
    console.log(`   开始时间: ${testRecord.startTime}`);
    console.log(`   结束时间: ${testRecord.endTime}`);
    console.log(`   跨天数: ${testRecord.daysOffset}`);
    console.log(`   总时长: ${testRecord.hours}小时\n`);
    
    // 测试第一天（11月6日）
    console.log('🔍 测试第一天 (2025-11-06):');
    const day1Result = AttendanceDisplayLogic.getDisplayTypeForDate('2025-11-06', [testRecord]);
    console.log(`   结果: ${day1Result.type} (${day1Result.typeLabel})`);
    console.log(`   预期: normal (出勤) - 因为13点开始，12点后\n`);
    
    // 测试第二天（11月7日）
    console.log('🔍 测试第二天 (2025-11-07):');
    const day2Result = AttendanceDisplayLogic.getDisplayTypeForDate('2025-11-07', [testRecord]);
    console.log(`   结果: ${day2Result.type} (${day2Result.typeLabel})`);
    console.log(`   预期: rest (休息) - 因为是12点后开始的考勤的第二天\n`);
    
    // 分析结果
    console.log('📊 结果分析:');
    const day1Correct = day1Result.type === 'normal';
    const day2Correct = day2Result.type === 'rest';
    
    console.log(`   第一天正确: ${day1Correct ? '✅' : '❌'}`);
    console.log(`   第二天正确: ${day2Correct ? '✅' : '❌'}`);
    
    if (!day2Correct) {
        console.log('\n🚨 第二天显示不正确！让我们深入分析...');
        
        // 详细分析第二天的逻辑
        console.log('\n🔬 详细分析第二天逻辑:');
        
        // 检查是否被记录覆盖
        const isCovered = AttendanceDisplayLogic.isDateCoveredByRecord('2025-11-07', testRecord);
        console.log(`   是否被记录覆盖: ${isCovered}`);
        
        if (isCovered) {
            // 检查应该显示的类型
            const shouldShow = AttendanceDisplayLogic.shouldShowAttendanceType('2025-11-07', testRecord);
            console.log(`   是否应该显示考勤类型: ${shouldShow}`);
            
            // 手动检查中间日规则
            const startTime = testRecord.startTime || '09:00';
            const [startHour, startMinute] = startTime.split(':').map(Number);
            const startTimeInMinutes = startHour * 60 + startMinute;
            const noonInMinutes = 12 * 60;
            
            console.log(`   开始时间: ${startTime} (${startTimeInMinutes}分钟)`);
            console.log(`   中午时间: 12:00 (${noonInMinutes}分钟)`);
            console.log(`   是否12点后开始: ${startTimeInMinutes >= noonInMinutes}`);
            
            const startDate = new Date(testRecord.date);
            const targetDate = new Date('2025-11-07');
            const daysDiff = Math.floor((targetDate - startDate) / (1000 * 60 * 60 * 24));
            
            console.log(`   开始日期: ${testRecord.date}`);
            console.log(`   目标日期: 2025-11-07`);
            console.log(`   天数差: ${daysDiff}`);
            console.log(`   是否是第二天: ${daysDiff === 1}`);
        }
    }
    
    return {
        day1: { result: day1Result, correct: day1Correct },
        day2: { result: day2Result, correct: day2Correct },
        overall: day1Correct && day2Correct
    };
}

// 如果在浏览器环境中运行
if (typeof window !== 'undefined') {
    window.debugSpecificCase = debugSpecificCase;
    console.log('🚀 调试工具已加载！在浏览器控制台中运行 debugSpecificCase() 来测试');
}

// 如果在 Node.js 环境中运行
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { debugSpecificCase };
}

export default debugSpecificCase;