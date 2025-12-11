/**
 * 考勤显示逻辑核心模块
 * 
 * 实现考勤记录的跨天显示规则：
 * 1. 24小时规则：跨天记录中，某天的考勤时长等于24小时才显示对应考勤类型，否则显示"出勤"
 * 2. 中午12点规则：考勤记录在当天中午12点前开始则当天显示考勤类型，12点后开始则当天显示"出勤"，第二天显示考勤类型
 * 3. 短期考勤特殊处理：总时长不满24小时且首日12点后开始，则第二天显示考勤类型
 * 4. 规则优先级：中午12点规则优先于24小时规则
 */

import { format, isSameDay } from 'date-fns';

/**
 * 考勤显示逻辑处理器
 */
export class AttendanceDisplayLogic {
    // 静态缓存，用于存储计算结果
    static _cache = new Map();
    static _cacheMaxSize = 1000; // 最大缓存条目数
    
    /**
     * 清空缓存
     */
    static clearCache() {
        this._cache.clear();
    }
    
    /**
     * 生成缓存键
     * @param {string} targetDateStr - 目标日期
     * @param {Array} attendanceRecords - 考勤记录数组
     * @returns {string}
     */
    static _generateCacheKey(targetDateStr, attendanceRecords) {
        // 使用日期和记录的哈希值作为缓存键
        const recordsHash = attendanceRecords
            .map(r => `${r.date}_${r.type}_${r.startTime}_${r.endTime}_${r.daysOffset}`)
            .sort()
            .join('|');
        return `${targetDateStr}:${recordsHash}`;
    }
    
    /**
     * 从缓存获取或计算结果
     * @param {string} cacheKey - 缓存键
     * @param {Function} computeFn - 计算函数
     * @returns {*}
     */
    static _getOrCompute(cacheKey, computeFn) {
        // 检查缓存
        if (this._cache.has(cacheKey)) {
            return this._cache.get(cacheKey);
        }
        
        // 计算结果
        const result = computeFn();
        
        // 缓存管理：如果缓存过大，清理一半
        if (this._cache.size >= this._cacheMaxSize) {
            const keysToDelete = Array.from(this._cache.keys()).slice(0, Math.floor(this._cacheMaxSize / 2));
            keysToDelete.forEach(key => this._cache.delete(key));
        }
        
        // 存储到缓存
        this._cache.set(cacheKey, result);
        return result;
    }
    /**
     * 计算指定日期应该显示的考勤类型
     * @param {string} targetDateStr - 目标日期字符串 (YYYY-MM-DD)
     * @param {Array} attendanceRecords - 所有考勤记录数组
     * @returns {Object} 显示结果 { type: 'normal'|'rest'|'leave'|..., record: originalRecord }
     */
    static getDisplayTypeForDate(targetDateStr, attendanceRecords) {
        // 使用缓存优化性能
        const cacheKey = this._generateCacheKey(targetDateStr, attendanceRecords);
        
        return this._getOrCompute(cacheKey, () => {
            
            // 遍历所有考勤记录，找到覆盖目标日期的记录
            for (const record of attendanceRecords) {
                
                const isCovered = this.isDateCoveredByRecord(targetDateStr, record);
                
                if (isCovered) {
                    const shouldShowType = this.shouldShowAttendanceType(targetDateStr, record);
                    
                    if (shouldShowType) {
                        const result = {
                            type: record.type,
                            record: record,
                            typeLabel: this.getTypeLabel(record.type)
                        };
                        return result;
                    }
                }
            }
            
            // 没有找到覆盖的记录，返回正常出勤
            return {
                type: 'normal',
                record: null,
                typeLabel: '出勤'
            };
        });
    }

    /**
     * 判断指定日期是否被考勤记录覆盖
     * @param {string} targetDateStr - 目标日期字符串
     * @param {Object} record - 考勤记录
     * @returns {boolean}
     */
    static isDateCoveredByRecord(targetDateStr, record) {
        const targetDate = new Date(targetDateStr);
        const startDate = new Date(record.date);
        
        // 计算结束日期
        const daysOffset = record.daysOffset || 0;
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + daysOffset);
        
        
        // 检查目标日期是否在记录范围内（包括开始和结束日期）
        const targetTime = targetDate.getTime();
        const startTime = startDate.getTime();
        const endTime = endDate.getTime();
        
        const isCovered = targetTime >= startTime && targetTime <= endTime;
        
