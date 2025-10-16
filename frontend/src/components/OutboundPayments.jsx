import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { reconciliationApi } from '../api/reconciliationApi';
import PageHeader from './PageHeader';
import AlertMessage from './AlertMessage';
import { Decimal } from 'decimal.js';
import { pinyin } from 'pinyin-pro';

import {
    Box, Button, Card, CardContent, CardHeader, CircularProgress, Grid, MenuItem,
    Typography, List, ListItem, ListItemText, ListItemButton, Divider, Select, Autocomplete,
    Dialog, DialogTitle, DialogContent, DialogActions, TextField, Alert, FormControl, InputLabel,
    Tabs, Tab, Paper, Stack, Tooltip, IconButton, Chip, Avatar
} from '@mui/material';
import {
    ContentCopy as ContentCopyIcon,
    AccountBalanceWallet as AccountBalanceWalletIcon,
    PlaylistAddCheck as PlaylistAddCheckIcon,
    HourglassEmpty as HourglassEmptyIcon,
    Block as BlockIcon
} from '@mui/icons-material';
import { useTheme, alpha } from '@mui/material/styles';

const formatCurrency = (value) => {
    const num = new Decimal(value || 0).toNumber();
    return num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const IgnoreRemarkDialog = ({ open, onClose, onSubmit }) => {
    const [remark, setRemark] = useState('');
    const handleSubmit = () => { onSubmit(remark); setRemark(''); onClose(); };
    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
            <DialogTitle>忽略流水</DialogTitle>
            <DialogContent>
                <TextField autoFocus margin="dense" label="忽略原因（选填）" fullWidth multiline rows={4} variant="outlined" value={remark} onChange={(e) => setRemark(e.target.value)} />
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>取消</Button>
                <Button onClick={handleSubmit} variant="contained" color="warning">确认忽略</Button>
            </DialogActions>
        </Dialog>
    );
};

