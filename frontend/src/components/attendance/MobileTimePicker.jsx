import { useState } from 'react';
import { Picker } from 'antd-mobile';

/**
 * 滚筒式时间选择器组件
 * 使用 antd-mobile Picker 实现原生 iOS 风格的滚筒选择
 * 分钟步长固定为 30 分钟（00 和 30）
 * 支持 24:00 作为结束时间选项
 */
const MobileTimePicker = ({ value, onChange, disabled = false, onClose }) => {
    // 解析当前值，支持 24:00
    const [hourStr, minuteStr] = (value || '09:00').split(':');
    const hour = parseInt(hourStr, 10);
    const minute = parseInt(minuteStr, 10);

    // 生成选项（0-24小时，24:00 表示当天结束）
    const hours = Array.from({ length: 25 }, (_, i) => ({
        label: String(i).padStart(2, '0'),
        value: String(i).padStart(2, '0')
    }));

    // 分钟选项（24小时时只能选00）
    const getMinutesForHour = (h) => {
        if (h === '24') {
            return [{ label: '00', value: '00' }];
        }
        return [
            { label: '00', value: '00' },
            { label: '30', value: '30' }
        ];
    };

    // 当前选择的值
    const currentHour = String(hour).padStart(2, '0');
    const currentMinute = hour === 24 ? '00' : (minute >= 30 ? '30' : '00');
    const currentValue = [currentHour, currentMinute];

    // 动态生成分钟列
    const [selectedHour, setSelectedHour] = useState(currentHour);
    const minutes = getMinutesForHour(selectedHour);

    // 处理确认
    const handleConfirm = (val) => {
        if (val && val.length === 2) {
            // 如果选择了24小时，分钟强制为00
            const finalMinute = val[0] === '24' ? '00' : val[1];
            const finalValue = `${val[0]}:${finalMinute}`;
            if (onChange) {
                onChange(finalValue);
            }
        }
        if (onClose) {
            onClose();
        }
    };

    // 处理取消
    const handleCancel = () => {
        if (onClose) {
            onClose();
        }
    };

    // 处理选择变化（用于动态更新分钟列）
    const handleSelect = (val) => {
        if (val && val.length >= 1) {
            setSelectedHour(val[0]);
        }
    };

    if (disabled) {
        return (
            <div className="bg-gray-100 text-gray-500 text-center p-3 rounded-lg border border-gray-200 font-mono text-lg">
                {value || '00:00'}
            </div>
        );
    }

    return (
        <Picker
            columns={[hours, minutes]}
            visible={true}
            onClose={handleCancel}
            onConfirm={handleConfirm}
            onSelect={handleSelect}
            value={currentValue}
            confirmText="确定"
            cancelText="取消"
            title="选择时间"
        />
    );
};

export default MobileTimePicker;