        return isCovered;
    }

    /**
     * 根据业务规则判断指定日期是否应该显示考勤类型
     * @param {string} targetDateStr - 目标日期字符串
     * @param {Object} record - 考勤记录
     * @returns {boolean}
     */
    static shouldShowAttendanceType(targetDateStr, record) {
        const targetDate = new Date(targetDateStr);
        const startDate = new Date(record.date);
        const daysOffset = record.daysOffset || 0;
        
        
        // 单天记录：直接显示
        if (daysOffset === 0) {
            return true;
        }
        
        // 跨天记录：应用业务规则
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + daysOffset);
        
        const isStartDay = isSameDay(targetDate, startDate);
        const isEndDay = isSameDay(targetDate, endDate);
        
        
        if (isStartDay) {
            // 开始日：出京、出境类型总是显示，其他类型应用中午12点规则
            if (record.type === 'out_of_beijing' || record.type === 'out_of_country') {
                return true;
            } else {
                // 其他类型应用中午12点规则
                const result = this.applyNoonRule(record);
                return result;
            }
        } else if (isEndDay) {
            // 结束日：出京、出境类型总是显示，其他类型应用24小时规则
            if (record.type === 'out_of_beijing' || record.type === 'out_of_country') {
                return true;
            } else {
                // 其他类型应用24小时规则和短期考勤特殊处理
                const result = this.applyEndDayRule(record);
                return result;
            }
        } else {
            // 中间日：需要检查是否是12点后开始的考勤的第二天
            const result = this.applyMiddleDayRule(record, targetDateStr);
            return result;
        }
    }

    /**
     * 应用中午12点规则
     * @param {Object} record - 考勤记录
     * @returns {boolean}
     */
    static applyNoonRule(record) {
        const startTime = record.startTime || '09:00';
        const [startHour, startMinute] = startTime.split(':').map(Number);
        const startTimeInMinutes = startHour * 60 + startMinute;
        const noonInMinutes = 12 * 60; // 中午12:00
        
        // 中午12点前开始：显示考勤类型
        // 中午12点后开始：显示"出勤"
        return startTimeInMinutes < noonInMinutes;
    }

    /**
     * 应用结束日规则（24小时规则 + 短期考勤特殊处理）
     * @param {Object} record - 考勤记录
     * @returns {boolean}
     */
    static applyEndDayRule(record) {
        const totalHours = (record.hours || 0) + (record.minutes || 0) / 60;
        const endTime = record.endTime || '18:00';
        const [endHour, endMinute] = endTime.split(':').map(Number);
        
        
        // 检查是否是12点后开始的考勤
        const startTime = record.startTime || '09:00';
        const [startHour, startMinute] = startTime.split(':').map(Number);
        const startTimeInMinutes = startHour * 60 + startMinute;
        const noonInMinutes = 12 * 60;
        const isAfterNoon = startTimeInMinutes >= noonInMinutes;
        
        
        // 【关键修复】对于12点后开始的考勤，结束日应该显示考勤类型（无论总时长和结束日时长）
        if (isAfterNoon) {
            return true;
        }
        
        // 对于12点前开始的考勤，应用传统的24小时规则
        if (totalHours < 24) {
            // 短期考勤：结束日按24小时规则处理
            const hoursOnEndDay = endHour + endMinute / 60;
            return hoursOnEndDay >= 24;
        } else {
            // 长期考勤：结束日按24小时规则处理
            const hoursOnEndDay = endHour + endMinute / 60;
            return hoursOnEndDay >= 24;
        }
    }

    /**
     * 应用中间日规则
     * @param {Object} record - 考勤记录
     * @param {string} targetDateStr - 目标日期字符串
     * @returns {boolean}
     */
    static applyMiddleDayRule(record, targetDateStr) {
        const startTime = record.startTime || '09:00';
        const [startHour, startMinute] = startTime.split(':').map(Number);
        const startTimeInMinutes = startHour * 60 + startMinute;
        const noonInMinutes = 12 * 60;
        
        
        // 如果是12点后开始的考勤
        if (startTimeInMinutes >= noonInMinutes) {
            const startDate = new Date(record.date);
            const targetDate = new Date(targetDateStr);
            const daysDiff = Math.floor((targetDate - startDate) / (1000 * 60 * 60 * 24));
            
            
            // 对于12点后开始的考勤，第二天（daysDiff === 1）应该显示考勤类型
            if (daysDiff === 1) {
                return true;
            }
            
            // 如果是更多天后，需要检查是否还在考勤范围内
            const daysOffset = record.daysOffset || 0;
            if (daysDiff <= daysOffset) {
                return true;
            }
            
            return false;
        }
        
        // 其他情况：中间日整天24小时，显示考勤类型
        return true;
    }

    /**
     * 获取考勤类型的显示标签
     * @param {string} type - 考勤类型
     * @returns {string}
     */
    static getTypeLabel(type) {
        const typeLabels = {
            'normal': '出勤',
            'rest': '休息',
            'leave': '请假',
            'overtime': '加班',
            'out_of_beijing': '出京',
            'out_of_country': '出境',
            'paid_leave': '带薪休假',
            'onboarding': '上户',
            'offboarding': '下户'
        };
        
        return typeLabels[type] || '出勤';
    }

    /**
     * 处理考勤记录去重合并
     * 同一客户同一员工的记录只保留最新的
     * @param {Array} records - 考勤记录数组
     * @returns {Array} 去重后的记录数组
     */
    static deduplicateRecords(records) {
        const recordsMap = new Map();
        
        records.forEach(record => {
            // 使用客户ID+员工ID+日期作为唯一键
            const uniqueKey = `${record.customer_id || 'unknown'}_${record.employee_id || 'unknown'}_${record.date}`;
            
            // 如果已存在相同键的记录，保留最新的（根据更新时间或创建时间）
            if (!recordsMap.has(uniqueKey)) {
                recordsMap.set(uniqueKey, record);
            } else {
                const existingRecord = recordsMap.get(uniqueKey);
                const existingTime = new Date(existingRecord.updated_at || existingRecord.created_at || 0);
                const currentTime = new Date(record.updated_at || record.created_at || 0);
                
                if (currentTime > existingTime) {
                    recordsMap.set(uniqueKey, record);
                }
            }
        });
        
        return Array.from(recordsMap.values());
    }

    /**
     * 计算跨天考勤的每日时长
     * @param {Object} record - 考勤记录
     * @param {string} targetDateStr - 目标日期
     * @returns {number} 该日期的工作时长（小时）
     */
    static calculateDailyHours(record, targetDateStr) {
        const targetDate = new Date(targetDateStr);
        const startDate = new Date(record.date);
        const daysOffset = record.daysOffset || 0;
        
        if (daysOffset === 0) {
            // 单天记录：返回总时长
            return (record.hours || 0) + (record.minutes || 0) / 60;
        }
        
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + daysOffset);
        
        const isStartDay = isSameDay(targetDate, startDate);
        const isEndDay = isSameDay(targetDate, endDate);
        
        if (isStartDay) {
            // 开始日：24 - 开始时间
            const startTime = record.startTime || '09:00';
            const [hours, minutes] = startTime.split(':').map(Number);
            const startHours = hours + minutes / 60;
            return 24 - startHours;
        } else if (isEndDay) {
            // 结束日：结束时间
            const endTime = record.endTime || '18:00';
            const [hours, minutes] = endTime.split(':').map(Number);
            return hours + minutes / 60;
        } else {
            // 中间日：整天24小时
            return 24;
        }
    }

    /**
     * 计算指定日期的实际出勤时长
     * 对于显示为"出勤"但有部分非出勤时间的日期，计算扣除非出勤时间后的实际出勤时长
     * @param {string} targetDateStr - 目标日期
     * @param {Array} attendanceRecords - 所有考勤记录数组
     * @returns {number} 实际出勤时长（小时）
     */
    static calculateActualWorkHours(targetDateStr, attendanceRecords) {
        // 上门服务员工：标准出勤时间是24小时
        const standardWorkHours = 24;
        
        // 定义各种考勤类型的性质
        const typeCategories = {
            // 非出勤类型：需要从24小时中扣除
            nonWork: ['rest', 'leave'],
            // 出勤类型：不扣除，仍算作出勤时间
            work: ['normal', 'paid_leave', 'out_of_beijing', 'out_of_country', 'onboarding', 'offboarding'],
            // 加班类型：额外出勤，应该加到24小时上
            overtime: ['overtime']
        };
        
        let totalNonWorkHours = 0;
        let totalOvertimeHours = 0;
        
        // 遍历所有考勤记录，计算该日期被各类型记录占用的时间
        for (const record of attendanceRecords) {
            if (this.isDateCoveredByRecord(targetDateStr, record)) {
                const dailyHours = this.calculateDailyHours(record, targetDateStr);
                
                if (record.type && typeCategories.nonWork.includes(record.type)) {
                    // 非出勤类型：从出勤时间中扣除
                    totalNonWorkHours += dailyHours;
                } else if (record.type && typeCategories.overtime.includes(record.type)) {
                    // 加班类型：额外增加出勤时间
                    totalOvertimeHours += dailyHours;
                } else if (record.type && typeCategories.work.includes(record.type)) {
                    // 出勤类型：不影响基础24小时出勤时间
                }
            }
        }
        
        // 实际出勤时长 = 标准24小时 - 非出勤时长 + 加班时长
        const actualWorkHours = Math.max(0, standardWorkHours - totalNonWorkHours + totalOvertimeHours);
        
        
        return actualWorkHours;
    }

    /**
     * 判断指定日期是否为该考勤记录第一个显示考勤类型的日期
     * @param {string} targetDateStr - 目标日期字符串
     * @param {Object} record - 考勤记录
     * @param {Array} allRecords - 所有考勤记录数组（用于计算显示逻辑）
     * @returns {boolean}
     */
    static isFirstDisplayDay(targetDateStr, record, allRecords) {
        const targetDate = new Date(targetDateStr);
        const startDate = new Date(record.date);
        const daysOffset = record.daysOffset || 0;
        
        
        // 单天记录：开始日就是第一个显示日
        if (daysOffset === 0) {
            const isStartDay = isSameDay(targetDate, startDate);
            return isStartDay;
        }
        
        // 跨天记录：找到第一个应该显示考勤类型的日期
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + daysOffset);
        
        // 遍历记录覆盖的所有日期，找到第一个应该显示考勤类型的日期
        let currentDate = new Date(startDate);
        while (currentDate <= endDate) {
            const currentDateStr = format(currentDate, 'yyyy-MM-dd');
            const shouldShow = this.shouldShowAttendanceType(currentDateStr, record);
            
            
            if (shouldShow) {
                // 找到第一个应该显示的日期
                const isFirstDay = isSameDay(targetDate, currentDate);
                return isFirstDay;
            }
            
            currentDate.setDate(currentDate.getDate() + 1);
        }
        
        // 如果没有找到应该显示的日期，返回false
        return false;
    }

    /**
     * 验证考勤记录的时间有效性
     * @param {Object} record - 考勤记录
     * @returns {Object} { isValid: boolean, errors: string[] }
     */
    static validateRecord(record) {
        const errors = [];
        
        // 检查必要字段
        if (!record.date) {
            errors.push('缺少日期信息');
        }
        
        if (!record.type) {
            errors.push('缺少考勤类型');
        }
        
        // 检查时间格式
        const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (record.startTime && !timeRegex.test(record.startTime)) {
            errors.push('开始时间格式无效');
        }
        
        if (record.endTime && !timeRegex.test(record.endTime)) {
            errors.push('结束时间格式无效');
        }
        
        // 检查时长逻辑
        if (record.hours !== undefined && record.hours < 0) {
            errors.push('工作时长不能为负数');
        }
        
        if (record.minutes !== undefined && (record.minutes < 0 || record.minutes >= 60)) {
            errors.push('分钟数必须在0-59之间');
        }
        
        // 检查跨天逻辑
        if (record.daysOffset !== undefined && record.daysOffset < 0) {
            errors.push('天数偏移不能为负数');
        }
        
        return {
            isValid: errors.length === 0,
            errors: errors
        };
    }
}

