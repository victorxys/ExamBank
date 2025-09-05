
// frontend/src/components/ContractDetail.jsx

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  Box, Typography, Paper, Grid, CircularProgress, Button,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip,Tooltip,
  List, ListItem, ListItemText, Divider, Dialog, DialogTitle, DialogContent,MenuItem,
  DialogActions, Alert, Stack, IconButton, TextField, InputAdornment, Switch
} from '@mui/material';
import {
    ArrowBack as ArrowBackIcon, Edit as EditIcon, CheckCircle as CheckCircleIcon,Info as InfoIcon,
    Cancel as CancelIcon, Save as SaveIcon, Link as LinkIcon, EventBusy as EventBusyIcon
} from '@mui/icons-material';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';

import api from '../api/axios';
import PageHeader from './PageHeader';
import AlertMessage from './AlertMessage';
import FinancialManagementModal from './FinancialManagementModal';

const formatDate = (isoString) => {
  if (!isoString) return '—';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '无效日期';
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch (e) { return '无效日期'; }
};

const formatCurrency = (amount) => {
  const num = parseFloat(amount);
  if (isNaN(num)) {
    return '0';
  }
  // 四舍五入到最近的整数，然后添加千位分隔符
  return Math.round(num).toLocaleString('en-US');
};

const DetailItem = ({ label, value }) => (
    <Grid item xs={12} sm={6} md={4}>
        <Typography variant="body2" color="text.secondary" gutterBottom>{label}</Typography>
        <Typography variant="body1" component="div" sx={{ fontWeight: 500 }}>{value || '—'}</Typography>
    </Grid>
);

const EditableDetailItem = ({ label, value, isEditing, onEdit, onSave, onCancel, onChange }) => (
    <Grid item xs={12} sm={6} md={4}>
        <Typography variant="body2" color="text.secondary" gutterBottom>{label}</Typography>
        {isEditing ? (
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <TextField
                    size="small"
                    value={value}
                    onChange={onChange}
                    InputProps={{
                        startAdornment: <InputAdornment position="start">¥</InputAdornment>,
                    }}
                    sx={{ mr: 1 }}
                />
                <IconButton size="small" onClick={onSave} color="primary"><SaveIcon /></IconButton>
                <IconButton size="small" onClick={onCancel}><CancelIcon /></IconButton>
            </Box>
        ) : (
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Typography variant="body1" component="div" sx={{ fontWeight: 500 }}>{`¥${formatCurrency(value)}`}</Typography>
                <IconButton size="small" onClick={onEdit} sx={{ ml: 1 }}><EditIcon fontSize="small" /></IconButton>
            </Box>
        )}
    </Grid>
);

const EditableNotesItem = ({ label, originalValue, operationalValue, isEditing, onEdit, onSave, onCancel, onChange }) => (
    <Grid item xs={12}>
        <Typography variant="body2" color="text.secondary" gutterBottom>
            {label}
            {!isEditing && (
                <IconButton size="small" onClick={onEdit} sx={{ ml: 1 }}>
                    <EditIcon fontSize="small" />
                </IconButton>
            )}
        </Typography>
        <Paper variant="outlined" sx={{ p: 2, whiteSpace: 'pre-wrap', backgroundColor: '#f9f9f9' }}>
            <Typography variant="body1">{originalValue || '（无原始备注）'}</Typography>
        </Paper>
        {isEditing ? (
            <Box sx={{ mt: 1 }}>
                <TextField
                    fullWidth
                    multiline
                    rows={4}
                    variant="outlined"
                    label="运营备注"
                    value={operationalValue}
                    onChange={onChange}
                />
                <Box sx={{ mt: 1, textAlign: 'right' }}>
                    <Button onClick={onSave} variant="contained" color="primary" startIcon={<SaveIcon />}>保存</Button>
                    <Button onClick={onCancel} sx={{ ml: 1 }}>取消</Button>
                </Box>
            </Box>
        ) : (
            operationalValue && (
                <Paper variant="outlined" sx={{ p: 2, mt: 1, whiteSpace: 'pre-wrap' }}>
                        <Typography variant="body2" color="text.secondary" gutterBottom>运营备注</Typography>
                    <Typography variant="body1">{operationalValue}</Typography>
                </Paper>
            )
        )}
    </Grid>
);

