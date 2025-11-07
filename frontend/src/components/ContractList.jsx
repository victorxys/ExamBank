// frontend/src/components/ContractList.jsx (支持排序和默认过滤)

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams, useLocation, useSearchParams } from 'react-router-dom';
import {
  Box, Button, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TablePagination, CircularProgress, Tooltip, Dialog, DialogTitle,
  DialogContent, DialogActions, Alert, TextField, Select, MenuItem, FormControl,
  InputLabel, Chip, Grid, TableSortLabel, Stack, IconButton
} from '@mui/material';
import {
    Sync as SyncIcon, Edit as EditIcon, Add as AddIcon, EventBusy as EventBusyIcon, CheckCircle as CheckCircleIcon, Cancel as CancelIcon, Link as LinkIcon
} from '@mui/icons-material';
import { useTheme, alpha } from '@mui/material/styles';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';

import api from '../api/axios';
import PageHeader from './PageHeader';
import AlertMessage from './AlertMessage';
import CreateVirtualContractModal from './CreateVirtualContractModal'; // 路径可能需要微调
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import CreateFormalContractModal from './CreateFormalContractModal';

const formatDate = (isoString) => {
  if (!isoString) return 'N/A';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '无效日期';
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
  } catch (e) { return '无效日期'; }
};

const STATUS_LABELS = {
    active: '服务中',
    pending: '待上户',
    finished: '已完成',
    terminated: '已终止',
    trial_active: '试工中',
    trial_succeeded: '试工成功',
    unsigned: '待签署'
};

const SIGNING_STATUS_LABELS = {
    UNSIGNED: '待签署',
    CUSTOMER_SIGNED: '客户已签',
    EMPLOYEE_SIGNED: '员工已签',
    SIGNED: '已签署',
};

const SIGNING_STATUS_COLORS = {
    UNSIGNED: 'warning',
    CUSTOMER_SIGNED: 'info',
    EMPLOYEE_SIGNED: 'info',
    SIGNED: 'success',
};

