import React, { useState, useEffect } from 'react';
import { DatePicker as AntdDatePicker } from 'antd-mobile';
import { Calendar } from './calendar';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Button } from './button';
import { cn } from '../../utils';
import { format } from 'date-fns';
import { zhCN as dateZhCN } from 'date-fns/locale';
import { zhCN } from 'react-day-picker/locale';
import { ChevronDownIcon, CalendarIcon } from 'lucide-react';

/**
 * 响应式日期选择器
 * - 手机端 (< 768px): 使用 antd-mobile DatePicker 滚筒选择器
 * - 桌面端 (>= 768px): 使用 shadcn Calendar + Popover (官方示例样式)
 */
const ResponsiveDatePicker = ({
    value,
    onChange,
    disabled = false,
    placeholder = '选择日期',
    className,
    minDate,
    maxDate
}) => {
    const [isMobile, setIsMobile] = useState(false);
    const [mobilePickerVisible, setMobilePickerVisible] = useState(false);
    const [popoverOpen, setPopoverOpen] = useState(false);
    
    // 检查是否有自定义高度类传入 (h-10, h-8, h-[38px] 等)
    const hasCustomHeight = className && /\bh-(\d+|\[)/.test(className);
    const baseButtonClasses = hasCustomHeight ? "text-sm" : "h-10 min-h-[2.5rem] px-3 py-2 text-sm";

    // 检测设备类型
    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth < 768);
        };
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    // 将 value 转换为 Date 对象
    const dateValue = value ? (typeof value === 'string' ? new Date(value) : value) : undefined;

    // 格式化显示
    const displayText = dateValue
        ? format(dateValue, 'yyyy年M月d日', { locale: dateZhCN })
        : placeholder;

    // 手机端处理
    const handleMobileConfirm = (val) => {
        onChange?.(val);
        setMobilePickerVisible(false);
    };

    // 桌面端处理
    const handleDesktopSelect = (date) => {
        onChange?.(date);
        setPopoverOpen(false);
    };

    // 手机端渲染 - antd-mobile 滚筒选择器
    if (isMobile) {
        return (
            <>
                <Button
                    variant="outline"
                    disabled={disabled}
                    className={cn(
                        "w-full justify-start text-left font-normal",
                        baseButtonClasses,
                        !dateValue && "text-muted-foreground",
                        className
                    )}
                    onClick={() => setMobilePickerVisible(true)}
                >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {displayText}
                </Button>
                <AntdDatePicker
                    visible={mobilePickerVisible}
                    onClose={() => setMobilePickerVisible(false)}
                    onConfirm={handleMobileConfirm}
                    value={dateValue}
                    min={minDate}
                    max={maxDate}
                    title="选择日期"
                    confirmText="确定"
                    cancelText="取消"
                />
            </>
        );
    }

    // 桌面端渲染 - shadcn 官方示例样式
    return (
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    disabled={disabled}
                    className={cn(
                        "w-full justify-between font-normal",
                        baseButtonClasses,
                        !dateValue && "text-muted-foreground",
                        className
                    )}
                >
                    {displayText}
                    <ChevronDownIcon className="h-4 w-4 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto overflow-hidden p-0" align="start">
                <Calendar
                    mode="single"
                    selected={dateValue}
                    captionLayout="dropdown"
                    locale={zhCN}
                    onSelect={handleDesktopSelect}
                />
            </PopoverContent>
        </Popover>
    );
};

export { ResponsiveDatePicker };
