/**
 * 考勤显示逻辑测试用例
 * 
 * 测试需求文档中定义的各种业务场景
 */

import { AttendanceDisplayLogic } from '../attendanceDisplayLogic';
import { AttendanceDateUtils } from '../attendanceDateUtils';

describe('AttendanceDisplayLogic', () => {
    describe('24小时规则测试', () => {
        test('跨天记录中，某天考勤时长等于24小时应显示考勤类型', () => {
            const record = {
                date: '2024-03-03',
                type: 'leave',
                startTime: '09:00',
                endTime: '09:00',
                daysOffset: 3,
                hours: 72,
                minutes: 0
            };

            // 测试中间日（3月4日和3月5日）应该显示请假
            const result1 = AttendanceDisplayLogic.getDisplayTypeForDate('2024-03-04', [record]);
            expect(result1.type).toBe('leave');
            expect(result1.typeLabel).toBe('请假');

            const result2 = AttendanceDisplayLogic.getDisplayTypeForDate('2024-03-05', [record]);
            expect(result2.type).toBe('leave');
            expect(result2.typeLabel).toBe('请假');
        });

        test('跨天记录中，某天考勤时长少于24小时应显示出勤', () => {
            const record = {
                date: '2024-03-03',
                type: 'leave',
                startTime: '14:00', // 下午2点开始
                endTime: '09:00',   // 第二天上午9点结束
                daysOffset: 1,
                hours: 19,
                minutes: 0
            };

            // 结束日（3月4日）只有9小时，应该显示出勤
            const result = AttendanceDisplayLogic.getDisplayTypeForDate('2024-03-04', [record]);
            expect(result.type).toBe('normal');
            expect(result.typeLabel).toBe('出勤');
        });
    });

    describe('中午12点规则测试', () => {
        test('中午12点前开始的考勤应在当天显示考勤类型', () => {
            const record = {
                date: '2024-03-03',
                type: 'rest',
                startTime: '11:00', // 上午11点开始
                endTime: '18:00',
                daysOffset: 1,
                hours: 31,
                minutes: 0
            };

            // 开始日应该显示休息
            const result = AttendanceDisplayLogic.getDisplayTypeForDate('2024-03-03', [record]);
            expect(result.type).toBe('rest');
            expect(result.typeLabel).toBe('休息');
        });

        test('中午12点后开始的考勤应在当天显示出勤，第二天显示考勤类型', () => {
            const record = {
                date: '2024-03-03',
                type: 'rest',
                startTime: '13:00', // 下午1点开始
                endTime: '18:00',
                daysOffset: 1,
                hours: 29,
                minutes: 0
            };

            // 开始日应该显示出勤
            const startDayResult = AttendanceDisplayLogic.getDisplayTypeForDate('2024-03-03', [record]);
            expect(startDayResult.type).toBe('normal');
            expect(startDayResult.typeLabel).toBe('出勤');

            // 结束日应该显示休息
            const endDayResult = AttendanceDisplayLogic.getDisplayTypeForDate('2024-03-04', [record]);
            expect(endDayResult.type).toBe('rest');
            expect(endDayResult.typeLabel).toBe('休息');
        });

        test('中午12点整点应按照12点后处理', () => {
            const record = {
                date: '2024-03-03',
                type: 'leave',
                startTime: '12:00', // 中午12点整点
                endTime: '18:00',
                daysOffset: 1,
                hours: 30,
                minutes: 0
            };

            // 开始日应该显示出勤（12点整点按12点后处理）
            const startDayResult = AttendanceDisplayLogic.getDisplayTypeForDate('2024-03-03', [record]);
            expect(startDayResult.type).toBe('normal');
            expect(startDayResult.typeLabel).toBe('出勤');
        });
    });

    describe('短期考勤特殊处理测试', () => {
        test('总时长不满24小时且首日12点后开始，第二天应显示考勤类型', () => {
            const record = {
                date: '2024-03-03',
                type: 'leave',
                startTime: '14:00', // 下午2点开始
                endTime: '10:00',   // 第二天上午10点结束
                daysOffset: 1,
                hours: 20,          // 总共20小时，不满24小时
                minutes: 0
            };

            // 开始日应该显示出勤（12点后开始）
            const startDayResult = AttendanceDisplayLogic.getDisplayTypeForDate('2024-03-03', [record]);
            expect(startDayResult.type).toBe('normal');

            // 结束日应该显示请假（短期考勤特殊处理）
            const endDayResult = AttendanceDisplayLogic.getDisplayTypeForDate('2024-03-04', [record]);
            expect(endDayResult.type).toBe('leave');
            expect(endDayResult.typeLabel).toBe('请假');
        });

        test('总时长不满24小时且首日12点前开始，首日应显示考勤类型', () => {
            const record = {
                date: '2024-03-03',
                type: 'leave',
                startTime: '10:00', // 上午10点开始
                endTime: '14:00',   // 第二天下午2点结束
                daysOffset: 1,
                hours: 28,          // 总共28小时，超过24小时但首日12点前开始
                minutes: 0
            };

            // 开始日应该显示请假（12点前开始）
            const startDayResult = AttendanceDisplayLogic.getDisplayTypeForDate('2024-03-03', [record]);
            expect(startDayResult.type).toBe('leave');
            expect(startDayResult.typeLabel).toBe('请假');
        });
    });

    describe('规则优先级测试', () => {
        test('中午12点规则应优先于24小时规则', () => {
            const record = {
                date: '2024-03-03',
                type: 'rest',
                startTime: '13:00', // 下午1点开始（12点后）
                endTime: '13:00',   // 第二天下午1点结束
                daysOffset: 1,
                hours: 24,          // 恰好24小时
                minutes: 0
            };

            // 虽然总时长24小时，但因为12点后开始，开始日应显示出勤
            const startDayResult = AttendanceDisplayLogic.getDisplayTypeForDate('2024-03-03', [record]);
            expect(startDayResult.type).toBe('normal');
            expect(startDayResult.typeLabel).toBe('出勤');

            // 结束日应显示休息
            const endDayResult = AttendanceDisplayLogic.getDisplayTypeForDate('2024-03-04', [record]);
            expect(endDayResult.type).toBe('rest');
            expect(endDayResult.typeLabel).toBe('休息');
        });
    });

    describe('第一显示日测试', () => {
        test('单天记录的开始日应该是第一显示日', () => {
            const record = {
                date: '2024-03-03',
                type: 'leave',
                startTime: '09:00',
                endTime: '18:00',
                daysOffset: 0,
                hours: 9,
                minutes: 0
            };

            const isFirstDay = AttendanceDisplayLogic.isFirstDisplayDay('2024-03-03', record, [record]);
            expect(isFirstDay).toBe(true);
        });

        test('跨天记录中，12点前开始的记录开始日应该是第一显示日', () => {
            const record = {
                date: '2024-03-03',
                type: 'rest',
                startTime: '11:00', // 上午11点开始
                endTime: '18:00',
                daysOffset: 1,
                hours: 31,
                minutes: 0
            };

            // 开始日应该是第一显示日
            const isFirstDay = AttendanceDisplayLogic.isFirstDisplayDay('2024-03-03', record, [record]);
            expect(isFirstDay).toBe(true);

            // 结束日不应该是第一显示日
            const isEndFirstDay = AttendanceDisplayLogic.isFirstDisplayDay('2024-03-04', record, [record]);
            expect(isEndFirstDay).toBe(false);
        });

        test('跨天记录中，12点后开始的记录第二天应该是第一显示日', () => {
            const record = {
                date: '2024-03-03',
                type: 'rest',
                startTime: '13:00', // 下午1点开始
                endTime: '18:00',
                daysOffset: 1,
                hours: 29,
                minutes: 0
            };

            // 开始日不应该是第一显示日（显示为出勤）
            const isStartFirstDay = AttendanceDisplayLogic.isFirstDisplayDay('2024-03-03', record, [record]);
            expect(isStartFirstDay).toBe(false);

            // 结束日应该是第一显示日（第一个显示休息的日期）
            const isEndFirstDay = AttendanceDisplayLogic.isFirstDisplayDay('2024-03-04', record, [record]);
            expect(isEndFirstDay).toBe(true);
        });

        test('出京/出境类型的开始日应该总是第一显示日', () => {
            const record = {
                date: '2024-03-03',
                type: 'out_of_beijing',
                startTime: '13:00', // 下午1点开始
                endTime: '18:00',
                daysOffset: 1,
                hours: 29,
                minutes: 0
            };

            // 开始日应该是第一显示日（出京类型总是显示）
            const isStartFirstDay = AttendanceDisplayLogic.isFirstDisplayDay('2024-03-03', record, [record]);
            expect(isStartFirstDay).toBe(true);

            // 结束日不应该是第一显示日
            const isEndFirstDay = AttendanceDisplayLogic.isFirstDisplayDay('2024-03-04', record, [record]);
            expect(isEndFirstDay).toBe(false);
        });
    });

    describe('考勤记录去重测试', () => {
        test('同一客户同一员工的记录应该去重', () => {
            const records = [
                {
                    date: '2024-03-03',
                    type: 'leave',
                    customer_id: 'customer1',
                    employee_id: 'employee1',
                    created_at: '2024-03-03T10:00:00Z'
                },
                {
                    date: '2024-03-03',
                    type: 'rest',
                    customer_id: 'customer1',
                    employee_id: 'employee1',
                    created_at: '2024-03-03T11:00:00Z' // 更新的记录
                }
            ];

            const deduplicatedRecords = AttendanceDisplayLogic.deduplicateRecords(records);
            
            expect(deduplicatedRecords).toHaveLength(1);
            expect(deduplicatedRecords[0].type).toBe('rest'); // 应该保留更新的记录
        });

        test('不同客户或不同员工的记录不应该去重', () => {
            const records = [
                {
                    date: '2024-03-03',
                    type: 'leave',
                    customer_id: 'customer1',
                    employee_id: 'employee1'
                },
                {
                    date: '2024-03-03',
                    type: 'rest',
                    customer_id: 'customer2',
                    employee_id: 'employee1'
                },
                {
                    date: '2024-03-03',
                    type: 'overtime',
                    customer_id: 'customer1',
                    employee_id: 'employee2'
                }
            ];

            const deduplicatedRecords = AttendanceDisplayLogic.deduplicateRecords(records);
            
            expect(deduplicatedRecords).toHaveLength(3); // 应该保留所有记录
        });
    });

    describe('边界条件测试', () => {
        test('跨月考勤记录应正确处理', () => {
            const record = {
                date: '2024-02-29', // 闰年2月29日
                type: 'leave',
                startTime: '10:00',
                endTime: '10:00',
                daysOffset: 2, // 跨到3月2日
                hours: 48,
                minutes: 0
            };

            // 2月29日应该显示请假
            const feb29Result = AttendanceDisplayLogic.getDisplayTypeForDate('2024-02-29', [record]);
            expect(feb29Result.type).toBe('leave');

            // 3月1日应该显示请假
            const mar1Result = AttendanceDisplayLogic.getDisplayTypeForDate('2024-03-01', [record]);
            expect(mar1Result.type).toBe('leave');

            // 3月2日应该显示请假
            const mar2Result = AttendanceDisplayLogic.getDisplayTypeForDate('2024-03-02', [record]);
            expect(mar2Result.type).toBe('leave');
        });

        test('跨年考勤记录应正确处理', () => {
            const record = {
                date: '2023-12-31',
                type: 'rest',
                startTime: '10:00',
                endTime: '10:00',
                daysOffset: 2, // 跨到2024年1月2日
                hours: 48,
                minutes: 0
            };

            // 2023年12月31日应该显示休息
            const dec31Result = AttendanceDisplayLogic.getDisplayTypeForDate('2023-12-31', [record]);
            expect(dec31Result.type).toBe('rest');

            // 2024年1月1日应该显示休息
            const jan1Result = AttendanceDisplayLogic.getDisplayTypeForDate('2024-01-01', [record]);
            expect(jan1Result.type).toBe('rest');

            // 2024年1月2日应该显示休息
            const jan2Result = AttendanceDisplayLogic.getDisplayTypeForDate('2024-01-02', [record]);
            expect(jan2Result.type).toBe('rest');
        });
    });
});