const ContractDetail = () => {
    const { contractId } = useParams();
    const navigate = useNavigate();
    const { state } = useLocation();
    const [contract, setContract] = useState(null);
    const [bills, setBills] = useState([]);
    const [adjustments, setAdjustments] = useState([]);
    const [logs, setLogs] = useState([]);
    const depositAdjustment = adjustments.find(adj => adj && adj.adjustment_type=== 'deposit');
    const [loading, setLoading] = useState(true);
    const [alert, setAlert] = useState({ open: false, message: '', severity: 'info' });
    

    // --- 修改 1: 迁移状态和逻辑 ---
    const [terminationDialogOpen, setTerminationDialogOpen] = useState(false);
    const [terminationDate, setTerminationDate] = useState(null);

    const [isEditingIntroFee, setIsEditingIntroFee] = useState(false);
    const [introFee, setIntroFee] = useState('');

    const [originalNotes, setOriginalNotes] = useState('');
    const [operationalNotes, setOperationalNotes] = useState('');
    const [isEditingNotes, setIsEditingNotes] = useState(false);

    const [modalOpen, setModalOpen] = useState(false);
    const [selectedBillDetails, setSelectedBillDetails] = useState(null);
    const [loadingModal, setLoadingModal] = useState(false);
    const [selectedBillContext, setSelectedBillContext] = useState(null);
    const [onboardingDialogOpen, setOnboardingDialogOpen] = useState(false);
    const [contractToSetDate, setContractToSetDate] = useState(null);
    const [newOnboardingDate, setNewOnboardingDate] = useState(null);
    const [infoDialogOpen, setInfoDialogOpen] = useState(false);
    const [infoDialogData, setInfoDialogData] = useState({ message: '', billId: null});

    const [conversionDialogOpen, setConversionDialogOpen] = useState(false);
    const [eligibleContracts, setEligibleContracts] = useState([]);
    const [loadingEligible, setLoadingEligible] = useState(false);
    const [selectedFormalContractId, setSelectedFormalContractId] = useState('');

    const [depositDialogOpen, setDepositDialogOpen] = useState(false);
    const [selectedAdjustment, setSelectedAdjustment] = useState(null);
    const [depositPaidDate, setDepositPaidDate] = useState(new Date());
    const [depositPaidAmount, setDepositPaidAmount] = useState('');
    const [depositSettlementNotes, setDepositSettlementNotes] = useState('定金收款'); 

    


    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [contractRes, billsRes, adjustmentsRes, logsRes] = await Promise.all([
                api.get(`/billing/contracts/${contractId}/details`),
                api.get(`/billing/contracts/${contractId}/bills`),
                api.get(`/billing/contracts/${contractId}/adjustments`),
                api.get(`/billing/contracts/${contractId}/logs`)
            ]);
            setContract(contractRes.data);
            setBills(billsRes.data);
            setAdjustments(adjustmentsRes.data);
            setIntroFee(contractRes.data.introduction_fee || '0');
            setLogs(logsRes.data);
            
            const separator = '\\n\\n--- 运营备注 ---\\n';
            const notes = contractRes.data.notes || '';
            if (notes.includes(separator)) {
                const parts = notes.split(separator);
                setOriginalNotes(parts[0]);
                setOperationalNotes(parts[1]);
            } else {
                setOriginalNotes(notes);
                setOperationalNotes('');
            }
        } catch (error) {
            setAlert({ open: true, message: `获取数据失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        } finally {
            setLoading(false);
        }
    }, [contractId]);

     useEffect(() => {
        if (contractId) {
            fetchData();
        }
    }, [contractId, fetchData]);

    if (loading) return <CircularProgress />;
    if (!contract) return <Typography>未找到合同信息。</Typography>;

    const TRIAL_OUTCOME_INFO = {
        pending: { label: '待处理', color: 'warning' },
        success: { label: '试工成功', color: 'success' },
        failure: { label: '试工失败', color: 'error' },
    };
    const STATUS_INFO = {
        active: { label: '生效中', color: 'success' },
        trial_active: { label: '试工中', color: 'info' },
        terminated: { label: '已终止', color: 'default' },
        finished: { label: '已完成', color: 'success' },
        // 你可以根据需要，在这里添加其他所有可能的状态
    };
    const ADJUSTMENT_TYPE_LABELS = {
        deposit: '定金',
        introduction_fee: '介绍费',
        customer_increase: '客户增款',
        customer_decrease: '客户减款',
        // ...可以根据需要添加更多
        };

    const ADJUSTMENT_STATUS_LABELS = {
        PENDING: '待处理',
        PAID: '已支付',
        BILLED: '已入账',
        };

    const trialOutcomeField = contract.contract_type_value === 'nanny_trial' ? (
        <Grid item xs={12} sm={6} md={4}>
            <Typography variant="body2" color="text.secondary"gutterBottom>试工结果</Typography>
            <Chip
                label={TRIAL_OUTCOME_INFO[contract.trial_outcome]?.label ||contract.trial_outcome}
                color={TRIAL_OUTCOME_INFO[contract.trial_outcome]?.color ||'default'}
                size="small"
            />
        </Grid>
    ) : null;

    const convertedToField = contract.converted_to_formal_contract_id ? (
        <Grid item xs={12} sm={6} md={4}>
            <Typography variant="body2" color="text.secondary"gutterBottom>后续合同</Typography>
            <Chip
                icon={<LinkIcon />}
                label={`已转为正式合同`}
                variant="outlined"
                onClick={() => navigate(`/contract/detail/${contract.converted_to_formal_contract_id}`)}
                sx={{ cursor: 'pointer', '&:hover': { backgroundColor:'action.hover' } }}
            />
        </Grid>
    ) : null;

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
            setAlert({ open: true, message: '请选择一个有效的日期', severity:'warning' });
            return;
        }
        try {
            // 第一步：更新实际上户日期
            await api.put(`/billing/contracts/${contractToSetDate.id}`, {
                actual_onboarding_date: newOnboardingDate.toISOString().split('T')[0]
            });
            setAlert({ open: true, message:'上户日期已更新，正在为您预生成所有账单...', severity: 'info' });

            // 第二步：触发后台任务，生成所有账单
            await api.post(`/billing/contracts/${contractToSetDate.id}/generate-all-bills`);

            setAlert({ open: true, message: '所有账单已成功预生成！', severity:'success' });
            handleCloseOnboardingDialog();
            fetchData(); // 重新加载详情页数据

        } catch (error) {
            setAlert({ open: true, message: `操作失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        }
    };



    const handleOpenDepositDialog = (adjustment) => {
        // 如果定金状态是 BILLED (已入账)
        if (adjustment.status === 'BILLED') {
            // 设置提示信息，并打开提示弹窗
            setInfoDialogData({
                message: '当前定金已经附加到账单，请在账单中进行结算操作。',
                billId: adjustment.customer_bill_id
            });
            setInfoDialogOpen(true);
        }
        // 如果状态是 PENDING (待处理)，则走原来的收款流程
        else if (adjustment.status === 'PENDING') {
            setSelectedAdjustment(adjustment);
            setDepositPaidAmount(adjustment.amount || '0');
            setDepositPaidDate(new Date());
            setDepositDialogOpen(true);
        }
        // 其他状态，可以给一个通用提示
        else {
            setAlert({ open: true, message: `该调整项状态为 ${adjustment.status}，无法进行收款操作。`, severity: 'info' });
        }
    };

    const handleCloseDepositDialog = () => {
        setDepositDialogOpen(false);
        setSelectedAdjustment(null);
    };

    const handleConfirmDepositPayment = async () => {
        if (!selectedAdjustment) return;
        try {
            await api.post(`/billing/financial-adjustments/${selectedAdjustment.id}/record-payment`, {
                paid_amount: depositPaidAmount,
                paid_at: depositPaidDate.toISOString(),
                settlement_notes: depositSettlementNotes,
            });
            setAlert({ open: true, message: '定金支付记录成功！', severity: 'success'});
            handleCloseDepositDialog();
            fetchData(); // 重新获取所有数据
        } catch (error) {
            setAlert({ open: true, message: `操作失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        }
    };

    const handleOpenTerminationDialog = () => {
        if (!contract) return;
        // 使用合同的开始日期作为默认终止日期，如果开始日期不存在，则回退到今天
        const defaultDate = contract.start_date ? new Date(contract.start_date) :new Date();
        setTerminationDate(defaultDate);
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
        if (!contract) {
            setAlert({ open: true, message: '合同数据尚未加载完成，请稍后再试。',severity: 'warning' });
            return;
        }
        const employeeId = contract.user_id || contract.service_personnel_id;

        setLoadingEligible(true);
        setConversionDialogOpen(true);
        setSelectedFormalContractId(''); // 重置选项

        try {
            // 我们需要获取该客户名下所有“active”状态的正式育儿嫂合同，作为转换目标
            const response = await api.get('/billing/contracts', {
                params: {
                    customer_name: contract.customer_name,
                    employee_id: employeeId,
                    type: 'nanny', // 只查找正式育儿嫂合同
                    status: 'active',
                    per_page: 100 // 获取足够多的数量
                }
            });
            // 过滤掉当前试工合同自身（虽然类型不同，但以防万一）
            const eligible = response.data.items.filter(c => c.id !== contractId);
            setEligibleContracts(eligible);
        } catch (error) {
            setAlert({ open: true, message: `获取可关联的正式合同列表失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
            setConversionDialogOpen(false); // 如果获取列表失败，就直接关闭弹窗
        } finally {
            setLoadingEligible(false);
        }
    };

    const handleConfirmConversion = async () => {
        if (!selectedFormalContractId) {
            setAlert({ open: true, message: '请选择一个要关联的正式合同。',severity: 'warning' });
            return;
        }

        // ... in handleConfirmConversion
        try {
            await api.post(`/billing/nanny-trial-contracts/${contractId}/convert`,{
                formal_contract_id: selectedFormalContractId
            });

            // 优化提示信息，告诉用户即将发生跳转
            setAlert({ open: true, message:'试工合同转换成功！正在跳转到正式合同页面...', severity: 'success' });
            setConversionDialogOpen(false);

            // --- ↓↓↓ 用 navigate 跳转替换掉 fetchData ↓↓↓ ---
            navigate(`/contract/detail/${selectedFormalContractId}`);
            // --- ↑↑↑ 修改结束 ↑↑↑ ---
        } catch (error) {
            setAlert({ open: true, message: `操作失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        }
    };
    
    const handleUpdateIntroFee = async () => {
        try {
            await api.put(`/billing/contracts/${contract.id}`, {
                introduction_fee: introFee,
            });
            setAlert({ open: true, message: '介绍费更新成功！', severity: 'success' });
            setIsEditingIntroFee(false);
            fetchData();
        } catch (error) {
            setAlert({ open: true, message: `操作失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        }
    };

    const handleSaveNotes = async () => {
        try {
            await api.put(`/billing/contracts/${contract.id}`, {
                notes: operationalNotes,
            });
            setAlert({ open: true, message: '备注更新成功！', severity: 'success' });
            setIsEditingNotes(false);
            fetchData();
        } catch (error) {
            setAlert({ open: true, message: `操作失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        }
    };

    const handleAutoRenewChange = async (event) => {
        const isEnabling = event.target.checked;

        if (isEnabling) {
            // 场景一：开启自动续签
            if (window.confirm("确定要为此合同开启自动续签吗？系统将自动为您延展未来的账单。")) {
                try {
                    setLoading(true); // 开始加载
                    await api.post(`/billing/contracts/${contract.id}/enable-auto-renew`);
                    setAlert({ open: true, message: '自动续签已成功开启！', severity: 'success' });
                    await fetchData(); // 重新获取所有数据以刷新页面
                } catch (error) {
                    setAlert({ open: true, message: `操作失败: ${error.response?.data?.error || error.message}`,severity: 'error' });
                } finally {
                    setLoading(false); // 结束加载
                }
            }
        } else {
            // 场景二：关闭自动续签，复用已有的终止合同弹窗
            handleOpenTerminationDialog();
        }
    };

    const handleOpenBillModal = async (bill) => {
        setModalOpen(true);
        setLoadingModal(true);
        setSelectedBillContext({
            customer_name: contract.customer_name,
            employee_name: contract.employee_name,
            contract_id: contract.id,
            contract_type_value: contract.contract_type_value,
        });

        try {
            const response = await api.get('/billing/details', { params: { bill_id: bill.id } });
            setSelectedBillDetails(response.data);
        } catch (error) {
            setAlert({ open: true, message: `获取账单详情失败: ${error.response?.data?.error || error.message}`, severity: 'error'});
            setSelectedBillDetails(null);
        } finally {
            setLoadingModal(false);
        }
    };

    const handleCloseBillModal = (updatedDetails) => {
        setModalOpen(false);
        setSelectedBillDetails(null);
        setSelectedBillContext(null);
        if (updatedDetails) {
            fetchData();
        }
    };

    const handleSaveChangesInModal = async (payload) => {
        setLoadingModal(true);
        try {
            const response = await api.post('/billing/batch-update', payload);
            setSelectedBillDetails(response.data.latest_details);
            setAlert({ open: true, message: response.data.message || "保存成功！", severity: 'success' });
        } catch (error) {
            setAlert({ open: true, message: `保存失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        } finally {
            setLoadingModal(false);
        }
    };



    const baseFields = {
        '客户姓名': contract.customer_name,
        // '联系人': contract.contact_person,
        '服务人员': contract.employee_name,
        '状态': (
            <Chip
                label={STATUS_INFO[contract.status]?.label || contract.status}
                color={STATUS_INFO[contract.status]?.color || 'default'}
                size="small"
            />
        ),
        '合同周期': `${formatDate(contract.start_date)} ~ ${formatDate(contract.end_date)}`,
        '合同剩余月数': <Chip label={contract.remaining_months} size="small" color={contract.highlight_remaining ? 'warning' : 'default'} variant={contract.highlight_remaining ? 'filled' : 'outlined'} />,
        // '创建时间': new Date(contract.created_at).toLocaleDateString('zh-CN'),
        // '备注': contract.notes,                   
    };                                            
                                                  
    const specificFields = contract.contract_type_value === 'maternity_nurse' ? {
        '合同类型': '月嫂合同',
        '级别/月薪': `¥${formatCurrency(contract.employee_level)}`,
        '预产期': formatDate(contract.provisional_start_date),
        // '实际上户日期': formatDate(contract.actual_onboarding_date),
        // '定金': `¥${formatCurrency(contract.deposit_amount)}`,
        '管理费': `¥${formatCurrency(contract.management_fee_amount)}`,
        // '管理费率': `${(contract.management_fee_rate * 100).toFixed(0)}%`,
        '保证金支付': `¥${formatCurrency(contract.security_deposit_paid)}`,
        // '优惠金额': `¥${formatCurrency(contract.discount_amount)}`,
    } : contract.contract_type_value === 'nanny_trial' ? {
        '合同类型': '育儿嫂试工',
        '级别/月薪': `¥${formatCurrency(contract.employee_level)}`,
    } : contract.contract_type_value === 'external_substitution' ? {
        '合同类型': '临时替班合同',
        '管理费': `¥${formatCurrency(contract.management_fee_amount)}`,
        '管理费率': `${(contract.management_fee_rate * 100).toFixed(0)}%`,
    } : { // nanny
        '合同类型': '育儿嫂合同',
        '级别/月薪': `¥${formatCurrency(contract.employee_level)}`,
        '管理费': `¥${formatCurrency(contract.management_fee_amount)}`,
        // '是否自动月签': contract.is_monthly_auto_renew ? '是' : '否',
    };

    const autoRenewField = (contract.contract_type_value === 'nanny') ? (
        <Grid item xs={12} sm={6} md={4}>
            <Typography variant="body2" color="text.secondary" gutterBottom>是否自动月签</Typography>
            <Switch
                checked={contract.is_monthly_auto_renew || false}
                onChange={handleAutoRenewChange}
                disabled={contract.status !== 'active'}
                color="primary"
            />
        </Grid>
    ) : null;

    const onboardingDateField = (contract.contract_type_value ==='maternity_nurse') ? (
        <Grid item xs={12} sm={6} md={4}>
            <Typography variant="body2" color="text.secondary"gutterBottom>实际上户日期</Typography>
            {contract.actual_onboarding_date ? (
                <Typography variant="body1" component="div" sx={{ fontWeight: 500 }}>
                    {formatDate(contract.actual_onboarding_date)}
                </Typography>
            ) : (
                <Tooltip title="点击设置实际上户日期" arrow>
                    <Chip
                        icon={<EventBusyIcon />}
                        label="未确认上户日期"
                        size="small"
                        variant="outlined"
                        onClick={() => handleOpenOnboardingDialog(contract)}
                        sx={{
                            borderColor: 'grey.400',
                            borderStyle: 'dashed',
                            color: 'text.secondary',
                            cursor: 'pointer',
                            '&:hover': { backgroundColor: 'action.hover' }
                        }}
                    />
                </Tooltip>
            )}
        </Grid>
    ) : null;

    const depositLogs = logs.filter(log => log.action === '记录定金支付');

    const depositField = (contract.contract_type_value === 'maternity_nurse') ?(
        <Grid item xs={12} sm={6} md={4}>
            <Typography variant="body2" color="text.secondary"gutterBottom>定金</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Typography variant="body1" component="div" sx={{ fontWeight: 500 }}>
                    {`¥${formatCurrency(contract.deposit_amount)}`}
                </Typography>

                {/* 只要定金未支付，就显示“收款”按钮 */}
                {!contract.deposit_paid && depositAdjustment && (
                    <Button
                        variant="contained"
                        size="small"
                        onClick={() => handleOpenDepositDialog(depositAdjustment)}
                        sx={{ ml: 2 }}
                    >
                        收款
                    </Button>
                )}

                {/* 仅在有相关日志时显示“信息”图标 */}
                {depositLogs.length > 0 && (
                    <Tooltip
                        title={
                            <Box>
                                {depositLogs.map(log => (
                                    <Box key={log.id} sx={{ mb: 1 }}>
                                        <Typography variant="caption" display="block">
                                            {new Date(log.created_at).toLocaleString('zh-CN')} by {log.user}
                                        </Typography>
                                        <Typography variant="body2">
                                            {log.action}: ¥{log.details?.paid_amount}
                                        </Typography>
                                    </Box>
                                ))}
                            </Box>
                        }
                    >
                        <IconButton size="small" sx={{ ml: 1 }}>
                            <InfoIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                )}
            </Box>
        </Grid>
    ) : null;

    const introFeeField = (['nanny', 'nanny_trial'].includes(contract.contract_type_value)) ? (
        <EditableDetailItem
            label="介绍费"
            value={introFee}
            isEditing={isEditingIntroFee}
            onEdit={() => setIsEditingIntroFee(true)}
            onSave={handleUpdateIntroFee}
            onCancel={() => {
                setIsEditingIntroFee(false);
                setIntroFee(contract.introduction_fee || '0');
            }}
            onChange={(e) => setIntroFee(e.target.value)}
        />
    ) : null;

    const notesField = (
        <EditableNotesItem
            label="合同备注"
            originalValue={originalNotes}
            operationalValue={operationalNotes}
            isEditing={isEditingNotes}
            onEdit={() => setIsEditingNotes(true)}
            onSave={handleSaveNotes}
            onCancel={() => {
                setIsEditingNotes(false);
                // 可选：重置未保存的修改
                const separator = '\\n\\n--- 运营备注 ---\\n';
                const notes = contract.notes || '';
                if (notes.includes(separator)) {
                    setOperationalNotes(notes.split(separator)[1]);
                } else {
                    setOperationalNotes('');
                }
            }}
            onChange={(e) => setOperationalNotes(e.target.value)}
        />
    );
    const sourceContractField = contract.source_trial_contract_id ? (
        <Grid item xs={12} sm={6} md={4}>
            <Typography variant="body2" color="text.secondary"gutterBottom>合同来源</Typography>
            <Chip
                icon={<LinkIcon />}
                label={`源自试工合同`}
                variant="outlined"
                onClick={() => navigate(`/contract/detail/${contract.source_trial_contract_id}`)}
                sx={{
                    cursor: 'pointer',
                    '&:hover': {
                        backgroundColor: 'action.hover'
                    }
                }}
            />
        </Grid>
    ) : null;

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
                             <Button variant="contained" color="primary" startIcon={<ArrowBackIcon />} onClick={() => navigate(state?.from?.pathname|| '/contracts/all')}>
                                返回列表
                            </Button>
                            {contract.status === 'active' && contract.contract_type_value !== 'nanny_trial' && (
                                <Button variant="contained" color="error" onClick={handleOpenTerminationDialog}>
                                    终止合同
                                </Button>
                            )}
                            {contract.contract_type_value === 'nanny_trial' && contract.trial_outcome=== 'pending' && (
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
                            <Typography variant="h3" gutterBottom>合同信息</Typography>
                            <Divider sx={{ my: 2 }} />
                            <Grid container spacing={3}>
                                {Object.entries(baseFields).map(([label, value]) => <DetailItem key={label} label={label} value={value} />)}
                                {Object.entries(specificFields).map(([label, value]) => <DetailItem key={label} label={label} value={value} />)}
                                {trialOutcomeField} {/* <--- 加上试工结果 */}
                                {convertedToField}  {/* <--- 加上转换链接 */}
                                {sourceContractField}
                                {onboardingDateField}
                                {depositField}
                                {autoRenewField}
                                {introFeeField}
                                {notesField}
                            </Grid>
                        </Paper>
                    </Grid>
                    {/* <Grid item xs={12}>
                        <Paper sx={{ p: 3 }}>
                            <Typography variant="h6" gutterBottom>财务调整项</Typography>
                            <TableContainer>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>类型</TableCell>
                                            <TableCell>金额</TableCell>
                                            <TableCell>状态</TableCell>
                                            <TableCell>说明</TableCell>
                                            <TableCell align="right">操作</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {adjustments.length > 0 ? adjustments.map((adj) => (
                                            <TableRow key={adj.id} hover>
                                                <TableCell>{ADJUSTMENT_TYPE_LABELS[adj.adjustment_type] || adj.adjustment_type}</TableCell>

                                                <TableCell sx={{fontWeight: 'bold'}}>{`¥${formatCurrency(adj.amount)}`}</TableCell>
                                                <TableCell><Chip label={ADJUSTMENT_STATUS_LABELS[adj.status] || adj.status} size="small" /></TableCell>
                                                <TableCell>{adj.description}</TableCell>
                                                <TableCell align="right">
                                                    {adj.adjustment_type === 'deposit'&& adj.status === 'PENDING' && (
                                                        <Button variant="contained"size="small" onClick={() => handleOpenDepositDialog(adj)}>
                                                            记录支付
                                                        </Button>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        )) : (
                                            <TableRow>
                                                <TableCell colSpan={5} align="center">无任何财务调整项</TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </Paper>
                    </Grid> */}
                    {/* 日志列表 */}
                    {/* <Grid item xs={12}>
                        <Paper sx={{ p: 3 }}>
                            <Typography variant="h6" gutterBottom>操作日志</Typography>
                            <List dense>
                                {logs.map(log => (
                                    <React.Fragment key={log.id}>
                                        <ListItem>
                                            <ListItemText
                                                primary={`${log.action} - by ${log.user}`}
                                                secondary={
                                                    <>
                                                        <Typography component="span" variant="body2" color="text.primary">
                                                            {new Date(log.created_at).toLocaleString('zh-CN')}
                                                        </Typography>
                                                        <pre style={{ whiteSpace: 'pre-wrap',wordBreak: 'break-all', margin: 0, fontSize: '0.75rem' }}>
                                                            {JSON.stringify(log.details, null,2)}
                                                        </pre>
                                                    </>
                                                }
                                            />
                                        </ListItem>
                                        <Divider component="li" />
                                    </React.Fragment>
                                ))}
                            </List>
                        </Paper>
                    </Grid> */}
                    <Grid item xs={12}>
                        <Paper sx={{ p: 3 }}>
                            <Typography variant="h5" gutterBottom>关联账单列表</Typography>
                            {bills.length > 0 ? (
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
                                        {bills.map((bill) => (
                                            <TableRow key={bill.id} hover>
                                                <TableCell>{bill.billing_period}</TableCell>
                                                <TableCell>{formatDate(bill.cycle_start_date)} ~ {formatDate(bill.cycle_end_date)}</TableCell>
                                                    <TableCell>
                                                    {bill.base_work_days} 天
                                                    {bill.is_substitute_bill && (
                                                        <Chip label="替" size="small" color="info"sx={{ ml: 1 }} />
                                                    )}
                                                </TableCell>
                                                <TableCell>{bill.overtime_days} 天</TableCell>
                                                <TableCell sx={{fontWeight: 'bold'}}>{`¥${formatCurrency(bill.total_due)}`}</TableCell>
                                                <TableCell><Chip label={bill.status} color={bill.status=== '已支付' ? 'success' : 'warning'} size="small" /></TableCell>
                                                <TableCell align="right">
                                                <Button variant="contained" size="small" onClick={() =>handleOpenBillModal(bill)}>
                                                    去管理
                                                </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        ) : (
                            <Typography variant="body1" sx={{ py: 3, textAlign: 'center', color:'text.secondary' }}>
                                暂无关联账单
                            </Typography>
                        )}
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
                            minDate={contract.start_date ? new Date(contract.start_date) : undefined}
                            sx={{ width: '100%', mt: 1 }}
                        />
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={handleCloseTerminationDialog}>取消</Button>
                        <Button onClick={handleConfirmTermination} variant="contained" color="error">确认终止</Button>
                    </DialogActions>
                </Dialog>
                {/* --------------------------------- */}
                {/* --- 开始：渲染财务管理弹窗 --- */}
                {modalOpen && (
                    <FinancialManagementModal
                        open={modalOpen}
                        onClose={handleCloseBillModal}
                        contract={selectedBillContext}
                        billingMonth={selectedBillDetails?.customer_bill_details?.billing_period}
                        billingDetails={selectedBillDetails}
                        loading={loadingModal}
                        onSave={handleSaveChangesInModal}
                        onNavigateToBill={(billId) => navigate(`/billing?find_bill_id=${billId}`)}
                    />
                )}
                {/* --- 结束：渲染财务管理弹窗 --- */}

                <Dialog open={depositDialogOpen} onClose={handleCloseDepositDialog}>
                    <DialogTitle>记录定金支付</DialogTitle>
                    <DialogContent>
                        <Typography sx={{ mb: 2 }}>
                            正在为 <b>{selectedAdjustment?.description}</b>记录支付信息。
                        </Typography>
                        <TextField
                            label="支付金额"
                            type="number"
                            fullWidth
                            margin="normal"
                            value={depositPaidAmount}
                            onChange={(e) => setDepositPaidAmount(e.target.value)}
                            InputProps={{
                                startAdornment: <InputAdornment position="start">¥</InputAdornment>,
                            }}
                        />
                        <DatePicker
                            label="支付日期"
                            value={depositPaidDate}
                            onChange={(date) => setDepositPaidDate(date)}
                            sx={{ width: '100%', mt: 2 }}
                        />
                        {/* --- 在这里新增一个输入框 --- */}
                        <TextField
                            label="收款方式/备注"
                            fullWidth
                            margin="normal"
                            value={depositSettlementNotes}
                            onChange={(e) => setDepositSettlementNotes(e.target.value)}
                        />
                        {/* --- 新增结束 --- */}
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={handleCloseDepositDialog}>取消</Button>
                        <Button onClick={handleConfirmDepositPayment} variant="contained" color="primary">确认支付</Button>
                    </DialogActions>
                </Dialog>
                <Dialog open={onboardingDialogOpen}onClose={handleCloseOnboardingDialog}>
                    <DialogTitle>设置实际上户日期</DialogTitle>
                    <DialogContent>
                        <Alert severity="info" sx={{ mt: 1, mb: 2 }}>
                            为月嫂合同 <b>{contractToSetDate?.customer_name}({contractToSetDate?.employee_name})</b> 设置实际上户日期。
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
                        <Button onClick={handleSaveOnboardingDate} variant="contained">保存并生成账单</Button>
                    </DialogActions>
                </Dialog>
                <Dialog open={infoDialogOpen} onClose={() => setInfoDialogOpen(false)}>
                    <DialogTitle>操作提示</DialogTitle>
                    <DialogContent>
                        <Alert severity="info">
                            {infoDialogData.message}
                        </Alert>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setInfoDialogOpen(false)}>关闭</Button>
                        <Button
                            variant="contained"
                            onClick={() => {
                                // 关闭提示弹窗
                                setInfoDialogOpen(false);
                                // 找到对应的账单对象
                                const targetBill = bills.find(b => b.id === infoDialogData.billId);
                                if (targetBill) {
                                    // 打开你已有的账单管理弹窗
                                    handleOpenBillModal(targetBill);
                                } else {
                                    setAlert({ open: true, message:'错误：未能在当前合同下找到对应的账单。', severity: 'error' });
                                }
                            }}
                        >
                            查看账单
                        </Button>
                    </DialogActions>
                </Dialog>
                <Dialog open={conversionDialogOpen} onClose={() => setConversionDialogOpen(false)} fullWidth maxWidth="sm">
                    <DialogTitle>关联到正式合同</DialogTitle>
                        <DialogContent>
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                请为这个成功的试工合同选择一个要转入的正式育儿嫂合同。试工期间的费用将会附加到所选正式合同的第一个账单上。
                            </Typography>

                            {loadingEligible ? (
                                <Box sx={{ display: 'flex', justifyContent: 'center', my: 3 }}>
                                    <CircularProgress />
                                </Box>
                            ) : eligibleContracts.length > 0 ? (
                                // 如果找到了合同，就显示下拉列表
                                <TextField
                                    select
                                    fullWidth
                                    variant="outlined"
                                    label="选择一个正式合同"
                                    value={selectedFormalContractId}
                                    onChange={(e) => setSelectedFormalContractId(e.target.value)}
                                >
                                    {eligibleContracts.map((c) => (
                                        <MenuItem key={c.id} value={c.id}>
                                            {`合同 (员工: ${c.employee_name}, 开始日期: ${formatDate(c.start_date)})`}
                                        </MenuItem>
                                    ))}
                                </TextField>
                            ) : (
                                // 如果没找到合同，就显示警告信息
                                <Alert severity="warning">
                                    客户({contract.customer_name})-员工({contract.employee_name}):尚未签订正式育儿嫂合同, 无法关联。
                                    <br/>
                                    请先签署正式合同后再执行此操作。
                                </Alert>
                            )}
                        </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setConversionDialogOpen(false)}>取消</Button>
                        <Button
                            onClick={handleConfirmConversion}
                            variant="contained"
                            color="primary"
                            disabled={!selectedFormalContractId || loadingEligible}
                        >
                            确认并转换
                        </Button>
                    </DialogActions>
                </Dialog>
            </Box>
        </LocalizationProvider>
    );
};

export default ContractDetail;