import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { format, parseISO, addDays, setHours, setMinutes, isSameDay, startOfDay } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import api from '../../api/axios';
import { useToast } from '../ui/use-toast';
import { Loader2, CheckCircle2, AlertCircle, Save, Send, X, Clock, ChevronRight, ChevronLeft, ArrowRight, Copy, Check, Share2, Eraser } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "../../utils";
import SignatureCanvas from 'react-signature-canvas';
import MobileTimePicker from './MobileTimePicker';

// Helper function to format duration
const formatDuration = (hours, minutes = 0) => {
    const totalHours = hours + minutes / 60;
    if (totalHours < 24) {
        // Less than 24 hours: show hours with 2 decimal places
        return `${totalHours.toFixed(2)}小时`;
    } else {
        // 24 hours or more: show as days with 3 decimal places
        const days = (totalHours / 24).toFixed(3);
        return `${days}天`;
    }
};

const ATTENDANCE_TYPES = {
    NORMAL: { label: '正常出勤', color: 'bg-gray-100 text-gray-800', value: 'normal', border: 'border-l-gray-200' },
    REST: { label: '休息', color: 'bg-blue-100 text-blue-800', value: 'rest', border: 'border-l-blue-400' },
    LEAVE: { label: '请假', color: 'bg-yellow-100 text-yellow-800', value: 'leave', border: 'border-l-yellow-400' },
    OVERTIME: { label: '加班', color: 'bg-green-100 text-green-800', value: 'overtime', border: 'border-l-green-400' },
    OUT_OF_BEIJING: { label: '出京', color: 'bg-purple-100 text-purple-800', value: 'out_of_beijing', border: 'border-l-purple-400' },
    OUT_OF_COUNTRY: { label: '出境', color: 'bg-pink-100 text-pink-800', value: 'out_of_country', border: 'border-l-pink-400' },
    PAID_LEAVE: { label: '带薪休假', color: 'bg-indigo-100 text-indigo-800', value: 'paid_leave', border: 'border-l-indigo-400' },
    ONBOARDING: { label: '上户', color: 'bg-cyan-100 text-cyan-800', value: 'onboarding', border: 'border-l-cyan-400' },
    OFFBOARDING: { label: '下户', color: 'bg-rose-100 text-rose-800', value: 'offboarding', border: 'border-l-rose-400' },
};

// Custom TimePicker Component
const TimePicker = ({ value, onChange, disabled }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [hour, minute] = (value || '00:00').split(':');
    // Generate a unique ID prefix for this instance to avoid conflicts
    const idPrefix = useMemo(() => Math.random().toString(36).substr(2, 9), []);

    // Generate hours (00-23) and minutes (00, 10, 20, 30, 40, 50)
    const hours = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));
    const minutes = Array.from({ length: 6 }, (_, i) => (i * 10).toString().padStart(2, '0'));

    // Scroll to selected item when popover opens
    useEffect(() => {
        if (isOpen) {
            // Simple timeout to ensure DOM is ready
            setTimeout(() => {
                const hourEl = document.getElementById(`${idPrefix}-hour-${hour}`);
                const minuteEl = document.getElementById(`${idPrefix}-minute-${minute}`);
                hourEl?.scrollIntoView({ block: 'center' });
                minuteEl?.scrollIntoView({ block: 'center' });
            }, 0);
        }
    }, [isOpen, hour, minute, idPrefix]);

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen} modal={true}>
            <PopoverTrigger asChild>
                <button
                    disabled={disabled}
                    className={cn(
                        "w-full p-3 bg-white border border-gray-200 rounded-xl flex items-center justify-center gap-2 text-lg font-mono transition-all outline-none",
                        disabled ? "opacity-50 cursor-not-allowed bg-gray-50 text-gray-500" : "hover:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 text-gray-900",
                        isOpen && "border-indigo-500 ring-2 ring-indigo-500/20"
                    )}
                >
                    <Clock className={cn("w-4 h-4", disabled ? "text-gray-400" : "text-gray-500")} />
                    <span className="font-bold">{value}</span>
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 bg-white shadow-xl rounded-xl border border-gray-100" align="center">
                <div className="flex h-64 divide-x divide-gray-100">
                    {/* Hours Column */}
                    <div className="w-20 overflow-y-auto p-2 scrollbar-hide">
                        <div className="text-xs text-gray-400 text-center mb-2 sticky top-0 bg-white/95 backdrop-blur py-1 z-10 font-medium">时</div>
                        {hours.map(h => (
                            <div
                                key={h}
                                id={`${idPrefix}-hour-${h}`}
                                onClick={() => {
                                    onChange(`${h}:${minute}`);
                                }}
                                className={cn(
                                    "p-2 text-center rounded-lg cursor-pointer text-sm mb-1 transition-all font-mono",
                                    hour === h ? "bg-black text-white font-bold shadow-sm" : "hover:bg-gray-100 text-gray-600"
                                )}
                            >
                                {h}
                            </div>
                        ))}
                    </div>
                    {/* Minutes Column */}
                    <div className="w-20 overflow-y-auto p-2 scrollbar-hide">
                        <div className="text-xs text-gray-400 text-center mb-2 sticky top-0 bg-white/95 backdrop-blur py-1 z-10 font-medium">分</div>
                        {minutes.map(m => (
                            <div
                                key={m}
                                id={`${idPrefix}-minute-${m}`}
                                onClick={() => {
                                    onChange(`${hour}:${m}`);
                                    // Optional: Close on minute selection if desired, but keeping open allows adjustment
                                }}
                                className={cn(
                                    "p-2 text-center rounded-lg cursor-pointer text-sm mb-1 transition-all font-mono",
                                    minute === m ? "bg-black text-white font-bold shadow-sm" : "hover:bg-gray-100 text-gray-600"
                                )}
                            >
                                {m}
                            </div>
                        ))}
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
};