describe('AttendanceDateUtils', () => {
    describe('时间范围验证测试', () => {
        test('有效的时间格式应该通过验证', () => {
            expect(AttendanceDateUtils.TimeRangeValidator.isValidTimeFormat('09:00')).toBe(true);
            expect(AttendanceDateUtils.TimeRangeValidator.isValidTimeFormat('23:59')).toBe(true);
            expect(AttendanceDateUtils.TimeRangeValidator.isValidTimeFormat('00:00')).toBe(true);
        });

        test('无效的时间格式应该被拒绝', () => {
            expect(AttendanceDateUtils.TimeRangeValidator.isValidTimeFormat('25:00')).toBe(false);
            expect(AttendanceDateUtils.TimeRangeValidator.isValidTimeFormat('12:60')).toBe(false);
            expect(AttendanceDateUtils.TimeRangeValidator.isValidTimeFormat('abc')).toBe(false);
            expect(AttendanceDateUtils.TimeRangeValidator.isValidTimeFormat('')).toBe(false);
        });

        test('有效的日期格式应该通过验证', () => {
            expect(AttendanceDateUtils.TimeRangeValidator.isValidDateFormat('2024-03-03')).toBe(true);
            expect(AttendanceDateUtils.TimeRangeValidator.isValidDateFormat('2024-02-29')).toBe(true); // 闰年
        });

        test('无效的日期格式应该被拒绝', () => {
            expect(AttendanceDateUtils.TimeRangeValidator.isValidDateFormat('2023-02-29')).toBe(false); // 非闰年
            expect(AttendanceDateUtils.TimeRangeValidator.isValidDateFormat('2024-13-01')).toBe(false); // 无效月份
            expect(AttendanceDateUtils.TimeRangeValidator.isValidDateFormat('abc')).toBe(false);
        });
    });

    describe('跨天时长计算测试', () => {
        test('单天记录应返回原始时长', () => {
            const record = {
                date: '2024-03-03',
                hours: 8,
                minutes: 30,
                daysOffset: 0
            };

            const duration = AttendanceDateUtils.CrossDayDurationCalculator.calculateTotalDuration(record);
            expect(duration.totalHours).toBe(8);
            expect(duration.totalMinutes).toBe(30);
            expect(duration.days).toBe(0);
        });

        test('跨天记录应正确计算总时长', () => {
            const record = {
                date: '2024-03-03',
                startTime: '14:00',
                endTime: '10:00',
                daysOffset: 1
            };

            const duration = AttendanceDateUtils.CrossDayDurationCalculator.calculateTotalDuration(record);
            expect(duration.totalHours).toBe(20); // 14:00到次日10:00 = 20小时
            expect(duration.days).toBe(1);
        });
    });

    describe('每日工作时长计算测试', () => {
        test('开始日应正确计算时长', () => {
            const record = {
                date: '2024-03-03',
                startTime: '14:00',
                endTime: '10:00',
                daysOffset: 1
            };

            const hours = AttendanceDateUtils.DailyWorkHoursCalculator.calculateDailyHours(record, '2024-03-03');
            expect(hours).toBe(10); // 14:00到24:00 = 10小时
        });

        test('结束日应正确计算时长', () => {
            const record = {
                date: '2024-03-03',
                startTime: '14:00',
                endTime: '10:00',
                daysOffset: 1
            };

            const hours = AttendanceDateUtils.DailyWorkHoursCalculator.calculateDailyHours(record, '2024-03-04');
            expect(hours).toBe(10); // 00:00到10:00 = 10小时
        });

        test('中间日应返回24小时', () => {
            const record = {
                date: '2024-03-03',
                startTime: '14:00',
                endTime: '10:00',
                daysOffset: 3
            };

            const hours = AttendanceDateUtils.DailyWorkHoursCalculator.calculateDailyHours(record, '2024-03-05');
            expect(hours).toBe(24); // 中间日整天24小时
        });
    });

    describe('边界条件处理测试', () => {
        test('中午12点边界应正确识别', () => {
            const record = { startTime: '12:00' };
            const result = AttendanceDateUtils.BoundaryConditionHandler.handleNoonBoundary(record);
            
            expect(result.isNoonBoundary).toBe(true);
            expect(result.shouldShowOnStartDay).toBe(false);
        });

        test('跨月跨年应正确识别', () => {
            const record = {
                date: '2023-12-31',
                daysOffset: 2
            };
            
            const result = AttendanceDateUtils.BoundaryConditionHandler.handleCrossMonthYear(record);
            expect(result.crossMonth).toBe(true);
            expect(result.crossYear).toBe(true);
        });

        test('极端时长应正确识别', () => {
            const record = {
                hours: 24 * 8, // 8天
                daysOffset: 3
            };
            
            const result = AttendanceDateUtils.BoundaryConditionHandler.handleExtremeDuration(record);
            expect(result.isExtreme).toBe(true);
            expect(result.warnings.length).toBeGreaterThan(0);
        });
    });
});

