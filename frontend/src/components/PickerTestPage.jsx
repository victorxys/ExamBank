import React, { useState } from 'react';
import { ResponsiveDatePicker } from './ui/ResponsiveDatePicker';
import { ResponsiveTimePicker } from './ui/ResponsiveTimePicker';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';

/**
 * 测试页面 - 用于验证响应式日期/时间选择器
 */
const PickerTestPage = () => {
    const [selectedDate, setSelectedDate] = useState(null);
    const [selectedTime, setSelectedTime] = useState('09:00');

    return (
        <div className="min-h-screen bg-gray-50 p-4">
            <Card className="max-w-md mx-auto">
                <CardHeader>
                    <CardTitle>日期/时间选择器测试</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    {/* 日期选择器测试 */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">
                            选择日期
                        </label>
                        <ResponsiveDatePicker
                            value={selectedDate}
                            onChange={setSelectedDate}
                            placeholder="请选择日期"
                        />
                        <p className="text-xs text-gray-500">
                            当前值: {selectedDate ? selectedDate.toISOString() : '未选择'}
                        </p>
                    </div>

                    {/* 时间选择器测试 */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">
                            选择时间
                        </label>
                        <ResponsiveTimePicker
                            value={selectedTime}
                            onChange={setSelectedTime}
                            minuteStep={30}
                        />
                        <p className="text-xs text-gray-500">
                            当前值: {selectedTime}
                        </p>
                    </div>

                    {/* 设备检测提示 */}
                    <div className="border-t pt-4">
                        <p className="text-xs text-gray-400">
                            调整浏览器窗口宽度，小于 768px 将显示滚筒选择器，大于等于 768px 将显示弹出框选择器。
                        </p>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default PickerTestPage;
