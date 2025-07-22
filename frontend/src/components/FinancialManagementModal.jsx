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
    CheckCircle as CheckCircleIcon, HighlightOff as HighlightOffIcon
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { Timeline } from '@mui/lab';

import api from '../api/axios'; 
import AdjustmentDialog, { AdjustmentTypes } from './AdjustmentDialog';
import InvoiceDetailsDialog from './InvoiceDetailsDialog';
import LogItem from './LogItem';

// --- 辅助函数 ---
const formatDateRange = (dateRangeString) => {
    if (!dateRangeString || !dateRangeString.includes('~')) return '—';
    const [startStr, endStr] = dateRangeString.split('~').map(d => d.trim());
    if (startStr === 'N/A' || endStr === 'N/A') return '—';
    try {
        const startDate = new Date(startStr);
        const endDate = new Date(endStr);
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return '无效日期';
        const diffTime = Math.abs(endDate - startDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
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
    if (key.includes('费率')) return `${value}`;
    const isMoney = !key.includes('天数') && !key.includes('费率');
    if (isMoney && /^-?\d+(\.\d+)?$/.test(String(value))) {
        const num = Number(value);
        return isNaN(num) ? String(value) : `¥${num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return String(value);
};

const getTooltipContent = (fieldName, billingDetails) => {
    const calc = billingDetails?.customer_bill_details?.calculation_details;
    // console.log('calc:', calc.calculation_log);
    if (!calc?.calculation_log) return null;

    const log = calc.calculation_log;
    const fieldToLogKeyMap = {
        '基础劳务费': '基础劳务费',
        '加班费': '加班费',
        '管理费': '管理费',
        '客应付款': '客应付款',
        '萌嫂保证金(工资)': '萌嫂保证金(工资)',
        '5%奖励': '5%奖励',
        '萌嫂应领款': '萌嫂应领款',
        '本次交管理费': '本次交管理费',
        '首月员工10%费用': '首月员工10%费用',
        '加班工资': '加班费', // "加班工资" and "加班费" can share the same log entry
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
        }
    }, [open, billingDetails]);

    const handleSave = () => {
        // 1. 从 props 和 state 中安全地获取所有必需的数据
        const contractId = contract?.id;
        const cycleStartDate = billingDetails?.cycle_start_date;
        const cycleEndDate = billingDetails?.cycle_end_date;
    
        // 2. 检查所有必需的数据是否存在，如果不存在则报错并返回
        if (!contractId || !billingMonth || !cycleStartDate || !cycleEndDate) {
            alert("无法保存，缺少关键的合同或周期信息。");
            console.error("Save failed due to missing critical data:", {
                contractId,
                billingMonth,
                cycleStartDate,
                cycleEndDate
            });
            return;
        }
    
        const [year, month] = billingMonth.split('-').map(Number);
    
        // 3. 构建一个完整的 payload 对象
        const payload = {
            // 关键的身份信息
            contract_id: contractId,
            billing_year: year,
            billing_month: month,
            cycle_start_date: cycleStartDate,
            cycle_end_date: cycleEndDate,
    
            // 用户修改的数据
            overtime_days: editableOvertime,
            adjustments: adjustments,
            settlement_status: { ...editableSettlement, invoice_details: editableInvoice }
        };
    
        // 4. 调用 onSave 并退出编辑模式
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
    const renderCardContent = (data, isCustomer) => {
        // console.log(`Rendering ${isCustomer ? 'customer' : 'employee'} data:`, data.groups);
        if (!data || !data.groups) return null;
        const currentAdjustments = adjustments.filter(adj => AdjustmentTypes[adj.adjustment_type]?.type === (isCustomer ? 'customer' : 'employee'));
        const fieldOrder = {
            "级别与保证金": ["级别", "客交保证金", "定金"],
            "劳务周期": ["劳务时间段", "基本劳务天数", "加班天数", "总劳务天数"],
            "费用明细": ["基础劳务费", "加班费", "管理费", "本次交管理费", "优惠"],
            "薪酬明细": ["萌嫂保证金(工资)", "基础劳务费", "加班费", "5%奖励", "首月员工10%费用"],
        };
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                {data.groups.map(group => (
                    <Box key={group.name}>
                        <Divider textAlign="left" sx={{ mb: 1.5 }}><Typography variant="overline" color="text.secondary">{group.name}</Typography></Divider>
                        <Grid container rowSpacing={1.5} columnSpacing={2}>
                            {/* --- 核心修正：使用预设的顺序数组来渲染 --- */}
                            {(fieldOrder[group.name] || Object.keys(group.fields)).map(key => {
                                if (!group.fields[key]) return null; // 如果字段不存在则不渲染
                                const value = group.fields[key];
                                const isOvertimeField = key === '加班天数' && isCustomer;
                                const tooltipContent = getTooltipContent(key, billingDetails);
                                return (
                                    <React.Fragment key={key}>
                                        <Grid item xs={5}><Typography variant="body2" color="text.secondary">{key}:</Typography></Grid>
                                         <Grid item xs={7} sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                                            {isEditMode && isOvertimeField ? (
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                    {/* --- 核心修正：确保图标被正确渲染 --- */}
                                                    <IconButton size="small" onClick={() => setEditableOvertime(p => Math.max(0, p - 1))}><RemoveIcon sx={{ fontSize: '1rem' }} /></IconButton>
                                                    <Typography variant="body1" sx={{ fontWeight: 500, minWidth: '40px', textAlign: 'center'}}>{editableOvertime}天</Typography>
                                                    <IconButton size="small" onClick={() => setEditableOvertime(p => p + 1)}><AddIcon sx={{ fontSize: '1rem' }} /></IconButton>
                                                </Box>
                                            ) : (
                                                <Typography variant="body1" sx={{ textAlign: 'right', fontWeight: 500, fontFamily: 'monospace' }}>
                                                    {key === '劳务时间段' ? formatDateRange(value) : formatValue(key, value)}
                                                </Typography>
                                            )}
                                            {tooltipContent && !isEditMode && (
                                                <Tooltip title={tooltipContent} arrow><InfoIcon sx={{ fontSize: '1rem', color: 'action.active', ml: 0.5,cursor: 'help' }} /></Tooltip>
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
                                    <ListItemText primary={AdjustmentTypes[adj.adjustment_type]?.label} secondary={adj.description} />
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
                <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    财务管理 - {contract?.customer_name} ({contract?.employee_name} / {billingMonth})
                    <IconButton onClick={onClose}><CloseIcon /></IconButton>
                </DialogTitle>
                <DialogContent dividers sx={{ bgcolor: 'grey.50', p: { xs: 1, sm: 2, md: 3 } }}>
                    {isEditMode && (<Alert severity="info" sx={{ mb: 2 }}>您正处于编辑模式。所有更改将在点击“保存”后生效。</Alert>)}
                    {loading ? (<Box sx={{ display: 'flex', justifyContent: 'center', p: 5 }}><CircularProgress /></Box>) 
                    : billingDetails ? (
                        <Grid container spacing={3}>
                            <Grid item xs={12} md={6}><Paper sx={{ p: 3, borderRadius: 2, boxShadow: 1 }}><Typography variant="h6" gutterBottom>客户账单</Typography>{renderCardContent(customerData, true)}</Paper></Grid>
                            <Grid item xs={12} md={6}><Paper sx={{ p: 3, borderRadius: 2, boxShadow: 1 }}><Typography variant="h6" gutterBottom>员工薪酬</Typography>{renderCardContent(employeeData, false)}</Paper></Grid>
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
        </>
    );
};

export default FinancialManagementModal;
