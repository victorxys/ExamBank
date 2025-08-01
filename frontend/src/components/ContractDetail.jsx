
// frontend/src/components/ContractDetail.jsx

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Paper, Grid, CircularProgress, Button,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip,
  List, ListItem, ListItemText, Divider, Dialog, DialogTitle, DialogContent,
  DialogActions, Alert, Stack
} from '@mui/material';
import {
    ArrowBack as ArrowBackIcon, Edit as EditIcon, CheckCircle as CheckCircleIcon,
    Cancel as CancelIcon
} from '@mui/icons-material';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';

import api from '../api/axios';
import PageHeader from './PageHeader';
import AlertMessage from './AlertMessage';

const formatDate = (isoString) => {
  if (!isoString) return '—';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '无效日期';
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch (e) { return '无效日期'; }
};

const DetailItem = ({ label, value }) => (
    <Grid item xs={12} sm={6} md={4}>
        <Typography variant="body2" color="text.secondary" gutterBottom>{label}</Typography>
        <Typography variant="body1" component="div" sx={{ fontWeight: 500 }}>{value || '—'}</Typography>
    </Grid>
);

const ContractDetail = () => {
    const { contractId } = useParams();
    const navigate = useNavigate();
    const [contract, setContract] = useState(null);
    const [bills, setBills] = useState([]);
    const [loading, setLoading] = useState(true);
    const [alert, setAlert] = useState({ open: false, message: '', severity: 'info' });

    // --- 修改 1: 迁移状态和逻辑 ---
    const [terminationDialogOpen, setTerminationDialogOpen] = useState(false);
    const [terminationDate, setTerminationDate] = useState(null);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [contractRes, billsRes] = await Promise.all([
                api.get(`/billing/contracts/${contractId}/details`),
                api.get(`/billing/contracts/${contractId}/bills`)
            ]);
            setContract(contractRes.data);
            setBills(billsRes.data);
        } catch (error) {
            setAlert({ open: true, message: `获取数据失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (contractId) {
            fetchData();
        }
    }, [contractId]);

    const handleOpenTerminationDialog = () => {
        if (!contract) return;
        setTerminationDate(new Date());
        setTerminationDialogOpen(true);
    };

    const handleCloseTerminationDialog = () => {
        setTerminationDialogOpen(false);
        setTerminationDate(null);
    };

    const handleConfirmTermination = async () => {
        if (!contract || !terminationDate) return;
        try {
            await api.post(`/billing/contracts/${contract.id}/terminate`, {
                termination_date: terminationDate.toISOString().split('T')[0],
            });
            setAlert({ open: true, message: '合同已终止，正在为您重算最后一期账单...', severity: 'success' });
            handleCloseTerminationDialog();
            fetchData(); // 重新获取数据以更新页面
        } catch (error) {
            setAlert({ open: true, message: `操作失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        }
    };

    const handleTrialSucceeded = async () => {
        if (!contract) return;
        try {
            await api.post(`/billing/contracts/${contract.id}/succeed`);
            setAlert({ open: true, message: '试工成功！该合同已完成。', severity: 'success' });
            fetchData(); // 重新获取数据以更新页面
        } catch (error) {
            setAlert({ open: true, message: `操作失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        }
    };
    // ---------------------------------

    const handleNavigateToBill = (bill) => {
        navigate(`/billing?month=${bill.billing_period}&open_bill_id=${bill.id}`);
    };

    if (loading) return <CircularProgress />;
    if (!contract) return <Typography>未找到合同信息。</Typography>;

    const baseFields = {
        '客户姓名': contract.customer_name,
        '联系人': contract.contact_person,
        '服务人员': contract.employee_name,
        '状态': <Chip label={contract.status} color={contract.status === 'active' ? 'success' : 'default'} size="small" />,
        '合同周期': `${formatDate(contract.start_date)} ~ ${formatDate(contract.end_date)}`,
        '合同剩余月数': <Chip label={contract.remaining_months} size="small" color={contract.highlight_remaining ? 'warning' : 'default'} variant={contract.highlight_remaining ? 'filled' : 'outlined'} />, 
        '创建时间': new Date(contract.created_at).toLocaleDateString('zh-CN'),
        '备注': contract.notes,                   
    };                                            
                                                  
    const specificFields = contract.contract_type === 'maternity_nurse' ? {
        '合同类型': '月嫂合同',                   
        '级别/月薪': `¥${contract.employee_level}`,
        '预产期': formatDate(contract.provisional_start_date),
        '实际上户日期': formatDate(contract.actual_onboarding_date),
        '定金': `¥${contract.deposit_amount}`,    
        '管理费率': `${(contract.management_fee_rate * 100).toFixed(0)}%`,
        '保证金支付': `¥${contract.security_deposit_paid}`,
        '优惠金额': `¥${contract.discount_amount}`,
    } : contract.contract_type === 'nanny_trial' ? {
        '合同类型': '育儿嫂试工',
        '级别/月薪': `¥${contract.employee_level}`,
        '介绍费': `¥${contract.introduction_fee}`,
    } : {
        '合同类型': '育儿嫂合同',
        '级别/月薪': `¥${contract.employee_level}`,
        '是否自动月签': contract.is_monthly_auto_renew ? '是' : '否',
    };

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Box>
                <AlertMessage open={alert.open} message={alert.message} severity={alert.severity} onClose={() => setAlert(prev => ({...prev, open:false}))} />
                <PageHeader
                    title="合同详情"
                    description={`${contract.customer_name} - ${contract.employee_name}`}
                    actions={
                        // --- 修改 2: 在 PageHeader 中添加操作按钮 ---
                        <Stack direction="row" spacing={2}>
                            <Button variant="contained" color="primary" startIcon={<ArrowBackIcon />} onClick={() => navigate('/contracts')}>
                                返回列表
                            </Button>
                            {contract.status === 'active' && contract.contract_type !== 'nanny_trial' && (
                                <Button variant="contained" color="error" onClick={handleOpenTerminationDialog}>
                                    终止合同
                                </Button>
                            )}
                            {contract.status === 'trial_active' && contract.contract_type === 'nanny_trial' && (
                                <>
                                    <Button variant="contained" color="success" startIcon={<CheckCircleIcon />} onClick={handleTrialSucceeded}>
                                        试工成功
                                    </Button>
                                    <Button variant="contained" color="error" startIcon={<CancelIcon />} onClick={handleOpenTerminationDialog}>
                                        试工失败
                                    </Button>
                                </>
                            )}
                        </Stack>
                        // -----------------------------------------
                    }
                />

                <Grid container spacing={3}>
                    <Grid item xs={12}>
                        <Paper sx={{ p: 3 }}>
                            <Typography variant="h6" gutterBottom>合同信息</Typography>
                            <Divider sx={{ my: 2 }} />
                            <Grid container spacing={3}>
                                {Object.entries(baseFields).map(([label, value]) => <DetailItem key={label} label={label} value={value} />)}
                                {Object.entries(specificFields).map(([label, value]) => <DetailItem key={label} label={label} value={value} />)}
                            </Grid>
                        </Paper>
                    </Grid>

                    <Grid item xs={12}>
                        <Paper sx={{ p: 3 }}>
                            <Typography variant="h6" gutterBottom>关联账单列表</Typography>
                            <TableContainer>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>账单周期 (所属月份)</TableCell>
                                            <TableCell>服务周期</TableCell>
                                            <TableCell>劳务天数</TableCell>
                                            <TableCell>加班天数</TableCell>
                                            <TableCell>应付金额</TableCell>
                                            <TableCell>支付状态</TableCell>
                                            <TableCell align="right">操作</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {bills.length > 0 ? bills.map((bill) => (
                                            <TableRow key={bill.id} hover>
                                                <TableCell>{bill.billing_period}</TableCell>
                                                <TableCell>{formatDate(bill.cycle_start_date)} ~ {formatDate(bill.cycle_end_date)}</TableCell>
                                                 <TableCell>
                                                    {bill.base_work_days} 天
                                                    {bill.is_substitute_bill && (
                                                        <Chip label="替" size="small" color="info" sx={{ ml: 1 }} />
                                                    )}
                                                </TableCell>
                                                <TableCell>{bill.overtime_days} 天</TableCell>
                                                <TableCell sx={{fontWeight: 'bold'}}>¥{bill.total_payable}</TableCell>
                                                <TableCell><Chip label={bill.status} color={bill.status === '已支付' ? 'success' : 'warning'} size="small" /></TableCell>
                                                <TableCell align="right">
                                                <Button variant="contained" size="small" onClick={() => handleNavigateToBill(bill)}>
                                                    去管理
                                                </Button>
                                                </TableCell>
                                            </TableRow>
                                        )) : (
                                            <TableRow>
                                                <TableCell colSpan={5} align="center">暂无关联账单</TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </Paper>
                    </Grid>
                </Grid>

                {/* --- 修改 3: 添加确认弹窗 --- */}
                <Dialog open={terminationDialogOpen} onClose={handleCloseTerminationDialog}>
                    <DialogTitle>确认合同操作</DialogTitle>
                    <DialogContent>
                        <Alert severity="warning" sx={{ mt: 1, mb: 2 }}>
                            您正在为 <b>{contract?.customer_name} ({contract?.employee_name})</b> 的合同进行操作。
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
                {/* --------------------------------- */}
            </Box>
        </LocalizationProvider>
    );
};

export default ContractDetail;