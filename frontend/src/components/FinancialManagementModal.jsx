// frontend/src/components/FinancialManagementModal.jsx (最终重构版)

import React, { useState, useEffect } from 'react';
import {
  Box, Button, Typography, Paper, Grid, Dialog, DialogTitle, DialogContent, 
  DialogActions, Divider, CircularProgress, Tooltip, IconButton, List, ListItem, 
  ListItemIcon, ListItemText, ListItemSecondaryAction, Alert, Switch, TextField,
  FormControlLabel, Chip
} from '@mui/material';
import { 
    Edit as EditIcon, Save as SaveIcon, Close as CloseIcon, Cancel as CancelIcon, 
    Add as AddIcon, Remove as RemoveIcon, Info as InfoIcon, Delete as DeleteIcon,
    ArrowUpward as ArrowUpwardIcon, ArrowDownward as ArrowDownwardIcon,
    ReceiptLong as ReceiptLongIcon, History as HistoryIcon,
    EditCalendar as EditCalendarIcon,
    CheckCircle as CheckCircleIcon, HighlightOff as HighlightOffIcon,
    ArticleOutlined as ArticleOutlinedIcon
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { Timeline } from '@mui/lab';

import api from '../api/axios'; 
import AdjustmentDialog, { AdjustmentTypes } from './AdjustmentDialog';
import InvoiceDetailsDialog from './InvoiceDetailsDialog';
import LogItem from './LogItem';
import { PeopleAlt as PeopleAltIcon } from '@mui/icons-material';
import SubstituteDialog from './SubstituteDialog';

// --- 辅助函数 ---
const formatDateRange = (dateRangeString) => {
    if (!dateRangeString || !dateRangeString.includes('~')) return '—';
    const [startStr, endStr] = dateRangeString.split('~').map(d => d.trim());
    if (startStr === 'N/A' || endStr === 'N/A') return '—';
    try {
        const startDate = new Date(startStr);
        const endDate = new Date(endStr);
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return '无效日期';
        // 计算天数：结束日 - 开始日
        const diffDays = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        const format = (date) => date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }).replace('/', '-');
        return `${format(startDate)} ~ ${format(endDate)} (${diffDays}天)`;
    } catch (e) { return '无效日期范围'; }
};