// 集成测试：完整的业务场景
describe('集成测试：完整业务场景', () => {
    test('场景1：请假1天，从3号9点到4号9点', () => {
        const record = {
            date: '2024-03-03',
            type: 'leave',
            startTime: '09:00',
            endTime: '09:00',
            daysOffset: 1,
            hours: 24,
            minutes: 0
        };

        // 3号应该显示"请假"（9点开始，12点前）
        const day3Result = AttendanceDisplayLogic.getDisplayTypeForDate('2024-03-03', [record]);
        expect(day3Result.type).toBe('leave');
        expect(day3Result.typeLabel).toBe('请假');

        // 4号应该显示"出勤"（只有9小时，不满24小时）
        const day4Result = AttendanceDisplayLogic.getDisplayTypeForDate('2024-03-04', [record]);
        expect(day4Result.type).toBe('normal');
        expect(day4Result.typeLabel).toBe('出勤');
    });

    test('场景2：请假3天，从3号9点到6号9点', () => {
        const record = {
            date: '2024-03-03',
            type: 'leave',
            startTime: '09:00',
            endTime: '09:00',
            daysOffset: 3,
            hours: 72,
            minutes: 0
        };

        // 3、4、5号应该显示"请假"
        expect(AttendanceDisplayLogic.getDisplayTypeForDate('2024-03-03', [record]).type).toBe('leave');
        expect(AttendanceDisplayLogic.getDisplayTypeForDate('2024-03-04', [record]).type).toBe('leave');
        expect(AttendanceDisplayLogic.getDisplayTypeForDate('2024-03-05', [record]).type).toBe('leave');

        // 6号应该显示"出勤"（只有9小时）
        expect(AttendanceDisplayLogic.getDisplayTypeForDate('2024-03-06', [record]).type).toBe('normal');
    });

    test('场景3：当天中午12点前开始的休假', () => {
        const record = {
            date: '2024-03-03',
            type: 'rest',
            startTime: '11:00', // 上午11点开始
            endTime: '18:00',
            daysOffset: 1,
            hours: 31,
            minutes: 0
        };

        // 当天应该显示"休假"
        const result = AttendanceDisplayLogic.getDisplayTypeForDate('2024-03-03', [record]);
        expect(result.type).toBe('rest');
        expect(result.typeLabel).toBe('休息');
    });

    test('场景4：当天中午12点后开始的休假', () => {
        const record = {
            date: '2024-03-03',
            type: 'rest',
            startTime: '13:00', // 下午1点开始
            endTime: '18:00',
            daysOffset: 1,
            hours: 29,
            minutes: 0
        };

        // 当天应该显示"出勤"
        const day3Result = AttendanceDisplayLogic.getDisplayTypeForDate('2024-03-03', [record]);
        expect(day3Result.type).toBe('normal');
        expect(day3Result.typeLabel).toBe('出勤');

        // 第二天应该显示"休假"
        const day4Result = AttendanceDisplayLogic.getDisplayTypeForDate('2024-03-04', [record]);
        expect(day4Result.type).toBe('rest');
        expect(day4Result.typeLabel).toBe('休息');
    });

    test('场景5：整个假期不满24小时，首日晚于中午12点开始', () => {
        const record = {
            date: '2024-03-03',
            type: 'leave',
            startTime: '14:00', // 下午2点开始
            endTime: '10:00',   // 第二天上午10点结束
            daysOffset: 1,
            hours: 20,          // 总共20小时，不满24小时
            minutes: 0
        };

        // 首日应该显示"出勤"（12点后开始）
        const day3Result = AttendanceDisplayLogic.getDisplayTypeForDate('2024-03-03', [record]);
        expect(day3Result.type).toBe('normal');
        expect(day3Result.typeLabel).toBe('出勤');

        // 第二天应该显示"请假"（短期考勤特殊处理）
        const day4Result = AttendanceDisplayLogic.getDisplayTypeForDate('2024-03-04', [record]);
        expect(day4Result.type).toBe('leave');
        expect(day4Result.typeLabel).toBe('请假');
    });
});