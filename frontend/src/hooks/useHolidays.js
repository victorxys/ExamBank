import { useState, useEffect } from 'react';

/**
 * 节假日数据获取 Hook
 * 使用 https://timor.tech/api/holiday/year/{year} API
 */
export const useHolidays = (year) => {
    const [holidays, setHolidays] = useState({});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!year) return;

        const fetchHolidays = async () => {
            // 检查缓存
            const cacheKey = `holidays_${year}`;
            const cached = localStorage.getItem(cacheKey);
            
            if (cached) {
                try {
                    const cachedData = JSON.parse(cached);
                    // 检查缓存是否过期（24小时）
                    if (Date.now() - cachedData.timestamp < 24 * 60 * 60 * 1000) {
                        setHolidays(cachedData.data);
                        return;
                    }
                } catch (e) {
                    console.warn('Failed to parse cached holiday data:', e);
                }
            }

            setLoading(true);
            setError(null);

            try {
                const response = await fetch(`https://timor.tech/api/holiday/year/${year}`);
                
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                
                const data = await response.json();
                
                if (data.code === 0 && data.holiday) {
                    setHolidays(data.holiday);
                    
                    // 缓存数据
                    localStorage.setItem(cacheKey, JSON.stringify({
                        data: data.holiday,
                        timestamp: Date.now()
                    }));
                } else {
                    throw new Error('Invalid holiday data format');
                }
            } catch (err) {
                console.error('Failed to fetch holiday data:', err);
                setError(err.message);
                // 如果网络请求失败，尝试使用缓存数据
                if (cached) {
                    try {
                        const cachedData = JSON.parse(cached);
                        setHolidays(cachedData.data);
                    } catch (e) {
                        // 忽略缓存解析错误
                    }
                }
            } finally {
                setLoading(false);
            }
        };

        fetchHolidays();
    }, [year]);

    /**
     * 获取指定日期的节假日信息
     * @param {Date} date - 日期对象
     * @returns {Object|null} 节假日信息
     */
    const getHolidayInfo = (date) => {
        if (!date || !holidays) return null;
        
        const dateKey = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        return holidays[dateKey] || null;
    };

    /**
     * 判断是否为节假日
     * @param {Date} date - 日期对象
     * @returns {boolean}
     */
    const isHoliday = (date) => {
        const info = getHolidayInfo(date);
        return info ? info.holiday === true : false;
    };

    /**
     * 判断是否为补班日
     * @param {Date} date - 日期对象
     * @returns {boolean}
     */
    const isWorkday = (date) => {
        const info = getHolidayInfo(date);
        return info ? info.holiday === false : false;
    };

    /**
     * 获取节假日显示标签
     * @param {Date} date - 日期对象
     * @returns {Object|null} { text, type, name }
     */
    const getHolidayLabel = (date) => {
        const info = getHolidayInfo(date);
        if (!info) return null;

        if (info.holiday === true) {
            // 法定节假日
            return {
                text: '假',
                type: 'holiday',
                name: info.name,
                wage: info.wage
            };
        } else if (info.holiday === false) {
            // 补班日
            return {
                text: '班',
                type: 'workday',
                name: info.name,
                wage: info.wage
            };
        }

        return null;
    };

    return {
        holidays,
        loading,
        error,
        getHolidayInfo,
        isHoliday,
        isWorkday,
        getHolidayLabel
    };
};