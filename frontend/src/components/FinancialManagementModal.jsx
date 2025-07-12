// frontend/src/components/FinancialManagementModal.jsx (最终完整版，修复 JSX 语法错误)

import React, { useState, useEffect } from 'react';
import {
  Box, Button, Typography, Paper, Grid, Dialog, DialogTitle, DialogContent, 
  DialogActions, Divider, CircularProgress, Tooltip, IconButton, List, ListItem, 
  ListItemIcon, ListItemText, ListItemSecondaryAction, Alert, Switch, TextField,
  FormControlLabel,Chip
} from '@mui/material';
import { 
    Edit as EditIcon, Save as SaveIcon, Close as CloseIcon, Cancel as CancelIcon, 
    Add as AddIcon, Remove as RemoveIcon, Info as InfoIcon, Delete as DeleteIcon,
    ArrowUpward as ArrowUpwardIcon, ArrowDownward as ArrowDownwardIcon,
    ReceiptLong as ReceiptLongIcon, History as HistoryIcon
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';

import AdjustmentDialog, { AdjustmentTypes } from './AdjustmentDialog';
import InvoiceDetailsDialog from './InvoiceDetailsDialog'; // 稍后创建


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
    
    // --- 编辑模式下的临时状态 ---
    const [editableOvertime, setEditableOvertime] = useState(0);
    const [adjustments, setAdjustments] = useState([]);
    const [editableSettlement, setEditableSettlement] = useState({
        customer_is_paid: false, customer_payment_date: null, customer_payment_channel: '',
        employee_is_paid: false, employee_payout_date: null, employee_payout_channel: '',
        invoice_needed: false, invoice_issued: false,
    });
    const [previewTotals, setPreviewTotals] = useState({ customer: 0, employee: 0 });
    const [isAdjustmentDialogOpen, setIsAdjustmentDialogOpen] = useState(false);
    const [editingAdjustment, setEditingAdjustment] = useState(null);
    const [adjustmentFilter, setAdjustmentFilter] = useState('all');

    const [editableInvoice, setEditableInvoice] = useState({
        number: '', amount: '', date: null
    });
    const [isInvoiceDialogOpen, setIsInvoiceDialogOpen] = useState(false);

    // **固定的UI配置，定义在组件顶层**
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
    
    // 实时计算预览总额的函数
    const calculatePreviewTotals = (currentAdjustments) => {
        if (!billingDetails) return;

        let customerTotal = parseFloat(billingDetails.customer_bill_details?.客应付款?.replace(/[^0-9.-]+/g,"")) || 0;
        let employeeTotal = parseFloat(billingDetails.employee_payroll_details?.萌嫂应领款?.replace(/[^0-9.-]+/g,"")) || 0;

        (billingDetails.adjustments || []).forEach(adj => {
             const config = AdjustmentTypes[adj.adjustment_type];
             if(!config) return;
             const amount = parseFloat(adj.amount);
             if (config.type === 'customer') customerTotal -= (amount * config.effect);
             if (config.type === 'employee') employeeTotal -= (amount * config.effect);
        });

        currentAdjustments.forEach(adj => {
             const config = AdjustmentTypes[adj.adjustment_type];
             if(!config) return;
             const amount = parseFloat(adj.amount);
             if (config.type === 'customer') customerTotal += (amount * config.effect);
             if (config.type === 'employee') employeeTotal += (amount * config.effect);
        });
        
        setPreviewTotals({ customer: customerTotal, employee: employeeTotal });
    };

    useEffect(() => {
        if (billingDetails) {
            const overtime = billingDetails.customer_bill_details?.加班天数;
            setEditableOvertime(parseInt(overtime, 10) || 0);
            setAdjustments(billingDetails.adjustments || []);

            setEditableInvoice(billingDetails.invoice_details || { number: '', amount: '', date: null });

            
            setEditableSettlement({
                customer_is_paid: billingDetails.customer_bill_details?.是否打款 === '是',
                customer_payment_date: billingDetails.customer_bill_details?.打款时间及渠道?.split('/')[0]?.trim() ? new Date(billingDetails.customer_bill_details.打款时间及渠道.split('/')[0].trim()) : null,
                customer_payment_channel: billingDetails.customer_bill_details?.打款时间及渠道?.split('/')[1]?.trim() || '',
                employee_is_paid: billingDetails.employee_payroll_details?.是否领款 === '是',
                employee_payout_date: billingDetails.employee_payroll_details?.领款时间及渠道?.split('/')[0]?.trim() ? new Date(billingDetails.employee_payroll_details.领款时间及渠道.split('/')[0].trim()) : null,
                employee_payout_channel: billingDetails.employee_payroll_details?.领款时间及渠道?.split('/')[1]?.trim() || '',
                invoice_needed: billingDetails.customer_bill_details?.发票记录 !== '无需开票',
                invoice_issued: billingDetails.customer_bill_details?.发票记录 === '已开票',
            });

            const initialAdjustments = billingDetails.adjustments || [];
            setAdjustments(initialAdjustments);
            calculatePreviewTotals(initialAdjustments);
        }
    }, [billingDetails]);

    const handleEnterEditMode = () => setIsEditMode(true);
    const handleCancelEdit = () => {
        if (billingDetails) {
            const overtime = billingDetails.customer_bill_details?.加班天数;
            setEditableOvertime(parseInt(overtime, 10) || 0);
            const initialAdjustments = billingDetails.adjustments || [];
            setAdjustments(initialAdjustments);
            calculatePreviewTotals(initialAdjustments);
            setEditableInvoice(billingDetails.invoice_details || { number: '', amount: '', date: null });
            // 此处也应重置结算状态
            setEditableSettlement({
                customer_is_paid: billingDetails.customer_bill_details?.是否打款 === '是',
                customer_payment_date: billingDetails.customer_bill_details?.打款时间及渠道?.split('/')[0]?.trim() ? new Date(billingDetails.customer_bill_details.打款时间及渠道.split('/')[0].trim()) : null,
                customer_payment_channel: billingDetails.customer_bill_details?.打款时间及渠道?.split('/')[1]?.trim() || '',
                employee_is_paid: billingDetails.employee_payroll_details?.是否领款 === '是',
                employee_payout_date: billingDetails.employee_payroll_details?.领款时间及渠道?.split('/')[0]?.trim() ? new Date(billingDetails.employee_payroll_details.领款时间及渠道.split('/')[0].trim()) : null,
                employee_payout_channel: billingDetails.employee_payroll_details?.领款时间及渠道?.split('/')[1]?.trim() || '',
                invoice_needed: billingDetails.customer_bill_details?.发票记录 !== '无需开票',
                invoice_issued: billingDetails.customer_bill_details?.发票记录 === '已开票',
            });
        }
        setIsEditMode(false);
    };
    const handleSave = () => {
        onSave({ 
            overtime_days: editableOvertime,
            adjustments: adjustments,
            settlement_status: editableSettlement,
            invoice_details: editableInvoice // 将发票详情打包

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
        let newAdjustments;
        const existingIndex = adjustments.findIndex(a => a.id === savedAdj.id);
        if (existingIndex > -1) {
            newAdjustments = [...adjustments];
            newAdjustments[existingIndex] = savedAdj;
        } else {
            newAdjustments = [...adjustments, savedAdj];
        }
        setAdjustments(newAdjustments);
        calculatePreviewTotals(newAdjustments);
    };
    const handleDeleteAdjustment = (id) => {
        const newAdjustments = adjustments.filter(a => a.id !== id);
        setAdjustments(newAdjustments);
        calculatePreviewTotals(newAdjustments);
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

    const handleSaveInvoice = (newInvoiceData) => {
        setEditableInvoice(newInvoiceData);
    };
    
    const customerData = billingDetails?.customer_bill_details || {};
    const employeeData = billingDetails?.employee_payroll_details || {};
    
    const renderCardContent = (data, isCustomer) => {
        const groupConfig = isCustomer ? fieldGroups.customer : fieldGroups.employee;
        const currentAdjustments = adjustments.filter(adj => 
            AdjustmentTypes[adj.adjustment_type]?.type === (isCustomer ? 'customer' : 'employee')
        );
        
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {Object.entries(groupConfig).map(([groupName, fields]) => {
                    if (groupName === '财务调整') {
                        if (!isEditMode && currentAdjustments.length === 0) {
                            return null;
                        }
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
                                        // **最终的 ListItem 布局**
                                        <ListItem key={adj.id} button={isEditMode} onClick={isEditMode ? () => handleOpenAdjustmentDialog(adj, isCustomer ? 'customer' : 'employee') : undefined} sx={{ my: 0.5, px: 1, borderRadius: 1, '&:hover': { bgcolor: isEditMode ? 'action.hover' : 'transparent'} }}>
                                            <Grid container alignItems="center">
                                                <Grid item xs={1}>
                                                    <ListItemIcon sx={{ minWidth: 'auto' }}>
                                                        {AdjustmentTypes[adj.adjustment_type]?.effect > 0 ? <ArrowUpwardIcon color="success" fontSize="small"/> : <ArrowDownwardIcon color="error" fontSize="small"/>}
                                                    </ListItemIcon>
                                                </Grid>
                                                <Grid item xs={6}>
                                                    <ListItemText 
                                                        primary={AdjustmentTypes[adj.adjustment_type]?.label} 
                                                        secondary={adj.description}
                                                        primaryTypographyProps={{ noWrap: true }}
                                                        secondaryTypographyProps={{ noWrap: true }}
                                                    />
                                                </Grid>
                                                <Grid item xs={4} sx={{ textAlign: 'right' }}>
                                                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 'bold' }}>
                                                        {AdjustmentTypes[adj.adjustment_type]?.effect > 0 ? '+' : '-'} {formatValue('', adj.amount)}
                                                    </Typography>
                                                </Grid>
                                                <Grid item xs={1} sx={{ textAlign: 'right' }}>
                                                    {isEditMode && (
                                                        <IconButton edge="end" size="small" onClick={(e) => { e.stopPropagation(); handleDeleteAdjustment(adj.id); }}>
                                                            <DeleteIcon fontSize="small"/>
                                                        </IconButton>
                                                    )}
                                                </Grid>
                                            </Grid>
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
                            return numericValue !== 0;
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
                                                    {/* **核心修正：修复 JSX 标签未闭合的错误** */}
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
                             {groupName === '最终结算' && isEditMode && (
                                <Box sx={{ mt: 1, textAlign: 'right' }}>
                                    <Typography variant="caption" color="text.secondary">
                                        预览总额: {formatValue('', isCustomer ? previewTotals.customer : previewTotals.employee)}
                                    </Typography>
                                </Box>
                            )}
                        </Box>
                    );
                })}
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
                                    <Grid container spacing={3}>
                                        <Grid item xs={12} md={6}>
                                            <Divider textAlign="left" sx={{ mb: 2 }}><Chip label="客户打款" size="small" /></Divider>
                                            {isEditMode ? (
                                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                                    <FormControlLabel control={<Switch checked={editableSettlement.customer_is_paid} onChange={handleSettlementChange} name="customer_is_paid" />} label="客户是否已打款" />
                                                    {editableSettlement.customer_is_paid && (
                                                        <>
                                                            <DatePicker label="打款日期" value={editableSettlement.customer_payment_date} onChange={(d) => handleDateChange('customer_payment_date', d)} />
                                                            <TextField label="打款渠道/备注" name="customer_payment_channel" value={editableSettlement.customer_payment_channel} onChange={handleSettlementChange} fullWidth />
                                                        </>
                                                    )}
                                                </Box>
                                            ) : (
                                                <Typography variant="body2">{customerData.是否打款 === '是' ? `是 (${customerData.打款时间及渠道 || '详情未录入'})` : '否'}</Typography>
                                            )}
                                        </Grid>
                                        <Grid item xs={12} md={6}>
                                            <Divider textAlign="left" sx={{ mb: 2 }}><Chip label="员工领款" size="small" /></Divider>
                                             {isEditMode ? (
                                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                                    <FormControlLabel control={<Switch checked={editableSettlement.employee_is_paid} onChange={handleSettlementChange} name="employee_is_paid" />} label="员工是否已领款" />
                                                    {editableSettlement.employee_is_paid && (
                                                        <>
                                                            <DatePicker label="领款日期" value={editableSettlement.employee_payout_date} onChange={(d) => handleDateChange('employee_payout_date', d)} />
                                                            <TextField label="领款渠道/备注" name="employee_payout_channel" value={editableSettlement.employee_payout_channel} onChange={handleSettlementChange} fullWidth />
                                                        </>
                                                    )}
                                                </Box>
                                            ) : (
                                                <Typography variant="body2">{employeeData.是否领款 === '是' ? `是 (${employeeData.领款时间及渠道 || '详情未录入'})` : '否'}</Typography>
                                            )}
                                        </Grid>
                                        <Grid item xs={12}>
                                            <Divider textAlign="left" sx={{ mt: 2, mb: 2 }}><Chip label="发票管理" size="small" /></Divider>
                                            {isEditMode ? (
                                                 <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}>
                                                    <FormControlLabel control={<Switch checked={editableSettlement.invoice_needed} onChange={handleSettlementChange} name="invoice_needed" />} label="是否需要发票" />
                                                    {editableSettlement.invoice_needed && (
                                                        <Box sx={{ pl: 2, borderLeft: '2px solid', borderColor: 'divider', width: '100%' }}>
                                                            <FormControlLabel control={<Switch checked={editableSettlement.invoice_issued} onChange={handleSettlementChange} name="invoice_issued" />} label="是否已开发票" />
                                                            <Button size="small" startIcon={<ReceiptLongIcon />} onClick={() => setIsInvoiceDialogOpen(true)} disabled={!editableSettlement.invoice_issued} sx={{ml: 2}}>管理发票详情 (非必填)</Button>
                                                        </Box>
                                                    )}
                                                </Box>
                                            ) : (
                                                <Typography variant="body2">{customerData.发票记录 || '无需开票'}</Typography>
                                            )}
                                        </Grid>
                                    </Grid>
                                </Paper>
                            </Grid>
                            <Grid item xs={12}>
                                 <Paper sx={{ p: 3, borderRadius: 2, boxShadow: 1 }}>
                                    <Typography variant="h6" gutterBottom>操作日志</Typography>
                                    <Typography variant="body2" color="text.secondary">[操作日志Timeline]</Typography>
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
            <AdjustmentDialog 
                open={isAdjustmentDialogOpen}
                onClose={handleCloseAdjustmentDialog}
                onSave={handleSaveAdjustment}
                adjustment={editingAdjustment}
                typeFilter={adjustmentFilter}
            />
            <InvoiceDetailsDialog
                open={isInvoiceDialogOpen}
                onClose={() => setIsInvoiceDialogOpen(false)}
                invoiceData={editableInvoice}
                onSave={(newInvoiceData) => setEditableInvoice(newInvoiceData)}
            />
        </>
    );
};

export default FinancialManagementModal;