// frontend/src/components/ContractList.jsx (支持排序和默认过滤)

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Button, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TablePagination, CircularProgress, Tooltip, Dialog, DialogTitle,
  DialogContent, DialogActions, Alert, TextField, Select, MenuItem, FormControl,
  InputLabel, Chip, Grid, TableSortLabel, Stack, IconButton
} from '@mui/material';
import {
    Sync as SyncIcon, Edit as EditIcon, Add as AddIcon, EventBusy as EventBusyIcon, CheckCircle as CheckCircleIcon, Cancel as CancelIcon
} from '@mui/icons-material';
import { useTheme, alpha } from '@mui/material/styles';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';

import api from '../api/axios';
import PageHeader from './PageHeader';
import AlertMessage from './AlertMessage';

const formatDate = (isoString) => {
  if (!isoString) return 'N/A';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '无效日期';
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
  } catch (e) { return '无效日期'; }
};

const ContractList = () => {
    const theme = useTheme();
    const navigate = useNavigate();
    const [contracts, setContracts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [alert, setAlert] = useState({ open: false, message: '', severity: 'info' });
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(10);
    const [totalContracts, setTotalContracts] = useState(0);
    const [syncing, setSyncing] = useState(false);

    // --- 核心修正 1：修改默认状态并增加排序 state ---
    const [filters, setFilters] = useState({ search: '', type: '', status: '' });
    const [sortBy, setSortBy] = useState(null); // 'remaining_days' or null
    const [sortOrder, setSortOrder] = useState('asc'); // 'asc' or 'desc'

    const [terminationDialogOpen, setTerminationDialogOpen] = useState(false);
    const [contractToTerminate, setContractToTerminate] = useState(null);
    const [terminationDate, setTerminationDate] = useState(null);

    const [onboardingDialogOpen, setOnboardingDialogOpen] = useState(false);
    const [contractToSetDate, setContractToSetDate] = useState(null);
    const [newOnboardingDate, setNewOnboardingDate] = useState(null);

    const fetchContracts = useCallback(async () => {
        setLoading(true);
        try {
            const params = {
                page: page + 1,
                per_page: rowsPerPage,
                ...filters
            };
            // --- 核心修正 2：将排序参数添加到API请求中 ---
            if (sortBy) {
                params.sort_by = sortBy;
                params.sort_order = sortOrder;
            }
            const response = await api.get('/billing/contracts', { params });
            setContracts(response.data.items || []);
            setTotalContracts(response.data.total || 0);
        } catch (error) {
            setAlert({ open: true, message: `获取合同列表失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        } finally { setLoading(false); }
    }, [page, rowsPerPage, filters, sortBy, sortOrder]); // 添加 sortBy 和 sortOrder 到依赖项

    useEffect(() => {
        fetchContracts();
    }, [fetchContracts]);

    const handleFilterChange = (e) => {
        setPage(0);
        setFilters(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    // --- 核心修正 3：处理排序的函数 ---
    const handleSort = (column) => {
        const isAsc = sortBy === column && sortOrder === 'asc';
        setSortOrder(isAsc ? 'desc' : 'asc');
        setSortBy(column);
    };

    const handleOpenTerminationDialog = (contract) => {
        setContractToTerminate(contract);
        setTerminationDate(new Date(contract.end_date));
        setTerminationDialogOpen(true);
    };

    const handleCloseTerminationDialog = () => {
        setTerminationDialogOpen(false);
        setContractToTerminate(null);
        setTerminationDate(null);
    };

    const handleConfirmTermination = async () => {
        if (!contractToTerminate || !terminationDate) return;
        try {
            await api.post(`/billing/contracts/${contractToTerminate.id}/terminate`, {
                termination_date: terminationDate.toISOString().split('T')[0],
            });
            setAlert({ open: true, message: '合同已终止，正在为您重算最后一期账单...', severity: 'success' });
            handleCloseTerminationDialog();
            fetchContracts();
        } catch (error) {
            setAlert({ open: true, message: `操作失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        }
    };

    const handleTriggerSync = async () => {
        setSyncing(true);
        setAlert({open: true, message: "合同同步任务已提交...", severity: 'info'});
        try {
            await api.post('/billing/sync-contracts');
            setTimeout(() => {
                setAlert({open: true, message: "同步任务正在后台处理，列表即将刷新。", severity: 'success'});
                setTimeout(() => fetchBills(), 5000);
            }, 3000);
        } catch (error) {
            setAlert({ open: true, message: `触发同步失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        } finally { setSyncing(false); }
    };

    const handleTrialSucceeded = async (contract) => {
        try {
            await api.post(`/billing/contracts/${contract.id}/succeed`);
            setAlert({ open: true, message: '试工成功！该合同已完成。', severity: 'success' });
            fetchContracts();
        } catch (error) {
            setAlert({ open: true, message: `操作失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        }
    };

    const handleOpenOnboardingDialog = (contract) => {
        setContractToSetDate(contract);
        const defaultDate = contract.provisional_start_date ? new Date(contract.provisional_start_date) : new Date();
        setNewOnboardingDate(defaultDate);
        setOnboardingDialogOpen(true);
    };
    const handleCloseOnboardingDialog = () => {
        setOnboardingDialogOpen(false);
        setContractToSetDate(null);
    };

    const handleSaveOnboardingDate = async () => {
        if (!contractToSetDate || !newOnboardingDate) {
            setAlert({ open: true, message: '请选择一个有效的日期', severity: 'warning' });
            return;
        }
        try {
            await api.put(`/billing/contracts/${contractToSetDate.id}`, {
                actual_onboarding_date: newOnboardingDate.toISOString().split('T')[0]
            });
            setAlert({ open: true, message: '上户日期已更新，正在为您预生成所有账单...', severity: 'info' });

            await api.post(`/billing/contracts/${contractToSetDate.id}/generate-all-bills`);

            setAlert({ open: true, message: '所有账单已成功预生成！', severity: 'success' });
            handleCloseOnboardingDialog();
            fetchContracts();

        } catch (error) {
            setAlert({ open: true, message: `操作失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        }
    };

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Box>
                <AlertMessage open={alert.open} message={alert.message} severity={alert.severity} onClose={() => setAlert(prev => ({...prev, open:false}))} />
                <PageHeader title="合同管理" description="查看、筛选和管理所有服务合同。" />
                <Paper sx={{ p: 2, mb: 3 }}>
                    <Grid container spacing={2} alignItems="center">
                        <Grid item xs={12} sm={4}><TextField fullWidth label="搜索客户/员工" name="search" value={filters.search} onChange={handleFilterChange} size="small" /></Grid>
                        <Grid item xs={6} sm={2}><FormControl fullWidth size="small"><InputLabel>类型</InputLabel><Select name="type" value={filters.type} label="类型" onChange={handleFilterChange}><MenuItem value=""><em>全部</em></MenuItem><MenuItem value="nanny">育儿嫂</MenuItem><MenuItem value="maternity_nurse">月嫂</MenuItem> <MenuItem value="nanny_trial">育儿嫂试工</MenuItem></Select></FormControl></Grid>
                        {/* --- 核心修正 4：修改状态过滤器的选项 --- */}
                        <Grid item xs={6} sm={2}><FormControl fullWidth size="small"><InputLabel>状态</InputLabel><Select name="status" value={filters.status} label="状态" onChange={handleFilterChange}><MenuItem value="all"><em>全部状态</em></MenuItem><MenuItem value="active">服务中</MenuItem><MenuItem value="pending">待上户</MenuItem><MenuItem value="finished">已完成</MenuItem><MenuItem value="terminated">已终止</MenuItem><MenuItem value="trial_active">试工中</MenuItem><MenuItem value="trial_succeeded">试工成功</MenuItem></Select></FormControl></Grid>
                        <Grid item xs={12} sm={4} sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                            {/* <Button variant="contained" startIcon={<AddIcon />}>新增合同</Button> */}
                            {/* <Button variant="outlined" startIcon={<SyncIcon />}>同步合同</Button> */}
                            <Button variant="contained" onClick={handleTriggerSync} disabled={syncing} startIcon={syncing ? <CircularProgress size={20} color="inherit" /> : <SyncIcon />}>同步</Button>
                        </Grid>
                    </Grid>
                </Paper>

                <TableContainer component={Paper}>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell>客户姓名</TableCell>
                                <TableCell>服务人员</TableCell>
                                <TableCell>合同类型</TableCell>
                                <TableCell>合同周期</TableCell>
                                {/* --- 核心修正 5：添加排序控件 --- */}
                                <TableCell sortDirection={sortBy === 'remaining_days' ? sortOrder : false}>
                                    <TableSortLabel
                                        active={sortBy === 'remaining_days'}
                                        direction={sortBy === 'remaining_days' ? sortOrder : 'asc'}
                                        onClick={() => handleSort('remaining_days')}
                                    >
                                        剩余有效期
                                    </TableSortLabel>
                                </TableCell>
                                <TableCell>实际上户日期</TableCell>
                                <TableCell>状态</TableCell>
                                <TableCell align="center">操作</TableCell>
                            </TableRow>
                        </TableHead>
                        
                        <TableBody>
                            {loading ? ( <TableRow><TableCell colSpan={8} align="center" sx={{py: 5}}><CircularProgress /></TableCell></TableRow> )
                            : (
                                contracts.map((contract) => {
                                    // --- 新增：定义颜色映射 ---
                                    const typeColors = {
                                        nanny: {
                                            bgColor: alpha(theme.palette.primary.light, 0.2),
                                            textColor: theme.palette.primary.dark,
                                        },
                                        maternity_nurse: {
                                            bgColor: alpha(theme.palette.info.light, 0.2),
                                            textColor: theme.palette.info.dark,
                                        },
                                        nanny_trial: {
                                            bgColor: alpha(theme.palette.primary.light, 0.2),
                                            textColor: theme.palette.primary.dark,
                                        },
                                        default: {
                                            bgColor: theme.palette.grey[200],
                                            textColor: theme.palette.grey[800],
                                        }
                                    };
                                    const colors = typeColors[contract.contract_type_value] || typeColors.default;
                                    // -------------------------

                                    return (
                                        <TableRow hover key={contract.id}>
                                            <TableCell sx={{fontWeight: 'bold'}}>{contract.customer_name}</TableCell>
                                            <TableCell>{contract.employee_name}</TableCell>
                                            <TableCell>
                                                <Chip
                                                    label={contract.contract_type_label}
                                                    size="small"
                                                    sx={{
                                                        backgroundColor: colors.bgColor,
                                                        color: colors.textColor,
                                                        fontWeight: 600
                                                    }}
                                                />
                                            </TableCell>
                                            <TableCell>
                                        <Typography variant="body2" sx={{ fontFamily: 'monospace', lineHeight: 1.5, whiteSpace: 'nowrap' }}>
                                            {formatDate(contract.start_date)}
                                            <br />
                                            {formatDate(contract.end_date)}
                                        </Typography>
                                    </TableCell>
                                    <TableCell>
                                        <Chip
                                            label={contract.remaining_months}
                                            size="small"
                                            color={contract.highlight_remaining ? 'warning' : 'default'}
                                            variant={contract.highlight_remaining ? 'filled' : 'outlined'}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        {contract.actual_onboarding_date ? (
                                            formatDate(contract.actual_onboarding_date)
                                        ) : contract.contract_type_value === 'maternity_nurse' ? (
                                            <Tooltip title="点击设置实际上户日期" arrow>
                                                <Chip
                                                    icon={<EventBusyIcon />} label="未确认上户日期" size="small" variant="outlined"
                                                    onClick={() => handleOpenOnboardingDialog(contract)}
                                                    sx={{ borderColor: 'grey.400', borderStyle: 'dashed', color: 'text.secondary', cursor:'pointer', '&:hover': { backgroundColor: 'action.hover' } }}
                                                />
                                            </Tooltip>
                                        ) : (
                                            'N/A'
                                        )}
                                    </TableCell>
                                    <TableCell><Chip label={contract.status} size="small" color={contract.status === 'active' ? 'success' : 'default'} /></TableCell>
                                    <TableCell align="center">
                                        {/* --- 修改 3: 动态渲染操作按钮 --- */}
                                        <Stack direction="column" spacing={1} alignItems="center">
                                            <Button variant="outlined" size="small" onClick={() => navigate(`/contracts/${contract.id}`)}>查看详情</Button>
                                        </Stack>
                                        {/* ----------------------------------------- */}
                                    </TableCell>
                                </TableRow>
                                    );
                                })
                            )}
                        </TableBody>
                    </Table>
                    <TablePagination component="div" count={totalContracts} page={page} onPageChange={(e, newPage) => setPage(newPage)}rowsPerPage={rowsPerPage} onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }} labelRowsPerPage="每页行数:" />
                </TableContainer>
                <Dialog open={terminationDialogOpen} onClose={handleCloseTerminationDialog}>
                    <DialogTitle>确认合同操作</DialogTitle>
                    <DialogContent>
                        <Alert severity="warning" sx={{ mt: 1, mb: 2 }}>
                            您正在为 <b>{contractToTerminate?.customer_name} ({contractToTerminate?.employee_name})</b> 的合同进行操作。
                            <br/>
                            此操作将把合同的最终状态设置为“已终止”并重算最后一期账单。
                        </Alert>
                        <DatePicker
                            label="终止日期"
                            value={terminationDate}
                            onChange={(date) => setTerminationDate(date)}
                            sx={{ width: '100%', mt: 1 }}
                        />
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={handleCloseTerminationDialog}>取消</Button>
                        <Button onClick={handleConfirmTermination} variant="contained" color="error">确认终止</Button>
                    </DialogActions>
                </Dialog>
                <Dialog open={onboardingDialogOpen} onClose={handleCloseOnboardingDialog}>
                    <DialogTitle>设置实际上户日期</DialogTitle>
                    <DialogContent>
                        <Alert severity="info" sx={{ mt: 1, mb: 2 }}>
                            为月嫂合同 <b>{contractToSetDate?.customer_name} ({contractToSetDate?.employee_name})</b> 设置实际上户日期。
                            <br/>
                            预产期参考: {formatDate(contractToSetDate?.provisional_start_date)}
                        </Alert>
                        <DatePicker
                            label="实际上户日期"
                            value={newOnboardingDate}
                            onChange={(date) => setNewOnboardingDate(date)}
                            sx={{ width: '100%', mt: 1 }}
                        />
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={handleCloseOnboardingDialog}>取消</Button>
                        <Button onClick={handleSaveOnboardingDate} variant="contained">保存</Button>
                    </DialogActions>
                </Dialog>
            </Box>
        </LocalizationProvider>
    );
};

export default ContractList;