import React, { useState, useEffect, useMemo } from 'react';
import { Picker } from 'antd-mobile';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Button } from './button';
import { cn } from '../../utils';
import { Clock } from 'lucide-react';

/**
 * 响应式时间选择器
 * - 手机端 (< 768px): 使用 antd-mobile Picker 滚筒选择器
 * - 桌面端 (>= 768px): 使用 Popover + 时间网格
 */
const ResponsiveTimePicker = ({
    value = '09:00',
    onChange,
    disabled = false,
    placeholder = '选择时间',
    className,
    minuteStep = 30  // 分钟步长，默认30分钟
}) => {
    const [isMobile, setIsMobile] = useState(false);
    const [mobilePickerVisible, setMobilePickerVisible] = useState(false);
    const [popoverOpen, setPopoverOpen] = useState(false);

    // 检测设备类型
    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth < 768);
        };
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    // 解析当前值
    const [hour, minute] = (value || '09:00').split(':').map(Number);

    // 生成小时选项 (00-23)
    const hours = useMemo(() =>
        Array.from({ length: 24 }, (_, i) => ({
            label: String(i).padStart(2, '0'),
            value: String(i).padStart(2, '0')
        })),
        []);

    // 生成分钟选项 (根据步长)
    const minutes = useMemo(() => {
        const result = [];
        for (let i = 0; i < 60; i += minuteStep) {
            result.push({
                label: String(i).padStart(2, '0'),
                value: String(i).padStart(2, '0')
            });
        }
        return result;
    }, [minuteStep]);

    // 当前选择值 (用于 antd-mobile Picker)
    const currentPickerValue = [
        String(hour).padStart(2, '0'),
        // 向下取整到最近的步长
        String(Math.floor(minute / minuteStep) * minuteStep).padStart(2, '0')
    ];

    // 手机端确认
    const handleMobileConfirm = (val) => {
        if (val && val.length === 2) {
            onChange?.(`${val[0]}:${val[1]}`);
        }
        setMobilePickerVisible(false);
    };

    // 桌面端选择
    const handleDesktopSelect = (h, m) => {
        onChange?.(`${h}:${m}`);
        setPopoverOpen(false);
    };

    // 触发器按钮
    const triggerButton = (
        <Button
            variant="outline"
            disabled={disabled}
            className={cn(
                "w-full justify-start text-left font-mono",
                className
            )}
            onClick={isMobile ? () => setMobilePickerVisible(true) : undefined}
        >
            <Clock className="mr-2 h-4 w-4" />
            {value || placeholder}
        </Button>
    );

    // 手机端渲染
    if (isMobile) {
        return (
            <>
                {triggerButton}
                <Picker
                    columns={[hours, minutes]}
                    visible={mobilePickerVisible}
                    onClose={() => setMobilePickerVisible(false)}
                    onConfirm={handleMobileConfirm}
                    value={currentPickerValue}
                    title="选择时间"
                    confirmText="确定"
                    cancelText="取消"
                />
            </>
        );
    }

    // 桌面端渲染 - 时间网格选择器
    return (
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
                {triggerButton}
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
                <div className="flex h-64 divide-x divide-gray-100">
                    {/* 小时列 */}
                    <div className="w-20 overflow-y-auto p-2">
                        <div className="text-xs text-gray-400 text-center mb-2 sticky top-0 bg-white/95 backdrop-blur py-1 z-10 font-medium">
                            时
                        </div>
                        {hours.map(h => (
                            <div
                                key={h.value}
                                onClick={() => handleDesktopSelect(h.value, currentPickerValue[1])}
                                className={cn(
                                    "p-2 text-center rounded-lg cursor-pointer text-sm mb-1 transition-all font-mono",
                                    String(hour).padStart(2, '0') === h.value
                                        ? "bg-primary text-primary-foreground font-bold"
                                        : "hover:bg-gray-100 text-gray-600"
                                )}
                            >
                                {h.label}
                            </div>
                        ))}
                    </div>
                    {/* 分钟列 */}
                    <div className="w-20 overflow-y-auto p-2">
                        <div className="text-xs text-gray-400 text-center mb-2 sticky top-0 bg-white/95 backdrop-blur py-1 z-10 font-medium">
                            分
                        </div>
                        {minutes.map(m => (
                            <div
                                key={m.value}
                                onClick={() => handleDesktopSelect(currentPickerValue[0], m.value)}
                                className={cn(
                                    "p-2 text-center rounded-lg cursor-pointer text-sm mb-1 transition-all font-mono",
                                    currentPickerValue[1] === m.value
                                        ? "bg-primary text-primary-foreground font-bold"
                                        : "hover:bg-gray-100 text-gray-600"
                                )}
                            >
                                {m.label}
                            </div>
                        ))}
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
};

export { ResponsiveTimePicker };