const ContractList = () => {
    const theme = useTheme();
    const navigate = useNavigate();
    const location = useLocation();
    const { contractType: typeFromUrl } = useParams();
    const [searchParams, setSearchParams] = useSearchParams();

    const searchTermFromUrl = searchParams.get('search') || '';
    const [inputValue, setInputValue] = useState(searchTermFromUrl);

    const [contracts, setContracts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [alert, setAlert] = useState({ open: false, message: '', severity: 'info' });
    const [totalContracts, setTotalContracts] = useState(0);
    const [syncing, setSyncing] = useState(false);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isCreateFormalModalOpen, setIsCreateFormalModalOpen] = useState(false);
    const [signingLink, setSigningLink] = useState('');
    const [isSigningLinkDialogOpen, setIsSigningLinkDialogOpen] = useState(false);

    const page = parseInt(searchParams.get('page') || '0', 10);
    const rowsPerPage = parseInt(searchParams.get('rowsPerPage') || '10', 10);
    const statusFilter = searchParams.get('status') || 'all';
    const depositStatusFilter = searchParams.get('deposit_status') || '';
    const sortBy = searchParams.get('sort_by') || 'created_at';
    const sortOrder = searchParams.get('sort_order') || 'desc';
    const typeFilter = searchParams.get('type') || (typeFromUrl === 'all' ? '' : typeFromUrl);
    const [terminationDialogOpen, setTerminationDialogOpen] = useState(false);
    const [contractToTerminate, setContractToTerminate] = useState(null);
    const [terminationDate, setTerminationDate] = useState(null);
    const [onboardingDialogOpen, setOnboardingDialogOpen] = useState(false);
    const [contractToSetDate, setContractToSetDate] = useState(null);
    const [newOnboardingDate, setNewOnboardingDate] = useState(null);

    useEffect(() => {
        if (searchTermFromUrl !== inputValue) {
            setInputValue(searchTermFromUrl);
        }
    }, [searchTermFromUrl]);

    useEffect(() => {
        if (inputValue === searchTermFromUrl) {
            return;
        }
        const debounceTimer = setTimeout(() => {
            const newParams = new URLSearchParams(searchParams);
            newParams.set('search', inputValue);
            newParams.set('page', '0');
            setSearchParams(newParams);
        }, 500);
        return () => clearTimeout(debounceTimer);
    }, [inputValue, searchTermFromUrl, searchParams, setSearchParams]);

    const handleInputChange = (e) => {
        setInputValue(e.target.value);
    };

    // 在 ContractList.jsx 中

    const fetchContracts = useCallback(async () => {
        setLoading(true);
        try {
            const params = {
                page: page + 1,
                per_page: rowsPerPage,
                search: searchTermFromUrl,
                type: typeFilter,
                status: statusFilter,
                deposit_status: depositStatusFilter,
                signing_status: searchParams.get('signing_status') || '', // <-- 添加这一行
                sort_by: sortBy,
                sort_order: sortOrder,
            };
            const response = await api.get('/contracts', { params });
            setContracts(response.data.contracts || []);
            setTotalContracts(response.data.total || 0);
        } catch (error) {
            // ...
        } finally { setLoading(false); }
        // 确保将 searchParams 添加到依赖项数组中，以便在筛选更改时重新创建此函数
    }, [page, rowsPerPage, searchParams]); // <-- 简化依赖项数组

    useEffect(() => {
        fetchContracts();
    }, [fetchContracts]);

    const handleFilterChange = (e) => {
        const { name, value } = e.target;
        const newParams = new URLSearchParams(searchParams);
        newParams.set(name, value);
        newParams.set('page', '0');
        setSearchParams(newParams);
    };

    const handleSort = (column) => {
        const isAsc = sortBy === column && sortOrder === 'asc';
        const newParams = new URLSearchParams(searchParams);
        newParams.set('sort_by', column);
        newParams.set('sort_order', isAsc ? 'desc' : 'asc');
        setSearchParams(newParams);
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
                setTimeout(() => fetchContracts(), 5000);
            }, 3000);
        } catch (error) {
            setAlert({ open: true, message: `触发同步失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        } finally { setSyncing(false); }
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

    const handleShowSigningLink = (token) => {
        const link = `${window.location.origin}/sign/${token}`;
        setSigningLink(link);
        setIsSigningLinkDialogOpen(true);
    };

    const getSigningStatusChip = (status) => {
        const label = SIGNING_STATUS_LABELS[status] || status || 'N/A';
        const color = SIGNING_STATUS_COLORS[status] || 'default';

        // “已签署”状态使用实心样式，其他状态使用描边样式
        const variant = status === 'signed' ? 'filled' : 'outlined';

        return <Chip label={label} color={color} size="small" variant={variant} />;
    };

    const correctedPage = Math.max(0, Math.min(page, Math.ceil(totalContracts / rowsPerPage) - 1));
    const headerActions = (
        <Box>
            <Button
                variant="contained"
                color="primary"
                startIcon={<AddIcon />}
                onClick={() => setIsCreateFormalModalOpen(true)}
                sx={{ mr: 2 }}
            >
                创建正式合同
            </Button>
            <Button
                variant="contained"
                startIcon={<AddCircleOutlineIcon />}
                onClick={() => setIsCreateModalOpen(true)}
            >
                新增虚拟合同
            </Button>
        </Box>
    );
    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Box>
                <AlertMessage open={alert.open} message={alert.message} severity={alert.severity} onClose={() => setAlert(prev => ({...prev, open:false}))} />
                <PageHeader title="合同管理" description="查看、筛选和管理所有服务合同。" actions={headerActions} />
                <Paper sx={{ p: 2, mb: 3 }}>
                    <Grid container spacing={2} alignItems="center">
                        <Grid item xs={12} sm={3}><TextField fullWidth label="搜索客户/员工" name="search" value={inputValue} onChange={handleInputChange} size="small" /></Grid>
                        <Grid item xs={6} sm={2}><FormControl fullWidth size="small"><InputLabel>类型</InputLabel><Select name="type" value={typeFilter}label="类型" onChange={handleFilterChange}><MenuItem value=""><em>全部</em></MenuItem><MenuItem value="nanny">育儿嫂</MenuItem><MenuItem value="maternity_nurse">月嫂</MenuItem> <MenuItem value="nanny_trial">育儿嫂试工</MenuItem><MenuItem value="formal">正式合同</MenuItem></Select></FormControl></Grid>
                        <Grid item xs={6} sm={2}><FormControl fullWidth size="small"><InputLabel>状态</InputLabel><Select name="status" value={statusFilter} label="状态" onChange={handleFilterChange}><MenuItem value="all"><em>全部状态</em></MenuItem><MenuItem value="unsigned">待签署</MenuItem><MenuItem value="active">服务中</MenuItem><MenuItem value="pending">待上户</MenuItem><MenuItem value="finished">已完成</MenuItem><MenuItem value="terminated">已终止</MenuItem><MenuItem value="trial_active">试工中</MenuItem><MenuItem value="trial_succeeded">试工成功</MenuItem></Select></FormControl></Grid>
                        <Grid item xs={6} sm={2}>
                            <FormControl fullWidth size="small">
                                <InputLabel>签署状态</InputLabel>
                                <Select
                                    name="signing_status"
                                    value={searchParams.get('signing_status') || ''}
                                    label="签署状态"
                                    onChange={handleFilterChange}
                                >
                                    <MenuItem value=""><em>全部</em></MenuItem>
                                    {Object.entries(SIGNING_STATUS_LABELS).map(([key, label]) => (
                                        <MenuItem key={key} value={key}>{label}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Grid>
                        {typeFilter === 'maternity_nurse' && (
                            <Grid item xs={6} sm={2}>
                                <FormControl fullWidth size="small">
                                    <InputLabel>定金状态</InputLabel>
                                    <Select name="deposit_status" value={depositStatusFilter} label="定金状态" onChange={handleFilterChange}>
                                        <MenuItem value=""><em>全部</em></MenuItem>
                                        <MenuItem value="paid">已支付</MenuItem>
                                        <MenuItem value="unpaid">未支付</MenuItem>
                                    </Select>
                                </FormControl>
                            </Grid>
                        )}

                        <Grid item xs={12} sm sx={{ display: 'flex',justifyContent: 'flex-end', gap: 1 }}>
                            {/* <Button variant="contained" color="primary" startIcon={<AddIcon />} onClick={() => setIsCreateFormalModalOpen(true)}>创建正式合同</Button>
                            <Button variant="contained" startIcon={<AddCircleOutlineIcon />} onClick={() => setIsCreateModalOpen(true)}>新增虚拟合同</Button>
                            <Button variant="contained"onClick={handleTriggerSync} disabled={syncing} startIcon={syncing ? <CircularProgress size={20} color="inherit" /> : <SyncIcon />}>同步</Button> */}
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
                                <TableCell>主状态</TableCell>
                                <TableCell>签署状态</TableCell>
                                <TableCell>客户签名</TableCell>
                                <TableCell>员工签名</TableCell>
                                <TableCell align="center">操作</TableCell>
                            </TableRow>
                        </TableHead>
                        
                        <TableBody>
                            {loading ? ( <TableRow><TableCell colSpan={7} align="center" sx={{py: 5}}><CircularProgress /></TableCell></TableRow> )
                            : (
                                contracts.map((contract) => (
                                    <TableRow hover key={contract.id}>
                                        <TableCell sx={{fontWeight: 'bold'}}>{contract.customer_name}</TableCell>
                                        <TableCell>{contract.service_personnel_name}</TableCell>
                                        <TableCell>
                                            <Chip label={contract.contract_type_label} size="small" />
                                        </TableCell>
                                        <TableCell>
                                            <Typography variant="body2" sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                                                {formatDate(contract.start_date)} - {formatDate(contract.end_date)}
                                            </Typography>
                                        </TableCell>
                                        <TableCell><Chip label={STATUS_LABELS[contract.status] || 'N/A'} size="small" color={contract.status === 'active' ? 'success' : 'default'} /></TableCell>
                                                                                <TableCell>{getSigningStatusChip(contract.signing_status )}</TableCell>
                                        <TableCell>
                                            {contract.customer_signature ? (
                                                <img src={contract.customer_signature} alt= "客户签名" style={{ display: 'block', maxWidth: '100px', maxHeight: '40px' }} />
                                            ) : (
                                                <Typography variant="caption" color= "text.secondary">未签</Typography>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            {contract.employee_signature ? (
                                                <img src={contract.employee_signature} alt= "员工签名" style={{ display: 'block', maxWidth: '100px', maxHeight: '40px' }} />
                                            ) : (
                                                <Typography variant="caption" color= "text.secondary">未签</Typography>
                                            )}
                                        </TableCell>
                                        <TableCell align="center">
                                            <Button variant="outlined" size="small" onClick={() => navigate(`/contract/detail/${contract.id}`, { state: { from: location.pathname + location. search } })}>
                                                查看详情
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                    <TablePagination
                        component="div"
                        count={totalContracts}
                        page={correctedPage}
                        onPageChange={(e, newPage) => {
                            const newParams = new URLSearchParams(searchParams);
                            newParams.set('page', newPage.toString());
                            setSearchParams(newParams);
                        }}
                        rowsPerPage={rowsPerPage}
                        onRowsPerPageChange={(e) => {
                            const newParams = new URLSearchParams(searchParams);
                            newParams.set('rowsPerPage', parseInt(e.target.value, 10));
                            newParams.set('page', '0');
                            setSearchParams(newParams);
                        }}
                        labelRowsPerPage="每页行数:"
                    />
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
                <Dialog open={isSigningLinkDialogOpen} onClose={() => setIsSigningLinkDialogOpen(false)} fullWidth maxWidth="sm">
                    <DialogTitle>合同签名链接</DialogTitle>
                    <DialogContent>
                        <Typography>任何人都可以通过此链接访问并签署合同，请妥善保管。</Typography>
                        <TextField
                            fullWidth
                            variant="outlined"
                            value={signingLink}
                            onFocus={(event) => event.target.select()}
                            InputProps={{ readOnly: true }}
                            sx={{ mt: 2 }}
                        />
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => navigator.clipboard.writeText(signingLink)}>复制链接</Button>
                        <Button onClick={() => setIsSigningLinkDialogOpen(false)}>关闭</Button>
                    </DialogActions>
                </Dialog>
            </Box>
            <CreateVirtualContractModal
                open={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                onSuccess={() => {
                    setIsCreateModalOpen(false);
                    // 在这里调用您页面中已有的、用于刷新合同列表的函数
                    // 例如: fetchContracts(); 
                    alert("操作成功，正在刷新列表...");
                }}
            />
            <CreateFormalContractModal
                open={isCreateFormalModalOpen}
                onClose={() => setIsCreateFormalModalOpen(false)}
                onSuccess={(newContractId) => { // 1. 让 onSuccess 函数接收一个参数 newContractId
                    setIsCreateFormalModalOpen(false);
                    setAlert({ open: true, message: '正式合同创建成功! 正在跳转...', severity: 'success' });
                    // 2. 使用 navigate 函数进行页面跳转
                    navigate(`/contract/detail/${newContractId}`);
                }}
            />
        </LocalizationProvider>
    );
};

export default ContractList;