/**
 * 24小时规则处理器
 */
export class TwentyFourHourRuleProcessor {
    /**
     * 检查指定日期是否满足24小时规则
     * @param {string} targetDateStr - 目标日期
     * @param {Object} record - 考勤记录
     * @returns {boolean}
     */
    static checkTwentyFourHourRule(targetDateStr, record) {
        const dailyHours = AttendanceDisplayLogic.calculateDailyHours(record, targetDateStr);
        return dailyHours >= 24;
    }
}

/**
 * 中午12点规则处理器
 */
export class NoonRuleProcessor {
    /**
     * 检查考勤记录是否满足中午12点规则
     * @param {Object} record - 考勤记录
     * @returns {boolean}
     */
    static checkNoonRule(record) {
        return AttendanceDisplayLogic.applyNoonRule(record);
    }
}

/**
 * 跨天记录处理器
 */
export class MultiDayRecordProcessor {
    /**
     * 处理跨天记录，生成每日显示数据
     * @param {Object} record - 考勤记录
     * @returns {Array} 每日显示数据数组
     */
    static processMultiDayRecord(record) {
        const startDate = new Date(record.date);
        const daysOffset = record.daysOffset || 0;
        const dailyData = [];
        
        for (let i = 0; i <= daysOffset; i++) {
            const currentDate = new Date(startDate);
            currentDate.setDate(startDate.getDate() + i);
            const dateStr = format(currentDate, 'yyyy-MM-dd');
            
            const shouldShow = AttendanceDisplayLogic.shouldShowAttendanceType(dateStr, record);
            const dailyHours = AttendanceDisplayLogic.calculateDailyHours(record, dateStr);
            
            dailyData.push({
                date: dateStr,
                type: shouldShow ? record.type : 'normal',
                typeLabel: shouldShow ? AttendanceDisplayLogic.getTypeLabel(record.type) : '出勤',
                hours: dailyHours,
                originalRecord: record
            });
        }
        
        return dailyData;
    }
}

export default AttendanceDisplayLogic;