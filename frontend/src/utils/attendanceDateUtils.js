/**
 * 考勤日期计算工具函数
 * 
 * 提供跨天时长计算、每日工作时长计算、时间范围验证等功能
 */

import { format, parseISO, addDays, isSameDay, startOfDay, endOfDay, differenceInMinutes } from 'date-fns';

/**
 * 跨天时长计算函数
 */
export class CrossDayDurationCalculator {
    /**
     * 计算跨天考勤记录的总时长
     * @param {Object} record - 考勤记录
     * @returns {Object} { totalHours: number, totalMinutes: number, days: number }
     */
    static calculateTotalDuration(record) {
        const startDate = new Date(record.date);
        const daysOffset = record.daysOffset || 0;
        
        if (daysOffset === 0) {
            // 单天记录：根据开始时间和结束时间计算
            const startTime = record.startTime || '09:00';
            const endTime = record.endTime || '18:00';
            
            const [startHour, startMinute] = startTime.split(':').map(Number);
            let [endHour, endMinute] = endTime.split(':').map(Number);
            
            // 特殊处理 24:00，视为当天的 24 小时整点
            const isEndTime24 = endTime === '24:00';
            if (isEndTime24) {
                endHour = 24;
                endMinute = 0;
            }
            
            // 计算当天的时长
            let totalMinutes;
            if (!isEndTime24 && (endHour < startHour || (endHour === startHour && endMinute < startMinute))) {
                // 跨午夜的情况（如 22:00 到 06:00）- 但不适用于 24:00
                totalMinutes = (24 * 60 - (startHour * 60 + startMinute)) + (endHour * 60 + endMinute);
            } else {
                // 正常情况（如 09:00 到 18:00）或 00:00 到 24:00
                totalMinutes = (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
            }
            
            return {
                totalHours: totalMinutes / 60,
                totalMinutes: totalMinutes % 60,
                days: 0
            };
        }
        
        // 跨天记录：根据开始时间和结束时间计算
        const startTime = record.startTime || '09:00';
        const endTime = record.endTime || '18:00';
        
        const [startHour, startMinute] = startTime.split(':').map(Number);
        let [endHour, endMinute] = endTime.split(':').map(Number);
        
        // 特殊处理 24:00
        const isEndTime24 = endTime === '24:00';
        if (isEndTime24) {
            endHour = 24;
            endMinute = 0;
        }
        
        // 计算开始日期时间
        const startDateTime = new Date(startDate);
        startDateTime.setHours(startHour, startMinute, 0, 0);
        
        // 计算结束日期时间
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + daysOffset);
        const endDateTime = new Date(endDate);
        
        // 对于 24:00，设置为当天的 24:00（即次日 00:00）
        if (isEndTime24) {
            endDateTime.setDate(endDateTime.getDate() + 1);
            endDateTime.setHours(0, 0, 0, 0);
        } else {
            endDateTime.setHours(endHour, endMinute, 0, 0);
        }
        
        // 计算总分钟数
        const totalMinutes = differenceInMinutes(endDateTime, startDateTime);
        
        return {
            totalHours: Math.floor(totalMinutes / 60),
            totalMinutes: totalMinutes % 60,
            days: daysOffset
        };
    }

    /**
     * 验证跨天记录的时间逻辑
     * @param {Object} record - 考勤记录
     * @returns {Object} { isValid: boolean, errors: string[] }
     */
    static validateCrossDayRecord(record) {
        const errors = [];
        
        if (!record.date) {
            errors.push('缺少开始日期');
            return { isValid: false, errors };
        }
        
        const daysOffset = record.daysOffset || 0;
        
        if (daysOffset < 0) {
            errors.push('天数偏移不能为负数');
        }
        
        if (daysOffset > 30) {
            errors.push('跨天记录不能超过30天');
        }
        
        // 验证时间格式
        const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
        
        if (record.startTime && !timeRegex.test(record.startTime)) {
            errors.push('开始时间格式无效');
        }
        
        if (record.endTime && !timeRegex.test(record.endTime)) {
            errors.push('结束时间格式无效');
        }
        
        // 对于跨天记录，验证时间逻辑
        if (daysOffset > 0) {
            const duration = this.calculateTotalDuration(record);
            
            if (duration.totalHours < 0) {
                errors.push('结束时间不能早于开始时间');
            }
            
            if (duration.totalHours > 24 * 31) {
                errors.push('考勤时长不能超过31天');
            }
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }
}

/**
 * 每日工作时长计算器
 */
export class DailyWorkHoursCalculator {
    /**
     * 计算指定日期的工作时长
     * @param {Object} record - 考勤记录
     * @param {string} targetDateStr - 目标日期字符串 (YYYY-MM-DD)
     * @returns {number} 工作时长（小时）
     */
    static calculateDailyHours(record, targetDateStr) {
        const targetDate = new Date(targetDateStr);
        const startDate = new Date(record.date);
        const daysOffset = record.daysOffset || 0;
        
        // 单天记录
        if (daysOffset === 0) {
            if (isSameDay(targetDate, startDate)) {
                return (record.hours || 0) + (record.minutes || 0) / 60;
            }
            return 0;
        }
        
        // 跨天记录
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + daysOffset);
        
