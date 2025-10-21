// frontend/src/components/ReconciliationPage.jsx

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { reconciliationApi } from '../api/reconciliationApi';
import { payerAliasApi } from '../api/payerAliasApi';
import api from '../api/axios';
import AlertMessage from './AlertMessage';
import FinancialManagementModal from './FinancialManagementModal';
import PageHeader from './PageHeader';
import { Decimal } from 'decimal.js';
import { pinyin } from 'pinyin-pro';

// --- Material-UI Imports ---
import {
    Box, Button, Card, CardContent, CardHeader, CircularProgress, Grid, MenuItem,
    Typography, List, ListItem, ListItemText, ListItemButton, Divider, Select, Autocomplete,
    Dialog, DialogTitle, DialogContent, DialogActions, TextField, Alert, FormControl, InputLabel,
    Tabs, Tab, Chip, Tooltip, IconButton, Paper, Stack, Avatar, FormControlLabel, Checkbox
} from '@mui/material';
import {
    ContentCopy as ContentCopyIcon,
    ArrowBackIosNew as ArrowBackIosNewIcon,
    ArrowForwardIos as ArrowForwardIosIcon,
    AccountBalanceWallet as AccountBalanceWalletIcon,
    PlaylistAddCheck as PlaylistAddCheckIcon,
    HourglassEmpty as HourglassEmptyIcon,
    Block as BlockIcon,
    SwitchAccount as SwitchAccountIcon,
} from '@mui/icons-material';
import { useTheme, alpha } from '@mui/material/styles';
const formatCurrency = (value) => {
    const num = new Decimal(value || 0).toNumber();
    return num.toLocaleString('zh-CN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
};

// --- Paste Statement Dialog Component ---
const PasteStatementDialog = ({ open, onClose, onSubmit }) => {
    const [statementText, setStatementText] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async () => {
        const text = statementText.trim();
        const lines = text.split(/(?=C[A-Z0-9]{10,})/).filter(line => line.trim() !== '');
        if (lines.length > 0 && lines[0].includes('交易流水号')) {
            const firstLine = lines[0];
            const headerMatch = firstLine.match(/^(.*?)(C[A-Z0-9]{10,}.*)$/);
            if (headerMatch) {
                lines.shift();
                lines.unshift(headerMatch[1], headerMatch[2]);
            }
        }
        if (lines.length <= 1) {
            alert('未能从文本中分割出有效的流水数据行。');
            return;
        }
        setIsSubmitting(true);
        await onSubmit(lines);
        setIsSubmitting(false);
        setStatementText('');
    };

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
            <DialogTitle>导入并解析银行流水</DialogTitle>
            <DialogContent>
                <TextField
                    autoFocus
                    margin="dense"
                    id="statement-text"
                    label="银行流水文本"
                    fullWidth
                    multiline
                    rows={10}
                    variant="outlined"
                    placeholder="请从银行网站复制流水文本，并粘贴到此处..."
                    value={statementText}
                    onChange={(e) => setStatementText(e.target.value)}
                />
            </DialogContent>
            <DialogActions sx={{ p: 3 }}>
                <Button onClick={onClose} color="secondary">取消</Button>
                <Button onClick={handleSubmit} variant="contained" disabled={isSubmitting || !statementText.trim()}>{isSubmitting ?'处理中...' : '导入'}</Button>
            </DialogActions>
        </Dialog>
    );
};

const IgnoreRemarkDialog = ({ open, onClose, onSubmit }) => {
    const [remark, setRemark] = useState('');
    const [isPermanent, setIsPermanent] = useState(false);

    const handleSubmit = () => {
        onSubmit(remark, isPermanent);
        setRemark('');
        setIsPermanent(false);
        onClose();
    };

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
            <DialogTitle>忽略流水</DialogTitle>
            <DialogContent>
                <TextField
                    autoFocus
                    margin="dense"
                    id="ignore-remark"
                    label="忽略原因（选填）"
                    fullWidth
                    multiline
                    rows={4}
                    variant="outlined"
                    placeholder="请填写忽略这笔流水的原因，例如：测试流水、重复流水等。"
                    value={remark}
                    onChange={(e) => setRemark(e.target.value)}
                />
                <FormControlLabel
                    control={
                        <Checkbox
                            checked={isPermanent}
                            onChange={(e) => setIsPermanent(e.target.checked)}
                            name="permanentIgnore"
                            color="primary"
                        />
                    }
                    label="永久忽略此付款/收款人"
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>取消</Button>
                <Button onClick={handleSubmit} variant="contained" color="warning">确认忽略</Button>
            </DialogActions>
        </Dialog>
    );
};

const AliasConflictDialog = ({ open, onClose, onConfirm, payerName, message }) => {
    return (
        <Dialog open={open} onClose={onClose}>
            <DialogTitle>危险操作确认</DialogTitle>
            <DialogContent>
                <Alert severity="warning">
                    <Typography gutterBottom>
                        无法直接解除付款人 <strong>{payerName}</strong> 的代付关系。
                    </Typography>
                    <Typography>
                        {message}
                    </Typography>
                </Alert>
                <Typography sx={{ mt: 2 }}>
                    选择“确认删除”将会永久删除所有关联的付款记录，并更新相关账单的金额。此操作不可逆。
                </Typography>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>取消</Button>
                <Button onClick={onConfirm} color="error" variant="contained">
                    解除关系并删除付款
                </Button>
            </DialogActions>
        </Dialog>
    );
};