const OutboundDetailsPanel = ({ transaction, category, onAllocationSuccess, setAlertInfo, accountingPeriod,onStatusUpdate }) => {
    const [allocations, setAllocations] = useState({});
    const [isSaving, setIsSaving] = useState(false);
    const [isIgnoreDialogOpen, setIsIgnoreDialogOpen] = useState(false);

    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    const [selectedPayable, setSelectedPayable] = useState(null);
    const [payableItems, setPayableItems] = useState([]);
    const [loadingPayables, setLoadingPayables] = useState(false);

    const handleConfirmSuggestion = async () => {
        if (!transaction?.matched_item) return;
        const item = transaction.matched_item;
        const amountToAllocate = new Decimal(transaction.amount);
        const payload = { allocations: [{ target_id: item.target_id, target_type: item.target_type, amount:amountToAllocate.toFixed(2) }] };
        setIsSaving(true);
        try {
            await reconciliationApi.allocateOutboundTransaction(transaction.id, payload);
            setAlertInfo({ open: true, message: '分配成功!', severity: 'success' });
            onAllocationSuccess();
        } catch (err) {
            setAlertInfo({ open: true, message: `操作失败: ${err.response?.data?.error || err.message}`, severity:'error' });
        } finally {
            setIsSaving(false);
        }
    };

    useEffect(() => {
        setAllocations({});
        setSearchTerm('');
        setSearchResults([]);
        setSelectedPayable(null);

        // Case 1: A partially allocated item is selected. It has a pre-filtered list of payables.
        if (transaction && transaction.payable_items) {
            setPayableItems(transaction.payable_items);

        // Case 2: The "Manual Allocation" tab is active, but the selected item doesn't have a pre-filtered list.
        // Fetch all payables for the month as a fallback.
        } else if (transaction && category === 'manual_allocation') {
            setLoadingPayables(true);
            reconciliationApi.getPayableItems(accountingPeriod)
                .then(response => setPayableItems([...response.data.payrolls, ...response.data.adjustments]))
                .catch(err => setAlertInfo({ open: true, message: '获取待支付项目失败', severity: 'error' }))
                .finally(() => setLoadingPayables(false));
        } else {
            setPayableItems([]);
        }
    }, [transaction, category, accountingPeriod, setAlertInfo]);

    useEffect(() => {
        if (!searchTerm) {
            setSearchResults([]);
            return;
        }
        setIsSearching(true);
        const timer = setTimeout(() => {
            reconciliationApi.searchPayableItems(searchTerm)
                .then(res => {
                    const uniqueResults = [];
                    const seenIds = new Set();
                    (res.data.results || []).forEach(item => {
                        if (!seenIds.has(item.id)) {
                            seenIds.add(item.id);
                            uniqueResults.push(item);
                        }
                    });
                    setSearchResults(uniqueResults);
                })
                .catch(err => console.error("Search failed:", err))
                .finally(() => setIsSearching(false));
        }, 500);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    const handleAllocationChange = (targetId, value) => {
        setAllocations(prev => ({ ...prev, [targetId]: value }));
    };

    const handleSave = async () => {
        const itemsToProcess = category === 'unmatched' ? (selectedPayable ? [selectedPayable] : []) :payableItems;
        const allocationsPayload = Object.entries(allocations)
            .map(([target_id, amount]) => {
                const item = itemsToProcess.find(p => p.target_id === target_id || p.id === target_id);
                return { ...item, amount: new Decimal(amount || 0) };
            })
            .filter(item => item.amount.gt(0))
            .map(item => ({
                target_id: item.target_id || item.id,
                target_type: item.target_type || item.type,
                amount: item.amount.toFixed(2)
            }));

        if (allocationsPayload.length === 0) {
            setAlertInfo({ open: true, message: "请输入至少一笔有效的分配金额。", severity: 'warning' });
            return;
        }
        setIsSaving(true);
        try {
            await reconciliationApi.allocateOutboundTransaction(transaction.id, { allocations:allocationsPayload});
            setAlertInfo({ open: true, message: '分配成功!', severity: 'success' });
            onAllocationSuccess();
        } catch (err) {
            setAlertInfo({ open: true, message: `操作失败: ${err.response?.data?.error || err.message}`, severity:'error' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleCancelAllocation = async () => {
        if (!transaction) return;
        if (!window.confirm(`确定要撤销这笔付款的所有分配吗？此操作不可逆。`)) return;
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

    const handleIgnore = async (remark) => {
        if (!transaction) return;
        setIsSaving(true);
        try {
            await reconciliationApi.ignoreTransaction(transaction.id, { remark });
            setAlertInfo({ open: true, message: '流水已忽略', severity: 'success' });
            onStatusUpdate(transaction.id, category, 'ignored');
        } catch (err) {
            setAlertInfo({ open: true, message: `操作失败: ${err.message}`, severity: 'error' });
        } finally {
            setIsSaving(false);
            setIsIgnoreDialogOpen(false);
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

    const totalTxnAmount = transaction ? new Decimal(transaction.amount) : new Decimal(0);
    const alreadyAllocated = transaction ? new Decimal(transaction.allocated_amount || 0) : new Decimal(0);
    const totalAllocatedInSession = Object.values(allocations).reduce((sum, amount) => sum.plus(new Decimal(amount|| 0)), new Decimal(0));
    const remainingAmount = totalTxnAmount.minus(alreadyAllocated).minus(totalAllocatedInSession);

    const renderAllocationUI = (items) => (
        <Stack spacing={2}>
            {items.map(item => (
                <Paper key={item.target_id || item.id} variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="body1" fontWeight="bold">{item.display_name || item.display}</Typography>
                    <Grid container spacing={2} alignItems="center" sx={{ mt: 1 }}>
                        <Grid item xs={6}><Typography variant="body2">待付: ¥{formatCurrency(item.amount_due)}</Typography></Grid>
                        <Grid item xs={6}><TextField label="本次分配" size="small" type="number" value={allocations[item.target_id || item.id] || ''} onChange={e => handleAllocationChange(item.target_id || item.id,e.target.value)} /></Grid>
                    </Grid>
                </Paper>
            ))}
        </Stack>
    );

    const renderContent = () => {
        switch (category) {
            case 'pending_confirmation':
                return (
                    <Box>
                        <Alert severity="success" sx={{ mb: 2 }}>系统建议将此笔付款分配给:</Alert>
                        <Paper variant="outlined" sx={{ p: 2 }}>
                            <Typography variant="h6">{transaction.matched_item.display_name}</Typography>
                            <Typography>待付金额: ¥{formatCurrency(transaction.matched_item.amount_due)}</Typography>
                        </Paper>
                        <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between' }}>
                            <Button variant="outlined" color="warning" onClick={() => setIsIgnoreDialogOpen(true)}>忽略</Button>
                            <Button variant="contained" onClick={handleConfirmSuggestion}disabled={isSaving}>确认分配</Button>
                        </Box>
                    </Box>
                );
            case 'manual_allocation':
                const existingAllocs = transaction.allocations || [];
                const hasPayableItems = payableItems && payableItems.length > 0;

                return (
                    <Box>
                        {existingAllocs.length > 0 && (
                            <Box mb={hasPayableItems ? 3 : 0}>
                                <Typography variant="subtitle2" gutterBottom sx={{ color: 'text.secondary', borderBottom: 1, borderColor: 'divider', pb: 1, mb: 2 }}>已分配项</Typography>
                                <List dense disablePadding>
                                    {existingAllocs.map((alloc, index) => (
                                        <ListItem key={index} sx={{ pl: 0 }}>
                                            <ListItemText
                                                primary={alloc.display_name}
                                                secondary={
                                                    <Typography variant="body2" color="text.secondary">
                                                        {`本次已分配: `}
                                                        <Typography component="span" variant="body2" fontWeight="bold" color="success.main">
                                                            ¥{formatCurrency(alloc.allocated_amount_from_this_txn)}
                                                        </Typography>
                                                    </Typography>
                                                }
                                            />
                                        </ListItem>
                                    ))}
                                </List>
                            </Box>
                        )}

                        {loadingPayables && <CircularProgress />}

                        {!loadingPayables && hasPayableItems && (
                            <Box mt={existingAllocs.length > 0 ? 3 : 0}>
                                <Typography variant="subtitle2" gutterBottom sx={{ color: 'text.secondary', borderBottom: 1, borderColor: 'divider', pb: 1, mb: 2 }}>可分配项</Typography>
                                {renderAllocationUI(payableItems)}
                            </Box>
                        )}

                        {!loadingPayables && !hasPayableItems && existingAllocs.length === 0 && (
                            <Alert severity="info">没有找到可供分配的付款项目。</Alert>
                        )}

                        <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Button variant="outlined" color="warning" onClick={() => setIsIgnoreDialogOpen(true)}>忽略此流水</Button>
                            <Box>
                                {existingAllocs.length > 0 && (
                                    <Button variant="outlined" color="error" onClick={handleCancelAllocation} disabled={isSaving} sx={{ mr: 2 }}>
                                        撤销全部分配
                                    </Button>
                                )}
                                {hasPayableItems && (
                                    <Button variant="contained" onClick={handleSave} disabled={isSaving}>
                                        {isSaving ? '处理中...' : '保存分配'}
                                    </Button>
                                )}
                            </Box>
                        </Box>
                    </Box>
                );
            case 'unmatched':
                return (
                    <Box>
                        <Alert severity="warning" sx={{ mb: 2 }}>未找到与付款人 “{transaction.payer_name}”的精确匹配项。</Alert>
                        <Autocomplete options={searchResults} getOptionLabel={(option) => option.display || ''}loading={isSearching} onInputChange={(e, val) => setSearchTerm(val)} onChange={(e, val) => setSelectedPayable(val)}filterOptions={(x) => x} renderInput={(params) => <TextField {...params} label="搜索员工/客户姓名" />} />
                        {selectedPayable && <Box sx={{ mt: 2 }}>{renderAllocationUI([selectedPayable])}</Box>}
                        <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between' }}><Button variant="outlined" color="warning" onClick={() => setIsIgnoreDialogOpen(true)}>忽略</Button><Button variant="contained"onClick={handleSave} disabled={!selectedPayable || isSaving}>保存分配并创建别名</Button></Box>
                    </Box>
                );
            case 'confirmed':
            case 'processed':
                return (
                    <Box>
                        <Alert severity={category === 'processed' ? 'success' : 'info'} sx={{ mb: 2 }}>
                            此流水已于 {new Date(transaction.updated_at).toLocaleString('zh-CN')} {category ==='processed' ? '处理完毕' : '确认分配'}。
                        </Alert>
                        <List>{(transaction.allocations || []).map((alloc, index) => (
                            <ListItem key={index} divider sx={{ display: 'flex', flexWrap: 'wrap', gap: 2,alignItems: 'center', py: 2 }}>
                                <Box sx={{ flex: '1 1 300px', minWidth: '250px' }}><Typography variant="body1">{alloc.display_name}</Typography></Box>
                                <Grid container spacing={1} sx={{ flex: '2 1 400px', minWidth: '300px', fontFamily:'monospace' }}>
                                    <Grid item xs={6} sm={3}><Typography variant="caption" color="text.secondary">应付总额</Typography><Typography variant="body2">¥{formatCurrency(alloc.total_due)}</Typography></Grid>
                                    <Grid item xs={6} sm={3}><Typography variant="caption" color="text.secondary">本次分配</Typography><Typography variant="body2" color="success.main" fontWeight="bold">¥{formatCurrency(alloc.allocated_amount_from_this_txn)}</Typography></Grid>
                                    <Grid item xs={6} sm={3}><Typography variant="caption" color="text.secondary">剩余待付</Typography><Typography variant="body2" color="error.main" fontWeight="bold">¥{formatCurrency(alloc.amount_remaining)}</Typography></Grid>
                                </Grid>
                            </ListItem>
                        ))}</List>
                    </Box>
                );
            case 'ignored':
                 return (
                    <Box>
                        <Alert severity="info" sx={{ mb: 2 }}>
                            此流水已于 {new Date(transaction.updated_at).toLocaleString('zh-CN')} 被忽略。
                            {transaction.ignore_remark && (
                                <Typography variant="body2" sx={{ mt: 1.5, pt: 1.5, borderTop: 1, borderColor:'divider', fontStyle:'italic' }}>
                                    原因: {transaction.ignore_remark}
                                </Typography>
                            )}
                        </Alert>
                        <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
                            <Button variant="outlined" color="info" onClick={handleUnignore}disabled={isSaving}>撤销忽略</Button>
                        </Box>
                    </Box>
                );
            default: return null;
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
                    {new Date(transaction.transaction_time).toLocaleString('zh-CN')} | {transaction.summary ||'无摘要'}
                </Typography>
            </Box>

            <Grid container spacing={1} alignItems="center" sx={{ mb: 3, p: 2, border: '1px solid', borderColor:'divider', borderRadius: 1, textAlign: 'center' }}>
                <Grid item xs={6} sm={3}><Typography variant="body2" component="div">付款额:<br /><Typography component="div" variant="h5" fontWeight="bold">¥{formatCurrency(totalTxnAmount)}</Typography></Typography></Grid>
                <Grid item xs={6} sm={3}><Typography variant="body2" component="div">已分配:<br /><Typography component="div" variant="h5" fontWeight="bold" color="text.secondary">¥{formatCurrency(alreadyAllocated)}</Typography></Typography></Grid>
                <Grid item xs={6} sm={3}><Typography variant="body2" component="div">本次分配:<br /><Typography component="div" variant="h5" fontWeight="bold" color="primary">¥{formatCurrency(totalAllocatedInSession)}</Typography></Typography></Grid>
                <Grid item xs={6} sm={3}><Typography variant="body2" component="div">剩余可分配:<br /><Typography component="div" variant="h5" fontWeight="bold" color={remainingAmount.lt(0) ? 'error' : 'warning.main'}>¥{formatCurrency(remainingAmount)}</Typography></Typography></Grid>
            </Grid>

            {renderContent()}
            <IgnoreRemarkDialog open={isIgnoreDialogOpen} onClose={() => setIsIgnoreDialogOpen(false)}onSubmit={handleIgnore} />
        </Box>
    );
};

export default function OutboundPayments() {
    const theme = useTheme();
    const { year: yearParam, month: monthParam } = useParams();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('pending_confirmation');
    const [categorizedTxns, setCategorizedTxns] = useState({ pending_confirmation: [], manual_allocation: [],unmatched: [], confirmed: [], processed: [], ignored: [] });
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedTxn, setSelectedTxn] = useState(null);
    const [alertInfo, setAlertInfo] = useState({ open: false, message: '', severity: 'info' });
    const [payerSearchTerm, setPayerSearchTerm] = useState('');

    const accountingPeriod = useMemo(() => {
        const year = parseInt(yearParam, 10);
        const month = parseInt(monthParam, 10);
        if (year && month) return { year, month };
        const now = new Date();
        navigate(`/billing/salary-payment/${now.getFullYear()}/${now.getMonth() + 1}`, { replace: true });
        return { year: now.getFullYear(), month: now.getMonth() + 1 };
    }, [yearParam, monthParam, navigate]);

    const fetchAndSetData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await reconciliationApi.getCategorizedOutboundTransactions(accountingPeriod);
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

            const newCategorized = {
                pending_confirmation: originalData.pending_confirmation || [],
                manual_allocation: originalData.manual_allocation || [],
                unmatched: originalData.unmatched || [],
                confirmed: confirmed,
                processed: processed,
                ignored: originalData.ignored || [],
            };
            setCategorizedTxns(newCategorized);

            // After a refresh, try to find the previously selected transaction
            const currentSelectedId = selectedTxn?.id;
            let nextSelectedTxn = null;
            if (currentSelectedId) {
                // Find in the current active tab first
                nextSelectedTxn = (newCategorized[activeTab] || []).find(t => t.id === currentSelectedId);
            }

            // If not found in current tab (maybe it moved), or nothing was selected
            if (!nextSelectedTxn) {
                const listForCurrentTab = newCategorized[activeTab] || [];
                if (listForCurrentTab.length > 0) {
                    nextSelectedTxn = listForCurrentTab[0];
                } else {
                    // If current tab is now empty, find the first available tab and select its first item
                    const firstTabWithData = ['pending_confirmation', 'manual_allocation', 'unmatched', 'confirmed', 'processed', 'ignored'].find(tab => newCategorized[tab]?.length > 0);
                    if (firstTabWithData && activeTab !== firstTabWithData) {
                        setActiveTab(firstTabWithData);
                        nextSelectedTxn = newCategorized[firstTabWithData][0];
                    } else if (firstTabWithData) {
                        nextSelectedTxn = newCategorized[firstTabWithData][0];
                    }
                }
            }
            setSelectedTxn(nextSelectedTxn);

        } catch (err) {
            setError('获取分类后的付款数据失败。');
        } finally {
            setIsLoading(false);
        }
    }, [accountingPeriod, activeTab, selectedTxn?.id]);

    useEffect(() => {
        fetchAndSetData();
    }, [accountingPeriod]);

    const handlePeriodChange = (event) => {
        const { name, value } = event.target;
        const newPeriod = { ...accountingPeriod, [name]: parseInt(value, 10) };
        navigate(`/billing/salary-payment/${newPeriod.year}/${newPeriod.month}`);
    };

    const handleTabChange = (event, newValue) => {
        setActiveTab(newValue);
        setSelectedTxn(categorizedTxns[newValue]?.[0] || null);
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

    const handleAlertClose = (event, reason) => {
        if (reason === 'clickaway') return;
        setAlertInfo(prev => ({ ...prev, open: false }));
    };

    const currentList = useMemo(() => categorizedTxns[activeTab] || [], [categorizedTxns, activeTab]);

    const filteredList = useMemo(() => {
        if (!payerSearchTerm) return currentList;
        const searchTerm = payerSearchTerm.toLowerCase();
        return currentList.filter(txn => {
            if (!txn || !txn.payer_name) return false;
            const payerName = txn.payer_name.toLowerCase();
            if (payerName.includes(searchTerm)) return true;
            try {
                const pinyinName = pinyin(payerName, { toneType: 'none', nonZh: 'consecutive' }).replace(/\s/g, '').toLowerCase();
                return pinyinName.includes(searchTerm);
            } catch (e) { return true; }
        });
    }, [currentList, payerSearchTerm]);

    const kpiStats = useMemo(() => {
        const allNonIgnored = Object.entries(categorizedTxns)
            .filter(([key]) => key !== 'ignored')
            .flatMap(([, txns]) => txns.filter((v, i, a) => a.findIndex(t => (t.id === v.id)) === i)); // Deduplicate txns

        const totalPaid = allNonIgnored.reduce((sum, txn) => sum.plus(new Decimal(txn.amount || 0)), new Decimal(0));
        const totalAllocated = allNonIgnored.reduce((sum, txn) => sum.plus(new Decimal(txn.allocated_amount || 0)),new Decimal(0));
        const unallocatedAmount = totalPaid.minus(totalAllocated);
        const ignoredAmount = (categorizedTxns.ignored || []).reduce((sum, txn) => sum.plus(new Decimal(txn.amount|| 0)), new Decimal(0));

        const formatNumber = (decimalValue) => decimalValue.toNumber().toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2 });

        return {
            totalPaid: formatNumber(totalPaid),
            totalAllocated: formatNumber(totalAllocated),
            unallocatedAmount: formatNumber(unallocatedAmount),
            ignoredAmount: formatNumber(ignoredAmount)
        };
    }, [categorizedTxns]);

    return (
        <Box>
            <AlertMessage open={alertInfo.open} message={alertInfo.message} severity={alertInfo.severity}onClose={handleAlertClose} />
            <PageHeader
                title="对外付款工作台"
                description="分配公司对外付款流水"
                actions={(
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <FormControl size="small" variant="outlined" sx={{ minWidth: 100, '& .MuiInputLabel-root':{color: 'rgba(255, 255, 255, 0.7)' }, '& .MuiInputLabel-root.Mui-focused': { color: 'white' } }}>
                            <InputLabel>年份</InputLabel>
                            <Select label="年份" name="year" value={accountingPeriod.year}onChange={handlePeriodChange} sx={{ color: 'white', '& .MuiOutlinedInput-notchedOutline': { borderColor:'rgba(255,255, 255, 0.5)' },'&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'white' }, '&.Mui-focused.MuiOutlinedInput-notchedOutline': { borderColor:'white' }, '& .MuiSelect-icon': { color: 'white' } }}>
                                {[2024, 2025, 2026].map(y => <MenuItem key={y} value={y}>{y}</MenuItem>)}
                            </Select>
                        </FormControl>
                        <FormControl size="small" variant="outlined" sx={{ minWidth: 100, '& .MuiInputLabel-root':{color: 'rgba(255, 255, 255, 0.7)' }, '& .MuiInputLabel-root.Mui-focused': { color: 'white' } }}>
                            <InputLabel>月份</InputLabel>
                            <Select label="月份" name="month" value={accountingPeriod.month}onChange={handlePeriodChange} sx={{ color: 'white', '& .MuiOutlinedInput-notchedOutline': { borderColor:'rgba(255,255, 255, 0.5)' },'&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'white' }, '&.Mui-focused.MuiOutlinedInput-notchedOutline': { borderColor:'white' }, '& .MuiSelect-icon': { color: 'white' } }}>
                                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <MenuItem key={m} value={m}>{m}月</MenuItem>)}
                            </Select>
                        </FormControl>
                    </Box>
                )}
            />
            <Grid container spacing={3} sx={{ px: 0, mb: 2 }}>
                <Grid item xs={12} sm={6} md={3}>
                    <Paper sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Avatar sx={{ bgcolor: alpha(theme.palette.primary.main, 0.1), color: 'primary.main', width: 48, height: 48 }}><AccountBalanceWalletIcon /></Avatar>
                        <Box><Typography variant="button" color="text.secondary">付款总额</Typography><Typography variant="h5" fontWeight="bold">¥{kpiStats.totalPaid}</Typography></Box>
                    </Paper>
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                    <Paper sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Avatar sx={{ bgcolor: alpha(theme.palette.success.main, 0.1), color: 'success.main', width: 48, height: 48 }}><PlaylistAddCheckIcon /></Avatar>
                        <Box><Typography variant="button" color="text.secondary">已分配总额</Typography><Typography variant="h5" fontWeight="bold" color="success.dark">¥{kpiStats.totalAllocated}</Typography></Box>
                    </Paper>
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                    <Paper sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Avatar sx={{ bgcolor: alpha(theme.palette.warning.main, 0.1), color: 'warning.main', width: 48, height: 48 }}><HourglassEmptyIcon /></Avatar>
                        <Box><Typography variant="button" color="text.secondary">未分配金额</Typography><Typography variant="h5" fontWeight="bold" color="warning.dark">¥{kpiStats.unallocatedAmount}</Typography></Box>
                    </Paper>
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                    <Paper sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Avatar sx={{ bgcolor: 'grey.200', color: 'text.secondary', width: 48, height: 48 }}><BlockIcon /></Avatar>
                        <Box><Typography variant="button" color="text.secondary">已忽略金额</Typography><Typography variant="h5" fontWeight="bold" color="text.secondary">¥{kpiStats.ignoredAmount}</Typography></Box>
                    </Paper>
                </Grid>
            </Grid>
            <Box sx={{ px: 0, py: 0 }}>
                <Grid container spacing={3}>
                    <Grid item xs={12} md={4}>
                        <Card sx={{ height: '82vh', display: 'flex', flexDirection: 'column' }}>
                            <CardHeader
                                title="待处理流水"
                                action={<TextField label="搜索收款人" variant="outlined" size="small" value={payerSearchTerm} onChange={(e) => setPayerSearchTerm(e.target.value)} sx={{ width: 150 }}/>}
                            />
                            <CardContent sx={{ flexGrow: 1, overflowY: 'auto', p:0, '&::-webkit-scrollbar': {display: 'none' },msOverflowStyle: 'none', 'scrollbarWidth': 'none' }}>
                                {isLoading ? <CircularProgress sx={{m:4}} /> : (
                                <List dense sx={{py: 0}}>
                                    {filteredList.map((txn) => {
                                        const totalAmount = new Decimal(txn.amount || 0);
                                        const allocatedAmount = new Decimal(txn.allocated_amount || 0);
                                        const remainingAmount = totalAmount.minus(allocatedAmount);
                                        let remainingColor = 'text.secondary';
                                        if (remainingAmount.isZero()) remainingColor = 'success.main';
                                        else if (remainingAmount.gt(0)) remainingColor = 'warning.main';
                                        else remainingColor = 'error.main';

                                        return (
                                            <React.Fragment key={txn.id}>
                                                <ListItem disablePadding secondaryAction={<Tooltip title="复制交易流水号"><IconButton edge="end" onClick={(e) => {e.stopPropagation();navigator.clipboard.writeText(txn.transaction_id); setAlertInfo({open: true, message:'交易流水号已复制', severity:'success' }); }}><ContentCopyIcon fontSize="small" /></IconButton></Tooltip>}>
                                                    <ListItemButton selected={selectedTxn?.id === txn.id} onClick={() => setSelectedTxn(txn)}>
                                                        <ListItemText
                                                            primary={<Typography variant="body1" component="div" fontWeight="bold">{txn.payer_name}</Typography>}
                                                            secondary={
                                                                <Box sx={{ mt: 0.5 }}>
                                                                    <Grid container spacing={1} sx={{ textAlign:'right' }}>
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
                                    })}
                                </List>
                                )}
                            </CardContent>
                        </Card>
                    </Grid>
                    <Grid item xs={12} md={8}>
                        <Card sx={{ height: '82vh', display: 'flex', flexDirection: 'column' }}>
                            <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                                <Tabs value={activeTab} onChange={handleTabChange} variant="scrollable">
                                    <Tab label={`待确认 (${categorizedTxns.pending_confirmation.length})`} value="pending_confirmation" />
                                    <Tab label={`待手动分配 (${categorizedTxns.manual_allocation.length})`} value="manual_allocation" />
                                    <Tab label={`未匹配 (${categorizedTxns.unmatched.length})`} value="unmatched"/>
                                    <Tab label={`已分配 (${categorizedTxns.confirmed.length})`} value="confirmed"/>
                                    <Tab label={`已处理 (${categorizedTxns.processed.length})`} value="processed"/>
                                    <Tab label={`已忽略 (${categorizedTxns.ignored.length})`} value="ignored" />
                                </Tabs>
                            </Box>
                            <CardContent sx={{ flexGrow: 1, overflowY: 'auto', p: 0, '&:last-child': {pb: 0 } }}>
                               <OutboundDetailsPanel
                                    transaction={selectedTxn}
                                    category={activeTab}
                                    onAllocationSuccess={fetchAndSetData}
                                    onStatusUpdate={handleStatusUpdate}
                                    setAlertInfo={setAlertInfo}
                                    accountingPeriod={accountingPeriod}
                                />
                            </CardContent>
                        </Card>
                    </Grid>
                </Grid>
            </Box>
        </Box>
    );
}