        // 检查目标日期是否在记录范围内
        if (targetDate < startDate || targetDate > endDate) {
            return 0;
        }
        
        const isStartDay = isSameDay(targetDate, startDate);
        const isEndDay = isSameDay(targetDate, endDate);
        
        if (isStartDay && isEndDay) {
            // 开始日和结束日是同一天（理论上不应该发生，因为daysOffset > 0）
            return (record.hours || 0) + (record.minutes || 0) / 60;
        } else if (isStartDay) {
            // 开始日：从开始时间到24:00
            const startTime = record.startTime || '09:00';
            const [hours, minutes] = startTime.split(':').map(Number);
            const startHours = hours + minutes / 60;
            return 24 - startHours;
        } else if (isEndDay) {
            // 结束日：从00:00到结束时间
            const endTime = record.endTime || '18:00';
            // 特殊处理 24:00
            if (endTime === '24:00') {
                return 24;
            }
            const [hours, minutes] = endTime.split(':').map(Number);
            return hours + minutes / 60;
        } else {
            // 中间日：整天24小时
            return 24;
        }
    }

    /**
     * 计算考勤记录涉及的所有日期及其工作时长
     * @param {Object} record - 考勤记录
     * @returns {Array} 日期和时长数组 [{ date: string, hours: number }]
     */
    static calculateAllDailyHours(record) {
        const startDate = new Date(record.date);
        const daysOffset = record.daysOffset || 0;
        const result = [];
        
        for (let i = 0; i <= daysOffset; i++) {
            const currentDate = new Date(startDate);
            currentDate.setDate(startDate.getDate() + i);
            const dateStr = format(currentDate, 'yyyy-MM-dd');
            const hours = this.calculateDailyHours(record, dateStr);
            
            result.push({
                date: dateStr,
                hours: hours
            });
        }
        
        return result;
    }
}

/**
 * 时间范围验证函数
 */
export class TimeRangeValidator {
    /**
     * 验证时间字符串格式
     * @param {string} timeStr - 时间字符串 (HH:MM)
     * @returns {boolean}
     */
    static isValidTimeFormat(timeStr) {
        if (!timeStr || typeof timeStr !== 'string') {
            return false;
        }
        
        // 支持 00:00 到 24:00（24:00 表示当天结束/次日开始）
        const timeRegex = /^([01]?[0-9]|2[0-4]):[0-5][0-9]$/;
        if (!timeRegex.test(timeStr)) {
            return false;
        }
        
        // 特殊处理：24:xx 只允许 24:00
        if (timeStr.startsWith('24:') && timeStr !== '24:00') {
            return false;
        }
        
        return true;
    }

    /**
     * 验证日期字符串格式
     * @param {string} dateStr - 日期字符串 (YYYY-MM-DD)
     * @returns {boolean}
     */
    static isValidDateFormat(dateStr) {
        if (!dateStr || typeof dateStr !== 'string') {
            return false;
        }
        
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(dateStr)) {
            return false;
        }
        