const TransactionDetailsPanel = ({
    transaction, category, onAllocationSuccess, onStatusUpdate, setAlertInfo,
    accountingPeriod, setOperationPeriod, onOpenBillModal, mainAccountingPeriod,
    // Props lifted from parent
    searchTerm, setSearchTerm, searchResults, isSearching,
    selectedCustomerName, setSelectedCustomerName,
    selectedSearchOption, setSelectedSearchOption,
    customerBills, isLoadingBills, closestBillInfo, relevantContractId,
    isSwitchingCustomer,setIsSwitchingCustomer,setOverrideCustomerName
}) => {
    const [allocations, setAllocations] = useState({});
    const [isSaving, setIsSaving] = useState(false);
    const [isIgnoreDialogOpen, setIsIgnoreDialogOpen] = useState(false);
    const [aliasConflictInfo, setAliasConflictInfo] = useState({ open: false, payerName: '', message: '' });
    const billListRef = useRef(null);
    const prevTransactionIdRef = useRef();
    const prevSelectedCustomerNameRef = useRef();


    const handleMonthChange = (delta) => {
        const newDate = new Date(accountingPeriod.year, accountingPeriod.month - 1 + delta);
        setOperationPeriod({
            year: newDate.getFullYear(),
            month: newDate.getMonth() + 1,
        });
    };
    const handlePrevMonth = () => handleMonthChange(-1);
    const handleNextMonth = () => handleMonthChange(1);



    useEffect(() => {
        // 只有当流水改变时，才执行自动滚动和更新ref
        if (prevTransactionIdRef.current !== transaction?.id) {
            const bills = customerBills;

            if (bills && bills.length > 0 && billListRef.current) {
                const closestBill = [...bills].sort((a, b) => {
                    const diffA = Math.abs((a.year - accountingPeriod.year) * 12 + (a.bill_month - accountingPeriod.month));
                    const diffB = Math.abs((b.year - accountingPeriod.year) * 12 + (b.bill_month - accountingPeriod.month));
                    return diffA - diffB;
                })[0];

                if (closestBill) {
                    const element = billListRef.current.querySelector(`#bill-item-${closestBill.id}`);
                    if (element) {
                        setTimeout(() => {
                            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }, 100);
                    }
                }
            }
        }

        // 为下一次渲染更新“上一次”的ID和名称
        prevTransactionIdRef.current = transaction?.id;
        prevSelectedCustomerNameRef.current = selectedCustomerName;

    }, [customerBills, transaction, category, accountingPeriod, selectedCustomerName]);
    

    useEffect(() => {
        // 这个钩子现在只负责管理自己内部的、与父组件无关的状态
        setAllocations({});

        // 为“待确认”页签预填分配金额
        if (transaction && category === 'pending_confirmation' && transaction.matched_bill) {
            const bill = transaction.matched_bill;
            const amountToAllocate = Math.min(parseFloat(transaction.amount), parseFloat(bill.amount_remaining));
            setAllocations({ [bill.id]: amountToAllocate.toString() });
        }
    }, [transaction, category]);
  

    const handleAllocationChange = (billId, value) => {
        setAllocations(prev => ({ ...prev, [billId]: value }));
    };

    const handleSave = async () => {
        const allocationsPayload = Object.entries(allocations)
            .map(([bill_id, amount]) => ({ bill_id, amount: new Decimal(amount || 0) }))
            .filter(({ amount }) => amount.gt(0))
            .map(({ bill_id, amount }) => ({ bill_id, amount: amount.toFixed(2) }));

        if (allocationsPayload.length === 0) {
            setAlertInfo({ open: true, message: "请输入至少一笔有效的分配金额。", severity: 'warning' });
            return;
        }

        setIsSaving(true);
        try {
            // 后端现在会自动处理别名创建，前端不再需要发送别名创建请求
            await reconciliationApi.allocateTransaction({ transactionId: transaction.id, allocations:allocationsPayload });
            setAlertInfo({ open: true, message: '分配成功！', severity: 'success' });
            onAllocationSuccess();
        } catch (err) {
            setAlertInfo({ open: true, message: `操作失败: ${err.message}`, severity: 'error' });
        } finally {
            setIsSaving(false);
        }
    };
    
    const handleCancelAllocation = async () => {
        if (!transaction) return;
        if (!window.confirm(`确定要撤销付款人 "${transaction.payer_name}" 的这笔分配吗？`)) return;
        setIsSaving(true);
        try {
            await reconciliationApi.cancelAllocation(transaction.id);
            setAlertInfo({ open: true, message: '撤销成功！', severity: 'success' });
            onAllocationSuccess();
        } catch (err) {
            setAlertInfo({ open: true, message: `撤销失败: ${err.message}`, severity: 'error' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleIgnore = () => {
        if (!transaction) return;
        setIsIgnoreDialogOpen(true);
    };

    const handleConfirmIgnore = async (remark, isPermanent) => {
        if (!transaction) return;
        setIsSaving(true);
        try {
            const response = await reconciliationApi.ignoreTransaction(transaction.id, { remark, is_permanent: isPermanent });
            setAlertInfo({ open: true, message: response.data.message || '流水已忽略', severity: 'success' });
            onAllocationSuccess(); // 改为调用softRefresh来完全更新UI
        } catch (err) {
            setAlertInfo({ open: true, message: `操作失败: ${err.message}`, severity: 'error' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleUnignore = async () => {
        if (!transaction) return;
        setIsSaving(true);
        try {
            await reconciliationApi.unignoreTransaction(transaction.id);
            setAlertInfo({ open: true, message: '已撤销忽略', severity: 'success' });
            const targetCategory = transaction.allocated_amount > 0 ? 'manual_allocation' : 'unmatched';
            onStatusUpdate(transaction.id, 'ignored', targetCategory);
        } catch (err) {
            setAlertInfo({ open: true, message: `操作失败: ${err.message}`, severity: 'error' });
        } finally {
            setIsSaving(false);
        }
    };

    const totalAllocatedInThisSession = Object.entries(allocations).reduce((sum, [, amount]) => sum.plus(new Decimal(amount || 0)), new Decimal(0));
    const totalTxnAmount = transaction ? new Decimal(transaction.amount) : new Decimal(0);
    const alreadyAllocated = transaction ? new Decimal(transaction.allocated_amount || 0) : new Decimal(0);
    const remainingAmount = totalTxnAmount.minus(alreadyAllocated).minus(totalAllocatedInThisSession);
    const isSaveDisabled = totalAllocatedInThisSession.lte(0) || remainingAmount.lt(0) || isSaving || !['unmatched', 'partially_allocated'].includes(transaction?.status);

    const handleSmartFill = (billId) => {
        const otherAllocationsInSession = Object.entries(allocations)
            .filter(([key,]) => key !== String(billId))
            .reduce((sum, [, amount]) => sum.plus(new Decimal(amount || 0)), new Decimal(0));

        const fillAmount = totalTxnAmount.minus(alreadyAllocated).minus(otherAllocationsInSession);

        if (fillAmount.gt(0)) {
            const bills = customerBills.length > 0 ? customerBills : (transaction?.unpaid_bills || []);
            const bill = bills.find(b => b.id === billId);
            if (!bill) return;

            const amountRemainingOnBill = new Decimal(bill.amount_remaining || 0);
            const finalFillAmount = Decimal.min(fillAmount, amountRemainingOnBill);
            handleAllocationChange(billId, finalFillAmount.toFixed(2));
        } else {
            setAlertInfo({ open: true, message: '没有足够的金额进行分配', severity: 'info' });
        }
    };

    const getBillMonthChipProps = (bill) => {
        // 使用 mainAccountingPeriod 进行比较
        const isCurrent = bill.year === mainAccountingPeriod.year && bill.bill_month === mainAccountingPeriod.month;
        if (isCurrent) {
            return { color: 'primary', variant: 'filled', sx: { ml: 1 } };
        } else {
            return { color: 'warning', variant: 'filled', sx: { ml: 1 } };
        }
    };

    const renderAllocationUI = (bills, customerName) => {
        const validBills = [...bills].filter(bill => bill && bill.id).sort((a, b) => a.year !== b.year ? a.year - b.year : a.bill_month - b.bill_month);
        return (
            <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="h6">客户: {customerName}</Typography>
                        {transaction.matched_by === 'alias' && <Chip label="代付" color="warning" size="small" />}
                        {!['confirmed', 'processed'].includes(category) && (
                            <Button size="small" startIcon={<SwitchAccountIcon />} onClick={() => setIsSwitchingCustomer(true)}>切换客户</Button>
                        )}
                    </Box>
                    <Box>
                        <IconButton onClick={() => setOperationPeriod(prev => ({...prev, month: prev.month - 1}))}size="small"><ArrowBackIosNewIcon fontSize="inherit" /></IconButton>
                        <Typography component="span" variant="subtitle1" sx={{ mx: 1 }}>{accountingPeriod.year}年{accountingPeriod.month}月</Typography>
                        <IconButton onClick={() => setOperationPeriod(prev => ({...prev, month: prev.month + 1}))}size="small"><ArrowForwardIosIcon fontSize="inherit" /></IconButton>
                    </Box>
                </Box>
                {validBills.length > 0 ? (
                    <Stack spacing={2} ref={billListRef}>
                        <Typography variant="subtitle1" gutterBottom sx={{ mb: 1 }}>该客户在 {accountingPeriod.year}年{accountingPeriod.month}月 的所有账单:</Typography>
                        {validBills.map((bill, index) => (
                            <Paper key={bill.id} variant="outlined" sx={{ p: 2, backgroundColor: 'transparent' }}>
                                <Grid container spacing={2} alignItems="center">
                                    <Grid item xs={12} md={6}>
                                        <Box>
                                            <Typography variant="body1" component="div" sx={{ display: 'flex',alignItems: 'center' }}>{`账单周期: ${bill.cycle}`}<Chip label={`${bill.bill_month}月账单`} size="small" {...getBillMonthChipProps(bill)} /></Typography>
                                            <Typography variant="body2" color="text.secondary">{`员工: ${bill.employee_name}`}</Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                                            <TextField type="number" size="small" sx={{ width: '130px' }}placeholder="0.00" value={allocations[bill.id] || ''} onChange={(e) => handleAllocationChange(bill.id, e.target.value)} InputProps={{ startAdornment: <Typography component="span" sx={{ mr: 1 }}>¥</Typography> }} />
                                            <Button size="small" variant="outlined" onClick={() => handleSmartFill(bill.id)}>自动</Button>
                                            {index === validBills.length - 1 && (<Button size="small" variant="outlined" onClick={() => handleSmartFill(bill.id, 'remaining')}>剩余</Button>)}
                                        </Box>
                                    </Grid>
                                    <Grid item xs={12} md={4}>
                                        <Box sx={{ fontFamily: 'monospace', textAlign: 'left' }}>
                                            <Typography variant="body2">应付: ¥{formatCurrency(bill.total_due)}</Typography>
                                            <Typography variant="body2" color="text.secondary">已付: ¥{formatCurrency(bill.total_paid)}</Typography>
                                            {bill.payments && bill.payments.map((p, i) => (<Typography variant="caption" color="text.secondary" key={i}>{`↳ ${p.payer_name}: ¥${formatCurrency(p.amount)}`}</Typography>))}
                                            {new Decimal(bill.paid_by_this_txn || 0).gt(0) && (<Typography variant="body2" color="primary.main">{`↳ 本次流水已付:¥${formatCurrency(bill.paid_by_this_txn)}`}</Typography>)}
                                            <Typography variant="body2" fontWeight="bold" color={new Decimal(bill.amount_remaining).gt(0) ? 'error.main' : 'inherit'}>待付: ¥{formatCurrency(bill.amount_remaining)}</Typography>
                                        </Box>
                                    </Grid>
                                    <Grid item xs={12} md={2} sx={{ textAlign: 'right' }}><Button variant="outlined"size="small" onClick={() => onOpenBillModal(bill)}>查看账单</Button></Grid>
                                </Grid>
                            </Paper>
                        ))}
                    </Stack>
                ) : (
                    <Box sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
                        <Typography>在 {accountingPeriod.year}年{accountingPeriod.month}月 未找到该客户的账单。</Typography>
                        {closestBillInfo && <Typography variant="body2" sx={{ mt: 1 }}>此客户最近一张账单在{closestBillInfo.year}年{closestBillInfo.month}月。</Typography>}
                        {relevantContractId && <Typography variant="body2" sx={{ mt: 1 }}>当前客户只有合同没有账单,点击<Button variant="text" size="small" onClick={() => window.open(`/contract/detail/${relevantContractId}`,'_blank')} sx={{ verticalAlign: 'baseline', mx: 0.5 }}>查看合同</Button>查看合同详情</Typography>}
                    </Box>
                )}
            </Box>
        );
    };

    const handleForceCancelAlias = async (payerName) => {
        setIsSaving(true);
        try {
            await payerAliasApi.deleteAlias(payerName, { delete_payments: true });
            setAlertInfo({ open: true, message: '别名和关联付款已成功删除！', severity: 'success' });
            onAllocationSuccess();
        } catch (err) {
            setAlertInfo({ open: true, message: `强制删除操作失败: ${err.response?.data?.message || err.message}`, severity: 'error' });
        } finally {
            setIsSaving(false);
            setAliasConflictInfo({ open: false, payerName: '', message: '' });
        }
    };

    const handleCancelAlias = async () => {
        if (!transaction) return;
        
        setIsSaving(true);
        try {
            await payerAliasApi.deleteAlias(transaction.payer_name);
            setAlertInfo({ open: true, message: '别名已解除！', severity: 'success' });
            onAllocationSuccess();
        } catch (err) {
            if (err.response && err.response.status === 409) {
                setAliasConflictInfo({
                    open: true,
                    payerName: transaction.payer_name,
                    message: err.response.data.message || '此关系下有已分配款项，是否要一并删除？'
                });
            } else {
                setAlertInfo({ open: true, message: `操作失败: ${err.response?.data?.message || err.message}`, severity: 'error' });
            }
        } finally {
            setIsSaving(false);
        }
    };

    const renderActions = () => {
        switch (category) {
            case 'pending_confirmation':
                return (
                    <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Button variant="outlined" color="warning" onClick={handleIgnore} disabled={isSaving}>忽略此流水</Button>
                        <Box>
                            {transaction.matched_by === 'alias' && (
                                <Button variant="outlined" color="warning" onClick={handleCancelAlias} disabled={isSaving} sx={{ mr: 2}}>解除支付关系</Button>
                            )}
                            <Button variant="contained" onClick={handleSave} disabled={isSaving || remainingAmount.lt(0)}>
                                {isSaving ? '处理中...' : '确认并保存'}
                            </Button>
                        </Box>
                    </Box>
                );
                    case 'manual_allocation':
                        return (
                             <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <Button variant="outlined" color="warning" onClick={handleIgnore} disabled={isSaving}>忽略此流水</Button>
                                <Box>
                                    {transaction.matched_by === 'alias' && (
                                        <Button variant="outlined" color="warning" onClick={handleCancelAlias} disabled={isSaving} sx={{ mr: 2}}>解除支付关系</Button>
                                    )}
                                    <Button variant="contained" onClick={handleSave} disabled={isSaveDisabled}>
                                        {isSaving ? '处理中...' : '保存分配'}
                                    </Button>
                                </Box>
                            </Box>
                        );            case 'unmatched':
                return (
                    <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Button variant="outlined" color="warning" onClick={handleIgnore} disabled={isSaving}>忽略此流水</Button>
                        <Button variant="contained" onClick={handleSave} disabled={!selectedCustomerName || isSaveDisabled}>
                            {isSaving ? '处理中...' : '保存分配并创建别名'}
                        </Button>
                    </Box>
                );
            case 'confirmed':
            case 'processed':
                return (
                    <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
                        <Button variant="outlined" color="error" onClick={handleCancelAllocation} disabled={isSaving}>撤销分配</Button>
                    </Box>
                );
            case 'ignored':
                return (
                    <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
                        <Button variant="outlined" color="info" onClick={handleUnignore} disabled={isSaving}>撤销忽略</Button>
                    </Box>
                );
            default:
                return null;
        }
    }

    const renderContent = () => {
        switch (category) {
            case 'pending_confirmation':
                if (isSwitchingCustomer) {
                    return (
                        <Box>
                            <Typography variant="subtitle1" gutterBottom>系统已自动匹配到客户 “{transaction.matched_bill.customer_name}”。如需为其他客户付款，请在下方搜索并选择新客户。</Typography>
                            <Autocomplete
                                options={searchResults}
                                getOptionLabel={(option) => option.display || ''}
                                isOptionEqualToValue={(option, value) => option.display === value.display}
                                value={selectedSearchOption}
                                loading={isSearching}
                                onInputChange={(event, newInputValue) => setSearchTerm(newInputValue)}
                                onChange={(event, newValue) => {
                                    setSelectedSearchOption(newValue);
                                    if (newValue) {
                                        const customerToSet = newValue.type === 'employee' ? newValue.customer_name: newValue.name;
                                        setOverrideCustomerName(customerToSet);
                                        setIsSwitchingCustomer(false);
                                    } else {
                                        setOverrideCustomerName(null);
                                    }
                                }}
                                filterOptions={(x) => x}
                                renderInput={(params) => (<TextField {...params} label="搜索新客户或员工姓名" />)}
                                renderOption={(props, option) => (
                                    <li {...props} key={option.display}>
                                        <Grid container alignItems="center">
                                            <Grid item xs>{option.name}{option.type === 'employee' && (<Typography variant="body2" color="text.secondary">(员工, 客户: {option.customer_name})</Typography>)}</Grid>
                                        </Grid>
                                    </li>
                                )}
                            />
                            <Button sx={{ mt: 2 }} onClick={() => setIsSwitchingCustomer(false)}>取消切换</Button>
                        </Box>
                    );
                }

                if (isLoadingBills && !customerBills.length) {
                    return (
                        <Box>
                            <Alert severity="info" sx={{ mb: 2 }}>
                                正在加载客户 “{transaction.matched_bill.customer_name}” 在 {accountingPeriod.year}年{accountingPeriod.month}月 的账单...
                            </Alert>
                            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
                        </Box>
                    );
                }

                return (
                    <>
                        <Alert severity="success" sx={{ mb: 2 }}>
                            系统已通过 {transaction.matched_by === 'alias' ? '别名/支付关系' : '客户名'}自动匹配到账单，请确认或修改分配。
                        </Alert>
                        {renderAllocationUI(customerBills, selectedCustomerName || transaction.matched_bill.customer_name)}
                        {renderActions()}
                    </>
                );
            case 'confirmed':
            case 'processed':
                if (isLoadingBills) {
                    return <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>;
                }
                if (!selectedCustomerName) {
                    return <Alert severity="info">正在加载客户账单信息...</Alert>;
                }
                return (
                    <>
                        <Alert severity="info" sx={{ mb: 2 }}>
                            此流水已分配给以下账单。
                        </Alert>
                        {renderAllocationUI(customerBills, selectedCustomerName)}
                        {renderActions()}
                    </>
                );
                case 'manual_allocation':
                    if (isSwitchingCustomer) {
                        return (
                            <Box>
                                <Typography variant="subtitle1" gutterBottom>当前付款人 “{transaction.payer_name}”自动匹配到客户 “{transaction.customer_name}”。如需为其他客户付款，请在下方搜索并选择新客户。</Typography>
                                <Autocomplete
                                    options={searchResults}
                                    getOptionLabel={(option) => option.display || ''}
                                    isOptionEqualToValue={(option, value) => option.display === value.display}
                                    value={selectedSearchOption}
                                    loading={isSearching}
                                    onInputChange={(event, newInputValue) => setSearchTerm(newInputValue)}
                                    onChange={(event, newValue) => {
                                        setSelectedSearchOption(newValue);
                                        if (newValue) {
                                            const customerToSet = newValue.type === 'employee' ? newValue.customer_name :newValue.name;
                                            setOverrideCustomerName(customerToSet);
                                            setIsSwitchingCustomer(false);
                                        } else {
                                            setOverrideCustomerName(null);
                                        }
                                    }}
                                    filterOptions={(x) => x}
                                    renderInput={(params) => (<TextField {...params} label="搜索新客户或员工姓名" />)}
                                    renderOption={(props, option) => (
                                        <li {...props} key={option.display}>
                                            <Grid container alignItems="center">
                                                <Grid item xs>{option.name}{option.type === 'employee' && (<Typography variant="body2" color="text.secondary">(员工, 客户: {option.customer_name})</Typography>)}</Grid>
                                            </Grid>
                                        </li>
                                    )}
                                />
                                <Button sx={{ mt: 2 }} onClick={() => setIsSwitchingCustomer(false)}>取消切换</Button>
                            </Box>
                        );
                    }

                    if (isLoadingBills) return <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>;
                    if (selectedCustomerName) return <>{renderAllocationUI(customerBills,selectedCustomerName)}{renderActions()}</>;
                    return <Typography sx={{ p: 2, color: 'text.secondary' }}>正在加载客户账单...</Typography>;
            case 'unmatched':
                return (
                    <Box>
                        <Alert severity="warning" sx={{ mb: 2 }}>未找到与付款人 “{transaction.payer_name}” 关联的客户。</Alert>
                        <Typography variant="subtitle1" gutterBottom>第一步：从系统中搜索并选择一个客户或员工：</Typography>
                        <Autocomplete
                            options={searchResults}
                            getOptionLabel={(option) => option.display || ''}
                            isOptionEqualToValue={(option, value) => option.display === value.display}
                            value={selectedSearchOption} // <-- 核心修改：value 绑定到对象 state
                            loading={isSearching}
                            onInputChange={(event, newInputValue) => setSearchTerm(newInputValue)}
                            onChange={(event, newValue) => {
                                setSelectedSearchOption(newValue); // 核心修改：更新对象 state
                                if (newValue) {
                                    // 提取字符串给应用逻辑使用
                                    const customerToSet = newValue.type === 'employee' ? newValue.customer_name : newValue.name;
                                    setSelectedCustomerName(customerToSet);
                                } else {
                                    setSelectedCustomerName(null);
                                }
                            }}
                            filterOptions={(x) => x}
                            renderInput={(params) => (<TextField {...params} label="搜索客户或员工姓名" />)}
                            renderOption={(props, option) => (
                                <li {...props} key={option.display}>
                                    <Grid container alignItems="center">
                                        <Grid item xs>
                                            {option.name}
                                            {option.type === 'employee' && (
                                                <Typography variant="body2" color="text.secondary">
                                                    (员工, 客户: {option.customer_name})
                                                </Typography>
                                            )}
                                        </Grid>
                                    </Grid>
                                </li>
                            )}
                        />
                        {selectedCustomerName && (
                            <Box sx={{ mt: 4 }}>
                                <Divider sx={{ mb: 2 }}><Chip label="第二步：分配金额" /></Divider>
                                {isLoadingBills
                                    ? <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
                                    // 总是渲染UI容器，它内部会处理空状态
                                    : renderAllocationUI(customerBills, selectedCustomerName)
                                }
                            </Box>
                        )}
                        {renderActions()}
                    </Box>
                );
            case 'ignored':
                return (
                    <Box>
                        <Alert severity="info" sx={{ mb: 2 }}>
                            此流水已于 {new Date(transaction.updated_at).toLocaleString('zh-CN')} 被忽略。
                            {transaction.ignore_remark && (
                                <Typography variant="body2" sx={{ mt: 1.5, pt: 1.5, borderTop: 1, borderColor: 'divider', fontStyle:'italic' }}>
                                    原因: {transaction.ignore_remark}
                                </Typography>
                            )}
                        </Alert>
                        {renderActions()}
                    </Box>
                );
            default:
                return null;
        }
    };

    if (!transaction) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                <Typography color="text.secondary">请从左侧选择一条流水开始处理。</Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ p: 3 }}>
            <Box mb={3} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h5" gutterBottom>{transaction.payer_name} : ¥{formatCurrency(transaction.amount)}</Typography>
                <Typography variant="body2" color="text.secondary">
                    {new Date(transaction.transaction_time).toLocaleString('zh-CN')} | {transaction.summary || '无摘要'}
                </Typography>
            </Box>

            <Grid container spacing={1} alignItems="center" sx={{ mb: 3, p: 2, border: '1px solid', borderColor: 'divider', borderRadius:1, textAlign: 'center' }}>
                <Grid item xs={6} sm={3}><Typography variant="body2" component="div">回款额:<br/><Typography component="div" variant="h5" fontWeight="bold">¥{formatCurrency(totalTxnAmount)}</Typography></Typography></Grid>
                <Grid item xs={6} sm={3}><Typography variant="body2" component="div">已分配:<br/><Typography component="div" variant="h5"fontWeight="bold" color="text.secondary">¥{formatCurrency(alreadyAllocated)}</Typography></Typography></Grid>
                <Grid item xs={6} sm={3}><Typography variant="body2" component="div">本次分配:<br/><Typography component="div" variant="h5" fontWeight="bold" color="primary">¥{formatCurrency(totalAllocatedInThisSession)}</Typography></Typography></Grid>
                <Grid item xs={6} sm={3}><Typography variant="body2" component="div">剩余可分配:<br/><Typography component="div" variant="h5" fontWeight="bold" color={remainingAmount.lt(0) ? 'error' : 'warning.main'}>¥{formatCurrency(remainingAmount)}</Typography></Typography></Grid>
            </Grid>

            {renderContent()}
            <IgnoreRemarkDialog
                open={isIgnoreDialogOpen}
                onClose={() => setIsIgnoreDialogOpen(false)}
                onSubmit={handleConfirmIgnore}
            />
            <AliasConflictDialog
                open={aliasConflictInfo.open}
                onClose={() => setAliasConflictInfo({ open: false, payerName: '', message: '' })}
                onConfirm={() => handleForceCancelAlias(aliasConflictInfo.payerName)}
                payerName={aliasConflictInfo.payerName}
                message={aliasConflictInfo.message}
            />
        </Box>
    );
};
export default function ReconciliationPage() {
    const theme = useTheme();
    const { year: yearParam, month: monthParam } = useParams();
    const navigate = useNavigate();

    // --- State for ReconciliationPage ---
    const [categorizedTxns, setCategorizedTxns] = useState({ pending_confirmation: [], manual_allocation: [], unmatched: [], confirmed:[], processed: [], ignored: [] });
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [selectedTxn, setSelectedTxn] = useState(null);
    const [activeTab, setActiveTab] = useState('pending_confirmation');
    const [accountingPeriod, setAccountingPeriod] = useState(() => {
        const year = parseInt(yearParam, 10);
        const month = parseInt(monthParam, 10);
        if (year && month) return { year, month };
        const now = new Date();
        return { year: now.getFullYear(), month: now.getMonth() + 1 };
    });
    const [operationPeriod, setOperationPeriod] = useState(accountingPeriod);
    const [alertInfo, setAlertInfo] = useState({ open: false, message: '', severity: 'info' });
    const [payerSearchTerm, setPayerSearchTerm] = useState('');

    // --- State Lifted from Child ---
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    const [selectedCustomerName, setSelectedCustomerName] = useState(null);
    const [selectedSearchOption, setSelectedSearchOption] = useState(null);
    const [customerBills, setCustomerBills] = useState([]);
    const [isLoadingBills, setIsLoadingBills] = useState(false);
    const [closestBillInfo, setClosestBillInfo] = useState(null);
    const [relevantContractId, setRelevantContractId] = useState(null);

    // --- State for Modal ---
    const [billModalOpen, setBillModalOpen] = useState(false);
    const [loadingBillDetails, setLoadingBillDetails] = useState(false);
    const [selectedBillDetails, setSelectedBillDetails] = useState(null);
    const [selectedBillContext, setSelectedBillContext] = useState(null);

    
    const prevTransactionIdRef = useRef();
    const prevSelectedCustomerNameRef = useRef();
    const [isSwitchingCustomer, setIsSwitchingCustomer] = useState(false);
    const [overrideCustomerName, setOverrideCustomerName] = useState(null);
    const effectiveCustomerName = overrideCustomerName || selectedCustomerName;
    
    // --- Handlers ---
    const handleAlertClose = (event, reason) => {
        if (reason === 'clickaway') return;
        setAlertInfo(prev => ({ ...prev, open: false }));
    };

    const handlePeriodChange = (event) => {
        const { name, value } = event.target;
        const newPeriod = { ...accountingPeriod, [name]: parseInt(value, 10) };
        navigate(`/billing/reconcile/${newPeriod.year}/${newPeriod.month}`);
    };

    const handleDialogSubmit = async (lines) => {
        try {
            const result = await reconciliationApi.postStatement(lines);
            setAlertInfo({ open: true, message: `处理完成: 新增 ${result.data.new_imports} 条, 重复 ${result.data.duplicates} 条, 错误 ${result.data.errors} 条。`, severity: 'success' });
            setIsDialogOpen(false);
            fetchTransactions();
        } catch (err) {
            setAlertInfo({ open: true, message: `提交失败: ${err.message}`, severity: 'error' });
        }
    };
    
    const handleSaveBillDetails = async (payload) => {
        setLoadingBillDetails(true); // 开始加载
        try {
            const response = await api.post('/billing/batch-update', payload);
            const newDetails = response.data.latest_details;

            // 用后端返回的最新数据，更新弹窗的 state
            setSelectedBillDetails(newDetails);

            setAlertInfo({ open: true, message: response.data.message || "保存成功！", severity:'success' });

            // 同时刷新对账页面左侧的流水列表，以反映可能的账单状态变化
            softRefresh();

        } catch (error) {
            setAlertInfo({ open: true, message: `保存失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        } finally {
            setLoadingBillDetails(false); // 结束加载
        }
    };

    const handleTabChange = (event, newValue) => {
        setOverrideCustomerName(null);
        setIsSwitchingCustomer(false);
        // 当切换到或离开“未匹配”页签时，重置所有相关状态
        if (newValue === 'unmatched' || activeTab === 'unmatched') {
            setSelectedCustomerName(null);
            setSearchTerm('');
            setSearchResults([]);
            setSelectedSearchOption(null);
        }
        setActiveTab(newValue);
        setSelectedTxn(categorizedTxns[newValue]?.[0] || null);
    };

    const handleOpenBillModal = async (bill) => {
        if (!bill || !bill.id) return;
        setBillModalOpen(true);
        setLoadingBillDetails(true);
        try {
            const response = await api.get('/billing/details', { params: { bill_id: bill.id } });
            setSelectedBillDetails(response.data);
            setSelectedBillContext({
                customer_name: bill.customer_name,
                employee_name: bill.employee_name,
                contract_id: bill.contract_id,
                billingMonth: `${accountingPeriod.year}-${String(accountingPeriod.month).padStart(2, '0')}`
            });
        } catch (err) {
            setAlertInfo({ open: true, message: `获取账单详情失败: ${err.message}`, severity: 'error' });
        } finally {
            setLoadingBillDetails(false);
        }
    };

    const handleCloseBillModal = () => {
        setBillModalOpen(false);
        setSelectedBillDetails(null);
        setSelectedBillContext(null);
    };

    const handleStatusUpdate = (transactionId, fromCategory, toCategory) => {
        setCategorizedTxns(currentTxns => {
            const sourceList = [...(currentTxns[fromCategory] || [])];
            const destList = [...(currentTxns[toCategory] || [])];
            const transactionIndex = sourceList.findIndex(t => t.id === transactionId);
            if (transactionIndex === -1) return currentTxns;

            const [movedTxn] = sourceList.splice(transactionIndex, 1);
            movedTxn.status = toCategory;
            destList.unshift(movedTxn);

            let nextSelectedTxn = null;
            if (sourceList.length > 0) {
                nextSelectedTxn = sourceList[Math.min(transactionIndex, sourceList.length - 1)];
            }
            setSelectedTxn(nextSelectedTxn);

            return { ...currentTxns, [fromCategory]: sourceList, [toCategory]: destList };
        });
    };

    // --- Data Fetching ---

    const fetchTransactions = useCallback(async () => {
        if (!accountingPeriod.year || !accountingPeriod.month) return;
        setIsLoading(true);
        setError(null);
        setSelectedTxn(null);
        try {
            const response = await reconciliationApi.getUnmatchedTransactions(accountingPeriod);
            const originalData = response.data;
            const processed = [];
            const confirmed = [];
            if (originalData.confirmed) {
                originalData.confirmed.forEach(txn => {
                    const totalAmount = new Decimal(txn.amount || 0);
                    const allocatedAmount = new Decimal(txn.allocated_amount || 0);
                    if (totalAmount.equals(allocatedAmount) && totalAmount.gt(0)) {
                        processed.push(txn);
                    } else {
                        confirmed.push(txn);
                    }
                });
            }
            const newData = {
                pending_confirmation: [],
                manual_allocation: [],
                unmatched: [],
                ignored: [],
                ...originalData,
                confirmed: confirmed, 
                processed: processed,
            };
            setCategorizedTxns(newData);

            const firstTabWithData = ['pending_confirmation', 'manual_allocation', 'unmatched', 'confirmed', 'processed', 'ignored'].find(tab => newData[tab]?.length > 0);
            if (firstTabWithData) {
                setActiveTab(firstTabWithData);
                setSelectedTxn(newData[firstTabWithData][0]);
            } else {
                setActiveTab('pending_confirmation');
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [accountingPeriod]);

    const softRefresh = async () => {
        if (!accountingPeriod.year || !accountingPeriod.month) return;
        try {
            const response = await reconciliationApi.getUnmatchedTransactions(accountingPeriod);
            const originalData = response.data;
            const processed = [];
            const confirmed = [];
            if (originalData.confirmed) {
                originalData.confirmed.forEach(txn => {
                    const totalAmount = new Decimal(txn.amount || 0);
                    const allocatedAmount = new Decimal(txn.allocated_amount || 0);
                    if (totalAmount.equals(allocatedAmount) && totalAmount.gt(0)) {
                        processed.push(txn);
                    } else {
                        confirmed.push(txn);
                    }
                });
            }
            const newData = {
                pending_confirmation: [],
                manual_allocation: [],
                unmatched: [],
                ignored: [],
                ...originalData,
                confirmed: confirmed, 
                processed: processed,
            };

            const oldCategory = activeTab;
            const oldList = categorizedTxns[oldCategory] || [];
            const oldIndex = selectedTxn ? oldList.findIndex(t => t.id === selectedTxn.id) : -1;

            setCategorizedTxns(newData);

            if (selectedTxn) {
                let updatedTxn = null;
                let newCategory = null;

                for (const category in newData) {
                    const found = newData[category].find(t => t.id === selectedTxn.id);
                    if (found) {
                        updatedTxn = found;
                        newCategory = category;
                        break;
                    }
                }

                if (updatedTxn) {
                    const forbiddenTabs = ['confirmed', 'processed', 'ignored'];

                    if (newCategory && newCategory !== oldCategory) {
                        if (forbiddenTabs.includes(newCategory)) {
                            // 流水移动到“终点”页签：停留在当前页，并选中下一项
                            const currentListNow = newData[oldCategory] || [];
                            let nextSelectedTxn = null;
                            if (currentListNow.length > 0) {
                                nextSelectedTxn = currentListNow[Math.min(oldIndex, currentListNow.length - 1)];
                            }
                            setSelectedTxn(nextSelectedTxn);
                        } else {
                            // 流水移动到其他工作页签：跟随跳转
                            setActiveTab(newCategory);
                            setSelectedTxn(updatedTxn);
                        }
                    } else {
                        // 流水仍在当前页签：只更新数据
                        setSelectedTxn(updatedTxn);
                    }
                } else {
                    // 流水消失了（例如被删除）：选中当前列表的下一项
                    const currentListNow = newData[oldCategory] || [];
                     let nextSelectedTxn = null;
                    if (currentListNow.length > 0) {
                        nextSelectedTxn = currentListNow[Math.min(oldIndex, currentListNow.length - 1)];
                    }
                    setSelectedTxn(nextSelectedTxn);
                }
            }
            const tabsThatUseCustomerBills = ['unmatched', 'manual_allocation', 'pending_confirmation'];
            if (tabsThatUseCustomerBills.includes(activeTab) && selectedCustomerName && selectedTxn?.id) {
                const billsResponse = await api.get('/billing/bills-by-customer', { 
                    params: { 
                        customer_name: selectedCustomerName, 
                        year: operationPeriod.year, 
                        month: operationPeriod.month,
                        bank_transaction_id: selectedTxn.id
                    }
                });
                setCustomerBills(billsResponse.data.bills);
                setClosestBillInfo(billsResponse.data.closest_bill_period);
                setRelevantContractId(billsResponse.data.relevant_contract_id);
            }
        } catch (err) {
            console.error("Soft refresh failed:", err);
            setAlertInfo({ open: true, message: '数据刷新失败', severity: 'error' });
        }
    };

    // --- Effects ---

    useEffect(() => {
        const year = parseInt(yearParam, 10);
        const month = parseInt(monthParam, 10);
        if (year && month) {
            if (year !== accountingPeriod.year || month !== accountingPeriod.month) {
                setAccountingPeriod({ year, month });
            }
        } else if (yearParam === undefined && monthParam === undefined) {
            navigate(`/billing/reconcile/${new Date().getFullYear()}/${new Date().getMonth() + 1}`, { replace: true });
        }
    }, [yearParam, monthParam, navigate, accountingPeriod.year, accountingPeriod.month]);

    useEffect(() => {
        fetchTransactions();
    }, [fetchTransactions]);

    useEffect(() => {
        setOperationPeriod(accountingPeriod);
    }, [accountingPeriod, activeTab]);

    const prevCustomerNameRef = useRef();
    useEffect(() => {
        const getCustomerName = (txn) => {
            if (!txn) return null;
            // 检查所有可能的字段以可靠地获取客户名称
            if (txn.customer_name) return txn.customer_name;
            if (txn.matched_bill?.customer_name) return txn.matched_bill.customer_name;
            if (txn.allocated_to_bills?.[0]?.customer_name) return txn.allocated_to_bills[0].customer_name;
            if (txn.unpaid_bills?.[0]?.customer_name) return txn.unpaid_bills[0].customer_name;
            return null;
        };

        const currentCustomerName = getCustomerName(selectedTxn);

        // 当选择的客户发生变化时，重置操作月份为当前账期
        if (prevCustomerNameRef.current !== currentCustomerName) {
            setOperationPeriod(accountingPeriod);
        }

        // 为下一次渲染更新ref
        prevCustomerNameRef.current = currentCustomerName;
    }, [selectedTxn, accountingPeriod]);

    useEffect(() => {
        // 这个钩子现在只负责在特定页签下自动选择客户
        let customerNameToSet = null;

        // 如果用户正在切换客户，则不自动设置客户名
        if (isSwitchingCustomer) {
            return;
        }

        if (activeTab === 'manual_allocation' && selectedTxn) {
            // 优先从流水对象上直接获取客户名称
            if (selectedTxn.customer_name) {
                customerNameToSet = selectedTxn.customer_name;
            } 
            // 降级到旧逻辑作为安全保障
            else if (selectedTxn.unpaid_bills?.length > 0) {
                customerNameToSet = selectedTxn.unpaid_bills[0].customer_name;
            }
        } else if (activeTab === 'pending_confirmation' && selectedTxn?.matched_bill) {
            customerNameToSet = selectedTxn.matched_bill.customer_name;
        } else if ((activeTab === 'confirmed' || activeTab === 'processed') && selectedTxn?.allocated_to_bills?.length > 0) {
            customerNameToSet = selectedTxn.allocated_to_bills[0].customer_name;
        }

        // 仅当需要设置的客户名与当前状态不同时才更新，避免不必要的重渲染
        if (customerNameToSet !== selectedCustomerName) {
            setSelectedCustomerName(customerNameToSet);
        }
        // 当清除流水选择或切换到不相关的页签时，也清除客户选择
        else if (!selectedTxn || !['manual_allocation', 'pending_confirmation', 'confirmed', 'processed'].includes(activeTab)) {
            if (selectedCustomerName !== null) {
                setSelectedCustomerName(null);
            }
        }
    }, [selectedTxn, activeTab, isSwitchingCustomer, selectedCustomerName]); // 增加 selectedCustomerName 作为依赖项，确保及时更新

    useEffect(() => {
        const customerNameFromTxn = selectedTxn?.customer_name || selectedTxn?.matched_bill?.customer_name || selectedTxn?.allocated_to_bills?.[0]?.customer_name || selectedTxn?.unpaid_bills?.[0]?.customer_name;

        if (!customerNameFromTxn || !selectedTxn?.id) {
            setCustomerBills([]);
            setClosestBillInfo(null);
            setRelevantContractId(null);
            return;
        }
        setIsLoadingBills(true);
        api.get('/billing/bills-by-customer', { 
            params: { 
                customer_name: customerNameFromTxn, // 直接使用从selectedTxn中获取的客户名称
                year: operationPeriod.year, 
                month: operationPeriod.month,
                bank_transaction_id: selectedTxn.id
            } 
        })
        .then(response => {
            setCustomerBills(response.data.bills);
            setClosestBillInfo(response.data.closest_bill_period);
            setRelevantContractId(response.data.relevant_contract_id);
        })
        .catch(err => {
            setAlertInfo({ open: true, message: `获取客户账单失败: ${err.message}`, severity: 'error' });
        })
        .finally(() => {
            setIsLoadingBills(false);
        });
    }, [selectedTxn, operationPeriod]); // 依赖项改为 selectedTxn 和 operationPeriod

    useEffect(() => {
        if (!searchTerm) {
            setSearchResults([]);
            return;
        }

        // 核心修正：当开始一次新的搜索时，清除上一次的选择
        setSelectedSearchOption(null);

        setIsSearching(true);
        const delayDebounceFn = setTimeout(() => {
            api.get('/billing/search-unpaid-bills', { params: { search: searchTerm, year: accountingPeriod.year, month: accountingPeriod.month } })
                .then(response => {
                    setSearchResults(response.data);
                })
                .catch(err => console.error("Search failed:", err))
                .finally(() => setIsSearching(false));
        }, 500);
        return () => clearTimeout(delayDebounceFn);
    }, [searchTerm, accountingPeriod]);

    // --- Memoized Lists ---
    const currentList = useMemo(() => categorizedTxns[activeTab] || [], [categorizedTxns, activeTab]);

    const filteredList = useMemo(() => {
        const list = currentList || [];
        if (!payerSearchTerm) return list;
        const searchTerm = payerSearchTerm.toLowerCase();
        return list.filter(txn => {
            if (!txn || !txn.payer_name) return false;
            const payerName = txn.payer_name.toLowerCase();
            if (payerName.includes(searchTerm)) return true;
            try {
                const pinyinName = pinyin(payerName, { toneType: 'none', nonZh: 'consecutive' }).replace(/\s/g, '').toLowerCase();
                if (pinyinName.includes(searchTerm)) return true;
                 const pinyinInitials = pinyin(payerName, { pattern: 'first', toneType: 'none', nonZh: 'consecutive' }).replace(/\s/g, '').toLowerCase();
                if (pinyinInitials.includes(searchTerm)) return true;
            } catch (e) {
                console.error("pinyin-pro failed:", e);
                return true;
            }
            return false;
        });
    }, [currentList, payerSearchTerm]);

    const kpiStats = useMemo(() => {
        // 从所有分类中（除了“已忽略”）聚合流水
        const allNonIgnored = Object.entries(categorizedTxns)
            .filter(([key]) => key !== 'ignored')
            .flatMap(([, txns]) => txns);

        // 回款总额 = 所有非忽略流水的总金额
        const totalReceived = allNonIgnored.reduce((sum, txn) => sum.plus(new Decimal(txn.amount || 0)), new Decimal(0));

        // 已分配总额 = 所有非忽略流水的已分配金额
        const totalAllocated = allNonIgnored.reduce((sum, txn) => sum.plus(new Decimal(txn.allocated_amount || 0)), new Decimal(0));

        // 未分配金额 = 回款总额 - 已分配总额
        const unallocatedAmount = totalReceived.minus(totalAllocated);

        // 已忽略金额 = “已忽略”分类下所有流水的总金额
        const ignoredAmount = (categorizedTxns.ignored || []).reduce((sum, txn) => sum.plus(new Decimal(txn.amount || 0)), new Decimal(0));

        const formatNumber = (decimalValue) => {
            return decimalValue.toNumber().toLocaleString('zh-CN', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
        };

        return {
            totalReceived: formatNumber(totalReceived),
            totalAllocated: formatNumber(totalAllocated),
            unallocatedAmount: formatNumber(unallocatedAmount),
            ignoredAmount: formatNumber(ignoredAmount)
        };
    }, [categorizedTxns]);

    const watermarkText = accountingPeriod ? `${accountingPeriod.month}月` : '';

    return (
        <Box>
            <AlertMessage open={alertInfo.open} message={alertInfo.message} severity={alertInfo.severity} onClose={handleAlertClose} />
            <PasteStatementDialog open={isDialogOpen} onClose={() => setIsDialogOpen(false)} onSubmit={handleDialogSubmit} />

            <PageHeader
                title="银行流水对账中心"
                description="为客户的银行回款进行分配"
                actions={(
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <FormControl size="small" variant="outlined" sx={{ minWidth: 100, '& .MuiInputLabel-root': { color: 'rgba(255, 255, 255, 0.7)' }, '& .MuiInputLabel-root.Mui-focused': { color: 'white' } }}>
                            <InputLabel id="year-select-label">年份</InputLabel>
                            <Select labelId="year-select-label" label="年份" name="year" value={accountingPeriod.year}onChange={handlePeriodChange} sx={{ color: 'white', '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255, 255, 255, 0.5)' },'&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'white' }, '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor:'white' }, '& .MuiSelect-icon': { color: 'white' } }}>
                                {[2024, 2025, 2026].map(y => <MenuItem key={y} value={y}>{y}</MenuItem>)}
                            </Select>
                        </FormControl>
                        <FormControl size="small" variant="outlined" sx={{ minWidth: 100, '& .MuiInputLabel-root': { color: 'rgba(255, 255, 255, 0.7)' }, '& .MuiInputLabel-root.Mui-focused': { color: 'white' } }}>
                            <InputLabel id="month-select-label">月份</InputLabel>
                            <Select labelId="month-select-label" label="月份" name="month" value={accountingPeriod.month}onChange={handlePeriodChange} sx={{ color: 'white', '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255, 255, 255, 0.5)' },'&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'white' }, '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor:'white' }, '& .MuiSelect-icon': { color: 'white' } }}>
                                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <MenuItem key={m} value={m}>{m}月</MenuItem>)}
                            </Select>
                        </FormControl>
                    </Box>
                )}
            />
            <Grid container spacing={3} sx={{ px: 0, mb: 2 }}>
                <Grid item xs={12} sm={6} md={3}>
                    <Paper sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Avatar sx={{ bgcolor: alpha(theme.palette.primary.main, 0.1), color: 'primary.main', width: 48, height: 48 }}>
                            <AccountBalanceWalletIcon />
                        </Avatar>
                        <Box>
                            <Typography variant="button" color="text.secondary">回款总额</Typography>
                            <Typography variant="h5" fontWeight="bold">¥{kpiStats.totalReceived}</Typography>
                        </Box>
                    </Paper>
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                    <Paper sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Avatar sx={{ bgcolor: alpha(theme.palette.success.main, 0.1), color: 'success.main', width: 48, height: 48 }}>
                            <PlaylistAddCheckIcon />
                        </Avatar>
                        <Box>
                            <Typography variant="button" color="text.secondary">已分配总额</Typography>
                            <Typography variant="h5" fontWeight="bold" color="success.dark">¥{kpiStats.totalAllocated}</Typography>
                        </Box>
                    </Paper>
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                    <Paper sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Avatar sx={{ bgcolor: alpha(theme.palette.warning.main, 0.1), color: 'warning.main', width: 48, height: 48 }}>
                            <HourglassEmptyIcon />
                        </Avatar>
                        <Box>
                            <Typography variant="button" color="text.secondary">未分配金额</Typography>
                            <Typography variant="h5" fontWeight="bold" color="warning.dark">¥{kpiStats.unallocatedAmount}</Typography>
                        </Box>
                    </Paper>
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                    <Paper sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Avatar sx={{ bgcolor: 'grey.200', color: 'text.secondary', width: 48, height: 48 }}>
                            <BlockIcon />
                        </Avatar>
                        <Box>
                            <Typography variant="button" color="text.secondary">已忽略金额</Typography>
                            <Typography variant="h5" fontWeight="bold" color="text.secondary">¥{kpiStats.ignoredAmount}</Typography>
                        </Box>
                    </Paper>
                </Grid>
            </Grid>
            <Box sx={{ px: 0, py: 0 }}>
                <Grid container spacing={3}>
                    <Grid item xs={12} md={4}>
                        <Card sx={{ height: '82vh', display: 'flex', flexDirection: 'column' }}>
                            <CardHeader
                                title="待处理流水"
                                action={
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                        <TextField label="搜索付款人" variant="outlined" size="small" value={payerSearchTerm} onChange={(e) => setPayerSearchTerm(e.target.value)} sx={{ width: 100 }} />
                                        <Button variant="contained" onClick={() => setIsDialogOpen(true)}>导入银行流水</Button>
                                    </Box>
                                }
                            />
                            <CardContent sx={{ flexGrow: 1, overflowY: 'auto', '&::-webkit-scrollbar': { display: 'none' },msOverflowStyle: 'none', 'scrollbarWidth': 'none' }}>
                                {isLoading && <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>}
                                {error && <Alert severity="error">{error}</Alert>}
                                {!isLoading && !error && (
                                <List sx={{py: 0}}>
                                    {filteredList.length > 0 ? filteredList.map((txn) => {
                                        const totalAmount = new Decimal(txn.amount || 0);
                                        const allocatedAmount = new Decimal(txn.allocated_amount || 0);
                                        const remainingAmount = totalAmount.minus(allocatedAmount);
                                        let remainingColor = 'text.secondary';
                                        if (remainingAmount.isZero()) {
                                            remainingColor = 'success.main';
                                        } else if (remainingAmount.gt(0)) {
                                            remainingColor = 'warning.main';
                                        } else {
                                            remainingColor = 'error.main';
                                        }
                                        return (
                                            <React.Fragment key={txn.id}>
                                                <ListItem disablePadding secondaryAction={<Tooltip title="复制交易流水号"><IconButton edge="end" aria-label="copy" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(txn.transaction_id); setAlertInfo({open: true, message: '交易流水号已复制', severity: 'success' }); }}><ContentCopyIcon fontSize="small" /></IconButton></Tooltip>}>
                                                    <ListItemButton selected={selectedTxn?.id === txn.id} onClick={() => setSelectedTxn(txn)}>
                                                        <ListItemText
                                                                                                                    primary={
                                                                                                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                                                                                            <Typography variant="body1" component="div" fontWeight="bold">{txn.payer_name}</Typography>
                                                                                                                            {((txn.matched_by === 'alias') || ((activeTab === 'confirmed' || activeTab === 'processed') && txn.allocated_to_bills?.[0]?.customer_name && txn.payer_name !== txn.allocated_to_bills[0].customer_name)) && (
                                                                                                                                <Chip label="代付" color="warning" size="small" />
                                                                                                                            )}
                                                                                                                        </Box>
                                                                                                                    }                                                            secondary={
                                                                <Box sx={{ mt: 0.5 }}>
                                                                    <Grid container spacing={1} sx={{ textAlign: 'right' }}>
                                                                        <Grid item xs={4}><Typography variant="caption" color="text.secondary">总额</Typography></Grid>
                                                                        <Grid item xs={4}><Typography variant="caption" color="text.secondary">已分配</Typography></Grid>
                                                                        <Grid item xs={4}><Typography variant="caption" color="text.secondary">待分配</Typography></Grid>
                                                                        <Grid item xs={4}><Typography variant="body2" fontWeight="bold">¥{formatCurrency(totalAmount)}</Typography></Grid>
                                                                        <Grid item xs={4}><Typography variant="body2" color="text.secondary">¥{formatCurrency(allocatedAmount)}</Typography></Grid>
                                                                        <Grid item xs={4}><Typography variant="body2" fontWeight="bold" color={remainingColor}>¥{formatCurrency(remainingAmount)}</Typography></Grid>
                                                                    </Grid>
                                                                    <Typography variant="caption" color="text.secondary" sx={{ display:'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', mt: 0.5, textAlign: 'left' }}>
                                                                        {new Date(txn.transaction_time).toLocaleDateString()} | {txn.summary || '无'}
                                                                    </Typography>
                                                                </Box>
                                                            }
                                                            primaryTypographyProps={{ component: 'div' }}
                                                            secondaryTypographyProps={{ component: 'div' }}
                                                        />
                                                    </ListItemButton>
                                                </ListItem>
                                                <Divider component="li" />
                                            </React.Fragment>
                                        );
                                     }) : <Typography sx={{ textAlign: 'center', p: 4, color: 'text.secondary' }}>{payerSearchTerm ?'没有找到匹配的流水' :'当前分类下没有待处理流水。'}</Typography>}
                                </List>
                                )}
                            </CardContent>
                        </Card>
                    </Grid>
                    <Grid item xs={12} md={8}>
                        <Card sx={{ height: '82vh', display: 'flex', flexDirection: 'column', position: 'relative' }}>
                            <Box sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0, zIndex: 2, backgroundColor:'background.paper' }}>
                                <Tabs value={activeTab} onChange={handleTabChange} aria-label="reconciliation tabs">
                                    <Tab label={`待确认 (${categorizedTxns.pending_confirmation.length})`} value="pending_confirmation"/>
                                    <Tab label={`待手动分配 (${categorizedTxns.manual_allocation.length})`} value="manual_allocation" />
                                    <Tab label={`未匹配 (${categorizedTxns.unmatched.length})`} value="unmatched" />
                                    <Tab label={`已确认 (${categorizedTxns.confirmed.length})`} value="confirmed" />
                                    <Tab label={`已处理 (${categorizedTxns.processed.length})`} value="processed" />
                                    <Tab label={`已忽略 (${categorizedTxns.ignored.length})`} value="ignored" />
                                </Tabs>
                            </Box>
                            <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize:'8rem', fontWeight: 'bold', color: 'rgba(0, 0, 0, 0.04)', zIndex: 1, pointerEvents: 'none', userSelect: 'none' }}>
                                {watermarkText}
                            </Box>
                            <CardContent sx={{ flexGrow: 1, overflowY: 'auto', position: 'relative', zIndex: 2, backgroundColor:'transparent', p: 0, '&:last-child': {pb: 0 } }}>
                                <TransactionDetailsPanel
                                    transaction={selectedTxn}
                                    category={activeTab}
                                    onAllocationSuccess={softRefresh}
                                    onStatusUpdate={handleStatusUpdate}
                                    setAlertInfo={setAlertInfo}
                                    accountingPeriod={operationPeriod}
                                    setOperationPeriod={setOperationPeriod}
                                    mainAccountingPeriod={accountingPeriod} 
                                    onOpenBillModal={handleOpenBillModal}
                                    searchTerm={searchTerm}
                                    setSearchTerm={setSearchTerm}
                                    searchResults={searchResults}
                                    isSearching={isSearching}
                                    selectedCustomerName={selectedCustomerName}
                                    selectedSearchOption={selectedSearchOption}
                                    setSelectedSearchOption={setSelectedSearchOption}                                    
                                    setSelectedCustomerName={setSelectedCustomerName}
                                    customerBills={customerBills}
                                    isLoadingBills={isLoadingBills}
                                    closestBillInfo={closestBillInfo}
                                    relevantContractId={relevantContractId}
                                    isSwitchingCustomer={isSwitchingCustomer}
                                    setIsSwitchingCustomer={setIsSwitchingCustomer}
                                    setOverrideCustomerName={setOverrideCustomerName}
                                />
                            </CardContent>
                        </Card>
                    </Grid>
                </Grid>
            </Box>
            {billModalOpen && (
                <FinancialManagementModal
                    open={billModalOpen}
                    onClose={handleCloseBillModal}
                    contract={selectedBillContext}
                    billingMonth={selectedBillContext?.billingMonth}
                    billingDetails={selectedBillDetails}
                    loading={loadingBillDetails}
                    onSave={handleSaveBillDetails}
                    onNavigateToBill={(billId) => {
                        console.log("Navigate to bill ID:", billId);
                    }}
                />
            )}
        </Box>
    );
}