const AttendanceFillPage = ({ mode = 'employee' }) => {
    const { token } = useParams();
    const navigate = useNavigate();
    const { toast } = useToast();
    const location = useLocation();

    // 判断是否为客户签署模式
    const isCustomerMode = mode === 'customer' || location.pathname.includes('/attendance-sign/');
    // 判断是否为管理员查看模式
    const isAdminView = mode === 'admin_view';

    // Loading & Form State
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    // Parse token to handle optional year/month suffix (e.g., UUID_2025_11)
    const { realToken, initialYear, initialMonth } = useMemo(() => {
        if (!token) return { realToken: '', initialYear: null, initialMonth: null };

        // Check if token matches UUID_YYYY_MM format
        const parts = token.split('_');
        if (parts.length === 3 && parts[0].length === 36) {
            // Assume format is UUID_YYYY_MM
            return {
                realToken: parts[0],
                initialYear: parseInt(parts[1], 10),
                initialMonth: parseInt(parts[2], 10)
            };
        }
        return { realToken: token, initialYear: null, initialMonth: null };
    }, [token]);

    // Month selection state (default to token suffix or last month)
    const getLastMonth = () => {
        const now = new Date();
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        return { year: lastMonth.getFullYear(), month: lastMonth.getMonth() + 1 };
    };

    const [selectedYear, setSelectedYear] = useState(() => initialYear || getLastMonth().year);
    const [selectedMonth, setSelectedMonth] = useState(() => initialMonth || getLastMonth().month);

    // Update selected year/month if token changes and has suffix
    useEffect(() => {
        if (initialYear && initialMonth) {
            setSelectedYear(initialYear);
            setSelectedMonth(initialMonth);
        }
    }, [initialYear, initialMonth]);

    const [formData, setFormData] = useState(null);
    const [attendanceData, setAttendanceData] = useState({
        rest_records: [],
        leave_records: [],
        overtime_records: [],
        out_of_beijing_records: [],
        out_of_country_records: [],
        paid_leave_records: [],
        onboarding_records: [],
        offboarding_records: []
    });
    const [monthDays, setMonthDays] = useState([]);
    const [contractInfo, setContractInfo] = useState(null);

    // First/Last Month Logic
    const isFirstMonth = useMemo(() => {
        if (!contractInfo?.start_date || !formData?.cycle_start_date) return false;
        // If contract starts AFTER the cycle start date, it's the first month (or partial month)
        return parseISO(contractInfo.start_date) > parseISO(formData.cycle_start_date);
    }, [contractInfo, formData]);

    const isLastMonth = useMemo(() => {
        if (!contractInfo || !formData?.cycle_end_date) return false;

        // 对于自动月签合同，只有在合同终止时才有"最后一个月"
        if (contractInfo.is_monthly_auto_renew) {
            // 合同未终止，永远不是最后一个月
            if (contractInfo.status !== 'terminated' || !contractInfo.termination_date) {
                return false;
            }
            // 合同已终止，使用终止日期判断
            const terminationDate = parseISO(contractInfo.termination_date);
            const cycleEndDate = parseISO(formData.cycle_end_date);
            // 如果终止日期在考勤周期内，则是最后一个月
            return terminationDate < cycleEndDate;
        }

        // 非自动月签合同，使用原来的逻辑
        if (!contractInfo.end_date) return false;
        // If contract ends BEFORE the cycle end date, it's the last month
        return parseISO(contractInfo.end_date) < parseISO(formData.cycle_end_date);
    }, [contractInfo, formData]);

    // 计算可编辑的月份：默认上个月，末月时为当月
    const editableMonth = useMemo(() => {
        const now = new Date();
        const lastMonth = { year: now.getFullYear(), month: now.getMonth() }; // 上个月 (0-indexed -> month值)
        if (lastMonth.month === 0) {
            lastMonth.year -= 1;
            lastMonth.month = 12;
        }

        // 如果是末月，检查合同结束日期是否在当月
        if (contractInfo && !contractInfo.is_monthly_auto_renew) {
            const endDateStr = contractInfo.end_date;
            if (endDateStr) {
                const endDate = parseISO(endDateStr);
                const currentYear = now.getFullYear();
                const currentMonth = now.getMonth() + 1;
                // 如果合同结束月就是当月，允许编辑当月
                if (endDate.getFullYear() === currentYear && (endDate.getMonth() + 1) === currentMonth) {
                    return { year: currentYear, month: currentMonth };
                }
            }
        }

        // 如果是已终止的自动月签合同，检查终止日期
        if (contractInfo?.is_monthly_auto_renew && contractInfo.status === 'terminated' && contractInfo.termination_date) {
            const terminationDate = parseISO(contractInfo.termination_date);
            const currentYear = now.getFullYear();
            const currentMonth = now.getMonth() + 1;
            if (terminationDate.getFullYear() === currentYear && (terminationDate.getMonth() + 1) === currentMonth) {
                return { year: currentYear, month: currentMonth };
            }
        }

        return lastMonth;
    }, [contractInfo]);

    // 判断当前是否为历史查看模式（只读）
    const isHistoricalView = useMemo(() => {
        if (!editableMonth) return false;
        // 如果当前选择的月份不是可编辑月份，则为历史查看模式
        return selectedYear !== editableMonth.year || selectedMonth !== editableMonth.month;
    }, [selectedYear, selectedMonth, editableMonth]);

    // 计算合同开始月份（用于限制向前切换）
    const contractStartMonth = useMemo(() => {
        if (!contractInfo?.start_date) return null;
        const startDate = parseISO(contractInfo.start_date);
        return { year: startDate.getFullYear(), month: startDate.getMonth() + 1 };
    }, [contractInfo]);

    // 能否切换到上个月（不能早于合同开始月）
    const canGoPrev = useMemo(() => {
        if (!contractStartMonth) return true;
        const prevMonth = selectedMonth === 1
            ? { year: selectedYear - 1, month: 12 }
            : { year: selectedYear, month: selectedMonth - 1 };

        if (prevMonth.year < contractStartMonth.year) return false;
        if (prevMonth.year === contractStartMonth.year && prevMonth.month < contractStartMonth.month) return false;
        return true;
    }, [selectedYear, selectedMonth, contractStartMonth]);

    const isDateDisabled = useCallback((date) => {
        if (!contractInfo) return false;
        const targetDate = startOfDay(date);

        if (isFirstMonth && contractInfo.start_date) {
            const startDate = startOfDay(parseISO(contractInfo.start_date));
            if (targetDate < startDate) return true;
        }

        if (isLastMonth) {
            // 对于自动月签合同，使用终止日期；否则使用结束日期
            const endDateStr = contractInfo.is_monthly_auto_renew
                ? contractInfo.termination_date
                : contractInfo.end_date;
            if (endDateStr) {
                const endDate = startOfDay(parseISO(endDateStr));
                if (targetDate > endDate) return true;
            }
        }

        return false;
    }, [contractInfo, isFirstMonth, isLastMonth]);

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingDate, setEditingDate] = useState(null);

    // Time Selection State
    const [tempRecord, setTempRecord] = useState({
        type: 'normal',
        daysOffset: 0,
        startTime: '09:00',
        endTime: '18:00'
    });

    // Scroll state for header shrink effect
    const [isScrolled, setIsScrolled] = useState(false);
    const [copiedLink, setCopiedLink] = useState(false);
    const [isReadOnly, setIsReadOnly] = useState(false);
    const [coveringRecord, setCoveringRecord] = useState(null);

    // Auto-save state
    const [autoSaveStatus, setAutoSaveStatus] = useState('saved'); // 'saved' | 'saving' | 'error'
    const autoSaveTimeoutRef = useRef(null);

    // Ref for time settings section (for auto-scroll)
    const timeSettingsRef = useRef(null);

    // Auto-scroll effect when type changes to non-normal
    useEffect(() => {
        if (tempRecord.type !== 'normal' && timeSettingsRef.current) {
            // Small delay to ensure DOM is fully rendered and layout is stable
            const timer = setTimeout(() => {
                timeSettingsRef.current?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [tempRecord.type]);

    // Signature state (for customer mode)
    const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false);
    const [isSigning, setIsSigning] = useState(false);
    const sigCanvasRef = useRef(null);
    const sigContainerRef = useRef(null);
    const [sigCanvasWidth, setSigCanvasWidth] = useState(0);

    // Share hint state
    const [showShareHint, setShowShareHint] = useState(false);

    // Mobile time picker drawer state
    const [timePickerDrawer, setTimePickerDrawer] = useState({
        isOpen: false,
        field: null, // 'startTime' or 'endTime'
        value: '09:00'
    });

    // Auto-save effect (only for employee mode, draft/confirmed status, and NOT historical view)
    useEffect(() => {
        if (mode !== 'employee' || !['draft', 'employee_confirmed'].includes(formData?.status)) return;
        // 历史查看模式不自动保存
        if (isHistoricalView) return;

        // Clear existing timeout
        if (autoSaveTimeoutRef.current) {
            clearTimeout(autoSaveTimeoutRef.current);
        }

        // Set saving status immediately
        setAutoSaveStatus('saving');

        // Debounce auto-save by 500ms
        autoSaveTimeoutRef.current = setTimeout(async () => {
            try {
                await api.put(`/attendance-forms/by-token/${realToken}`, {
                    form_id: formData?.id,  // 传递 form_id 确保更新正确的月份
                    form_data: attendanceData
                });
                setAutoSaveStatus('saved');
            } catch (error) {
                console.error('Auto-save failed:', error);
                setAutoSaveStatus('error');
            }
        }, 500);

        return () => {
            if (autoSaveTimeoutRef.current) {
                clearTimeout(autoSaveTimeoutRef.current);
            }
        };
    }, [attendanceData, mode, formData?.status, token, isHistoricalView]);

    useEffect(() => {
        fetchData(selectedYear, selectedMonth);

        // Check for showShareHint param
        const searchParams = new URLSearchParams(location.search);
        if (searchParams.get('showShareHint') === 'true') {
            setShowShareHint(true);
            // Optional: Remove param from URL without reload
            const newUrl = window.location.pathname;
            window.history.replaceState({}, '', newUrl);
        }
    }, [token, location.search, selectedYear, selectedMonth]);

    // Resize observer for signature canvas
    useEffect(() => {
        if (isSignatureModalOpen && sigContainerRef.current) {
            setSigCanvasWidth(sigContainerRef.current.offsetWidth);

            const handleResize = () => {
                if (sigContainerRef.current) {
                    setSigCanvasWidth(sigContainerRef.current.offsetWidth);
                }
            };

            window.addEventListener('resize', handleResize);
            return () => window.removeEventListener('resize', handleResize);
        }
    }, [isSignatureModalOpen]);

    // Scroll listener for header shrink effect with hysteresis
    useEffect(() => {
        const handleScroll = () => {
            const scrollY = window.scrollY;
            // 迟滞逻辑：向下滚动超过 50px 才收缩，向上滚动回到 20px 以内才展开
            // 这样可以避免在临界点反复触发导致的抖动
            if (scrollY > 50 && !isScrolled) {
                setIsScrolled(true);
            } else if (scrollY <= 20 && isScrolled) {
                setIsScrolled(false);
            }
        };
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, [isScrolled]);

    const fetchData = async (year = selectedYear, month = selectedMonth) => {
        try {
            setLoading(true);
            // 根据模式选择不同的 API 端点
            let endpoint = isCustomerMode
                ? `/attendance-forms/sign/${realToken}`  // 客户签署模式
                : `/attendance-forms/by-token/${realToken}`;  // 员工填写模式或管理员查看模式

            // 添加月份参数 (仅员工模式)
            if (!isCustomerMode && year && month) {
                endpoint += `?year=${year}&month=${month}`;
            }

            const response = await api.get(endpoint);
            const data = response.data;

            setFormData(data);
            setContractInfo(data.contract_info);

            // 重置考勤数据 - 先清空，再填充新数据
            const emptyData = {
                rest_records: [],
                leave_records: [],
                overtime_records: [],
                out_of_beijing_records: [],
                out_of_country_records: [],
                paid_leave_records: [],
                onboarding_records: [],
                offboarding_records: []
            };

            if (data.form_data && Object.keys(data.form_data).length > 0) {
                setAttendanceData({
                    ...emptyData,
                    ...data.form_data
                });
            } else {
                // 新表单：使用空数据
                setAttendanceData(emptyData);
            }

            const startDate = parseISO(data.cycle_start_date);
            const endDate = parseISO(data.cycle_end_date);
            const days = [];
            let current = startDate;
            while (current <= endDate) {
                days.push(current);
                current = addDays(current, 1);
            }
            setMonthDays(days);

        } catch (error) {
            console.error("Failed to fetch attendance data", error);
            toast({
                title: "获取数据失败",
                description: "无法加载考勤表数据，请检查链接是否正确。",
                variant: "destructive"
            });
        } finally {
            setLoading(false);
        }
    };

    // Debug logs removed

    const getDayRecord = (date) => {
        const dateStr = format(date, 'yyyy-MM-dd');
        for (const key of Object.keys(ATTENDANCE_TYPES)) {
            const typeValue = ATTENDANCE_TYPES[key].value;
            if (typeValue === 'normal') continue;

            const records = attendanceData[`${typeValue}_records`] || [];
            const record = records.find(r => r.date === dateStr);
            if (record) {
                return { ...record, type: typeValue, typeLabel: ATTENDANCE_TYPES[key].label, typeConfig: ATTENDANCE_TYPES[key] };
            }
        }
        return { type: 'normal', typeLabel: '正常出勤', typeConfig: ATTENDANCE_TYPES.NORMAL, hours: 8, minutes: 0 };
    };

    const openEditModal = (date) => {
        // 客户模式下禁止编辑
        if (isCustomerMode) return;
        // 管理员查看模式下禁止编辑
        if (isAdminView) return;
        // 历史查看模式下禁止编辑
        if (isHistoricalView) return;
        // 客户已签署后禁止编辑
        if (formData.status === 'customer_signed' || formData.status === 'synced') return;

        setEditingDate(date);
        const dateStr = format(date, 'yyyy-MM-dd');

        // Check if this date is covered by a multi-day record (but is not the start date)
        let foundCoveringRecord = null;
        let isCovered = false;

        Object.keys(attendanceData).forEach(key => {
            if (key.endsWith('_records') && Array.isArray(attendanceData[key])) {
                attendanceData[key].forEach(r => {
                    const startDate = new Date(r.date);
                    // If it IS the start date, it's editable (normal logic handles this)
                    if (format(startDate, 'yyyy-MM-dd') === dateStr) return;

                    const endDate = new Date(startDate);
                    endDate.setDate(startDate.getDate() + (r.daysOffset || 0));

                    // Use string comparison to avoid time issues
                    const currentStr = dateStr;
                    const startStr = format(startDate, 'yyyy-MM-dd');
                    const endStr = format(endDate, 'yyyy-MM-dd');

                    if (currentStr > startStr && currentStr <= endStr) {
                        foundCoveringRecord = r;
                        isCovered = true;
                    }
                });
            }
        });

        if (isCovered && foundCoveringRecord) {
            setIsReadOnly(true);
            setCoveringRecord(foundCoveringRecord);
            // Determine if this is the last day of the record
            const startDate = new Date(foundCoveringRecord.date);
            const endDate = new Date(startDate);
            endDate.setDate(startDate.getDate() + (foundCoveringRecord.daysOffset || 0));
            const endStr = format(endDate, 'yyyy-MM-dd');

            const isLastDay = dateStr === endStr;

            setTempRecord({
                type: foundCoveringRecord.type,
                daysOffset: 0,
                startTime: '00:00',
                endTime: isLastDay ? (foundCoveringRecord.endTime || '18:00') : '24:00'
            });
            setIsModalOpen(true);
            return;
        }

        setIsReadOnly(false);
        setCoveringRecord(null);

        const record = getDayRecord(date);
        // Logic to restore from stored duration
        let daysOffset = 0;
        let startTime = '09:00';
        let endTime = '18:00';

        if (record.type !== 'normal') {
            const totalMinutes = (record.hours || 0) * 60 + (record.minutes || 0);
            if (totalMinutes > 0) {
                // Calculate days offset and end time
                const startDateTime = setMinutes(setHours(date, 9), 0);
                const endDateTime = new Date(startDateTime.getTime() + totalMinutes * 60000);

                // Calculate days difference
                const daysDiff = Math.floor((endDateTime - startDateTime) / (1000 * 60 * 60 * 24));
                daysOffset = daysDiff;

                startTime = '09:00';
                endTime = format(endDateTime, 'HH:mm');
            }
        }

        setTempRecord({
            type: record.type,
            daysOffset: daysOffset,
            startTime: startTime,
            endTime: endTime
        });
        setIsModalOpen(true);
    };

    // Calculate duration based on days offset and time
    const calculatedDuration = useMemo(() => {
        if (!editingDate || !tempRecord.startTime || !tempRecord.endTime) {
            return { days: 0, hours: 0, minutes: 0, totalHours: 0 };
        }

        const [startH, startM] = tempRecord.startTime.split(':').map(Number);
        const [endH, endM] = tempRecord.endTime.split(':').map(Number);

        // Start date is always editingDate
        const startDateTime = setMinutes(setHours(editingDate, startH), startM);
        // End date is editingDate + daysOffset
        const endDate = addDays(editingDate, tempRecord.daysOffset || 0);
        const endDateTime = setMinutes(setHours(endDate, endH), endM);

        // Calculate total minutes difference
        const totalMinutes = Math.floor((endDateTime - startDateTime) / (1000 * 60));

        if (totalMinutes < 0) {
            return { days: 0, hours: 0, minutes: 0, totalHours: 0 };
        }

        const days = Math.floor(totalMinutes / (24 * 60));
        const remainingMinutes = totalMinutes % (24 * 60);
        const hours = Math.floor(remainingMinutes / 60);
        const minutes = remainingMinutes % 60;
        const totalHours = Math.floor(totalMinutes / 60);

        return { days, hours, minutes, totalHours };
    }, [editingDate, tempRecord.daysOffset, tempRecord.startTime, tempRecord.endTime]);

    const handleSaveRecord = () => {
        if (!editingDate) return;
        const dateStr = format(editingDate, 'yyyy-MM-dd');

        setAttendanceData(prev => {
            const newData = { ...prev };

            // Remove existing record for this date from all lists
            Object.keys(ATTENDANCE_TYPES).forEach(key => {
                const tVal = ATTENDANCE_TYPES[key].value;
                if (tVal === 'normal') return;
                const recordKey = `${tVal}_records`;
                newData[recordKey] = (newData[recordKey] || []).filter(r => r.date !== dateStr);
            });

            // If not normal, add to the new list
            if (tempRecord.type !== 'normal') {
                const recordKey = `${tempRecord.type}_records`;
                newData[recordKey] = [...(newData[recordKey] || []), {
                    date: dateStr,
                    hours: calculatedDuration.totalHours,
                    minutes: calculatedDuration.minutes,
                    type: tempRecord.type,
                    daysOffset: tempRecord.daysOffset || 0,
                    startTime: tempRecord.startTime || '09:00',
                    endTime: tempRecord.endTime || '18:00'
                }];
            }

            return newData;
        });
        setIsModalOpen(false);
    };

    const handleSaveDraft = async () => {
        try {
            setSubmitting(true);
            await api.put(`/attendance-forms/by-token/${token}`, {
                form_id: formData?.id,
                form_data: attendanceData
            });
            toast({ title: "保存成功", description: "考勤草稿已保存。" });
        } catch (error) {
            toast({ title: "保存失败", description: "请稍后重试。", variant: "destructive" });
        } finally {
            setSubmitting(false);
        }
    };

    const handleSubmit = async () => {
        if (!window.confirm("确认提交考勤表吗？\n\n提交后将生成客户签署链接。\n在客户签署前，您仍可以修改考勤数据，修改将自动同步。")) return;
        try {
            setSubmitting(true);
            const response = await api.put(`/attendance-forms/by-token/${token}`, {
                form_id: formData?.id,
                form_data: attendanceData,
                action: 'confirm'
            });
            setFormData(prev => ({ ...prev, status: response.data.status, client_sign_url: response.data.client_sign_url }));
            toast({ title: "提交成功", description: "考勤表已确认，请等待客户签署。" });
        } catch (error) {
            toast({ title: "提交失败", description: "请稍后重试。", variant: "destructive" });
        } finally {
            setSubmitting(false);
        }
    };

    const copySignLink = () => {
        if (formData.client_sign_url) {
            navigator.clipboard.writeText(formData.client_sign_url);
            setCopiedLink(true);
            toast({ title: "已复制", description: "签署链接已复制到剪贴板" });
            setTimeout(() => setCopiedLink(false), 2000);
        }
    };

    const shareToWeChat = () => {
        if (!formData.client_sign_url) return;

        const shareUrl = formData.client_sign_url;
        const shareTitle = `${formData.year}年${formData.month}月考勤表签署`;
        const shareDesc = `请${contractInfo?.customer_name || '客户'}签署考勤表`;

        // 检测是否在微信内置浏览器中
        const isWeChat = /MicroMessenger/i.test(navigator.userAgent);

        if (isWeChat) {
            // 在微信中，提示用户点击右上角分享
            toast({
                title: "请点击右上角",
                description: "点击右上角「...」按钮分享给朋友",
                duration: 5000
            });
        } else {
            // 不在微信中，尝试使用 Web Share API
            if (navigator.share) {
                navigator.share({
                    title: shareTitle,
                    text: shareDesc,
                    url: shareUrl
                }).catch(() => {
                    // 分享失败，回退到复制链接
                    copySignLink();
                });
            } else {
                // 不支持 Web Share API，直接复制链接
                copySignLink();
                toast({
                    title: "已复制链接",
                    description: "请手动分享给微信联系人",
                    duration: 3000
                });
            };
        }
    };

    const handleSignature = async () => {
        if (sigCanvasRef.current.isEmpty()) {
            toast({
                title: "请签名",
                description: "请在签名区域写下您的名字",
                variant: "destructive"
            });
            return;
        }

        try {
            setIsSigning(true);
            const signatureImage = sigCanvasRef.current.toDataURL('image/png');

            const response = await api.post(`/attendance-forms/sign/${token}`, {
                signature_data: {
                    image: signatureImage,
                    signed_at: new Date().toISOString(),
                    ip_address: window.location.hostname
                }
            });

            // 更新表单状态
            setFormData(prev => ({ ...prev, status: 'customer_signed' }));
            setIsSignatureModalOpen(false);
            toast({
                title: "签署成功",
                description: "考勤表已签署完成"
            });
        } catch (error) {
            console.error("签署失败", error);
            toast({
                title: "签署失败",
                description: error.response?.data?.error || "请稍后重试",
                variant: "destructive"
            });
        } finally {
            setIsSigning(false);
        }
    };

    if (loading) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>;
    if (!formData) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><div className="text-center"><AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" /><h2 className="text-xl font-bold">无法加载考勤表</h2></div></div>;

    // Stats - Calculate total days for each category (with 3 decimal places)
    let totalWorkDays = 0; // 出勤天数（包括正常、出京、出境，不包括加班）
    let totalLeaveDays = 0; // 请假或休假天数（休息、请假、带薪休假）
    let totalOvertimeDays = 0; // 加班天数（单独统计）

    // Calculate leave days (rest, leave, paid_leave)
    ['rest_records', 'leave_records', 'paid_leave_records'].forEach(key => {
        if (Array.isArray(attendanceData[key])) {
            attendanceData[key].forEach(record => {
                const hours = (record.hours || 0) + (record.minutes || 0) / 60;
                totalLeaveDays += hours / 24;
            });
        }
    });

    // Calculate overtime days separately
    if (Array.isArray(attendanceData.overtime_records)) {
        attendanceData.overtime_records.forEach(record => {
            const hours = (record.hours || 0) + (record.minutes || 0) / 60;
            totalOvertimeDays += hours / 24;
        });
    }

    // Work days = valid days - leave days - overtime days (加班不计入出勤)
    const validDaysCount = monthDays.filter(day => !isDateDisabled(day)).length;
    totalWorkDays = validDaysCount - totalLeaveDays - totalOvertimeDays;

    return (
        <div className="min-h-screen bg-slate-50 pb-48 font-sans">
            {/* 
               1. 头部区域 - CSS Sticky Offset 方案
               - 高度固定为 140px，文档流永远不变
               - sticky top-[-80px]：上半部分 80px 会在滚动时自然卷出屏幕
               - 下半部分 60px 会"卡"在屏幕顶部
               - 上半部分：副标题（会被卷走）
               - 下半部分：标题 + User 图标（会保留）
            */}
            <div className="sticky top-[-80px] z-30 h-[140px] bg-slate-50/95 backdrop-blur-sm border-b border-gray-200 transition-all duration-300 ease-in-out">
                <div className="h-full flex flex-col justify-end px-5">
                    <div className="max-w-3xl mx-auto w-full">
                        {/* 上半部分：副标题区域（80px，会被卷走） */}
                        <div className={`transition-all duration-300 overflow-hidden
                            ${isScrolled ? 'opacity-0 h-0' : 'opacity-100 h-[80px]'}`}>
                            <div className="flex items-end h-full pb-2">
                                <p className="text-sm text-gray-500">
                                    客户: {contractInfo?.customer_name || '请确认考勤信息'}
                                </p>
                            </div>
                        </div>

                        {/* 下半部分：主标题区域（60px，会保留在顶部） */}
                        <div className="h-[60px] flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                {/* 月份切换 - 仅员工模式显示 */}
                                {!isCustomerMode && !isAdminView && (
                                    <button
                                        onClick={() => {
                                            if (!canGoPrev) return;
                                            const newDate = new Date(selectedYear, selectedMonth - 2, 1);
                                            setSelectedYear(newDate.getFullYear());
                                            setSelectedMonth(newDate.getMonth() + 1);
                                        }}
                                        disabled={!canGoPrev}
                                        className={`p-1.5 rounded-lg transition-colors ${canGoPrev
                                            ? 'bg-gray-100 hover:bg-gray-200 active:bg-gray-300'
                                            : 'bg-gray-50 cursor-not-allowed'
                                            }`}
                                        title={canGoPrev ? "上个月" : "不能查看合同开始前的考勤"}
                                    >
                                        <ChevronLeft className={`w-5 h-5 ${canGoPrev ? 'text-gray-600' : 'text-gray-300'}`} />
                                    </button>
                                )}

                                <h1
                                    className="font-bold text-gray-900 transition-all duration-300"
                                    style={{
                                        fontSize: isScrolled ? '18px' : '28px',
                                        lineHeight: '1.2'
                                    }}
                                >
                                    {selectedMonth}月考勤{isHistoricalView ? '记录' : '填报'}
                                    {isAdminView && <span className="ml-2 text-sm bg-gray-200 text-gray-600 px-2 py-1 rounded">查看模式</span>}
                                    {isHistoricalView && !isAdminView && <span className="ml-2 text-sm bg-amber-100 text-amber-700 px-2 py-1 rounded">只读</span>}
                                </h1>

                                {/* 月份切换 - 仅员工模式显示 */}
                                {!isCustomerMode && !isAdminView && (() => {
                                    // 判断是否可以切换到下个月（不能超过可编辑月份）
                                    const canGoNext = editableMonth && (
                                        selectedYear < editableMonth.year ||
                                        (selectedYear === editableMonth.year && selectedMonth < editableMonth.month)
                                    );

                                    return (
                                        <button
                                            onClick={() => {
                                                if (!canGoNext) return;
                                                const newDate = new Date(selectedYear, selectedMonth, 1);
                                                setSelectedYear(newDate.getFullYear());
                                                setSelectedMonth(newDate.getMonth() + 1);
                                            }}
                                            disabled={!canGoNext}
                                            className={`p-1.5 rounded-lg transition-colors ${canGoNext
                                                ? 'bg-gray-100 hover:bg-gray-200 active:bg-gray-300'
                                                : 'bg-gray-50 cursor-not-allowed'
                                                }`}
                                            title={canGoNext ? "下个月" : "不能填写未来月份"}
                                        >
                                            <ChevronRight className={`w-5 h-5 ${canGoNext ? 'text-gray-600' : 'text-gray-300'}`} />
                                        </button>
                                    );
                                })()}
                            </div>

                            {/* User 图标 */}
                            <div className={`rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold transition-all duration-300
                                ${isScrolled ? 'h-8 w-8 text-xs' : 'h-10 w-10 text-sm'}`}>
                                {contractInfo?.employee_name?.slice(-2) || 'User'}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* 
               2. 统计卡片 
               - sticky 定位
               - Header 可见部分固定为 60px，所以统计卡片固定在 top-[60px]
            */}
            <div className="sticky top-[60px] z-20 bg-slate-50 transition-all duration-300 ease-in-out px-4 pt-2 pb-2">

                {/* 加上一个外层 div 控制最大宽度，防止在大屏上太宽 */}
                <div className="max-w-3xl mx-auto">
                    <div className="bg-white rounded-2xl p-4 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.08)] border border-gray-100">
                        <div className="grid grid-cols-3 gap-3 text-center divide-x divide-gray-100">
                            <div>
                                <div className="text-2xl font-black text-gray-900">{totalWorkDays.toFixed(3)}</div>
                                <div className="text-[11px] font-medium text-gray-400 mt-1">出勤(天)</div>
                            </div>
                            <div>
                                <div className="text-2xl font-black text-orange-500">{totalLeaveDays.toFixed(3)}</div>
                                <div className="text-[11px] font-medium text-gray-400 mt-1">请假/休假</div>
                            </div>
                            <div>
                                <div className="text-2xl font-black text-green-600">{totalOvertimeDays.toFixed(3)}</div>
                                <div className="text-[11px] font-medium text-gray-400 mt-1">加班(天)</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="max-w-3xl mx-auto p-4 space-y-4">
                {/* Calendar Grid */}
                <div className="bg-white rounded-2xl p-3 shadow-sm border border-gray-100">
                    {/* Week Header */}
                    <div className="grid grid-cols-7 gap-1 mb-2">
                        {['一', '二', '三', '四', '五', '六', '日'].map((day, index) => (
                            <div
                                key={day}
                                className={`text-center text-xs font-medium py-1 ${index >= 5 ? 'text-red-400' : 'text-gray-500'
                                    }`}
                            >
                                {day}
                            </div>
                        ))}
                    </div>

                    {/* Calendar Days Grid */}
                    <div className="grid grid-cols-7 gap-1">
                        {/* 添加月初空白格子 */}
                        {monthDays.length > 0 && (() => {
                            const firstDay = monthDays[0];
                            const dayOfWeek = firstDay.getDay(); // 0=周日, 1=周一, ..., 6=周六
                            // 转换为周一为0的索引
                            const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
                            return Array.from({ length: offset }).map((_, i) => (
                                <div key={`empty-${i}`} className="aspect-square"></div>
                            ));
                        })()}

                        {monthDays.map((date, index) => {
                            // 计算每一天的实际状态（处理跨天）
                            const dateStr = format(date, 'yyyy-MM-dd');
                            let effectiveRecord = { type: 'normal' };

                            // 遍历所有非正常记录，查找覆盖当天的记录
                            Object.keys(attendanceData).forEach(key => {
                                if (key.endsWith('_records') && Array.isArray(attendanceData[key])) {
                                    attendanceData[key].forEach(record => {
                                        // Fallback for daysOffset
                                        let daysOffset = record.daysOffset || 0;
                                        if (daysOffset === 0 && (record.hours || 0) >= 24) {
                                            daysOffset = Math.floor(record.hours / 24);
                                        }

                                        const startDate = new Date(record.date);
                                        const endDate = new Date(startDate);
                                        endDate.setDate(startDate.getDate() + daysOffset);

                                        // 检查当前日期是否在记录范围内（包括开始和结束日期）
                                        // 注意：比较日期时要忽略时间
                                        const current = new Date(dateStr);
                                        const start = new Date(format(startDate, 'yyyy-MM-dd'));
                                        const end = new Date(format(endDate, 'yyyy-MM-dd'));

                                        if (current >= start && current <= end) {
                                            effectiveRecord = {
                                                ...record,
                                                daysOffset: daysOffset, // Ensure effective record has the calculated offset
                                                typeLabel: ATTENDANCE_TYPES[Object.keys(ATTENDANCE_TYPES).find(k => ATTENDANCE_TYPES[k].value === record.type)]?.label
                                            };
                                        }
                                    });
                                }
                            });

                            const record = effectiveRecord;
                            const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                            const isToday = format(date, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');

                            const isDisabled = isDateDisabled(date);

                            // Status color mapping
                            const statusColors = {
                                'normal': 'bg-gray-50 border-gray-200',
                                'rest': 'bg-blue-50 border-blue-200',
                                'leave': 'bg-yellow-50 border-yellow-200',
                                'overtime': 'bg-green-50 border-green-200',
                                'out_of_beijing': 'bg-purple-50 border-purple-200',
                                'out_of_country': 'bg-pink-50 border-pink-200',
                                'paid_leave': 'bg-indigo-50 border-indigo-200',
                                'onboarding': 'bg-cyan-50 border-cyan-200',
                                'offboarding': 'bg-rose-50 border-rose-200',
                            };

                            const statusTextColors = {
                                'normal': 'text-gray-600',
                                'rest': 'text-blue-600',
                                'leave': 'text-yellow-600',
                                'overtime': 'text-green-600',
                                'out_of_beijing': 'text-purple-600',
                                'out_of_country': 'text-pink-600',
                                'paid_leave': 'text-indigo-600',
                                'onboarding': 'text-cyan-600',
                                'offboarding': 'text-rose-600',
                            };

                            return (
                                <div
                                    key={index}
                                    onClick={() => !isDisabled && openEditModal(date)}
                                    className={`
                                        relative aspect-square rounded-lg border-2 p-1 
                                        transition-all duration-200 flex flex-col items-center justify-center
                                        ${isDisabled
                                            ? 'bg-gray-100 border-gray-200 cursor-not-allowed opacity-60'
                                            : `${statusColors[record.type] || 'bg-gray-50 border-gray-200'} cursor-pointer active:scale-95 hover:shadow-md`
                                        }
                                        ${isToday ? 'ring-2 ring-indigo-400 ring-offset-1' : ''}
                                        ${!isDisabled && isWeekend && record.type === 'normal' ? 'bg-red-50/30' : ''}
                                    `}
                                >
                                    {/* Date Number */}
                                    <span className={`text-lg font-bold mb-1 ${isDisabled ? 'text-gray-400' :
                                        (isToday ? 'text-indigo-600' : 'text-gray-700')
                                        }`}>
                                        {format(date, 'd')}
                                    </span>

                                    {/* Status Label */}
                                    {isDisabled ? (
                                        <X className="w-4 h-4 text-gray-400" />
                                    ) : (
                                        <span className={`text-xs font-medium truncate w-full text-center ${statusTextColors[record.type] || 'text-gray-600'}`}>
                                            {record.typeLabel || '正常'}
                                        </span>
                                    )}

                                    {/* Duration (if not normal) */}
                                    {!isDisabled && record.type !== 'normal' && (
                                        <span className="text-[10px] text-gray-500 scale-90">
                                            {(() => {
                                                if (['onboarding', 'offboarding'].includes(record.type)) {
                                                    return record.startTime;
                                                }

                                                // Calculate daily hours for multi-day records
                                                let displayHours = parseFloat(record.hours || 0);
                                                const startDate = new Date(record.date);

                                                // Check if it's a multi-day record
                                                if ((record.daysOffset || 0) > 0) {
                                                    const endDate = new Date(startDate);
                                                    endDate.setDate(startDate.getDate() + record.daysOffset);

                                                    const currentStr = format(date, 'yyyy-MM-dd');
                                                    const startStr = format(startDate, 'yyyy-MM-dd');
                                                    const endStr = format(endDate, 'yyyy-MM-dd');

                                                    if (currentStr === startStr) {
                                                        // Start day: 24 - start time
                                                        const [hours, minutes] = (record.startTime || '09:00').split(':').map(Number);
                                                        const startH = hours + minutes / 60;
                                                        displayHours = 24 - startH;
                                                    } else if (currentStr === endStr) {
                                                        // End day: end time
                                                        const [hours, minutes] = (record.endTime || '18:00').split(':').map(Number);
                                                        displayHours = hours + minutes / 60;
                                                    } else {
                                                        // Middle days
                                                        displayHours = 24;
                                                    }
                                                }

                                                // Format output
                                                if (displayHours >= 24) return '24h';
                                                return Number.isInteger(displayHours) ? `${displayHours}h` : `${displayHours.toFixed(1)}h`;
                                            })()}
                                        </span>
                                    )}

                                    {/* Today Marker */}
                                    {isToday && (
                                        <div className="absolute top-0 right-0 w-1.5 h-1.5 bg-indigo-500 rounded-full"></div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* 详情列表 - 显示所有非正常出勤记录 */}
                {(() => {
                    // 收集所有非正常记录并按日期排序
                    const allSpecialRecords = [];
                    Object.keys(attendanceData).forEach(key => {
                        if (key.endsWith('_records') && Array.isArray(attendanceData[key])) {
                            attendanceData[key].forEach(record => {
                                allSpecialRecords.push({
                                    ...record,
                                    typeLabel: ATTENDANCE_TYPES[Object.keys(ATTENDANCE_TYPES).find(k => ATTENDANCE_TYPES[k].value === record.type)]?.label
                                });
                            });
                        }
                    });

                    // 按日期排序
                    allSpecialRecords.sort((a, b) => new Date(a.date) - new Date(b.date));

                    if (allSpecialRecords.length === 0) return null;

                    return (
                        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                            <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                                <Clock className="w-4 h-4" />
                                考勤详情
                            </h3>
                            <div className="space-y-2">
                                {allSpecialRecords.map((record, index) => {
                                    const date = new Date(record.date);
                                    const isWeekend = date.getDay() === 0 || date.getDay() === 6;

                                    // 计算结束日期和时间显示字符串
                                    const startDate = new Date(record.date);

                                    // Fallback for daysOffset
                                    let daysOffset = record.daysOffset || 0;
                                    if (daysOffset === 0 && (record.hours || 0) >= 24) {
                                        daysOffset = Math.floor(record.hours / 24);
                                    }

                                    const endDate = new Date(startDate);
                                    endDate.setDate(startDate.getDate() + daysOffset);

                                    let timeRangeStr = '';
                                    const startTime = record.startTime || '09:00';
                                    const endTime = record.endTime || '18:00';

                                    if (daysOffset > 0) {
                                        // 跨天：显示完整起止时间
                                        timeRangeStr = `${format(startDate, 'M月d日')} ${startTime} ~ ${format(endDate, 'M月d日')} ${endTime}`;
                                    } else {
                                        // 单天：只显示时间范围
                                        timeRangeStr = `${format(startDate, 'M月d日')} ${startTime}~${endTime}`;
                                    }

                                    return (
                                        <div
                                            key={index}
                                            onClick={() => openEditModal(date)}
                                            className="flex items-center justify-between p-3 rounded-lg bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors active:scale-[0.98]"
                                        >
                                            <div className="flex items-center gap-3">
                                                {(() => {
                                                    // 根据类型获取对应的颜色
                                                    const typeColors = {
                                                        'rest': 'bg-blue-100 text-blue-700 border-blue-300',
                                                        'leave': 'bg-yellow-100 text-yellow-700 border-yellow-300',
                                                        'overtime': 'bg-green-100 text-green-700 border-green-300',
                                                        'out_of_beijing': 'bg-purple-100 text-purple-700 border-purple-300',
                                                        'out_of_country': 'bg-pink-100 text-pink-700 border-pink-300',
                                                        'paid_leave': 'bg-indigo-100 text-indigo-700 border-indigo-300',
                                                        'onboarding': 'bg-cyan-100 text-cyan-700 border-cyan-300',
                                                        'offboarding': 'bg-orange-100 text-orange-700 border-orange-300',
                                                    };
                                                    const colorClass = typeColors[record.type] || (isWeekend ? 'bg-red-50 text-red-600 border-red-200' : 'bg-white text-gray-700 border-gray-200');

                                                    return (
                                                        <div className={`flex flex-col items-center justify-center w-10 h-10 rounded-lg ${colorClass} border`}>
                                                            <span className="text-xs font-bold">{format(date, 'd')}</span>
                                                            <span className="text-[8px]">{format(date, 'EEE', { locale: zhCN })}</span>
                                                        </div>
                                                    );
                                                })()}

                                                <div>
                                                    <div className="text-sm font-medium text-gray-900">
                                                        {record.typeLabel}
                                                    </div>
                                                    <div className="text-xs text-gray-500">
                                                        {timeRangeStr}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-sm font-bold text-gray-900">
                                                    {formatDuration(record.hours, record.minutes)}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })()}
            </div>

            {/* 客户签名展示 (仅在 Admin View 或已签署状态下显示) */}
            {(isAdminView || formData.status === 'customer_signed' || formData.status === 'synced') && formData.signature_data && (
                <div className="max-w-3xl mx-auto p-4 pt-0">
                    <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                        <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-green-600" />
                            客户签名
                        </h3>
                        <div className="border border-gray-200 rounded-xl overflow-hidden bg-gray-50 p-4 flex justify-center">
                            <img
                                src={formData.signature_data.image}
                                alt="Customer Signature"
                                className="max-h-32 object-contain"
                            />
                        </div>
                        <div className="mt-2 text-xs text-center text-gray-500">
                            签署时间: {formData.signature_data.signed_at ? format(parseISO(formData.signature_data.signed_at), 'yyyy-MM-dd HH:mm:ss') : '未知'}
                        </div>
                    </div>
                </div>
            )}

            {/* Bottom Fixed Action Bar */}
            {!isAdminView && (
                <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-20">
                    <div className="max-w-3xl mx-auto">
                        {isCustomerMode ? (
                            /* 客户签署模式 */
                            <div className="w-full space-y-3">
                                {formData.status === 'customer_signed' ? (
                                    <div className="w-full bg-green-50 text-green-700 py-3 rounded-xl text-center font-medium flex items-center justify-center gap-2">
                                        <CheckCircle2 className="w-5 h-5" />
                                        已签署
                                    </div>
                                ) : (
                                    <>
                                        <div className="text-center text-sm text-gray-600 mb-2">
                                            请确认考勤信息无误后签署
                                        </div>
                                        <button
                                            onClick={() => setIsSignatureModalOpen(true)}
                                            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition-colors shadow-lg"
                                        >
                                            <Send className="w-5 h-5" />
                                            确认并签署
                                        </button>
                                    </>
                                )}
                            </div>
                        ) : (
                            /* 员工填写模式 */
                            <div className="space-y-3">
                                {/* 历史查看模式提示 */}
                                {isHistoricalView && (
                                    <div className="w-full bg-gray-100 text-gray-600 py-3 px-4 rounded-xl text-center text-sm">
                                        <div className="font-medium mb-1">📋 历史考勤记录</div>
                                        <div>仅供查看，不可修改</div>
                                    </div>
                                )}

                                {!isHistoricalView && formData.status === 'employee_confirmed' && (
                                    <div className="w-full bg-yellow-50 text-yellow-700 py-2.5 px-3 rounded-xl text-center text-sm font-medium">
                                        已提交，等待客户签署（仍可修改）
                                    </div>
                                )}

                                {!isHistoricalView && (formData.status === 'draft' || formData.status === 'employee_confirmed') ? (
                                    <>
                                        {/* Auto-save status indicator */}
                                        <div className="flex items-center justify-center gap-2 text-sm mb-2">
                                            {autoSaveStatus === 'saving' && (
                                                <>
                                                    <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
                                                    <span className="text-gray-500">保存中...</span>
                                                </>
                                            )}
                                            {autoSaveStatus === 'saved' && (
                                                <>
                                                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                                                    <span className="text-green-600">已自动保存</span>
                                                </>
                                            )}
                                            {autoSaveStatus === 'error' && (
                                                <>
                                                    <AlertCircle className="w-4 h-4 text-red-600" />
                                                    <span className="text-red-600">保存失败</span>
                                                </>
                                            )}
                                        </div>

                                        {/* Submit and Share button for draft status */}
                                        {formData.status === 'draft' && (
                                            <button
                                                onClick={async () => {
                                                    if (!window.confirm("确认提交考勤表并分享给客户？\n\n提交后将跳转到签署页面，请在微信中分享给客户签署。")) return;
                                                    try {
                                                        setSubmitting(true);
                                                        const response = await api.put(`/attendance-forms/by-token/${realToken}`, {
                                                            form_id: formData?.id,
                                                            form_data: attendanceData,
                                                            action: 'confirm'
                                                        });
                                                        // 更新状态
                                                        setFormData(prev => ({ ...prev, status: response.data.status, client_sign_url: response.data.client_sign_url }));
                                                        // 直接跳转到签署页面
                                                        if (response.data.client_sign_url) {
                                                            const signUrl = new URL(response.data.client_sign_url);
                                                            signUrl.searchParams.set('showShareHint', 'true');
                                                            window.location.href = signUrl.toString();
                                                        }
                                                    } catch (error) {
                                                        toast({ title: "提交失败", description: "请稍后重试。", variant: "destructive" });
                                                        setSubmitting(false);
                                                    }
                                                }}
                                                disabled={submitting}
                                                className="w-full bg-teal-600 text-white font-bold py-4 rounded-xl shadow-lg active:bg-teal-700 flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                <Share2 className="w-5 h-5" />
                                                {submitting ? '提交中...' : '提交考勤并分享给客户'}
                                            </button>
                                        )}

                                        {/* Share button for already confirmed status */}
                                        {formData.client_sign_url && formData.status === 'employee_confirmed' && (
                                            <button
                                                onClick={() => {
                                                    // 跳转到签署页面，并带上分享提示参数
                                                    const signUrl = new URL(formData.client_sign_url);
                                                    signUrl.searchParams.set('showShareHint', 'true');
                                                    window.location.href = signUrl.toString();
                                                }}
                                                className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition-colors shadow-md"
                                            >
                                                <Share2 className="w-5 h-5" />
                                                前往签署页分享给客户
                                            </button>
                                        )}
                                    </>
                                ) : (
                                    <div className="flex flex-col gap-4 w-full">
                                        <div className="w-full bg-green-50 text-green-700 py-3 rounded-xl text-center font-medium flex items-center justify-center gap-2">
                                            <CheckCircle2 className="w-5 h-5" />
                                            {formData.status === 'customer_signed' ? '客户已签署' : '已完成'}
                                        </div>


                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Edit Modal (Bottom Sheet style on mobile, Center on desktop) */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
                    <div
                        className="bg-white w-full max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl animate-in slide-in-from-bottom duration-300 max-h-[85vh] flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Fixed Header */}
                        <div className="flex items-center justify-between p-6 pb-4 border-b border-gray-200 shrink-0">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900">
                                    {format(editingDate, 'M月d日')} {format(editingDate, 'EEEE', { locale: zhCN })}
                                </h3>
                                <p className="text-sm text-gray-500">请选择当日考勤状态</p>
                            </div>
                            <button
                                onClick={() => setIsModalOpen(false)}
                                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                            >
                                <X className="w-5 h-5 text-gray-600" />
                            </button>
                        </div>

                        {/* Scrollable Content */}
                        <div className="flex-1 overflow-y-auto p-6 pt-4">
                            {isReadOnly && coveringRecord && (
                                <div className="mb-6 p-4 bg-yellow-50 text-yellow-800 rounded-xl text-sm border border-yellow-200 flex items-start gap-3">
                                    <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                                    <div>
                                        <div className="font-bold mb-1">该日期包含在多天考勤记录中</div>
                                        <div>
                                            属于 {format(new Date(coveringRecord.date), 'M月d日')} 开始的
                                            <span className="font-bold mx-1">
                                                {ATTENDANCE_TYPES[Object.keys(ATTENDANCE_TYPES).find(k => ATTENDANCE_TYPES[k].value === coveringRecord.type)]?.label}
                                            </span>
                                            记录。
                                        </div>
                                        <div className="mt-1 text-yellow-700/80">如需修改，请前往开始日期进行操作。</div>
                                    </div>
                                </div>
                            )}

                            {/* Type Grid */}
                            <div className={`grid grid-cols-3 gap-3 mb-6 ${isReadOnly ? 'opacity-50 pointer-events-none' : ''}`}>
                                {Object.keys(ATTENDANCE_TYPES).map(key => {
                                    const type = ATTENDANCE_TYPES[key];

                                    // Filter Logic for Onboarding/Offboarding
                                    if (type.value === 'onboarding') {
                                        if (!isFirstMonth || !contractInfo?.start_date) return null;
                                        if (!isSameDay(editingDate, parseISO(contractInfo.start_date))) return null;
                                    }
                                    if (type.value === 'offboarding') {
                                        if (!isLastMonth) return null;
                                        // 对于自动月签合同，使用终止日期；否则使用结束日期
                                        const endDateStr = contractInfo?.is_monthly_auto_renew
                                            ? contractInfo?.termination_date
                                            : contractInfo?.end_date;
                                        if (!endDateStr) return null;
                                        if (!isSameDay(editingDate, parseISO(endDateStr))) return null;
                                    }

                                    const isSelected = tempRecord.type === type.value;
                                    return (
                                        <button
                                            key={key}
                                            onClick={() => setTempRecord(prev => ({ ...prev, type: type.value }))}
                                            className={`py-3 px-2 rounded-xl text-sm font-medium transition-all border ${isSelected
                                                ? 'bg-black text-white border-black shadow-md'
                                                : 'bg-white text-gray-900 border-gray-300 hover:border-indigo-400 hover:bg-indigo-50'
                                                }`}
                                        >
                                            {type.label}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Time Input (Only for non-normal) */}
                            {tempRecord.type !== 'normal' && (
                                <div
                                    ref={timeSettingsRef}
                                    className={`bg-gray-50 rounded-xl p-4 mb-4 animate-in fade-in slide-in-from-top-2 ${isReadOnly ? 'opacity-50 pointer-events-none' : ''}`}
                                >
                                    <div className="flex items-center gap-2 mb-4 text-sm font-medium text-gray-700">
                                        <Clock className="w-4 h-4" />
                                        <span>
                                            {tempRecord.type === 'onboarding' ? '上户时间' :
                                                tempRecord.type === 'offboarding' ? '下户时间' :
                                                    `${ATTENDANCE_TYPES[Object.keys(ATTENDANCE_TYPES).find(k => ATTENDANCE_TYPES[k].value === tempRecord.type)]?.label}时长设置`}
                                        </span>
                                    </div>

                                    {['onboarding', 'offboarding'].includes(tempRecord.type) ? (
                                        // Onboarding/Offboarding: Single Time Picker
                                        <div className="bg-white rounded-lg border border-gray-200 p-3"
                                            onClick={() => !isReadOnly && setTimePickerDrawer({
                                                isOpen: true,
                                                field: 'startTime',
                                                value: tempRecord.startTime || '09:00'
                                            })}
                                        >
                                            <div className="text-xs text-gray-500 mb-1">
                                                {tempRecord.type === 'onboarding' ? '到达时间' : '离开时间'}
                                            </div>
                                            <div className="text-lg font-medium text-gray-900 flex items-center justify-between">
                                                {tempRecord.startTime || '09:00'}
                                                <ChevronRight className="w-4 h-4 text-gray-400" />
                                            </div>
                                        </div>
                                    ) : (
                                        // Standard Duration Picker
                                        <>
                                            {/* Start Date (Fixed, Display Only) */}
                                            <div className="mb-4">
                                                <label className="text-xs text-gray-500 mb-2 block">开始日期</label>
                                                <div className="bg-gray-100 text-gray-700 text-center p-3 rounded-lg border border-gray-200 font-bold">
                                                    {editingDate && format(editingDate, 'yyyy年M月d日 EEEE', { locale: zhCN })}
                                                </div>
                                            </div>

                                            {/* Start Time */}
                                            <div className="mb-4">
                                                <label className="text-xs text-gray-500 mb-2 block">开始时间</label>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (!isReadOnly) {
                                                            setTimePickerDrawer({
                                                                isOpen: true,
                                                                field: 'startTime',
                                                                value: tempRecord.startTime || '09:00'
                                                            });
                                                        }
                                                    }}
                                                    disabled={isReadOnly}
                                                    className={`w-full p-3 rounded-lg border text-center font-mono text-lg transition-colors ${isReadOnly
                                                        ? 'bg-gray-100 text-gray-500 border-gray-200 cursor-not-allowed'
                                                        : 'bg-white text-gray-900 border-gray-300 hover:border-teal-400 hover:bg-teal-50 active:bg-teal-100'
                                                        }`}
                                                >
                                                    {tempRecord.startTime || '09:00'}
                                                </button>
                                            </div>

                                            {/* Days Offset Selector */}
                                            <div className="mb-4">
                                                <label className="text-xs text-gray-500 mb-2 block">持续天数</label>
                                                <div className="flex items-center gap-3">
                                                    <button
                                                        type="button"
                                                        onClick={() => setTempRecord(prev => ({ ...prev, daysOffset: Math.max(0, (prev.daysOffset || 0) - 1) }))}
                                                        className="w-12 h-12 rounded-lg bg-black hover:bg-gray-800 active:bg-gray-700 flex items-center justify-center text-2xl font-bold text-white"
                                                    >
                                                        −
                                                    </button>
                                                    <div className="flex-1 text-center">
                                                        <div className="text-3xl font-bold text-gray-900">{(tempRecord.daysOffset || 0) === 0 ? '当天' : tempRecord.daysOffset}</div>
                                                        <div className="text-xs text-gray-500 mt-1">{(tempRecord.daysOffset || 0) === 0 ? '' : '天后'}</div>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => setTempRecord(prev => ({ ...prev, daysOffset: (prev.daysOffset || 0) + 1 }))}
                                                        className="w-12 h-12 rounded-lg bg-black hover:bg-gray-800 active:bg-gray-700 flex items-center justify-center text-2xl font-bold text-white"
                                                    >
                                                        +
                                                    </button>
                                                </div>
                                                {tempRecord.daysOffset > 0 && (
                                                    <div className="mt-2 text-center text-sm text-gray-600">
                                                        结束日期: {editingDate && format(addDays(editingDate, tempRecord.daysOffset), 'M月d日 EEEE', { locale: zhCN })}
                                                    </div>
                                                )}
                                            </div>

                                            {/* End Time */}
                                            <div className="mb-4">
                                                <label className="text-xs text-gray-500 mb-2 block">结束时间</label>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (!isReadOnly) {
                                                            setTimePickerDrawer({
                                                                isOpen: true,
                                                                field: 'endTime',
                                                                value: tempRecord.endTime || '18:00'
                                                            });
                                                        }
                                                    }}
                                                    disabled={isReadOnly}
                                                    className={`w-full p-3 rounded-lg border text-center font-mono text-lg transition-colors ${isReadOnly
                                                        ? 'bg-gray-100 text-gray-500 border-gray-200 cursor-not-allowed'
                                                        : 'bg-white text-gray-900 border-gray-300 hover:border-teal-400 hover:bg-teal-50 active:bg-teal-100'
                                                        }`}
                                                >
                                                    {tempRecord.endTime || '18:00'}
                                                </button>
                                            </div>
                                        </>
                                    )}
                                    <div className="mt-3 text-center">
                                        <span className="text-sm text-gray-500">共计: </span>
                                        <span className="text-lg font-bold text-gray-900">
                                            {isReadOnly && tempRecord.endTime === '24:00'
                                                ? '24小时'
                                                : formatDuration(calculatedDuration.totalHours, calculatedDuration.minutes)
                                            }
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Sticky Bottom Buttons */}
                        {!isReadOnly && (
                            <div className="p-6 pt-4 border-t border-gray-200 bg-white shrink-0">
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setIsModalOpen(false)}
                                        className="flex-1 bg-gray-100 text-gray-700 font-bold py-3.5 rounded-xl shadow active:scale-[0.98] transition-transform hover:bg-gray-200"
                                    >
                                        关闭
                                    </button>
                                    <button
                                        onClick={handleSaveRecord}
                                        className="flex-1 bg-black text-white font-bold py-3.5 rounded-xl shadow-lg active:scale-[0.98] transition-transform hover:bg-gray-900"
                                    >
                                        确认修改
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Signature Modal (for customer mode) */}
            {isSignatureModalOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-xl font-bold text-gray-900">签署确认</h3>
                            <button
                                onClick={() => setIsSignatureModalOpen(false)}
                                className="text-gray-400 hover:text-gray-600 transition-colors"
                            >
                                <X className="w-6 h-6" />
                            </button>
                        </div>

                        <div className="mb-6">
                            <p className="text-sm text-gray-600 mb-4">
                                请在下方区域手写签名以确认。签署后将无法修改。
                            </p>

                            <div ref={sigContainerRef} className="border border-gray-300 rounded-xl overflow-hidden bg-gray-50 touch-none mb-4" style={{ height: '200px' }}>
                                {sigCanvasWidth > 0 && (
                                    <SignatureCanvas
                                        ref={sigCanvasRef}
                                        penColor='black'
                                        canvasProps={{
                                            width: sigCanvasWidth,
                                            height: 200,
                                            className: 'sigCanvas'
                                        }}
                                    />
                                )}
                            </div>

                            <div className="flex justify-end">
                                <button
                                    onClick={() => sigCanvasRef.current.clear()}
                                    className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
                                >
                                    <Eraser className="w-4 h-4" />
                                    清除签名
                                </button>
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setIsSignatureModalOpen(false)}
                                className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleSignature}
                                disabled={isSigning}
                                className="flex-1 px-4 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                            >
                                {isSigning ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        签署中...
                                    </>
                                ) : (
                                    '确认签署'
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Share Hint Overlay */}
            {showShareHint && (
                <div
                    className="fixed inset-0 bg-black/80 z-[100] flex flex-col items-end p-8 cursor-pointer"
                    onClick={() => setShowShareHint(false)}
                >
                    <div className="text-white flex flex-col items-end animate-bounce">
                        <ArrowRight className="w-12 h-12 -rotate-45 mb-4" />
                        <div className="text-xl font-bold mb-2">点击右上角菜单</div>
                        <div className="text-lg">选择"发送给朋友"</div>
                        <div className="text-lg">分享给客户签署</div>
                    </div>
                </div>
            )}

            {/* Mobile Time Picker Drawer */}
            {timePickerDrawer.isOpen && (
                <MobileTimePicker
                    value={timePickerDrawer.value}
                    onChange={(newValue) => {
                        // Update the temp record with the new time
                        if (timePickerDrawer.field === 'startTime') {
                            setTempRecord(prev => ({ ...prev, startTime: newValue }));
                        } else if (timePickerDrawer.field === 'endTime') {
                            setTempRecord(prev => ({ ...prev, endTime: newValue }));
                        }
                    }}
                    onClose={() => setTimePickerDrawer({ isOpen: false, field: null, value: '09:00' })}
                />
            )}
        </div>
    );
};

export default AttendanceFillPage;
