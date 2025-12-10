/**
 * 考勤逻辑验证脚本
 * 手动验证业务逻辑是否正确实现
 */

import { AttendanceDisplayLogic } from './attendanceDisplayLogic.js';
import { AttendanceDateUtils } from './attendanceDateUtils.js';

// 测试用例
const testCases = [
    {
        name: '场景1：请假1天，从3号9点到4号9点',
        record: {
            date: '2024-03-03',
            type: 'leave',
            startTime: '09:00',
            endTime: '09:00',
            daysOffset: 1,
            hours: 24,
            minutes: 0
        },
        expectations: [
            { date: '2024-03-03', expectedType: 'leave', reason: '9点开始，12点前，应显示请假' },
            { date: '2024-03-04', expectedType: 'normal', reason: '只有9小时，不满24小时，应显示出勤' }
        ]
    },
    {
        name: '场景2：请假3天，从3号9点到6号9点',
        record: {
            date: '2024-03-03',
            type: 'leave',
            startTime: '09:00',
            endTime: '09:00',
            daysOffset: 3,
            hours: 72,
            minutes: 0
        },
        expectations: [
            { date: '2024-03-03', expectedType: 'leave', reason: '开始日，9点开始，12点前' },
            { date: '2024-03-04', expectedType: 'leave', reason: '中间日，整天24小时' },
            { date: '2024-03-05', expectedType: 'leave', reason: '中间日，整天24小时' },
            { date: '2024-03-06', expectedType: 'normal', reason: '结束日，只有9小时，不满24小时' }
        ]
    },
    {
        name: '场景3：当天中午12点前开始的休假',
        record: {
            date: '2024-03-03',
            type: 'rest',
            startTime: '11:00',
            endTime: '18:00',
            daysOffset: 1,
            hours: 31,
            minutes: 0
        },
        expectations: [
            { date: '2024-03-03', expectedType: 'rest', reason: '11点开始，12点前，应显示休假' }
        ]
    },
    {
        name: '场景4：当天中午12点后开始的休假',
        record: {
            date: '2024-03-03',
            type: 'rest',
            startTime: '13:00',
            endTime: '18:00',
            daysOffset: 1,
            hours: 29,
            minutes: 0
        },
        expectations: [
            { date: '2024-03-03', expectedType: 'normal', reason: '13点开始，12点后，当天应显示出勤' },
            { date: '2024-03-04', expectedType: 'rest', reason: '12点后开始的考勤，第二天应显示休假' }
        ]
    },
    {
        name: '场景5：整个假期不满24小时，首日晚于中午12点开始',
        record: {
            date: '2024-03-03',
            type: 'leave',
            startTime: '14:00',
            endTime: '10:00',
            daysOffset: 1,
            hours: 20,
            minutes: 0
        },
        expectations: [
            { date: '2024-03-03', expectedType: 'normal', reason: '14点开始，12点后，首日应显示出勤' },
            { date: '2024-03-04', expectedType: 'leave', reason: '短期考勤特殊处理，第二天应显示请假' }
        ]
    },
    {
        name: '场景6：中午12点整点边界测试',
        record: {
            date: '2024-03-03',
            type: 'leave',
            startTime: '12:00',
            endTime: '18:00',
            daysOffset: 1,
            hours: 30,
            minutes: 0
        },
        expectations: [
            { date: '2024-03-03', expectedType: 'normal', reason: '12点整点按12点后处理，应显示出勤' },
            { date: '2024-03-04', expectedType: 'leave', reason: '第二天应显示请假' }
        ]
    }
];

