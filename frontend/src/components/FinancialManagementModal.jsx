// frontend/src/components/FinancialManagementModal.jsx (最终完整版，修复 api 未定义错误)

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
    CheckCircle as CheckCircleIcon, HighlightOff as HighlightOffIcon // 新增图标
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { Timeline, TimelineItem, TimelineSeparator, TimelineConnector, TimelineContent, TimelineDot } from '@mui/lab';

// **核心修正**: 导入我们定义的 axios 实例
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
const formatValue = (key, value) => {
    if (value === null || value === undefined || value === '' || String(value).includes('待计算'))
        return <Box component="span" sx={{ color: 'text.disabled' }}>{value || '—'}</Box>;
    if (key === '加班天数') return `${value} 天`;
    if (key.includes('费率')) return `${value}`;
    const isMoney = ['级别', '定金', '保证金', '劳务费', '管理费', '工资', '应付', '应领', '奖励', '结余', '优惠', '增款', '退款', '减款'].some(k => key.includes(k));
    if (isMoney || /^-?\d+(\.\d+)?$/.test(String(value))) {
        const num = Number(value);
        return isNaN(num) ? String(value) : `¥${num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return String(value);
};


// --- 主组件 ---
const FinancialManagementModal = ({ open, onClose, contract, billingMonth, billingDetails, loading, onSave }) => {
    const [isEditMode, setIsEditMode] = useState(false);
    
    // --- 编辑模式下的所有临时状态 ---
    const [editableOvertime, setEditableOvertime] = useState(0);
    const [adjustments, setAdjustments] = useState([]);
    const [editableSettlement, setEditableSettlement] = useState({
        customer_is_paid: false, customer_payment_date: null, customer_payment_channel: '',
        employee_is_paid: false, employee_payout_date: null, employee_payout_channel: '',
        invoice_needed: false, invoice_issued: false,
    });
    const [editableInvoice, setEditableInvoice] = useState({ number: '', amount: '', date: null });
    const [isAdjustmentDialogOpen, setIsAdjustmentDialogOpen] = useState(false);
    const [editingAdjustment, setEditingAdjustment] = useState(null);
    const [adjustmentFilter, setAdjustmentFilter] = useState('all');
    const [isInvoiceDialogOpen, setIsInvoiceDialogOpen] = useState(false);
    const [activityLogs, setActivityLogs] = useState([]);
    const [loadingLogs, setLoadingLogs] = useState(false);

    // **固定的UI配置**
    const fieldGroups = {
        customer: {
            '合同基石': ['级别', '定金', '客交保证金'],
            '本期输入': ['加班天数', '劳务时间段', '出勤总天数'],
            '费用明细': ['基本劳务费', '加班工资', '管理费率', '管理费'],
            '财务调整': [], // 财务调整将通过 state 动态渲染
            '最终结算': ['客应付款']
        },
        employee: {
            '薪酬明细': ['萌嫂保证金(工资)', '加班费', '5%奖励'],
            '财务调整': [],
            '最终结算': ['萌嫂应领款']
        }
    };
    
    useEffect(() => {
        if (open && billingDetails) {
            // 初始化所有编辑状态
            const customerDetails = billingDetails.customer_bill_details || {};
            const employeeDetails = billingDetails.employee_payroll_details || {};
            const invoiceDetails = billingDetails.invoice_details || {};
            
            setEditableOvertime(parseInt(customerDetails.加班天数, 10) || 0);
            
            const customerPaymentInfo = customerDetails.打款时间及渠道 || '';
            const employeePaymentInfo = employeeDetails.领款时间及渠道 || '';
            const invoiceRecord = customerDetails.发票记录 || '';

            setEditableSettlement({
                customer_is_paid: customerDetails.是否打款 === '是',
                customer_payment_date: customerPaymentInfo.includes('/') && new Date(customerPaymentInfo.split('/')[0].trim()) ? new Date(customerPaymentInfo.split('/')[0].trim()) : null,
                customer_payment_channel: customerPaymentInfo.includes('/') ? customerPaymentInfo.split('/')[1].trim() : '',
                employee_is_paid: employeeDetails.是否领款 === '是',
                employee_payout_date: employeePaymentInfo.includes('/') && new Date(employeePaymentInfo.split('/')[0].trim()) ? new Date(employeePaymentInfo.split('/')[0].trim()) : null,
                employee_payout_channel: employeePaymentInfo.includes('/') ? employeePaymentInfo.split('/')[1].trim() : '',
                invoice_needed: invoiceRecord !== '无需开票',
                invoice_issued: String(invoiceRecord).startsWith('已开票'),
            });

            setAdjustments(billingDetails.adjustments || []);
            setEditableInvoice(invoiceDetails);

            // 获取日志
            // **核心修正**: 同时获取 billId 和 payrollId
            const billId = customerDetails.id;
            const payrollId = employeeDetails.id;

            if (billId || payrollId) {
                setLoadingLogs(true);
                // **核心修正**: 将两个ID都作为参数发送
                api.get('/billing/logs', { params: { bill_id: billId, payroll_id: payrollId } })
                    .then(response => {
                        setActivityLogs(response.data);
                    })
                    .catch(error => {
                        console.error("获取操作日志失败:", error);
                        setActivityLogs([]);
                    })
                    .finally(() => {
                        setLoadingLogs(false);
                    });
            } else {
                setActivityLogs([]);
            }
        }
    }, [open, billingDetails]);

    const handleEnterEditMode = () => setIsEditMode(true);
    const handleCancelEdit = () => {
        if (billingDetails) {
            const customerDetails = billingDetails.customer_bill_details || {};
            const employeeDetails = billingDetails.employee_payroll_details || {};
            const invoiceDetails = billingDetails.invoice_details || {};
            const overtime = customerDetails.加班天数;
            setEditableOvertime(parseInt(overtime, 10) || 0);
            setAdjustments(billingDetails.adjustments || []);
            setEditableInvoice(invoiceDetails);
            const invoiceRecord = customerDetails.发票记录 || '';
            const customerPaymentInfo = customerDetails.打款时间及渠道 || '';
            const employeePaymentInfo = employeeDetails.领款时间及渠道 || '';
            setEditableSettlement({
                customer_is_paid: customerDetails.是否打款 === '是',
                customer_payment_date: customerPaymentInfo.includes('/') && new Date(customerPaymentInfo.split('/')[0].trim()) ? new Date(customerPaymentInfo.split('/')[0].trim()) : null,
                customer_payment_channel: customerPaymentInfo.includes('/') ? customerPaymentInfo.split('/')[1].trim() : '',
                employee_is_paid: employeeDetails.是否领款 === '是',
                employee_payout_date: employeePaymentInfo.includes('/') && new Date(employeePaymentInfo.split('/')[0].trim()) ? new Date(employeePaymentInfo.split('/')[0].trim()) : null,
                employee_payout_channel: employeePaymentInfo.includes('/') ? employeePaymentInfo.split('/')[1].trim() : '',
                invoice_needed: invoiceRecord !== '无需开票',
                invoice_issued: String(invoiceRecord).startsWith('已开票'),
            });
        }
        setIsEditMode(false);
    };
    const handleSave = () => {
        onSave({ 
            overtime_days: editableOvertime,
            adjustments: adjustments,
            settlement_status: { ...editableSettlement, invoice_details: editableInvoice }
        });
        setIsEditMode(false);
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
    const handleSaveAdjustment = (savedAdj) => {
        setAdjustments(prev => {
            const existingIndex = prev.findIndex(a => a.id === savedAdj.id);
            if (existingIndex > -1) {
                const newAdjustments = [...prev];
                newAdjustments[existingIndex] = savedAdj;
                return newAdjustments;
            } else {
                return [...prev, savedAdj];
            }
        });
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
    
    const renderCardContent = (data, isCustomer) => {
        const groupConfig = isCustomer ? fieldGroups.customer : fieldGroups.employee;
        const currentAdjustments = adjustments.filter(adj => 
            AdjustmentTypes[adj.adjustment_type]?.type === (isCustomer ? 'customer' : 'employee')
        );
        
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                {Object.entries(groupConfig).map(([groupName, fields]) => {
                    if (groupName === '财务调整') {
                        if (!isEditMode && currentAdjustments.length === 0) return null;
                        return (
                            <Box key={groupName}>
                                <Divider textAlign="left" sx={{ mb: 1.5, '&::before, &::after': { borderColor: 'grey.200' } }}>
                                    <Typography variant="overline" color="text.secondary">{groupName}</Typography>
                                </Divider>
                                {currentAdjustments.length === 0 && isEditMode && (
                                     <Typography variant="caption" color="text.secondary" sx={{pl:1}}>暂无调整项</Typography>
                                )}
                                <List dense disablePadding>
                                    {currentAdjustments.map(adj => (
                                        <ListItem key={adj.id} button={isEditMode} onClick={isEditMode ? () => handleOpenAdjustmentDialog(adj, isCustomer ? 'customer' : 'employee') : undefined} secondaryAction={isEditMode && (<IconButton edge="end" size="small" onClick={(e) => { e.stopPropagation(); handleDeleteAdjustment(adj.id); }}><DeleteIcon fontSize="small"/></IconButton>)} sx={{ my: 0.5, px: 1, borderRadius: 1, '&:hover': { bgcolor: isEditMode ? 'action.hover' : 'transparent'} }}>
                                            <ListItemIcon sx={{ minWidth: 'auto', mr: 1.5 }}>
                                                {AdjustmentTypes[adj.adjustment_type]?.effect > 0 ? <ArrowUpwardIcon color="success" fontSize="small"/> : <ArrowDownwardIcon color="error" fontSize="small"/>}
                                            </ListItemIcon>
                                            <ListItemText primary={AdjustmentTypes[adj.adjustment_type]?.label} secondary={adj.description} sx={{ pr: 4 }} />
                                            <Typography variant="body2" noWrap sx={{ fontFamily: 'monospace', fontWeight: 'bold', ml: 1 }}>
                                                {AdjustmentTypes[adj.adjustment_type]?.effect > 0 ? '+' : '-'} {formatValue('', adj.amount)}
                                            </Typography>
                                        </ListItem>
                                    ))}
                                </List>
                                {isEditMode && (
                                    <Box sx={{ mt: 1, display: 'flex', justifyContent: 'center' }}>
                                        <Button size="small" variant="text" startIcon={<AddIcon />} onClick={() => handleOpenAdjustmentDialog(null, isCustomer ? 'customer' : 'employee')}>
                                            添加{isCustomer ? '客户' : '员工'}侧调整
                                        </Button>
                                    </Box>
                                )}
                            </Box>
                        );
                    }

                    const visibleFields = fields.filter(key => {
                        if (!data.hasOwnProperty(key)) return false;
                        if (isEditMode) return true;
                        const zeroHiddenFields = ['加班天数', '加班工资'];
                        if (zeroHiddenFields.includes(key)) {
                            const numericValue = parseFloat(String(data[key]).replace(/[^0-9.-]+/g, ""));
                            return isNaN(numericValue) ? true : numericValue !== 0;
                        }
                        return true;
                    });
                    
                    if (visibleFields.length === 0) return null;

                    return (
                        <Box key={groupName}>
                            <Divider textAlign="left" sx={{ mb: 1.5, '&::before, &::after': { borderColor: 'grey.200' } }}>
                                <Typography variant="overline" color="text.secondary">{groupName}</Typography>
                            </Divider>
                            <Grid container rowSpacing={1.5} columnSpacing={2}>
                                {visibleFields.map(key => (
                                    <React.Fragment key={key}>
                                        <Grid item xs={5}><Typography variant="body2" color="text.secondary">{key}:</Typography></Grid>
                                        <Grid item xs={7}>
                                            {isEditMode && key === '加班天数' && isCustomer ? (
                                                <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 0.5 }}>
                                                    <IconButton size="small" onClick={() => setEditableOvertime(Math.max(0, editableOvertime - 1))}><RemoveIcon sx={{ fontSize: '1rem' }} /></IconButton>
                                                    <Typography variant="body1" sx={{ fontWeight: 500, minWidth: '40px', textAlign: 'center' }}>{editableOvertime}天</Typography>
                                                    <IconButton size="small" onClick={() => setEditableOvertime(editableOvertime + 1)}><AddIcon sx={{ fontSize: '1rem' }} /></IconButton>
                                                    <Tooltip title="添加加班备注">
                                                        <IconButton size="small" color="primary">
                                                            <InfoIcon sx={{ fontSize: '1.125rem' }} />
                                                        </IconButton>
                                                    </Tooltip>
                                                </Box>
                                            ) : (
                                                <Typography variant="body1" sx={{ textAlign: 'right', fontWeight: 500, fontFamily: 'monospace', color: (key.includes('应付') || key.includes('应领')) ? (key.includes('应付') ? 'error.main' : 'success.main') : 'text.primary', fontWeight: (key.includes('应付') || key.includes('应领')) ? 'bold' : 500 }}>
                                                    {key === '劳务时间段' ? formatDateRange(data[key]) : formatValue(key, data[key])}
                                                </Typography>
                                            )}
                                        </Grid>
                                    </React.Fragment>
                                ))}
                            </Grid>
                        </Box>
                    );
                })}
            </Box>
        );
    };

    // **核心修正**: 一个专门用于渲染发票记录的辅助组件
    const InvoiceRecordView = ({ record }) => {
        if (!record || record === '无需开票') {
            return <Typography variant="body1" sx={{ fontWeight: 500, mt: 0.5 }}>无需开票</Typography>;
        }
        if (record === '待开票') {
            return <Typography variant="body1" sx={{ fontWeight: 500, mt: 0.5, color: 'warning.main' }}>待开票</Typography>;
        }
        
        const match = record.match(/已开票 \((.*)\)/);
        const details = match ? match[1] : '';

        return (
            <Box>
                <Typography variant="body1" sx={{ fontWeight: 500, mt: 0.5 }}>已开票</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{details}</Typography>
            </Box>
        );
    };

    const handleForceRecalculate = () => {
        if (!contract) return;
        const [year, month] = billingMonth.split('-').map(Number);
        // 这里可以直接调用新的 API，也可以复用已有的 task polling 逻辑
        // 为简单起见，我们直接调用
        api.post('/billing/force-recalculate', {
            contract_id: contract.id,
            year: year,
            month: month,
        }).then(response => {
            alert('强制重算任务已提交！详情即将刷新...');
            // 可以在这里启动一个轮询或延时来刷新详情
            setTimeout(() => {
                // 重新触发详情加载
                // 这需要将 handleOpenDetailDialog 的逻辑提取出来
            }, 3000);
        }).catch(error => {
            alert(`强制重算失败: ${error.response?.data?.error || error.message}`);
        });
    };

    return (
        <>
            <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth scroll="paper">
                <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    财务管理 - {contract?.customer_name} ({contract?.employee_name} / {billingMonth})
                    <IconButton onClick={onClose}><CloseIcon /></IconButton>
                </DialogTitle>
                <DialogContent dividers sx={{ bgcolor: 'grey.50', p: { xs: 1, sm: 2, md: 3 } }}>
                    {isEditMode && (
                        <Alert severity="info" sx={{ mb: 2 }}>
                            您正处于编辑模式。所有更改将在点击“保存”后生效。
                        </Alert>
                    )}
                    {loading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', p: 5 }}><CircularProgress /></Box>
                    ) : billingDetails ? (
                        <Grid container spacing={3}>
                            <Grid item xs={12} md={6}>
                                <Paper sx={{ p: 3, borderRadius: 2, boxShadow: 1 }}>
                                    <Typography variant="h6" gutterBottom>客户账单</Typography>
                                    {renderCardContent(customerData, true)}
                                </Paper>
                            </Grid>
                            <Grid item xs={12} md={6}>
                                <Paper sx={{ p: 3, borderRadius: 2, boxShadow: 1 }}>
                                    <Typography variant="h6" gutterBottom>员工薪酬</Typography>
                                    {renderCardContent(employeeData, false)}
                                </Paper>
                            </Grid>
                            <Grid item xs={12}>
                                <Paper sx={{ p: 3, borderRadius: 2, boxShadow: 1 }}>
                                    <Typography variant="h6" gutterBottom>结算与发票状态</Typography>
                                    
                                    {isEditMode ? (
                                        <Grid container spacing={3} sx={{ mt: 1 }}>
                                            <Grid item xs={12} md={6}>
                                                <Divider textAlign="left" sx={{ mb: 2 }}><Chip label="客户打款" size="small" /></Divider>
                                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                                    <FormControlLabel control={<Switch checked={editableSettlement.customer_is_paid} onChange={handleSettlementChange} name="customer_is_paid" />} label="客户是否已打款" />
                                                    {editableSettlement.customer_is_paid && (
                                                        <>
                                                            <DatePicker label="打款日期" value={editableSettlement.customer_payment_date} onChange={(d) => handleDateChange('customer_payment_date', d)} />
                                                            <TextField label="打款渠道/备注" name="customer_payment_channel" value={editableSettlement.customer_payment_channel} onChange={handleSettlementChange} fullWidth />
                                                        </>
                                                    )}
                                                </Box>
                                            </Grid>
                                            <Grid item xs={12} md={6}>
                                                <Divider textAlign="left" sx={{ mb: 2 }}><Chip label="员工领款" size="small" /></Divider>
                                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                                    <FormControlLabel control={<Switch checked={editableSettlement.employee_is_paid} onChange={handleSettlementChange} name="employee_is_paid" />} label="员工是否已领款" />
                                                    {editableSettlement.employee_is_paid && (
                                                        <>
                                                            <DatePicker label="领款日期" value={editableSettlement.employee_payout_date} onChange={(d) => handleDateChange('employee_payout_date', d)} />
                                                            <TextField label="领款渠道/备注" name="employee_payout_channel" value={editableSettlement.employee_payout_channel} onChange={handleSettlementChange} fullWidth />
                                                        </>
                                                    )}
                                                </Box>
                                            </Grid>
                                            <Grid item xs={12}>
                                                <Divider textAlign="left" sx={{ mt: 2, mb: 2 }}><Chip label="发票管理" size="small" /></Divider>
                                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}>
                                                    <FormControlLabel control={<Switch checked={editableSettlement.invoice_needed} onChange={handleSettlementChange} name="invoice_needed" />} label="是否需要发票" />
                                                    {editableSettlement.invoice_needed && (
                                                        <Box sx={{ pl: 2, borderLeft: '2px solid', borderColor: 'divider', width: '100%' }}>
                                                            <FormControlLabel control={<Switch checked={editableSettlement.invoice_issued} onChange={handleSettlementChange} name="invoice_issued" />} label="是否已开发票" />
                                                            <Button size="small" startIcon={<ReceiptLongIcon />} onClick={handleOpenInvoiceDialog} disabled={!editableSettlement.invoice_issued} sx={{ml: 2}}>管理发票详情 (非必填)</Button>
                                                        </Box>
                                                    )}
                                                </Box>
                                            </Grid>
                                        </Grid>
                                    ) : (
                                        <Grid container spacing={2} sx={{ mt: 1 }}>
                                            <Grid item xs={6} md={3}>
                                                <Typography variant="body2" color="text.secondary">客户是否打款</Typography>
                                                <Box>
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                                                        {customerData.是否打款 === '是' ? (
                                                            <CheckCircleIcon sx={{ fontSize: '1.2rem', color: 'success.main' }} />
                                                        ) : (
                                                            <HighlightOffIcon sx={{ fontSize: '1.2rem', color: 'text.secondary' }} />
                                                        )}
                                                        <Typography variant="body1" sx={{ fontWeight: 500 }}>{customerData.是否打款}</Typography>
                                                    </Box>
                                                    {customerData.是否打款 === '是' && (
                                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, pl: '2px' }}>
                                                            {customerData.打款时间及渠道 || '—'}
                                                        </Typography>
                                                    )}
                                                </Box>
                                            </Grid>
                                            <Grid item xs={6} md={6}>
                                                <Typography variant="body2" color="text.secondary">发票记录</Typography>
                                                <InvoiceRecordView record={customerData.发票记录} />
                                            </Grid>
                                            <Grid item xs={6} md={3}>
                                                <Typography variant="body2" color="text.secondary">员工是否领款</Typography>
                                                <Box>
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                                                        {employeeData.是否领款 === '是' ? (
                                                            <CheckCircleIcon sx={{ fontSize: '1.2rem', color: 'success.main' }} />
                                                        ) : (
                                                            <HighlightOffIcon sx={{ fontSize: '1.2rem', color: 'text.secondary' }} />
                                                        )}
                                                        <Typography variant="body1" sx={{ fontWeight: 500 }}>{employeeData.是否领款}</Typography>
                                                    </Box>
                                                    {employeeData.是否领款 === '是' && (
                                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, pl: '2px' }}>
                                                            {employeeData.领款时间及渠道 || '—'}
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
                                    {loadingLogs ? <CircularProgress size={24} /> : (
                                        <Timeline sx={{ p: 0, m: 0 }}>
                                            {activityLogs.length > 0 ? activityLogs.map((log, index) => (
                                                // **核心修正**: 使用新的 LogItem 组件
                                                <LogItem key={log.id} log={log} isLast={index === activityLogs.length - 1} />
                                            )) : (
                                                <Typography variant="body2" color="text.secondary">暂无操作日志</Typography>
                                            )}
                                        </Timeline>
                                    )}
                                </Paper>
                            </Grid>
                        </Grid>
                    ) : (
                        <Typography color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>无此月份的账单数据，请先计算账单。</Typography>
                    )}
                </DialogContent>
                <DialogActions sx={{ p: 2 }}>
                    {isEditMode ? (
                        <>
                            <Button onClick={handleCancelEdit} variant="text" startIcon={<CancelIcon />}>取消</Button>
                            <Button onClick={handleSave} variant="contained" color="primary" startIcon={<SaveIcon />}>
                                保存并重新计算
                            </Button>
                        </>
                    ) : (
                        <>
                            <Button onClick={onClose}>关闭</Button>
                            <Button onClick={handleEnterEditMode} variant="contained" startIcon={<EditIcon />}>
                                进入编辑模式
                            </Button>
                        </>
                    )}
                </DialogActions>
            </Dialog>
            <InvoiceDetailsDialog
                open={isInvoiceDialogOpen}
                onClose={handleCloseInvoiceDialog}
                onSave={handleSaveInvoice}
                invoiceData={editableInvoice}
            />
            <AdjustmentDialog 
                open={isAdjustmentDialogOpen}
                onClose={handleCloseAdjustmentDialog}
                onSave={handleSaveAdjustment}
                adjustment={editingAdjustment}
                typeFilter={adjustmentFilter}
            />
        </>
    );
};

export default FinancialManagementModal;