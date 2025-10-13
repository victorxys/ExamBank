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

// --- Material-UI Imports ---
import {
    Box, Button, Card, CardContent, CardHeader, CircularProgress, Grid, MenuItem,
    Typography, List, ListItem, ListItemText, ListItemButton, Divider, Select, Autocomplete,
    Dialog, DialogTitle, DialogContent, DialogActions, TextField, Alert, FormControl, InputLabel,
    Tabs, Tab, Chip, Tooltip, IconButton, Paper,Stack
} from '@mui/material';
import {
    ContentCopy as ContentCopyIcon,
    ArrowBackIosNew as ArrowBackIosNewIcon,
    ArrowForwardIos as ArrowForwardIosIcon
} from '@mui/icons-material';

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
                <Button onClick={handleSubmit} variant="contained" disabled={isSubmitting || !statementText.trim()}>{isSubmitting ? '处理中...' : '导入'}</Button>
            </DialogActions>
        </Dialog>
    );
};
const TransactionDetailsPanel = ({ transaction, category, onAllocationSuccess, onStatusUpdate, setAlertInfo, accountingPeriod, setOperationPeriod, onOpenBillModal }) => {
    const [allocations, setAllocations] = useState({});
    const [isSaving, setIsSaving] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    const [selectedCustomerName, setSelectedCustomerName] = useState(null);
    const [customerBills, setCustomerBills] = useState([]);
    const [isLoadingBills, setIsLoadingBills] = useState(false);

    const handleMonthChange = (delta) => {
        const newDate = new Date(accountingPeriod.year, accountingPeriod.month - 1 + delta);
        setOperationPeriod({
            year: newDate.getFullYear(),
            month: newDate.getMonth() + 1,
        });
    };
    const handlePrevMonth = () => handleMonthChange(-1);
    const handleNextMonth = () => handleMonthChange(1);

    const billListRef = useRef(null);

    useEffect(() => {
        const bills = (category === 'manual_allocation' && customerBills.length > 0) 
                      ? customerBills
                      : (category === 'manual_allocation' && transaction?.unpaid_bills)
                      ? transaction.unpaid_bills
                      : customerBills;

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
    }, [customerBills, transaction, category, accountingPeriod]);

    useEffect(() => {
        setAllocations({});
        setSearchTerm('');
        setSearchResults([]);
        setSelectedCustomerName(null);

        if (transaction) {
            if (category === 'pending_confirmation' && transaction.matched_bill) {
                const bill = transaction.matched_bill;
                const amountToAllocate = Math.min(parseFloat(transaction.amount), parseFloat(bill.amount_remaining));
                setAllocations({ [bill.id]: amountToAllocate.toString() });
            } else if (category === 'manual_allocation' && transaction.unpaid_bills?.length > 0) {
                const customerName = transaction.unpaid_bills[0].customer_name;
                setSelectedCustomerName(customerName);
            }
        }
    }, [transaction, category]);

    useEffect(() => {
        if (!searchTerm) {
            setSearchResults([]);
            return;
        }
        setIsSearching(true);
        const delayDebounceFn = setTimeout(() => {
            api.get('/billing/search-unpaid-bills', { params: { search: searchTerm, year: accountingPeriod.year, month: accountingPeriod.month } })
                .then(response => {
                    const uniqueCustomerNames = [...new Set(response.data.map(item => item.customer_name))];
                    setSearchResults(uniqueCustomerNames);
                })
                .catch(err => console.error("Search failed:", err))
                .finally(() => setIsSearching(false));
        }, 500);
        return () => clearTimeout(delayDebounceFn);
    }, [searchTerm, accountingPeriod]);

    useEffect(() => {
        if (!selectedCustomerName) {
            setCustomerBills([]);
            return;
        }
        setIsLoadingBills(true);
        api.get('/billing/unpaid-bills-by-customer', { params: { customer_name: selectedCustomerName, year: accountingPeriod.year, month: accountingPeriod.month } })
            .then(response => setCustomerBills(response.data))
            .catch(err => setAlertInfo({ open: true, message: `获取客户账单失败: ${err.message}`, severity: 'error' }))
            .finally(() => setIsLoadingBills(false));
    }, [selectedCustomerName, accountingPeriod]);

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
            if (category === 'unmatched' && allocationsPayload.length > 0) {
                const firstAllocatedBillId = parseInt(allocationsPayload[0].bill_id, 10);
                const billToGetContractFrom = customerBills.find(b => b.id === firstAllocatedBillId);

                if (billToGetContractFrom?.contract_id) {
                    await payerAliasApi.createAlias({
                        payer_name: transaction.payer_name,
                        contract_id: billToGetContractFrom.contract_id,
                    });
                    setAlertInfo({ open: true, message: '别名创建成功', severity: 'info' });
                } else {
                    console.error("Could not find contract_id for the allocated bill. Alias not created.");
                }
            }

            await reconciliationApi.allocateTransaction({ transactionId: transaction.id, allocations: allocationsPayload });
            setAlertInfo({ open: true, message: "分配成功！", severity: 'success' });
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

    const handleIgnore = async () => {
        if (!transaction) return;
        if (!window.confirm(`确定要忽略这笔来自 "${transaction.payer_name}" 的流水吗？`)) return;
        setIsSaving(true);
        try {
            await reconciliationApi.ignoreTransaction(transaction.id);
            setAlertInfo({ open: true, message: '流水已忽略', severity: 'success' });
            onStatusUpdate(transaction.id, category, 'ignored');
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
    const alreadyAllocated = transaction ? new Decimal(transaction.allocated_amount) : new Decimal(0);
    const remainingAmount = totalTxnAmount.minus(alreadyAllocated).minus(totalAllocatedInThisSession);
    const isSaveDisabled = totalAllocatedInThisSession.lte(0) || remainingAmount.lt(0) || isSaving;

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

    const getBillMonthChipProps = (bill, accountingPeriod) => {
        const isCurrent = bill.year === accountingPeriod.year && bill.bill_month === accountingPeriod.month;
        if (isCurrent) {
            return { color: 'primary', sx: { ml: 1 } };
        }
        const now = new Date(accountingPeriod.year, accountingPeriod.month - 1);
        const billDate = new Date(bill.year, bill.bill_month - 1);
        let monthDiff = (now.getFullYear() - billDate.getFullYear()) * 12;
        monthDiff += now.getMonth() - billDate.getMonth();
        if (monthDiff < 0) {
            return { color: 'primary', sx: { ml: 1 } };
        }
        const opacity = Math.min(0.6 + monthDiff * 0.1, 1);
        return { sx: { ml: 1, backgroundColor: `rgba(237, 108, 2, ${opacity})`, color: 'white' } };
    };

    const renderAllocationUI = (bills, customerName) => {
        const validBills = [...bills]
            .filter(bill => {
                if (bill && bill.id) return true;
                console.warn("Detected a bill object that is null, undefined, or missing an 'id'. Filtering it out.", bill);
                return false;
            })
            .sort((a, b) => {
                if (a.year !== b.year) return a.year - b.year;
                return a.month - b.month;
            });

        return (
            <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="h6" gutterBottom>
                        客户: {customerName}
                    </Typography>
                    <Box>
                        <IconButton onClick={handlePrevMonth} size="small"><ArrowBackIosNewIcon fontSize="inherit" /></IconButton>
                        <IconButton onClick={handleNextMonth} size="small"><ArrowForwardIosIcon fontSize="inherit" /></IconButton>
                    </Box>
                </Box>
                <Typography variant="subtitle1" gutterBottom sx={{ mb: 2 }}>
                    该客户在 {accountingPeriod.year}年{accountingPeriod.month}月 有以下未付账单:
                </Typography>
                
                <Stack spacing={2} ref={billListRef}>
                    {validBills.map((bill, index) => (
                        <Paper key={bill.id} variant="outlined" sx={{ p: 2 }}>
                            <Grid container spacing={2} alignItems="center">
                                {/* Column 1 */}
                                <Grid item xs={12} md={6}>
                                    <Box>
                                        <Typography variant="body1" component="div" sx={{ display: 'flex', alignItems: 'center' }}>
                                            {`账单周期: ${bill.cycle}`}
                                            {(category === 'manual_allocation' || category === 'unmatched') && bill.bill_month && (
                                                <Chip label={`${bill.bill_month}月账单`} size="small" {...getBillMonthChipProps(bill, accountingPeriod)} />
                                            )}
                                        </Typography>
                                        <Typography variant="body2" color="text.secondary">{`员工: ${bill.employee_name}`}</Typography>
                                    </Box>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                                        <TextField type="number" size="small" sx={{ width: '130px' }} placeholder="0.00" value={allocations[bill.id] || ''} onChange={(e) =>handleAllocationChange(bill.id, e.target.value)} InputProps={{ startAdornment: <Typography component="span" sx={{ mr: 1 }}>¥</Typography>}} />
                                        <Button size="small" variant="outlined" onClick={() => handleSmartFill(bill.id)}>自动</Button>
                                        {index === validBills.length - 1 && (<Button size="small" variant="outlined" onClick={() => handleSmartFill(bill.id)}>剩余</Button>)}
                                    </Box>
                                </Grid>

                                {/* Column 2 */}
                                <Grid item xs={12} md={4}>
                                    <Box sx={{ fontFamily: 'monospace', textAlign: 'left' }}>
                                        <Typography variant="body2">应付: ¥{bill.total_due}</Typography>
                                        <Typography variant="body2" color="text.secondary">已付: ¥{bill.total_paid}</Typography>
                                        {bill.payments && bill.payments.map((p, i) => (<Typography variant="caption" color="text.secondary" key={i}>{`↳ ${p.payer_name}: ¥${p.amount}`}</Typography>))}
                                        {bill.paid_by_this_txn && parseFloat(bill.paid_by_this_txn) > 0 && (<Typography variant="body2" color="primary.main">{`↳ 本次流水已付:¥${bill.paid_by_this_txn}`}</Typography>)}
                                        <Typography variant="body2" fontWeight="bold" color="error.main">待付: ¥{bill.amount_remaining}</Typography>
                                    </Box>
                                </Grid>

                                {/* Column 3 */}
                                <Grid item xs={12} md={2}>
                                    <Box sx={{ textAlign: 'right' }}>
                                        <Button variant="outlined" size="small" onClick={() => onOpenBillModal(bill)}>查看账单</Button>
                                    </Box>
                                </Grid>
                            </Grid>
                        </Paper>
                    ))}
                </Stack>
            </Box>
        );
    };

    const handleCancelAlias = async () => {
        if (!transaction) return;
        if (!window.confirm(`确定要解除付款人 "${transaction.payer_name}" 的别名关系吗？下次系统将不再自动匹配。`)) return;
        setIsSaving(true);
        try {
            await payerAliasApi.deleteAlias(transaction.payer_name);
            setAlertInfo({ open: true, message: '别名已解除！正在刷新...', severity: 'success' });
            onAllocationSuccess();
        } catch (err) {
            setAlertInfo({ open: true, message: `操作失败: ${err.message}`, severity: 'error' });
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
                                <Button variant="outlined" color="warning" onClick={handleCancelAlias} disabled={isSaving} sx={{ mr: 2 }}>解除支付关系</Button>
                            )}
                            <Button variant="contained" onClick={handleSave} disabled={isSaving}>确认并保存</Button>
                        </Box>
                    </Box>
                );
            case 'manual_allocation':
                return (
                     <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Button variant="outlined" color="warning" onClick={handleIgnore} disabled={isSaving}>忽略此流水</Button>
                        <Button variant="contained" onClick={handleSave} disabled={isSaveDisabled}>
                            {isSaving ? '处理中...' : '保存分配'}
                        </Button>
                    </Box>
                );
            case 'unmatched':
                return (
                    <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Button variant="outlined" color="warning" onClick={handleIgnore} disabled={isSaving}>忽略此流水</Button>
                        <Button variant="contained" onClick={handleSave} disabled={!selectedCustomerName || isSaveDisabled}>
                            {isSaving ? '处理中...' : '保存分配并创建别名'}
                        </Button>
                    </Box>
                );
            case 'confirmed':
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
                return (
                    <Box>
                        <Alert severity="success" sx={{ mb: 2 }}>
                            系统已通过 {transaction.matched_by === 'alias' ? '别名/支付关系' : '客户名'} 自动匹配到唯一账单，请确认。
                        </Alert>
                        <Typography variant="h5" gutterBottom>客户: {transaction.matched_bill.customer_name} ~ 员工: {transaction.matched_bill.employee_name}</Typography>
                        <List>
                            <ListItem divider sx={{ alignItems: 'center' }}>
                                <ListItemText primary={`账单周期: ${transaction.matched_bill.cycle}`} secondary={`应付: ${transaction.matched_bill.total_due} | 待付: ${transaction.matched_bill.amount_remaining}`} />
                                <Button variant="outlined" size="small" onClick={() => onOpenBillModal(transaction.matched_bill)} sx={{ ml: 2 }}>查看账单</Button>
                            </ListItem>
                        </List>
                        {renderActions()}
                    </Box>
                );
            case 'manual_allocation':
                if (isLoadingBills) {
                    return <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>;
                }
                if (selectedCustomerName && customerBills.length > 0) {
                    return <>{renderAllocationUI(customerBills, selectedCustomerName)}{renderActions()}</>;
                }
                if (selectedCustomerName) {
                    return <Typography sx={{ p: 2, color: 'text.secondary' }}>未找到该客户在 {accountingPeriod.year}年{accountingPeriod.month}月 的未付账单。</Typography>;
                }
                return <Typography sx={{ p: 2, color: 'text.secondary' }}>正在加载客户账单...</Typography>;
            case 'confirmed':
                const customerName = transaction.allocated_to_bills?.[0]?.customer_name;
                return (
                    <Box>
                        <Alert severity="info" sx={{ mb: 2 }}>此流水已于 {new Date(transaction.updated_at).toLocaleString('zh-CN')} 确认分配。</Alert>
                        <Typography variant="h6" gutterBottom>
                            付款人: {transaction.payer_name}
                            {customerName && transaction.payer_name !== customerName && (
                                <Typography component="span" variant="body1" color="text.secondary" sx={{ ml: 1 }}>
                                    (客户: {customerName})
                                </Typography>
                            )}
                        </Typography>
                        <Typography variant="subtitle1" gutterBottom>已分配给以下账单:</Typography>
                        <List>
                            {transaction.allocated_to_bills.map((bill, index) => (
                                <ListItem key={`${bill.id}-${index}`} id={`bill-item-${bill.id}`} divider sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', py: 2}}>
                                    <Box sx={{ flex: '1 1 300px', minWidth: '250px' }}><Typography variant="body1">{bill.employee_name}</Typography><Typography variant="body2" color="text.secondary">{bill.cycle}</Typography></Box>
                                    <Grid container spacing={1} sx={{ flex: '2 1 400px', minWidth: '300px', fontFamily: 'monospace' }}>
                                        <Grid item xs={6} sm={3}><Typography variant="caption" color="text.secondary">应收总额</Typography><Typography variant="body2">¥{bill.total_due}</Typography></Grid>
                                        <Grid item xs={6} sm={3}><Typography variant="caption" color="text.secondary">本次分配</Typography><Typography variant="body2" color="success.main" fontWeight="bold">¥{bill.allocated_amount_from_this_txn}</Typography></Grid>
                                        <Grid item xs={6} sm={3}><Typography variant="caption" color="text.secondary">实收总额</Typography><Typography variant="body2">¥{bill.total_paid}</Typography></Grid>
                                        <Grid item xs={6} sm={3}><Typography variant="caption" color="text.secondary">剩余待收</Typography><Typography variant="body2" color="error.main" fontWeight="bold">¥{bill.amount_remaining}</Typography></Grid>
                                    </Grid>
                                    <Box sx={{ flex: '0 1 auto', ml: 'auto' }}><Button variant="outlined" size="small" onClick={() =>onOpenBillModal(bill)}>查看账单</Button></Box>
                                </ListItem>
                            ))}
                        </List>
                        {renderActions()}
                    </Box>
                );
            case 'unmatched':
                return (
                    <Box>
                        <Alert severity="warning" sx={{ mb: 2 }}>未找到与付款人 “{transaction.payer_name}” 关联的客户。</Alert>
                        <Typography variant="subtitle1" gutterBottom>第一步：从系统中搜索并选择一个客户：</Typography>
                        <Autocomplete
                            options={searchResults}
                            getOptionLabel={(option) => option || ''}
                            loading={isSearching}
                            onInputChange={(event, newInputValue) => setSearchTerm(newInputValue)}
                            onChange={(event, newValue) => setSelectedCustomerName(newValue)}
                            filterOptions={(x) => x}
                            renderInput={(params) => (<TextField {...params} label="搜索客户姓名或拼音" />)}
                        />
                        {selectedCustomerName && (
                            <Box sx={{ mt: 4 }}>
                                <Divider sx={{ mb: 2 }}><Chip label="第二步：分配金额" /></Divider>
                                {isLoadingBills ? <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box> : (
                                    customerBills.length > 0 
                                        ? renderAllocationUI(customerBills, selectedCustomerName)
                                        : <Typography sx={{ p: 2, color: 'text.secondary' }}>未找到该客户在此会计月份的未付账单。</Typography>
                                )}
                            </Box>
                        )}
                        {renderActions()}
                    </Box>
                );
            case 'ignored':
                return (
                    <Box>
                        <Alert severity="info" sx={{ mb: 2 }}>此流水已于 {new Date(transaction.updated_at).toLocaleString('zh-CN')} 被忽略。</Alert>
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
                <Typography variant="h5" gutterBottom>{transaction.payer_name} : ¥{new Decimal(transaction.amount).toFixed(2)}</Typography>
                <Typography variant="body2" color="text.secondary">
                    {new Date(transaction.transaction_time).toLocaleString('zh-CN')} | {transaction.summary || '无摘要'}
                </Typography>
            </Box>

            <Grid container spacing={1} alignItems="center" sx={{ mb: 3, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1, textAlign: 'center' }}>
                <Grid item xs={6} sm={3}><Typography variant="body2" component="div">流水总额:<br/><Typography component="div" variant="h6" fontWeight="bold">¥{totalTxnAmount.toFixed(2)}</Typography></Typography></Grid>
                <Grid item xs={6} sm={3}><Typography variant="body2" component="div">已分配:<br/><Typography component="div" variant="h6" fontWeight="bold" color="text.secondary">¥{alreadyAllocated.toFixed(2)}</Typography></Typography></Grid>
                <Grid item xs={6} sm={3}><Typography variant="body2" component="div">本次分配:<br/><Typography component="div" variant="h6" fontWeight="bold" color="primary">¥{totalAllocatedInThisSession.toFixed(2)}</Typography></Typography></Grid>
                <Grid item xs={6} sm={3}><Typography variant="body2" component="div">剩余可分配:<br/><Typography component="div" variant="h6" fontWeight="bold" color={remainingAmount.lt(0) ? 'error' : 'warning.main'}>¥{remainingAmount.toFixed(2)}</Typography></Typography></Grid>
            </Grid>

            {renderContent()}
        </Box>
    );
};

export default function ReconciliationPage() {
    const { year: yearParam, month: monthParam } = useParams();
    const navigate = useNavigate();

    const [categorizedTxns, setCategorizedTxns] = useState({ pending_confirmation: [], manual_allocation: [], unmatched: [], confirmed: [], ignored: [] });
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [selectedTxn, setSelectedTxn] = useState(null);
    const [activeTab, setActiveTab] = useState('pending_confirmation');
    
    const [accountingPeriod, setAccountingPeriod] = useState(() => {
        const year = parseInt(yearParam, 10);
        const month = parseInt(monthParam, 10);
        if (year && month) {
            return { year, month };
        }
        return { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
    });

    const [operationPeriod, setOperationPeriod] = useState(accountingPeriod);
    const [alertInfo, setAlertInfo] = useState({ open: false, message: '', severity: 'info' });

    useEffect(() => {
        const year = parseInt(yearParam, 10);
        const month = parseInt(monthParam, 10);

        if (year && month) {
            if (year !== accountingPeriod.year || month !== accountingPeriod.month) {
                setAccountingPeriod({ year, month });
            }
        } else if (yearParam === undefined && monthParam === undefined) {
            const now = new Date();
            navigate(`/billing/reconcile/${now.getFullYear()}/${now.getMonth() + 1}`, { replace: true });
        }
    }, [yearParam, monthParam, navigate, accountingPeriod.year, accountingPeriod.month]);

    useEffect(() => {
        setOperationPeriod(accountingPeriod);
    }, [accountingPeriod, selectedTxn]);
    
    const [billModalOpen, setBillModalOpen] = useState(false);
    const [loadingBillDetails, setLoadingBillDetails] = useState(false);
    const [selectedBillDetails, setSelectedBillDetails] = useState(null);
    const [selectedBillContext, setSelectedBillContext] = useState(null);

    const handleAlertClose = (event, reason) => {
        if (reason === 'clickaway') return;
        setAlertInfo(prev => ({ ...prev, open: false }));
    };

    const fetchTransactions = useCallback(async () => {
        if (!accountingPeriod.year || !accountingPeriod.month) return;
        setIsLoading(true);
        setError(null);
        setSelectedTxn(null);
        try {
            const response = await reconciliationApi.getUnmatchedTransactions(accountingPeriod);
            setCategorizedTxns(response.data);
            const firstTabWithData = ['pending_confirmation', 'manual_allocation', 'unmatched', 'confirmed', 'ignored'].find(tab => response.data[tab]?.length > 0);
            if (firstTabWithData) {
                setActiveTab(firstTabWithData);
                setSelectedTxn(response.data[firstTabWithData][0]);
            } else {
                setActiveTab('pending_confirmation');
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [accountingPeriod]);

    const handleStatusUpdate = (transactionId, fromCategory, toCategory) => {
        setCategorizedTxns(currentTxns => {
            const sourceList = [...(currentTxns[fromCategory] || [])];
            const destList = [...(currentTxns[toCategory] || [])];
    
            const transactionIndex = sourceList.findIndex(t => t.id === transactionId);
            if (transactionIndex === -1) {
                return currentTxns; // Should not happen
            }
    
            // 1. Remove from source list
            const [movedTxn] = sourceList.splice(transactionIndex, 1);
    
            // 2. Update status and add to destination list
            movedTxn.status = toCategory; // Assuming the category name matches the status value
            destList.unshift(movedTxn); // Add to the top of the new list
    
            // 3. Determine next selected transaction
            let nextSelectedTxn = null;
            if (sourceList.length > 0) {
                // Select the next one, or the previous one if it was the last
                nextSelectedTxn = sourceList[Math.min(transactionIndex, sourceList.length - 1)];
            }
            setSelectedTxn(nextSelectedTxn);
    
            // 4. Return the new state
            return {
                ...currentTxns,
                [fromCategory]: sourceList,
                [toCategory]: destList,
            };
        });
    };

    useEffect(() => {
        fetchTransactions();
    }, [fetchTransactions]);

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

    const handleTabChange = (event, newValue) => {
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
    
    const findBillInCategorizedTxns = (billId) => {
        for (const category in categorizedTxns) {
            for (const txn of categorizedTxns[category]) {
                const bills = txn.unpaid_bills || txn.allocated_to_bills || (txn.matched_bill ? [txn.matched_bill] : []);
                const foundBill = bills.find(b => b.id === billId);
                if (foundBill) return foundBill;
            }
        }
        return null;
    };

    const handleCloseBillModal = () => {
        setBillModalOpen(false);
        setSelectedBillDetails(null);
        setSelectedBillContext(null);
    };

    const currentList = useMemo(() => categorizedTxns[activeTab] || [], [categorizedTxns, activeTab]);
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
                        <FormControl size="small" variant="outlined" sx={{ minWidth: 100, 
                            '& .MuiInputLabel-root': { color: 'rgba(255, 255, 255, 0.7)' },
                            '& .MuiInputLabel-root.Mui-focused': { color: 'white' },
                        }}>
                            <InputLabel id="year-select-label">年份</InputLabel>
                            <Select
                                labelId="year-select-label"
                                label="年份"
                                name="year"
                                value={accountingPeriod.year}
                                onChange={handlePeriodChange}
                                sx={{
                                    color: 'white',
                                    '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255, 255, 255, 0.5)' },
                                    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'white' },
                                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'white' },
                                    '& .MuiSelect-icon': { color: 'white' },
                                }}
                            >
                                {[2024, 2025, 2026].map(y => <MenuItem key={y} value={y}>{y}</MenuItem>)}
                            </Select>
                        </FormControl>
                        <FormControl size="small" variant="outlined" sx={{ minWidth: 100,
                            '& .MuiInputLabel-root': { color: 'rgba(255, 255, 255, 0.7)' },
                            '& .MuiInputLabel-root.Mui-focused': { color: 'white' },
                        }}>
                            <InputLabel id="month-select-label">月份</InputLabel>
                            <Select
                                labelId="month-select-label"
                                label="月份"
                                name="month"
                                value={accountingPeriod.month}
                                onChange={handlePeriodChange}
                                sx={{
                                    color: 'white',
                                    '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255, 255, 255, 0.5)' },
                                    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'white' },
                                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'white' },
                                    '& .MuiSelect-icon': { color: 'white' },
                                }}
                            >
                                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <MenuItem key={m} value={m}>{m}月</MenuItem>)}
                            </Select>
                        </FormControl>
                    </Box>
                )}
            />
            <Box sx={{ px: 0, py: 0 }}>
                <Grid container spacing={3}>
                    <Grid item xs={12} md={4}>
                        <Card sx={{ height: '82vh', display: 'flex', flexDirection: 'column' }}>
                            <CardHeader title="待处理流水" action={<Button variant="contained" onClick={() => setIsDialogOpen(true)}>导入银行流水</Button>} />
                            <CardContent sx={{
                                flexGrow: 1,
                                overflowY: 'auto',
                                '&::-webkit-scrollbar': { display: 'none' },
                                msOverflowStyle: 'none',
                                'scrollbarWidth': 'none'
                            }}>
                                {isLoading && <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>}
                                {error && <Alert severity="error">{error}</Alert>}
                                {!isLoading && !error && (
                                <List sx={{py: 0}}>
                                    {currentList.length > 0 ? currentList.map((txn) => {
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
                                                <ListItem disablePadding secondaryAction={<Tooltip title="复制交易流水号"><IconButton edge="end" aria-label="copy" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(txn.transaction_id); setAlertInfo({ open: true, message: '交易流水号已复制', severity: 'success' }); }}><ContentCopyIcon fontSize="small" /></IconButton></Tooltip>}>
                                                    <ListItemButton selected={selectedTxn?.id === txn.id} onClick={() => setSelectedTxn(txn)}>
                                                        <ListItemText
                                                            primary={<Typography variant="body1" component="div" fontWeight="bold">{txn.payer_name}</Typography>}
                                                            secondary={
                                                                <Box sx={{ mt: 0.5 }}>
                                                                    <Grid container spacing={1} sx={{ textAlign: 'right' }}>
                                                                        <Grid item xs={4}><Typography variant="caption" color="text.secondary">总额</Typography></Grid>
                                                                        <Grid item xs={4}><Typography variant="caption" color="text.secondary">已分配</Typography></Grid>
                                                                        <Grid item xs={4}><Typography variant="caption" color="text.secondary">待分配</Typography></Grid>
                                                                        <Grid item xs={4}><Typography variant="body2" fontWeight="bold">¥{totalAmount.toFixed(2)}</Typography></Grid>
                                                                        <Grid item xs={4}><Typography variant="body2" color="text.secondary">¥{allocatedAmount.toFixed(2)}</Typography></Grid>
                                                                        <Grid item xs={4}><Typography variant="body2" fontWeight="bold" color={remainingColor}>¥{remainingAmount.toFixed(2)}</Typography></Grid>
                                                                    </Grid>
                                                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', mt: 0.5, textAlign: 'left' }}>
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
                                    }) : <Typography sx={{ textAlign: 'center', p: 4, color: 'text.secondary' }}>当前分类下没有待处理流水。</Typography>}
                                </List>
                                )}
                            </CardContent>
                        </Card>
                    </Grid>
                    <Grid item xs={12} md={8}>
                        <Card sx={{ height: '82vh', display: 'flex', flexDirection: 'column' }}>
                            <Box sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
                                <Tabs value={activeTab} onChange={handleTabChange} aria-label="reconciliation tabs">
                                    <Tab label={`待确认 (${categorizedTxns.pending_confirmation.length})`} value="pending_confirmation" />
                                    <Tab label={`待手动分配 (${categorizedTxns.manual_allocation.length})`} value="manual_allocation" />
                                    <Tab label={`未匹配 (${categorizedTxns.unmatched.length})`} value="unmatched" />
                                    <Tab label={`已确认 (${categorizedTxns.confirmed.length})`} value="confirmed" />
                                    <Tab label={`已忽略 (${categorizedTxns.ignored.length})`} value="ignored" />
                                </Tabs>
                            </Box>
                            <CardContent sx={{ position: 'relative', flexGrow: 1, overflowY: 'auto' }}>
                                <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: '8rem', fontWeight: 'bold', color: 'rgba(0, 0, 0, 0.04)', zIndex: 0, pointerEvents: 'none', userSelect: 'none' }}>{watermarkText}</Box>
                                <Box sx={{ position: 'relative', zIndex: 1, width: '100%' }}>
                                    <TransactionDetailsPanel 
                                        transaction={selectedTxn} 
                                        category={activeTab} 
                                        onAllocationSuccess={fetchTransactions}
                                        onStatusUpdate={handleStatusUpdate}
                                        setAlertInfo={setAlertInfo}
                                        accountingPeriod={operationPeriod} // <-- Use the new operationPeriod state
                                        setOperationPeriod={setOperationPeriod} // <-- Pass the setter function
                                        onOpenBillModal={handleOpenBillModal}
                                    />
                                </Box>
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
                    onSave={() => {}}
                    onNavigateToBill={() => {}}
                />
            )}
        </Box>
    );
}