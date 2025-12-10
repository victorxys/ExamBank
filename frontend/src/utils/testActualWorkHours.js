// 测试calculateActualWorkHours函数
import { AttendanceDisplayLogic } from './attendanceDisplayLogic.js';

// 测试11月6日的场景
const testScenario = () => {
    console.log('🧪 测试calculateActualWorkHours函数...');
    
    // 模拟11月6日13:00-18:00的休息记录（跨天到11月7日）
    const testRecord = {
        date: '2025-11-06',
        startTime: '13:00',
        endTime: '18:00',
        daysOffset: 1,
        type: 'rest',
        hours: 29 // 总时长29小时
    };
    
    const allRecords = [testRecord];
    
    // 测试11月6日的实际出勤时长
    console.log('\n📅 测试11月6日:');
    const actualHours6 = AttendanceDisplayLogic.calculateActualWorkHours('2025-11-06', allRecords);
    console.log(`结果: ${actualHours6}小时`);
    console.log(`预期: 3小时 (8小时 - 5小时休息时间)`);
    
    // 测试11月7日的实际出勤时长
    console.log('\n📅 测试11月7日:');
    const actualHours7 = AttendanceDisplayLogic.calculateActualWorkHours('2025-11-07', allRecords);
    console.log(`结果: ${actualHours7}小时`);
    console.log(`预期: 0小时 (全天休息)`);
    
    // 验证calculateDailyHours的计算
    console.log('\n🔍 验证calculateDailyHours:');
    const dailyHours6 = AttendanceDisplayLogic.calculateDailyHours(testRecord, '2025-11-06');
    const dailyHours7 = AttendanceDisplayLogic.calculateDailyHours(testRecord, '2025-11-07');
    console.log(`11月6日占用时长: ${dailyHours6}小时`);
    console.log(`11月7日占用时长: ${dailyHours7}小时`);
};

// 如果在浏览器环境中运行
if (typeof window !== 'undefined') {
    window.testActualWorkHours = testScenario;
    console.log('🚀 测试函数已加载！在浏览器控制台中运行 testActualWorkHours() 来测试');
}

export { testScenario };