        // 验证日期是否有效
        const date = new Date(dateStr);
        return date instanceof Date && !isNaN(date) && format(date, 'yyyy-MM-dd') === dateStr;
    }

    /**
     * 验证考勤记录的时间范围
     * @param {Object} record - 考勤记录
     * @returns {Object} { isValid: boolean, errors: string[] }
     */
    static validateAttendanceTimeRange(record) {
        const errors = [];
        
        // 验证日期
        if (!this.isValidDateFormat(record.date)) {
            errors.push('日期格式无效，应为 YYYY-MM-DD');
        }
        
        // 验证开始时间
        if (record.startTime && !this.isValidTimeFormat(record.startTime)) {
            errors.push('开始时间格式无效，应为 HH:MM');
        }
        
        // 验证结束时间
        if (record.endTime && !this.isValidTimeFormat(record.endTime)) {
            errors.push('结束时间格式无效，应为 HH:MM');
        }
        
        // 验证天数偏移
        if (record.daysOffset !== undefined) {
            if (!Number.isInteger(record.daysOffset) || record.daysOffset < 0) {
                errors.push('天数偏移必须为非负整数');
            }
            
            if (record.daysOffset > 365) {
                errors.push('天数偏移不能超过365天');
            }
        }
        
        // 验证工作时长
        if (record.hours !== undefined) {
            if (typeof record.hours !== 'number' || record.hours < 0) {
                errors.push('工作小时数必须为非负数');
            }
            
            if (record.hours > 24 * 365) {
                errors.push('工作小时数不能超过一年');
            }
        }
        
        if (record.minutes !== undefined) {
            if (!Number.isInteger(record.minutes) || record.minutes < 0 || record.minutes >= 60) {
                errors.push('分钟数必须为0-59之间的整数');
            }
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * 检查日期是否为工作日
     * @param {string|Date} date - 日期
     * @returns {boolean}
     */
    static isWorkday(date) {
        const dateObj = typeof date === 'string' ? new Date(date) : date;
        const dayOfWeek = dateObj.getDay();
        // 0 = 周日, 6 = 周六
        return dayOfWeek !== 0 && dayOfWeek !== 6;
    }

    /**
     * 检查日期是否为周末
     * @param {string|Date} date - 日期
     * @returns {boolean}
     */
    static isWeekend(date) {
        return !this.isWorkday(date);
    }
}

/**
 * 边界条件处理器
 */
export class BoundaryConditionHandler {
    /**
     * 处理中午12点整点的特殊情况
     * @param {Object} record - 考勤记录
     * @returns {Object} 处理结果
     */
    static handleNoonBoundary(record) {
        const startTime = record.startTime || '09:00';
        const [hours, minutes] = startTime.split(':').map(Number);
        
        // 检查是否恰好是中午12点
        if (hours === 12 && minutes === 0) {
            return {
                isNoonBoundary: true,
                shouldShowOnStartDay: false, // 12点整点按照"12点后"处理
                recommendation: '中午12点整点建议按照"12点后开始"处理'
            };
        }
        
        return {
            isNoonBoundary: false,
            shouldShowOnStartDay: hours < 12 || (hours === 12 && minutes === 0)
        };
    }

    /**
     * 处理跨月跨年的考勤记录
     * @param {Object} record - 考勤记录
     * @returns {Object} 处理结果
     */
    static handleCrossMonthYear(record) {
        const startDate = new Date(record.date);
        const daysOffset = record.daysOffset || 0;
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + daysOffset);
        
        const crossMonth = startDate.getMonth() !== endDate.getMonth();
        const crossYear = startDate.getFullYear() !== endDate.getFullYear();
        
        return {
            crossMonth,
            crossYear,
            startMonth: startDate.getMonth() + 1,
            endMonth: endDate.getMonth() + 1,
            startYear: startDate.getFullYear(),
            endYear: endDate.getFullYear(),
            warning: crossMonth ? '考勤记录跨月，请注意月度统计' : null
        };
    }

    /**
     * 处理极端时长情况
     * @param {Object} record - 考勤记录
     * @returns {Object} 处理结果
     */
    static handleExtremeDuration(record) {
        const totalHours = (record.hours || 0) + (record.minutes || 0) / 60;
        const daysOffset = record.daysOffset || 0;
        
        const warnings = [];
        const errors = [];
        
        // 检查最小时长
        if (totalHours < 0.5 && record.type !== 'normal') {
            warnings.push('考勤时长少于30分钟，请确认是否正确');
        }
        
        // 检查最大时长
        if (totalHours > 24 * 7) {
            warnings.push('考勤时长超过7天，请确认是否正确');
        }
        
        if (totalHours > 24 * 30) {
            errors.push('考勤时长不能超过30天');
        }
        
        // 检查跨天逻辑一致性
        if (daysOffset > 0) {
            const expectedMinHours = daysOffset * 24;
            if (totalHours < expectedMinHours - 24) {
                warnings.push(`跨${daysOffset}天的记录时长可能偏少`);
            }
        }
        
        return {
            isExtreme: warnings.length > 0 || errors.length > 0,
            warnings,
            errors,
            totalHours,
            daysOffset
        };
    }
}

/**
 * 工具函数集合
 */
export const AttendanceDateUtils = {
    CrossDayDurationCalculator,
    DailyWorkHoursCalculator,
    TimeRangeValidator,
    BoundaryConditionHandler
};

export default AttendanceDateUtils;