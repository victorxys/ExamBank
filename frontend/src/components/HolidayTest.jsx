import React from 'react';
import { useHolidays } from '../hooks/useHolidays';

const HolidayTest = () => {
    const { holidays, loading, error, getHolidayLabel } = useHolidays(2025);

    // 测试几个日期
    const testDates = [
        new Date(2025, 0, 1),  // 元旦
        new Date(2025, 1, 3),  // 春节前调休（可能的补班日）
        new Date(2025, 1, 10), // 春节
        new Date(2025, 3, 5),  // 清明节
        new Date(2025, 4, 1),  // 劳动节
        new Date(2025, 5, 2),  // 端午节
        new Date(2025, 8, 15), // 中秋节
        new Date(2025, 9, 1),  // 国庆节
    ];

    if (loading) return <div className="p-4">加载节假日数据中...</div>;
    if (error) return <div className="p-4 text-red-600">错误: {error}</div>;

    return (
        <div className="p-4 max-w-2xl mx-auto">
            <h1 className="text-2xl font-bold mb-4">2025年节假日测试</h1>
            
            <div className="mb-6">
                <h2 className="text-lg font-semibold mb-2">原始数据:</h2>
                <pre className="bg-gray-100 p-2 rounded text-sm overflow-auto max-h-40">
                    {JSON.stringify(holidays, null, 2)}
                </pre>
            </div>

            <div>
                <h2 className="text-lg font-semibold mb-2">测试日期:</h2>
                <div className="grid gap-2">
                    {testDates.map((date, index) => {
                        const label = getHolidayLabel(date);
                        return (
                            <div key={index} className="flex items-center justify-between p-2 border rounded">
                                <span>{date.toLocaleDateString('zh-CN')}</span>
                                <div className="flex items-center gap-2">
                                    {label ? (
                                        <>
                                            <span className={`px-2 py-1 rounded text-xs font-bold ${
                                                label.type === 'holiday' 
                                                    ? 'bg-red-500 text-white' 
                                                    : 'bg-blue-500 text-white'
                                            }`}>
                                                {label.text}
                                            </span>
                                            <span className="text-sm text-gray-600">{label.name}</span>
                                        </>
                                    ) : (
                                        <span className="text-gray-400">普通日期</span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default HolidayTest;