// 运行验证
function runValidation() {
    console.log('🧪 开始验证考勤显示逻辑...\n');
    
    let totalTests = 0;
    let passedTests = 0;
    let failedTests = [];

    testCases.forEach((testCase, index) => {
        console.log(`📋 测试 ${index + 1}: ${testCase.name}`);
        console.log(`   记录: ${testCase.record.date} ${testCase.record.startTime}-${testCase.record.endTime} (${testCase.record.daysOffset}天) ${testCase.record.type}`);
        
        testCase.expectations.forEach((expectation, expIndex) => {
            totalTests++;
            
            try {
                const result = AttendanceDisplayLogic.getDisplayTypeForDate(expectation.date, [testCase.record]);
                const passed = result.type === expectation.expectedType;
                
                if (passed) {
                    passedTests++;
                    console.log(`   ✅ ${expectation.date}: ${result.type} (${result.typeLabel}) - ${expectation.reason}`);
                } else {
                    failedTests.push({
                        testCase: testCase.name,
                        date: expectation.date,
                        expected: expectation.expectedType,
                        actual: result.type,
                        reason: expectation.reason
                    });
                    console.log(`   ❌ ${expectation.date}: 期望 ${expectation.expectedType}, 实际 ${result.type} - ${expectation.reason}`);
                }
            } catch (error) {
                totalTests++;
                failedTests.push({
                    testCase: testCase.name,
                    date: expectation.date,
                    expected: expectation.expectedType,
                    actual: 'ERROR',
                    reason: expectation.reason,
                    error: error.message
                });
                console.log(`   💥 ${expectation.date}: 执行错误 - ${error.message}`);
            }
        });
        
        console.log('');
    });

    // 输出总结
    console.log('📊 测试总结:');
    console.log(`   总测试数: ${totalTests}`);
    console.log(`   通过: ${passedTests}`);
    console.log(`   失败: ${failedTests.length}`);
    console.log(`   成功率: ${((passedTests / totalTests) * 100).toFixed(1)}%`);

    if (failedTests.length > 0) {
        console.log('\n❌ 失败的测试:');
        failedTests.forEach((failure, index) => {
            console.log(`   ${index + 1}. ${failure.testCase} - ${failure.date}`);
            console.log(`      期望: ${failure.expected}, 实际: ${failure.actual}`);
            console.log(`      原因: ${failure.reason}`);
            if (failure.error) {
                console.log(`      错误: ${failure.error}`);
            }
        });
    }

    return {
        total: totalTests,
        passed: passedTests,
        failed: failedTests.length,
        successRate: (passedTests / totalTests) * 100
    };
}

// 验证工具函数
function validateUtilityFunctions() {
    console.log('\n🔧 验证工具函数...\n');
    
    // 测试时间格式验证
    console.log('⏰ 时间格式验证:');
    const timeTests = [
        { input: '09:00', expected: true },
        { input: '23:59', expected: true },
        { input: '00:00', expected: true },
        { input: '25:00', expected: false },
        { input: '12:60', expected: false },
        { input: 'abc', expected: false }
    ];
    
    timeTests.forEach(test => {
        const result = AttendanceDateUtils.TimeRangeValidator.isValidTimeFormat(test.input);
        const status = result === test.expected ? '✅' : '❌';
        console.log(`   ${status} ${test.input}: ${result} (期望: ${test.expected})`);
    });

    // 测试日期格式验证
    console.log('\n📅 日期格式验证:');
    const dateTests = [
        { input: '2024-03-03', expected: true },
        { input: '2024-02-29', expected: true }, // 闰年
        { input: '2023-02-29', expected: false }, // 非闰年
        { input: '2024-13-01', expected: false }, // 无效月份
        { input: 'abc', expected: false }
    ];
    
    dateTests.forEach(test => {
        const result = AttendanceDateUtils.TimeRangeValidator.isValidDateFormat(test.input);
        const status = result === test.expected ? '✅' : '❌';
        console.log(`   ${status} ${test.input}: ${result} (期望: ${test.expected})`);
    });

    // 测试边界条件处理
    console.log('\n🎯 边界条件处理:');
    
    // 中午12点边界
    const noonResult = AttendanceDateUtils.BoundaryConditionHandler.handleNoonBoundary({ startTime: '12:00' });
    console.log(`   ✅ 中午12点边界: ${noonResult.isNoonBoundary ? '识别正确' : '识别失败'}`);
    
    // 跨月跨年
    const crossResult = AttendanceDateUtils.BoundaryConditionHandler.handleCrossMonthYear({
        date: '2023-12-31',
        daysOffset: 2
    });
    console.log(`   ✅ 跨年识别: ${crossResult.crossYear ? '识别正确' : '识别失败'}`);
    console.log(`   ✅ 跨月识别: ${crossResult.crossMonth ? '识别正确' : '识别失败'}`);
}

// 如果在浏览器环境中运行
if (typeof window !== 'undefined') {
    // 将验证函数暴露到全局，方便在浏览器控制台中调用
    window.validateAttendanceLogic = runValidation;
    window.validateUtilityFunctions = validateUtilityFunctions;
    
    console.log('🚀 考勤逻辑验证工具已加载！');
    console.log('💡 在浏览器控制台中运行以下命令进行验证:');
    console.log('   validateAttendanceLogic() - 验证主要业务逻辑');
    console.log('   validateUtilityFunctions() - 验证工具函数');
}

// 如果在 Node.js 环境中运行
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        runValidation,
        validateUtilityFunctions,
        testCases
    };
}

export { runValidation, validateUtilityFunctions, testCases };