const formatDate = (dateString) => {
    if (!dateString || dateString.includes('N/A')) return '—';
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return '无效日期';
        return date.toLocaleDateString('zh-CN', {  month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
    } catch (e) {
        return '无效日期';
    }
};

const formatValue = (key, value) => {
    if (value === null || value === undefined || value === '' || String(value).includes('待计算'))
        return <Box component="span" sx={{ color: 'text.disabled' }}>{value || '—'}</Box>;
    if (key === '加班天数') return `${value} 天`;
    if (key === '替班天数') return `${value} 天`;
    if (key === '基本劳务天数') return `${value} 天`;
    if (key === '总劳务天数') return `${value} 天`;
    if (key.includes('费率')) {
        const num = Number(value);
        return isNaN(num) ? String(value) : `${(num * 100).toFixed(0)}%`;
    }
    const isMoney = !key.includes('天数') && !key.includes('费率');
    if (isMoney && /^-?\d+(\.\d+)?$/.test(String(value))) {
        const num = Number(value);
        return isNaN(num) ? String(value) : `¥${num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return String(value);
};

const getTooltipContent = (fieldName, billingDetails, isCustomer) => {
    const details = isCustomer ? billingDetails?.customer_bill_details : billingDetails?.employee_payroll_details;
    const calc = details?.calculation_details;
    if (!calc?.calculation_log) return null;

    const log = calc.calculation_log;
    const fieldToLogKeyMap = {
        '基础劳务费': '基础劳务费',
        '试工费': '试工费',
        '加班费': '加班费',
        '管理费': '管理费',
        '被替班费用': '被替班扣款',
        '客应付款': '客应付款',
        '萌嫂保证金(工资)': '员工工资',
        '5%奖励': '5%奖励',
        '萌嫂应领款': '萌嫂应领款',
        '本次交管理费': '本次交管理费',
        '首月员工10%费用': '首月员工10%费用',
        '加班工资': '加班费',
    };
    const logKey = fieldToLogKeyMap[fieldName];
    if (!logKey || !log[logKey]) return null;

    return (
        <Box sx={{ p: 1, maxWidth: 350 }}>
            <Typography variant="caption" sx={{ fontWeight: 'bold', color: 'common.white', display: 'block', mb: 1 }}>
                计算过程
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'grey.200', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {log[logKey]}
            </Typography>
        </Box>
    );
};

// --- 主组件 ---
const FinancialManagementModal = ({ open, onClose, contract, billingMonth, billingDetails, loading, onSave }) => {
    const [isEditMode, setIsEditMode] = useState(false);
    const [editableOvertime, setEditableOvertime] = useState(0);
    const [adjustments, setAdjustments] = useState([]);
    const [editableSettlement, setEditableSettlement] = useState({});
    const [editableInvoice, setEditableInvoice] = useState({ number: '', amount: '', date: null });
    const [isAdjustmentDialogOpen, setIsAdjustmentDialogOpen] = useState(false);
    const [editingAdjustment, setEditingAdjustment] = useState(null);
    const [adjustmentFilter, setAdjustmentFilter] = useState('all');
    const [isInvoiceDialogOpen, setIsInvoiceDialogOpen] = useState(false);
    const [activityLogs, setActivityLogs] = useState([]);
    const [loadingLogs, setLoadingLogs] = useState(false);
    const [isCycleEditDialogOpen, setIsCycleEditDialogOpen] = useState(false);
    const [editableCycle, setEditableCycle] = useState({ start: null, end: null });
    const [isSubstituteDialogOpen, setIsSubstituteDialogOpen] = useState(false);
    const [substituteRecords, setSubstituteRecords] = useState([]);

    useEffect(() => {
        if (open && billingDetails) {
            const customerDetails = billingDetails.customer_bill_details || {};
            const employeeDetails = billingDetails.employee_payroll_details || {};
            const invoiceDetails = billingDetails.invoice_details || {};
            
            setEditableOvertime(parseInt(billingDetails.attendance?.overtime_days, 10) || 0);
            setAdjustments(billingDetails.adjustments || []);
            setEditableInvoice({
                number: invoiceDetails.number || '',
                amount: invoiceDetails.amount || '',
                date: invoiceDetails.date ? new Date(invoiceDetails.date) : null,
            });

            const customerPayment = customerDetails.payment_status || {};
            const employeePayment = employeeDetails.payment_status || {};

            setEditableSettlement({
                customer_is_paid: customerPayment.customer_is_paid || false,
                customer_payment_date: customerPayment.customer_payment_date ? new Date(customerPayment.customer_payment_date) : null,
                customer_payment_channel: customerPayment.customer_payment_channel || '',
                employee_is_paid: employeePayment.employee_is_paid || false,
                employee_payout_date: employeePayment.employee_payout_date ? new Date(employeePayment.employee_payout_date) : null,
                employee_payout_channel: employeePayment.employee_payout_channel || '',
                invoice_needed: customerPayment.invoice_needed || false,
                invoice_issued: customerPayment.invoice_issued || false,
            });

            if (customerDetails.id || employeeDetails.id) {
                setLoadingLogs(true);
                api.get('/billing/logs', { params: { bill_id: customerDetails.id, payroll_id: employeeDetails.id } })
                    .then(res => setActivityLogs(res.data))
                    .catch(err => console.error("获取日志失败:", err))
                    .finally(() => setLoadingLogs(false));
            }
            if (contract?.contract_id) {
                api.get(`/contracts/${contract.contract_id}/substitutes`)
                    .then(res => setSubstituteRecords(res.data))
                    .catch(err => console.error("获取替班记录失败:", err));
            }
        }
    }, [open, billingDetails]);

    const handleOpenSubstituteDialog = () => {
        console.log('Opening SubstituteDialog. contract?.contract_type_value:', contract?.contract_type_value);
        setIsSubstituteDialogOpen(true);
    }

    const handleCloseSubstituteDialog = () => {
        setIsSubstituteDialogOpen(false);
    };

    const handleSaveSubstitute = async (substituteData) => {
        try {
            await api.post(`/contracts/${contract.contract_id}/substitutes`, substituteData);
            alert('替班记录添加成功！');
            // 重新获取替班记录列表
            api.get(`/contracts/${contract.contract_id}/substitutes`)
                .then(res => setSubstituteRecords(res.data))
                .catch(err => console.error("获取替班记录失败:", err));
            handleCloseSubstituteDialog();
        } catch (error) {
            console.error("保存替班记录失败:", error);
            alert('保存替班记录失败，请查看控制台获取更多信息。');
        }
    };

        const handleDeleteSubstitute = async (recordId) => {
        if (window.confirm("确定要删除这条替班记录吗？相关账单将重新计算。")) {
            try {
                // 第一次尝试：常规删除
                const response = await api.delete(`/contracts/substitutes/${recordId}`);

                if (response.status === 200) {
                    alert('替班记录删除成功！');
                    setSubstituteRecords(prev => prev.filter(r => r.id !== recordId));
                } else if (response.status === 409) {
                    // 如果是409冲突，则询问是否强制删除
                    if (window.confirm("注意：此替班记录关联的账单已产生操作日志。\n\n是否要强制删除此记录及其所有关联日志？此操作不可逆！")) {
                        try {
                            // 第二次尝试：强制删除
                            const forceResponse = await api.delete(`/contracts/substitutes/${recordId}?force=true`);
                            if (forceResponse.status === 200) {
                                alert('强制删除成功！');
                                setSubstituteRecords(prev => prev.filter(r => r.id !== recordId));
                            } else {
                                console.error("强制删除替班记录失败:", forceResponse);
                                alert(`强制删除失败: ${forceResponse.data?.message || '未知错误'}`);
                            }
                        } catch (forceError) {
                            // 如果强制删除也失败了 (网络错误等)
                            console.error("强制删除替班记录失败:", forceError);
                            alert(`强制删除失败: ${forceError.response?.data?.message || forceError.message}`);
                        }
                    }
                } else {
                    // 其他非200/非409的响应
                    console.error("删除替班记录失败:", response);
                    alert(`删除失败: ${response.data?.message || '未知错误'}`);
                }
            } catch (error) {
                // 捕获网络错误或其他非HTTP响应错误
                console.error("删除替班记录失败:", error);
                alert(`删除失败: ${error.message}`);
            }
        }
    };

    const handleSave = () => {
        const billId = billingDetails?.customer_bill_details?.id;

        if (!billId) {
            alert("无法保存，缺少关键的账单ID。");
            console.error("Save failed due to missing bill_id:", billingDetails);
            return;
        }

        const payload = {
            bill_id: billId,
            overtime_days: editableOvertime,
            adjustments: adjustments,
            settlement_status: { ...editableSettlement, invoice_details: editableInvoice }
        };

        onSave(payload);
        setIsEditMode(false);
    };

    const handleEnterEditMode = () => setIsEditMode(true);
    const handleCancelEdit = () => {
        if (billingDetails) {
            // Re-initialize state from props, ensuring data types are correct
            const customerDetails = billingDetails.customer_bill_details || {};
            const employeeDetails = billingDetails.employee_payroll_details || {};
            const invoiceDetails = billingDetails.invoice_details || {};

            setEditableOvertime(parseInt(billingDetails.attendance?.overtime_days, 10) || 0);
            setAdjustments(billingDetails.adjustments || []);

            setEditableInvoice({
                number: invoiceDetails.number || '',
                amount: invoiceDetails.amount || '',
                date: invoiceDetails.date ? new Date(invoiceDetails.date) : null,
            });

            const customerPayment = customerDetails.payment_status || {};
            const employeePayment = employeeDetails.payment_status || {};

            setEditableSettlement({
                customer_is_paid: customerPayment.customer_is_paid || false,
                customer_payment_date: customerPayment.customer_payment_date ? new Date(customerPayment.customer_payment_date) : null,
                customer_payment_channel: customerPayment.customer_payment_channel || '',
                employee_is_paid: employeePayment.employee_is_paid || false,
                employee_payout_date: employeePayment.employee_payout_date ? new Date(employeePayment.employee_payout_date) : null,
                employee_payout_channel: employeePayment.employee_payout_channel || '',
                invoice_needed: customerPayment.invoice_needed || false,
                invoice_issued: customerPayment.invoice_issued || false,
            });
        }
        setIsEditMode(false);
    };
    const handleSaveAdjustment = (savedAdj) => {
        setAdjustments(prev => {
            const existing = prev.find(a => a.id === savedAdj.id);
            if (existing) return prev.map(a => a.id === savedAdj.id ? savedAdj : a);
            return [...prev, savedAdj];
        });
    };
    const handleOpenAdjustmentDialog = (adj = null, filter = 'all') => {
        setEditingAdjustment(adj);
        setAdjustmentFilter(filter);
        setIsAdjustmentDialogOpen(true);
    };
    const handleCloseAdjustmentDialog = () => {
        setIsAdjustmentDialogOpen(false);
        setEditingAdjustment(null);
    };
    const handleDeleteAdjustment = (id) => {
        setAdjustments(prev => prev.filter(a => a.id !== id));
    };
    const handleSettlementChange = (event) => {
        const { name, value, checked, type } = event.target;
        setEditableSettlement(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value,
        }));
    };
    const handleDateChange = (name, newDate) => {
        setEditableSettlement(prev => ({ ...prev, [name]: newDate }));
    };
    const handleOpenInvoiceDialog = () => setIsInvoiceDialogOpen(true);
    const handleCloseInvoiceDialog = () => setIsInvoiceDialogOpen(false);
    const handleSaveInvoice = (newInvoiceData) => setEditableInvoice(newInvoiceData);
    
    const customerData = billingDetails?.customer_bill_details || {};
    const employeeData = billingDetails?.employee_payroll_details || {};

    const handleOpenCycleEditDialog = () => setIsCycleEditDialogOpen(true);
    const handleCloseCycleEditDialog = () => setIsCycleEditDialogOpen(false);
    const handleCycleDateChange = (name, newDate) => {
        setEditableCycle(prev => ({ ...prev, [name]: newDate }));
    };
    const handleSaveCycle = async () => {
        if (!editableCycle.start || !editableCycle.end) {
            alert("请提供完整的周期起止日期！");
            return;
        }
        try {
            const billId = billingDetails.customer_bill_details.id;
            await api.post(`/billing/bills/${billId}/update-cycle`, {
                new_start_date: editableCycle.start.toISOString().split('T')[0],
                new_end_date: editableCycle.end.toISOString().split('T')[0],
            });
            onClose(); 
            alert("周期已更新，后续账单已顺延！请在新的月份查看后续账单。");
        } catch (error) {
            console.error("更新周期失败:", error);
        } finally {
            handleCloseCycleEditDialog();
        }
    };
    const renderCardContent = (data, isCustomer, billingDetails) => {
        if (!data || !data.groups) return null;

        // 从 calculation_details 中提取替班天数和费用
        const substituteDays = data.calculation_details?.substitute_days;
        const substituteDeduction = data.calculation_details?.substitute_deduction;

        const currentAdjustments = adjustments.filter(adj => AdjustmentTypes[adj.adjustment_type]?.type === (isCustomer ? 'customer' : 'employee'));
        const fieldOrder = {
            "级别与保证金": ["级别", "客交保证金", "定金"],
            "劳务周期": ["劳务时间段", "基本劳务天数", "加班天数", "替班天数", "总劳务天数"],
            "费用明细": ["管理费率", "管理费", "本次交管理费", "基础劳务费", "试工费", "加班费", "被替班费用", "优惠"],
            "薪酬明细": ["萌嫂保证金(工资)", "试工费", "基础劳务费", "加班费", "被替班费用", "5%奖励", "首月员工10%费用"],
        };

        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                {data.groups.map(group => (
                    <Box key={group.name}>
                        <Divider textAlign="left" sx={{ mb: 1.5 }}><Typography variant="overline" color="text.secondary">{group.name}</Typography></Divider>
                        <Grid container rowSpacing={1.5} columnSpacing={2}>
                            {(fieldOrder[group.name] || Object.keys(group.fields)).map(key => {
                                if (key === '替班天数') {
                                    if (!substituteDays || Number(substituteDays) === 0) return null;
                                    return (
                                        <React.Fragment key="substitute_days">
                                            <Grid item xs={5}><Typography variant="body2" color="text.secondary">被替班天数:</Typography></Grid>
                                            <Grid item xs={7} sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                                                <Typography variant="body1" sx={{ textAlign: 'right', fontWeight: 500, fontFamily: 'monospace', color: 'warning.main' }}>
                                                    {formatValue('替班天数', substituteDays)}
                                                </Typography>
                                            </Grid>
                                        </React.Fragment>
                                    );
                                }

                                if (key === '被替班费用') {
                                    if (!substituteDeduction || Number(substituteDeduction) === 0) return null;
                                    const tooltipContent = getTooltipContent(key, billingDetails, isCustomer);
                                    return (
                                        <React.Fragment key="substitute_deduction">
                                            <Grid item xs={5}><Typography variant="body2" color="text.secondary">被替班扣款:</Typography></Grid>
                                            <Grid item xs={7} sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                                                <Typography variant="body1" sx={{ textAlign: 'right', fontWeight: 500, fontFamily: 'monospace', color: 'error.main' }}>
                                                    {formatValue(key, substituteDeduction)}
                                                </Typography>
                                                {tooltipContent && !isEditMode && (
                                                    <Tooltip title={tooltipContent} arrow>
                                                        <InfoIcon sx={{ fontSize: '1rem', color: 'action.active', ml: 0.5, cursor: 'help' }} />
                                                    </Tooltip>
                                                )}
                                            </Grid>
                                        </React.Fragment>
                                    );
                                }

                                const isOvertimeField = key === '加班天数';
                                if (isEditMode && isOvertimeField) {
                                    return (
                                        <React.Fragment key="overtime_edit">
                                            <Grid item xs={5} sx={{ display: 'flex', alignItems: 'center' }}><Typography variant="body2" color="text.secondary">加班天数:</Typography></Grid>
                                            <Grid item xs={7} sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                                                <IconButton size="small" onClick={() => setEditableOvertime(p => Math.max(0, p - 1))}><RemoveIcon /></IconButton>
                                                <Typography variant="body1" sx={{ mx: 1, fontWeight: 500, fontFamily: 'monospace' }}>{editableOvertime}</Typography>
                                                <IconButton size="small" onClick={() => setEditableOvertime(p => p + 1)}><AddIcon /></IconButton>
                                            </Grid>
                                        </React.Fragment>
                                    );
                                }

                                if (!group.fields[key]) return null;
                                const value = group.fields[key];
                                const isOvertimeFeeField = key === '加班费';
                                const tooltipContent = getTooltipContent(key, billingDetails, isCustomer);
                                // 新增的逻辑：如果字段是“5%奖励”且值为0或“待计算”，则不显示
                                if (key === '5%奖励' && (Number(value) === 0 || value === '待计算')) {
                                    return null;
                                }
                                if ((isOvertimeField || isOvertimeFeeField) && Number(value) === 0) {
                                    return null;
                                }

                                return (
                                    <React.Fragment key={key}>
                                        <Grid item xs={5}><Typography variant="body2" color="text.secondary">{key}:</Typography></Grid>
                                        <Grid item xs={7} sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                                            <Typography variant="body1" sx={{ textAlign: 'right', fontWeight: 500, fontFamily: 'monospace' }}>
                                                {formatValue(key, value)}
                                            </Typography>
                                            {tooltipContent && !isEditMode && (
                                                <Tooltip title={tooltipContent} arrow>
                                                    <InfoIcon sx={{ fontSize: '1rem', color: 'action.active', ml: 0.5, cursor: 'help' }} />
                                                </Tooltip>
                                            )}
                                        </Grid>
                                    </React.Fragment>
                                );
                            })}
                        </Grid>
                    </Box>
                ))}
                
                <Box>
                    <Divider textAlign="left" sx={{ mb: 1.5 }}><Typography variant="overline" color="text.secondary">财务调整</Typography></Divider>
                    {currentAdjustments.length > 0 ? (
                        <List dense disablePadding>
                            {currentAdjustments.map(adj => (
                                 <ListItem
                                    key={adj.id}
                                    button={isEditMode}
                                    onClick={isEditMode ? () => { setEditingAdjustment(adj); setIsAdjustmentDialogOpen(true); } : undefined}
                                    secondaryAction={isEditMode && (
                                        // --- 核心修正：在删除按钮的 onClick 中阻止事件冒泡 ---
                                        <IconButton
                                            edge="end"
                                            size="small"
                                            onClick={(e) => {
                                                e.stopPropagation(); // 阻止事件冒泡到 ListItem
                                                handleDeleteAdjustment(adj.id);
                                            }}
                                        >
                                            <DeleteIcon fontSize="small"/>
                                        </IconButton>
                                    )}
                                >
                                    <ListItemIcon sx={{ minWidth: 'auto', mr: 1.5 }}>{AdjustmentTypes[adj.adjustment_type]?.effect > 0 ? <ArrowUpwardIcon color="success" fontSize="small"/> : <ArrowDownwardIcon color="error" fontSize="small"/>}</ListItemIcon>
                                    <ListItemText 
                                        primary={AdjustmentTypes[adj.adjustment_type]?.label} 
                                        secondary={
                                            <Typography variant="body2" component="span" sx={{ whiteSpace: 'pre-wrap', color: 'text.secondary' }}>
                                                {adj.description}
                                            </Typography>
                                        } 
                                    />
                                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 'bold' }}>{AdjustmentTypes[adj.adjustment_type]?.effect > 0 ? '+' : '-'} {formatValue('', adj.amount)}</Typography>
                                </ListItem>
                            ))}
                        </List>
                    ) : (<Typography variant="caption" color="text.secondary" sx={{pl:1}}>暂无调整项</Typography>)}
                    {isEditMode && (<Box sx={{ mt: 1, display: 'flex', justifyContent: 'center' }}><Button size="small" variant="text" startIcon={<AddIcon />} onClick={() => { setEditingAdjustment(null); setAdjustmentFilter(isCustomer ? 'customer' : 'employee'); setIsAdjustmentDialogOpen(true); }}>添加调整</Button></Box>)}
                </Box>

                <Box>
                    <Divider textAlign="left" sx={{ mb: 1.5 }}><Typography variant="overline" color="text.secondary">最终结算</Typography></Divider>
                    <Grid container>
                        {Object.entries(data.final_amount).map(([key, value]) => {
                            const tooltipContent = getTooltipContent(key, billingDetails);
                            return (
                                <React.Fragment key={key}>
                                    <Grid item xs={5}><Typography variant="body2" color="text.secondary">{key}:</Typography></Grid>
                                    <Grid item xs={7} sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                                        <Typography variant="h4" sx={{ fontWeight: 'bold', fontFamily: 'monospace', color: key.includes('应付') ? 'error.main' : 'success.main' }}>
                                            {formatValue(key, value)}
                                        </Typography>
                                        {tooltipContent && !isEditMode && (
                                            <Tooltip title={tooltipContent} arrow><InfoIcon sx={{ fontSize: '1rem', color: 'action.active', ml: 0.5, cursor: 'help' }} /></Tooltip>
                                        )}
                                    </Grid>
                                </React.Fragment>
                            );
                        })}
                    </Grid>
                </Box>
            </Box>
        );
    };
    const InvoiceRecordView = () => {
        if (!editableSettlement.invoice_needed) {
            return <Typography variant="body1" sx={{ fontWeight: 500, mt: 0.5 }}>无需开票</Typography>;
        }
        if (!editableSettlement.invoice_issued) {
            return <Typography variant="body1" sx={{ fontWeight: 500, mt: 0.5, color: 'warning.main' }}>待开票</Typography>;
        }

        let formattedDate = '未录入';
        if (editableInvoice.date) {
            // 创建一个新的 Date 对象来处理字符串或 Date 对象
            const dateObj = new Date(editableInvoice.date);
            if (!isNaN(dateObj.getTime())) {
                // 使用 toLocaleDateString 避免时区问题
                formattedDate = dateObj.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
            }
        }

        const details = `开票金额: ${editableInvoice.amount || '未录入'}, 发票号: ${editableInvoice.number || '未录入'}, 日期: ${formattedDate}`;

        return (
            <Box>
                <Typography variant="body1" sx={{ fontWeight: 500, mt: 0.5, color: 'success.main' }}>已开票</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{details}</Typography>
            </Box>
        );
    };
    return (
        <>
            <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth scroll="paper">
                <DialogTitle variant="h5" sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Box>
                        财务管理 - {contract?.customer_name} ({contract?.employee_name} / {billingMonth})
                    </Box>
                    <Box>
                        <Button
                            component="a"
                            href={`/contracts/${contract?.contract_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            startIcon={<ArticleOutlinedIcon />}
                            variant="outlined"
                            size="small"
                        >
                            查看合同
                        </Button>
                        <IconButton onClick={onClose} sx={{ ml: 1 }}><CloseIcon /></IconButton>
                    </Box>
                </DialogTitle>
                <DialogContent dividers sx={{ bgcolor: 'grey.50', p: { xs: 1, sm: 2, md: 3 } }}>
                    {isEditMode && (<Alert severity="info" sx={{ mb: 2 }}>您正处于编辑模式。所有更改将在点击“保存”后生效。</Alert>)}
                    {loading ? (<Box sx={{ display: 'flex', justifyContent: 'center', p: 5 }}><CircularProgress /></Box>) 
                    : billingDetails ? (
                        <Grid container spacing={3}>
                            <Grid item xs={12} md={6}><Paper sx={{ p: 3, borderRadius: 2, boxShadow: 1 }}><Typography variant="h6" gutterBottom>客户账单</Typography>{renderCardContent(customerData, true, billingDetails)}</Paper></Grid>
                            <Grid item xs={12} md={6}><Paper sx={{ p: 3, borderRadius: 2, boxShadow: 1 }}><Typography variant="h6" gutterBottom>员工薪酬</Typography>{renderCardContent(employeeData, false, billingDetails)}</Paper></Grid>
                            {!billingDetails?.is_substitute_bill && (
                                <Grid item xs={12}>
                                    <Paper sx={{ p: 3, borderRadius: 2, boxShadow: 1 }}>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                                            <Typography variant="h6">替班记录</Typography>
                                            <Button
                                                variant="outlined"
                                                size="small"
                                                startIcon={<PeopleAltIcon />}
                                                onClick={handleOpenSubstituteDialog}
                                                disabled={isEditMode}
                                            >
                                                添加替班记录
                                            </Button>
                                        </Box>
                                        <List dense>
                                            {substituteRecords.length > 0 ? substituteRecords.map(record => (
                                                <ListItem key={record.id}>
                                                    <ListItemText
                                                        primary={`${record.substitute_user_name} (日薪: ¥${record.substitute_salary})`}
                                                        secondary={`从 ${formatDate(record.start_date)} 到 ${formatDate(record.end_date)}`}
                                                    />
                                                    <ListItemSecondaryAction>
                                                        <IconButton edge="end" aria-label="delete" disabled={isEditMode} onClick={() => handleDeleteSubstitute(record.id)}>
                                                            <DeleteIcon />
                                                        </IconButton>
                                                    </ListItemSecondaryAction>
                                                </ListItem>
                                            )) : (
                                                <Typography variant="body2" color="text.secondary" sx={{ pl: 2 }}>暂无替班记录</Typography>
                                            )}
                                        </List>
                                    </Paper>
                                </Grid>
                            )}
                            <Grid item xs={12}>
                                <Paper sx={{ p: 3, borderRadius: 2, boxShadow: 1 }}>
                                    <Typography variant="h6" gutterBottom>结算与发票状态</Typography>
                                    {isEditMode ? (
                                        <Grid container spacing={3} sx={{ mt: 1 }}>
                                            <Grid item xs={12} md={6}>
                                                <Divider textAlign="left" sx={{ mb: 2 }}><Chip label="客户打款" size="small" /></Divider>
                                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                                    <FormControlLabel control={<Switch checked={editableSettlement.customer_is_paid} onChange={handleSettlementChange} name="customer_is_paid" />} label="客户是否已打款" />
                                                    {editableSettlement.customer_is_paid && (<><DatePicker label="打款日期" value={editableSettlement.customer_payment_date} onChange={(d) => handleDateChange('customer_payment_date', d)} /><TextField label="打款渠道/备注" name="customer_payment_channel" value={editableSettlement.customer_payment_channel} onChange={handleSettlementChange} fullWidth /></>)}
                                                </Box>
                                            </Grid>
                                            <Grid item xs={12} md={6}>
                                                <Divider textAlign="left" sx={{ mb: 2 }}><Chip label="员工领款" size="small" /></Divider>
                                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                                    <FormControlLabel control={<Switch checked={editableSettlement.employee_is_paid} onChange={handleSettlementChange} name="employee_is_paid" />} label="员工是否已领款" />
                                                    {editableSettlement.employee_is_paid && (<><DatePicker label="领款日期" value={editableSettlement.employee_payout_date} onChange={(d) => handleDateChange('employee_payout_date', d)} /><TextField label="领款渠道/备注" name="employee_payout_channel" value={editableSettlement.employee_payout_channel} onChange={handleSettlementChange} fullWidth /></>)}
                                                </Box>
                                            </Grid>
                                            <Grid item xs={12}>
                                                <Divider textAlign="left" sx={{ mt: 2, mb: 2 }}><Chip label="发票管理" size="small" /></Divider>
                                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}>
                                                    <FormControlLabel control={<Switch checked={editableSettlement.invoice_needed} onChange={handleSettlementChange} name="invoice_needed" />} label="是否需要发票" />
                                                    {editableSettlement.invoice_needed && (<Box sx={{ pl: 2, borderLeft: '2px solid', borderColor: 'divider', width: '100%' }}><FormControlLabel control={<Switch checked={editableSettlement.invoice_issued} onChange={handleSettlementChange} name="invoice_issued" />} label="是否已开发票" /><Button size="small" startIcon={<ReceiptLongIcon />} onClick={handleOpenInvoiceDialog} disabled={!editableSettlement.invoice_issued} sx={{ml: 2}}>管理发票详情 (非必填)</Button></Box>)}
                                                </Box>
                                            </Grid>
                                        </Grid>
                                    ) : (
                                        <Grid container spacing={2} sx={{ mt: 1 }}>
                                            <Grid item xs={6} md={3}>
                                                <Typography variant="body2" color="text.secondary">客户是否打款</Typography>
                                                <Box>
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                                                        {editableSettlement.customer_is_paid ? <CheckCircleIcon sx={{ fontSize: '1.2rem', color: 'success.main' }} /> : <HighlightOffIcon sx={{fontSize: '1.2rem', color: 'text.secondary' }} />}
                                                        <Typography variant="body1" sx={{ fontWeight: 500 }}>{editableSettlement.customer_is_paid ? '是' : '否'}</Typography>
                                                    </Box>
                                                    {editableSettlement.customer_is_paid && (
                                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, pl: '2px' }}>
                                                            {editableSettlement.customer_payment_date ? formatDate(editableSettlement.customer_payment_date.toISOString()) : '—'} /{editableSettlement.customer_payment_channel || '—'}
                                                        </Typography>
                                                    )}
                                                </Box>
                                            </Grid>
                                            <Grid item xs={6} md={6}>
                                                <Typography variant="body2" color="text.secondary">发票记录</Typography>
                                                <InvoiceRecordView />
                                            </Grid>
                                            <Grid item xs={6} md={3}>
                                                <Typography variant="body2" color="text.secondary">员工是否领款</Typography>
                                                <Box>
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                                                        {editableSettlement.employee_is_paid ? <CheckCircleIcon sx={{ fontSize: '1.2rem', color: 'success.main' }} /> : <HighlightOffIcon sx={{fontSize: '1.2rem', color: 'text.secondary' }} />}
                                                        <Typography variant="body1" sx={{ fontWeight: 500 }}>{editableSettlement.employee_is_paid ? '是' : '否'}</Typography>
                                                    </Box>
                                                    {editableSettlement.employee_is_paid && (
                                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, pl: '2px' }}>
                                                            {editableSettlement.employee_payout_date ? formatDate(editableSettlement.employee_payout_date.toISOString()) : '—'} /{editableSettlement.employee_payout_channel || '—'}
                                                        </Typography>
                                                    )}
                                                </Box>
                                            </Grid>
                                        </Grid>
                                    )}
                                </Paper>
                            </Grid>
                            <Grid item xs={12}>
                                <Paper sx={{ p: 3, borderRadius: 2, boxShadow: 1 }}>
                                    <Typography variant="h6" gutterBottom>操作日志</Typography>
                                    {loadingLogs ? <CircularProgress size={24} /> : (<Timeline sx={{ p: 0, m: 0 }}>{activityLogs.length > 0 ? activityLogs.map((log, index) => (<LogItem key={log.id} log={log} isLast={index === activityLogs.length - 1} />)) : (<Typography variant="body2" color="text.secondary">暂无操作日志</Typography>)}</Timeline>)}
                                </Paper>
                            </Grid>
                        </Grid>
                    ) : (<Typography color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>无此月份的账单数据，请先计算账单。</Typography>)}
                </DialogContent>
                <DialogActions sx={{ p: 2 }}>
                    {isEditMode ? (<><Button onClick={handleCancelEdit} variant="text" startIcon={<CancelIcon />}>取消</Button><Button onClick={handleSave} variant="contained" color="primary" startIcon={<SaveIcon />}>保存并重新计算</Button></>) 
                    : (<><Button onClick={onClose}>关闭</Button><Button onClick={handleEnterEditMode} variant="contained" startIcon={<EditIcon />}>进入编辑模式</Button></>)}
                </DialogActions>
            </Dialog>
            <InvoiceDetailsDialog open={isInvoiceDialogOpen} onClose={handleCloseInvoiceDialog} onSave={handleSaveInvoice} invoiceData={editableInvoice} defaultInvoiceAmount={customerData?.final_amount?.客应付款}/>
            <Dialog open={isCycleEditDialogOpen} onClose={handleCloseCycleEditDialog} maxWidth="xs" fullWidth>
                <DialogTitle>修改并顺延服务周期</DialogTitle>
                <DialogContent>
                    <Alert severity="warning" sx={{mb: 2}}>注意：修改本期结束日期将会自动顺延所有后续的账单周期和月份。</Alert>
                    <Grid container spacing={2} sx={{pt: 1}}>
                        <Grid item xs={12}><DatePicker label="本期开始日期" value={editableCycle.start} onChange={(d) => handleCycleDateChange('start', d)} sx={{width: '100%'}} /></Grid>
                        <Grid item xs={12}><DatePicker label="本期结束日期" value={editableCycle.end} onChange={(d) => handleCycleDateChange('end', d)} sx={{width: '100%'}} /></Grid>
                    </Grid>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseCycleEditDialog}>取消</Button>
                    <Button onClick={handleSaveCycle} variant="contained">确认修改</Button>
                </DialogActions>
            </Dialog>
            <AdjustmentDialog open={isAdjustmentDialogOpen} onClose={handleCloseAdjustmentDialog} onSave={handleSaveAdjustment} adjustment={editingAdjustment} typeFilter={adjustmentFilter}/>
            <SubstituteDialog
                open={isSubstituteDialogOpen}
                onClose={handleCloseSubstituteDialog}
                onSave={handleSaveSubstitute}
                contractId={contract?.contract_id}
                contractType={contract?.contract_type_value}
                billMonth={billingMonth}
                originalBillCycleStart={billingDetails?.cycle_start_date}
                originalBillCycleEnd={billingDetails?.cycle_end_date}
            />
        </>
    );
};

export default FinancialManagementModal;
