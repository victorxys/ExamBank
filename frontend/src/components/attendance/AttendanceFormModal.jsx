import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../ui/dialog';
import { Button } from '../ui/button';
import { Calendar } from '../ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { format, isSameDay, parseISO } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { Calendar as CalendarIcon, Clock, Save, Send } from 'lucide-react';
import { cn } from '../../utils';
import api from '../../api/axios';

// 考勤类型定义
const ATTENDANCE_TYPES = {
    REST: { label: '休息', color: 'bg-blue-100 text-blue-800', value: 'rest' },
    LEAVE: { label: '请假', color: 'bg-yellow-100 text-yellow-800', value: 'leave' },
    OVERTIME: { label: '加班', color: 'bg-green-100 text-green-800', value: 'overtime' },
    OUT_OF_BEIJING: { label: '出京', color: 'bg-purple-100 text-purple-800', value: 'out_of_beijing' },
    OUT_OF_COUNTRY: { label: '出境', color: 'bg-pink-100 text-pink-800', value: 'out_of_country' },
    PAID_LEAVE: { label: '带薪休假', color: 'bg-indigo-100 text-indigo-800', value: 'paid_leave' },
};

const AttendanceFormModal = ({ isOpen, onClose, contractId, employeeId, cycleStartDate, cycleEndDate, initialToken }) => {
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [attendanceData, setAttendanceData] = useState({
        rest_records: [],
        leave_records: [],
        overtime_records: [],
        beijing_records: [],
        country_records: [],
        paid_leave_records: []
    });
    const [loading, setLoading] = useState(false);
    const [token, setToken] = useState(initialToken);
    const [formStatus, setFormStatus] = useState('draft');
    const [customerLink, setCustomerLink] = useState('');

    // 当前选中的操作类型
    const [currentType, setCurrentType] = useState('REST');
    // 当前选中的时长 (小时:分钟)
    const [hours, setHours] = useState(24);
    const [minutes, setMinutes] = useState(0);

    useEffect(() => {
        if (isOpen) {
            if (employeeId) {
                setToken(employeeId);
                fetchAttendanceData(employeeId);
            } else if (initialToken) {
                setToken(initialToken);
                fetchAttendanceData(initialToken);
            }
        }
    }, [isOpen, employeeId, initialToken]);

    const fetchAttendanceData = async (t = token) => {
        try {
            setLoading(true);
            const response = await api.get(`/attendance-forms/by-token/${t}`);
            const data = response.data;
            if (data.form_data) {
                // 合并默认值，防止 undefined
                setAttendanceData({
                    rest_records: [],
                    leave_records: [],
                    overtime_records: [],
                    beijing_records: [],
                    country_records: [],
                    paid_leave_records: [],
                    ...data.form_data
                });
            }
            setFormStatus(data.status);
            if (data.customer_signature_token) {
                setCustomerLink(`${window.location.origin}/attendance-sign/${data.customer_signature_token}`);
            }
        } catch (error) {
            console.error("Failed to fetch attendance data", error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        try {
            setLoading(true);
            await api.put(`/attendance-forms/by-token/${token}`, {
                form_data: attendanceData
            });
            // alert("保存成功");
        } catch (error) {
            console.error("Failed to save", error);
            alert("保存失败");
        } finally {
            setLoading(false);
        }
    };

    const handleConfirm = async () => {
        if (!window.confirm("确认后将生成客户签署链接，是否继续？")) return;
        try {
            setLoading(true);
            const response = await api.put(`/attendance-forms/by-token/${token}`, {
                form_data: attendanceData,
                action: 'confirm'
            });
            setFormStatus(response.data.status);
            if (response.data.customer_signature_token) {
                setCustomerLink(`${window.location.origin}/attendance-sign/${response.data.customer_signature_token}`);
            }
        } catch (error) {
            console.error("Failed to confirm", error);
            alert("确认失败");
        } finally {
            setLoading(false);
        }
    };

    const handleDateSelect = (date) => {
        if (!date) return;
        setSelectedDate(date);
        // 可以在这里回显该日期的记录到输入框?
        // 简单起见，我们只在日历上显示标记，点击日期只是为了添加记录
    };

    const addRecord = () => {
        if (!selectedDate) return;
        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        const typeKey = ATTENDANCE_TYPES[currentType].value; // e.g., 'rest'
        const recordKey = `${typeKey}_records`; // e.g., 'rest_records'

        const newRecord = {
            date: dateStr,
            hours: parseInt(hours),
            minutes: parseInt(minutes),
            type: typeKey
        };

        setAttendanceData(prev => {
            // 检查是否存在同日期的同类型记录，如果有则更新，否则添加
            // 或者允许同一天有多条? 通常同一天同一类型只有一条。
            // 但同一天可能有"请假"和"加班"?
            // 让我们先简单处理: 过滤掉同日期的同类型记录，然后添加新的
            const list = prev[recordKey] || [];
            const filtered = list.filter(r => r.date !== dateStr);
            return {
                ...prev,
                [recordKey]: [...filtered, newRecord]
            };
        });
    };

    const removeRecord = (dateStr, typeKey) => {
        const recordKey = `${typeKey}_records`;
        setAttendanceData(prev => ({
            ...prev,
            [recordKey]: (prev[recordKey] || []).filter(r => r.date !== dateStr)
        }));
    };

    // 渲染日历修饰符
    const modifiers = {};
    const modifiersStyles = {};

    Object.keys(ATTENDANCE_TYPES).forEach(key => {
        const type = ATTENDANCE_TYPES[key];
        const recordKey = `${type.value}_records`;
        const dates = (attendanceData[recordKey] || []).map(r => parseISO(r.date));
        if (dates.length > 0) {
            modifiers[type.value] = dates;
            // modifiersStyles[type.value] = { backgroundColor: 'var(--color-primary)' }; // 使用 classNames 代替 styles
        }
    });

    // 自定义日历渲染
    // 由于 react-day-picker 的 modifiersClassNames 需要在 CSS 中定义，或者使用 tailwind 类
    // 我们在 Calendar 组件中已经传递了 classNames。
    // 这里我们可以通过 modifiersClassNames 传递 tailwind 类
    const modifiersClassNames = {
        rest: "bg-blue-100 text-blue-800 font-bold",
        leave: "bg-yellow-100 text-yellow-800 font-bold",
        overtime: "bg-green-100 text-green-800 font-bold",
        out_of_beijing: "bg-purple-100 text-purple-800 font-bold",
        out_of_country: "bg-pink-100 text-pink-800 font-bold",
        paid_leave: "bg-indigo-100 text-indigo-800 font-bold"
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0 gap-0">
                <DialogHeader className="p-6 pb-2 border-b">
                    <DialogTitle>电子考勤表 ({formStatus === 'draft' ? '草稿' : formStatus})</DialogTitle>
                    <DialogDescription>
                        请在日历上选择日期并添加考勤记录。
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 flex overflow-hidden">
                    {/* 左侧：日历与操作 */}
                    <div className="w-1/2 p-6 border-r overflow-y-auto">
                        <div className="mb-4 flex items-center justify-between">
                            <h3 className="font-medium">选择日期并添加记录</h3>
                        </div>

                        <div className="flex justify-center mb-6">
                            <Calendar
                                mode="single"
                                selected={selectedDate}
                                onSelect={handleDateSelect}
                                modifiers={modifiers}
                                modifiersClassNames={modifiersClassNames}
                                locale={zhCN}
                                className="rounded-md border shadow"
                            />
                        </div>

                        <div className="space-y-4">
                            <div className="flex flex-wrap gap-2">
                                {Object.keys(ATTENDANCE_TYPES).map(key => (
                                    <Button
                                        key={key}
                                        variant={currentType === key ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => setCurrentType(key)}
                                        className={cn(
                                            currentType === key ? "" : "hover:bg-accent",
                                            currentType === key ? "" : ATTENDANCE_TYPES[key].color.split(' ')[0] // 浅色背景提示
                                        )}
                                    >
                                        {ATTENDANCE_TYPES[key].label}
                                    </Button>
                                ))}
                            </div>

                            <div className="flex items-center gap-4 p-4 border rounded-lg bg-slate-50">
                                <div className="flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-muted-foreground" />
                                    <span className="text-sm font-medium">时长:</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        min="0"
                                        max="24"
                                        value={hours}
                                        onChange={e => setHours(e.target.value)}
                                        className="w-16 p-1 border rounded text-center"
                                    />
                                    <span className="text-sm">小时</span>
                                    <input
                                        type="number"
                                        min="0"
                                        max="59"
                                        value={minutes}
                                        onChange={e => setMinutes(e.target.value)}
                                        className="w-16 p-1 border rounded text-center"
                                    />
                                    <span className="text-sm">分钟</span>
                                </div>
                                <Button onClick={addRecord} size="sm">添加/更新</Button>
                            </div>
                        </div>
                    </div>

                    {/* 右侧：明细列表 */}
                    <div className="w-1/2 p-6 overflow-y-auto bg-slate-50/50">
                        <h3 className="font-medium mb-4">本月考勤明细</h3>

                        <div className="space-y-6">
                            {Object.keys(ATTENDANCE_TYPES).map(key => {
                                const type = ATTENDANCE_TYPES[key];
                                const recordKey = `${type.value}_records`;
                                const records = attendanceData[recordKey] || [];

                                if (records.length === 0) return null;

                                return (
                                    <div key={key} className="space-y-2">
                                        <h4 className={cn("text-sm font-semibold px-2 py-1 rounded w-fit", type.color)}>
                                            {type.label} ({records.length}条)
                                        </h4>
                                        <div className="grid grid-cols-2 gap-2">
                                            {records.sort((a, b) => a.date.localeCompare(b.date)).map((r, idx) => (
                                                <div key={idx} className="flex items-center justify-between p-2 bg-white border rounded text-sm shadow-sm group">
                                                    <span>{r.date}</span>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-muted-foreground">{r.hours}h {r.minutes}m</span>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-6 w-6 opacity-0 group-hover:opacity-100 text-destructive"
                                                            onClick={() => removeRecord(r.date, type.value)}
                                                        >
                                                            &times;
                                                        </Button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}

                            {Object.values(attendanceData).every(arr => !arr || arr.length === 0) && (
                                <div className="text-center text-muted-foreground py-10">
                                    暂无记录，请在左侧选择日期添加
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <DialogFooter className="p-6 border-t bg-white">
                    {customerLink && (
                        <div className="flex-1 flex items-center gap-2 mr-4 overflow-hidden">
                            <span className="text-sm font-medium whitespace-nowrap">签署链接:</span>
                            <code className="text-xs bg-slate-100 p-1 rounded flex-1 overflow-hidden text-ellipsis">{customerLink}</code>
                            <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(customerLink)}>复制</Button>
                        </div>
                    )}
                    <Button variant="outline" onClick={handleSave} disabled={loading}>
                        <Save className="w-4 h-4 mr-2" />
                        保存草稿
                    </Button>
                    <Button onClick={handleConfirm} disabled={loading || formStatus !== 'draft'}>
                        <Send className="w-4 h-4 mr-2" />
                        {formStatus === 'draft' ? '确认并生成链接' : '已确认'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default AttendanceFormModal;
