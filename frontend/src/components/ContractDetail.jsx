// frontend/src/components/ContractDetail.jsx

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
    Box, Typography, Paper, Grid, CircularProgress, Button, InputLabel, Select,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip, Tooltip,
    List, ListItem, ListItemText, Divider, Dialog, DialogTitle, DialogContent, MenuItem,
    DialogActions, Alert, Stack, IconButton, TextField, InputAdornment, Switch, FormControlLabel, Radio, RadioGroup, FormControl, FormLabel, Autocomplete
} from '@mui/material';
import {
    ArrowBack as ArrowBackIcon, Edit as EditIcon, CheckCircle as CheckCircleIcon, Info as InfoIcon,
    Cancel as CancelIcon, Save as SaveIcon, Link as LinkIcon, EventBusy as EventBusyIcon, ReceiptLong as ReceiptLongIcon,
    Message as MessageIcon,
    Download as DownloadIcon,
    PictureAsPdf as PictureAsPdfIcon,
    Autorenew as AutorenewIcon,
} from '@mui/icons-material';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';

import api from '../api/axios';
import PageHeader from './PageHeader';
import AlertMessage from './AlertMessage';
import FinancialManagementModal from './FinancialManagementModal';
import { useTrialConversion } from '../hooks/useTrialConversion'; // <--- 添加这个
import TrialConversionDialog from './modals/TrialConversionDialog'; // <--- 添加这个
import SigningMessageModal from './SigningMessageModal'; // Import the new modal
import EditContractModal from './EditContractModal';
import FamilyIdManager from './FamilyIdManager';

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
    const depositAdjustment = adjustments.find(adj => adj && adj.adjustment_type === 'deposit');
    const [loading, setLoading] = useState(true);
    const [alert, setAlert] = useState({ open: false, message: '', severity: 'info' });


    // --- 修改 1: 迁移状态和逻辑 ---
    const [terminationDialogOpen, setTerminationDialogOpen] = useState(false);
    const [terminationDate, setTerminationDate] = useState(null);
    const [chargeOnTerminationDate, setChargeOnTerminationDate] = useState(true);

    const [isTransfer, setIsTransfer] = useState(false);
    const [substitutes, setSubstitutes] = useState([]);
    const [selectedSubstituteUserId, setSelectedSubstituteUserId] = useState('');
    const [selectedNewContractId, setSelectedNewContractId] = useState('');
    const [loadingTransferOptions, setLoadingTransferOptions] = useState(false);
    const [filterMethod, setFilterMethod] = useState('employee');

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
    const [infoDialogData, setInfoDialogData] = useState({ message: '', billId: null });

    const [conversionDialogOpen, setConversionDialogOpen] = useState(false);
    const [eligibleContracts, setEligibleContracts] = useState([]);
    const [loadingEligible, setLoadingEligible] = useState(false);
    const [selectedFormalContractId, setSelectedFormalContractId] = useState('');
    // const [targetBillId, setTargetBillId] = useState(null);

    const [depositDialogOpen, setDepositDialogOpen] = useState(false);
    const [selectedAdjustment, setSelectedAdjustment] = useState(null);
    const [depositPaidDate, setDepositPaidDate] = useState(new Date());
    const [depositPaidAmount, setDepositPaidAmount] = useState('');
    const [depositSettlementNotes, setDepositSettlementNotes] = useState('定金收款');

    // State for the new signing message modal
    const [signingModalOpen, setSigningModalOpen] = useState(false);
    const [signingMessage, setSigningMessage] = useState('');
    const [signingModalTitle, setSigningModalTitle] = useState('');

    // State for editing signature requirement
    const [isEditingSignature, setIsEditingSignature] = useState(false);
    const [requiresSignature, setRequiresSignature] = useState(null);

    const [isRenewModalOpen, setIsRenewModalOpen] = useState(false);
    const [renewalData, setRenewalData] = useState({
        start_date: null,
        end_date: null,
        employee_level: '',
        management_fee_amount: '',
        management_fee_rate: 0,
        transfer_deposit: true,
        template_id: null,
        content: '',
    });

    const conversionActions = useTrialConversion((formalContractId) => {
        if (formalContractId) {
            navigate(`/contract/detail/${formalContractId}`);
        } else {
            fetchData();
        }
    });

    // --- Start of Change Contract Logic ---
    const [isChangeModalOpen, setIsChangeModalOpen] = useState(false);
    const [changeData, setChangeData] = useState({
        start_date: null,
        end_date: null,
        employee_level: '',
        management_fee_amount: '',
        management_fee_rate: 0,
        service_personnel_id: '',
        service_personnel_name: '',
        transfer_deposit: true,
        template_id: null,
        content: '',
    });
    const [personnelOptions, setPersonnelOptions] = useState([]);
    const [personnelSearchTerm, setPersonnelSearchTerm] = useState('');
    const [isSearchingPersonnel, setIsSearchingPersonnel] = useState(false);
    const [selectedPersonnel, setSelectedPersonnel] = useState(null);
    // --- End of Change Contract Logic ---
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);


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

            const separator = '\n\n--- 运营备注 ---\n';
            const notes = contractRes.data.notes || '';
            if (notes.includes(separator)) {
                const parts = notes.split(separator);
                setOriginalNotes(parts[0]);
                setOperationalNotes(parts[1]);
            } else {
                setOriginalNotes(notes);
                setOperationalNotes('');
            }

            // Initialize signature requirement state
            setRequiresSignature(contractRes.data.requires_signature);
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

    // 修正后的useEffect，使用 customer_name 进行筛选
    useEffect(() => {
        if (!isTransfer) {
            setEligibleContracts([]);
            return;
        }

        const fetchEligibleContracts = async () => {
            setLoadingTransferOptions(true);
            setEligibleContracts([]);
            setSelectedNewContractId('');
            try {
                let contractsData = [];
                if (filterMethod === 'customer') {
                    const response = await api.get('/billing/contracts/eligible-for-transfer', {
                        params: {
                            customer_name: contract.customer_name,
                            exclude_contract_id: contractId
                        }
                    });
                    contractsData = response.data.map(c => {
                        const match = c.label.match(/ - (.*) \((.*)生效\)/);
                        return {
                            id: c.id,
                            employee_name: match ? match[1] : '未知员工',
                            start_date: match ? match[2] : null,
                            end_date: null
                        };
                    });
                } else if (filterMethod === 'employee' && selectedSubstituteUserId) {
                    const response = await api.get('/billing/contracts', {
                        params: {
                            customer_name: contract.customer_name,
                            employee_id: selectedSubstituteUserId,
                            status: 'active',
                            per_page: 100
                        }
                    });
                    contractsData = response.data.items.filter(c => c.id !== contractId);
                }
                setEligibleContracts(contractsData);

            } catch (error) {
                setAlert({ open: true, message: `获取目标合同列表失败: ${error.message}`, severity: 'warning' });
            } finally {
                setLoadingTransferOptions(false);
            }
        };

        fetchEligibleContracts();

    }, [isTransfer, filterMethod, selectedSubstituteUserId, contractId, contract?.customer_name]);

    useEffect(() => {
        if (contract?.trial_outcome === 'success' && contract.converted_to_formal_contract_id) {
            api.get(`/billing/contracts/${contract.converted_to_formal_contract_id}/bills`)
                .then(response => {
                    const formalBills = response.data;
                    if (formalBills && formalBills.length > 0) {
                        const targetBill = formalBills[0];
                        targetBill.isTransferredBill = true;

                        setBills(prevBills => {
                            // --- 【核心修正】在添加前，检查账单是否已存在 ---
                            const isAlreadyPresent = prevBills.some(b => b.id === targetBill.id);
                            if (isAlreadyPresent) {
                                // 如果已存在，直接返回旧的列表，不做任何改动
                                return prevBills;
                            }
                            // 如果不存在，则将新账单添加到列表开头
                            return [targetBill, ...prevBills];
                        });
                    }
                })
                .catch(err => {
                    console.error("获取目标账单失败:", err);
                });
        }
    }, [contract]);

    useEffect(() => {
        if (renewalData.management_fee_rate > 0 && renewalData.employee_level) {
            let newFee = 0;
            const level = parseFloat(renewalData.employee_level);
            const rate = parseFloat(renewalData.management_fee_rate);

            // --- 核心修改：区分月嫂合同和育儿嫂合同的计算逻辑 ---
            if (contract?.contract_type_value === 'maternity_nurse') {
                // 月嫂逻辑：管理费 = (级别 / (1 - 费率)) * 费率
                // 注意：这里的费率是指管理费占总金额(级别+管理费)的比例
                if (rate < 1) {
                    const totalAmount = level / (1 - rate);
                    newFee = totalAmount * rate;
                }
            } else {
                // 育儿嫂逻辑：管理费 = 级别 * 费率
                newFee = level * rate;
            }

            // 只有在计算值与当前值不同时才更新，避免无限循环
            if (Math.abs(newFee - parseFloat(renewalData.management_fee_amount || 0)) > 0.01) {
                setRenewalData(prev => ({ ...prev, management_fee_amount: newFee.toFixed(2) }));
            }
        }
    }, [renewalData.employee_level, renewalData.management_fee_rate, contract?.contract_type_value]);

    useEffect(() => {
        if (changeData.management_fee_rate > 0 && changeData.employee_level) {
            let newFee = 0;
            const level = parseFloat(changeData.employee_level);
            const rate = parseFloat(changeData.management_fee_rate);

            // --- 核心修改：区分月嫂合同和育儿嫂合同的计算逻辑 ---
            if (contract?.contract_type_value === 'maternity_nurse') {
                // 月嫂逻辑：管理费 = (级别 / (1 - 费率)) * 费率
                if (rate < 1) {
                    const totalAmount = level / (1 - rate);
                    newFee = totalAmount * rate;
                }
            } else {
                // 育儿嫂逻辑：管理费 = 级别 * 费率
                newFee = level * rate;
            }

            if (Math.abs(newFee - parseFloat(changeData.management_fee_amount || 0)) > 0.01) {
                setChangeData(prev => ({ ...prev, management_fee_amount: newFee.toFixed(2) }));
            }
        }
    }, [changeData.employee_level, changeData.management_fee_rate, contract?.contract_type_value]);

    useEffect(() => {
        if (personnelSearchTerm.length < 1) {
            setPersonnelOptions([]);
            return;
        }

        const delayDebounceFn = setTimeout(async () => {
            setIsSearchingPersonnel(true);
            try {
                const response = await api.get('/billing/personnel/search', {
                    params: { q: personnelSearchTerm }
                });
                setPersonnelOptions(response.data);
            } catch (error) {
                console.error("Failed to search for personnel:", error);
            } finally {
                setIsSearchingPersonnel(false);
            }
        }, 300);

        return () => clearTimeout(delayDebounceFn);
    }, [personnelSearchTerm]);
    // --- End of Change Contract Logic ---

    if (loading) return <CircularProgress />;
    if (!contract) return <Typography>未找到合同信息。</Typography>;

    const handleDeleteContract = async () => {
        if (!contract) return;

        const isConfirmed = window.confirm(
            `您确定要永久删除这个合同吗？\n\n客户: ${contract.customer_name}\n员工: ${contract.employee_name}\n\n此操作不可撤销，且只应在合同未生效前执行。`
        );

        if (isConfirmed) {
            try {
                await api.delete(`/contracts/${contract.id}`);
                setAlert({
                    open: true,
                    message: '合同已成功删除。',
                    severity: 'success',
                });
                // 删除成功后，跳转回合同列表
                setTimeout(() => navigate('/contracts/all'), 1500);
            } catch (error) {
                setAlert({
                    open: true,
                    message: `删除失败: ${error.response?.data?.error || error.message}`,
                    severity: 'error',
                });
            }
        }
    };

    const handleDownloadPdf = async () => {
        setAlert({ open: false, message: '', severity: 'info' });
        try {
            const response = await api.get(`/contracts/${contractId}/download`, {
                responseType: 'blob',
            });

            const contentDisposition = response.headers['content-disposition'];

            // --- 核心修改：构建更具描述性的默认文件名 ---
            const customerName = contract.customer_name || '未知客户';
            const employeeName = contract.employee_name || '未知员工';
            const contractTypeLabel = contract.contract_type_label || '合同'; // 假设 contract_type_label 存在
            const startDate = contract.start_date ? formatDate(contract.start_date) : '未知日期';

            // 清理文件名，替换掉文件系统不允许的字符，并处理多余空格
            let defaultFilename = `${customerName}-${employeeName}-${contractTypeLabel}合同-${startDate}.pdf`;
            defaultFilename = defaultFilename.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();

            let filename = defaultFilename; // 默认使用我们构建的文件名
            // --- 修改结束 ---

            if (contentDisposition) {
                const filenameMatch = contentDisposition.match(/filename="(.+)"/);
                if (filenameMatch && filenameMatch.length > 1) {
                    // 如果后端提供了文件名，则优先使用后端提供的
                    filename = decodeURIComponent(filenameMatch[1]);
                }
            }

            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', filename);
            document.body.appendChild(link);
            link.click();
            link.parentNode.removeChild(link);
            window.URL.revokeObjectURL(url);

        } catch (error) {
            console.error("下载PDF时发生错误:", error);
            setAlert({ open: true, message: `下载PDF失败: ${error.message}`, severity: 'error' });
        }
    };

    const handlePreviewPdf = async () => {
        if (!contract?.id) return;
        try {
            const response = await api.get(`/contracts/${contract.id}/download`, {
                responseType: 'blob',
            });
            const file = new Blob([response.data], { type: 'application/pdf' });
            const fileURL = URL.createObjectURL(file);
            // 在新标签页中打开，而不是下载
            window.open(fileURL, '_blank');
        } catch (error) {
            console.error('预览PDF失败:', error);
            // 这里可以添加一个给用户的错误提示
        }
    };

    const handleOpenSigningModal = async (type) => {
        setAlert({ open: false, message: '', severity: 'info' });
        try {
            const response = await api.get(`/contracts/${contractId}/signing-messages`);
            if (type === 'customer') {
                setSigningMessage(response.data.customer_message);
                setSigningModalTitle('客户签约提醒消息');
            } else {
                setSigningMessage(response.data.employee_message);
                setSigningModalTitle('员工签约提醒消息');
            }
            setSigningModalOpen(true);
        } catch (error) {
            setAlert({ open: true, message: `获取签约消息失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        }
    };

    const fetchLatestTemplateContent = async (contractType) => {
        try {
            const response = await api.get('/contract_templates', {
                params: {
                    contract_type: contractType,
                    all: true // Fetch all templates for the given type
                }
            });
            // Templates are already sorted by version descending in the backend
            // So the first one in the list will be the latest version
            if (response.data.templates && response.data.templates.length > 0) {
                const latestTemplate = response.data.templates[0];
                return {
                    template_id: latestTemplate.id,
                    content: latestTemplate.content
                };
            }
        } catch (error) {
            console.error(`Failed to fetch latest template for type ${contractType}:`, error);
            setAlert({ open: true, message: `获取最新合同模板失败: ${error.message}`, severity: 'error' });
        }
        return { template_id: null, content: '' };
    };

    const handleOpenRenewModal = async () => { // Make it async
        if (!contract) return;

        // --- 核心修改：根据原合同周期计算默认续约时长 ---
        const oldStartDate = new Date(contract.start_date);
        const oldEndDate = new Date(contract.end_date);

        // 1. 计算原合同的年月日时长
        const years = oldEndDate.getFullYear() - oldStartDate.getFullYear();
        const months = oldEndDate.getMonth() - oldStartDate.getMonth();
        const days = oldEndDate.getDate() - oldStartDate.getDate();

        // 2. 计算新合同的默认开始日期
        const defaultStartDate = new Date(oldEndDate);
        defaultStartDate.setDate(defaultStartDate.getDate() + 1);

        // 3. 在新开始日期的基础上，叠加原合同的时长
        const defaultEndDate = new Date(defaultStartDate);
        defaultEndDate.setFullYear(defaultEndDate.getFullYear() + years);
        defaultEndDate.setMonth(defaultEndDate.getMonth() + months);
        defaultEndDate.setDate(defaultEndDate.getDate() + days);

        // 4. 计算总月数用于在UI上显示 (这是一个近似值，主要用于显示)
        // 如果周期为1年，则显示12个月
        let approxDurationInMonths = years * 12 + months;
        // 如果天数差异较大，可能需要微调月数，这里做一个简单处理
        if (days > 15) approxDurationInMonths += 1;
        if (days < -15) approxDurationInMonths -= 1;
        if (approxDurationInMonths <= 0) approxDurationInMonths = 1;

        let templateId = contract.template_id;
        let templateContent = contract.content;

        // If template_id or content is missing, fetch the latest template
        if (!templateId || !templateContent) {
            const latestTemplate = await fetchLatestTemplateContent(contract.contract_type_value);
            templateId = latestTemplate.template_id;
            templateContent = latestTemplate.content;
        }

        setRenewalData({
            start_date: defaultStartDate,
            end_date: defaultEndDate,
            duration_months: approxDurationInMonths, // 使用计算出的近似月数
            employee_level: contract.employee_level || '',
            management_fee_rate: contract.management_fee_rate || 0,
            management_fee_amount: contract.management_fee_amount || '',
            transfer_deposit: true,
            template_id: templateId,
            content: templateContent,
        });
        setIsRenewModalOpen(true);
    };

    const handleRenewContract = async () => {
        try {
            const response = await api.post(`/contracts/${contractId}/renew`, renewalData);
            setAlert({ open: true, message: '合同续约成功！', severity: 'success' });
            setIsRenewModalOpen(false);
            navigate(`/contract/detail/${response.data.new_contract_id}`);
        } catch (error) {
            setAlert({ open: true, message: `续约失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        }
    };

    // --- Start of Change Contract 变更合同 Logic ---

    const handleOpenChangeModal = async () => { // Make it async
        const today = new Date();
        const newEndDate = new Date(today);
        newEndDate.setFullYear(newEndDate.getFullYear() + 1);

        let templateId = contract.template_id;
        let templateContent = contract.content;

        // If template_id or content is missing, fetch the latest template
        if (!templateId || !templateContent) {
            const latestTemplate = await fetchLatestTemplateContent(contract.contract_type_value);
            templateId = latestTemplate.template_id;
            templateContent = latestTemplate.content;
        }

        setChangeData({
            start_date: today,
            end_date: newEndDate,
            employee_level: contract.employee_level,
            management_fee_amount: contract.management_fee_amount,
            management_fee_rate: contract.management_fee_rate || 0,
            service_personnel_id: contract.service_personnel_id,
            service_personnel_name: contract.employee_name,
            transfer_deposit: true,
            template_id: templateId,
            content: templateContent,
        });
        setSelectedPersonnel({ id: contract.service_personnel_id, name: contract.employee_name });

        // --- 在这里添加下面这行 ---
        setIsChangeModalOpen(true);
    };

    const handleCloseChangeModal = () => {
        setIsChangeModalOpen(false);
    };

    const handleConfirmChange = async () => {
        setLoading(true);
        // setError(''); // This is not a defined state, maybe it was removed. I'll use setAlert.
        setAlert({ open: false, message: '', severity: 'info' });

        try {
            // All data for the change is in changeData state
            const payload = {
                ...changeData,
                start_date: changeData.start_date.toISOString().split('T')[0],
                end_date: changeData.end_date.toISOString().split('T')[0],
            };

            // Single atomic API call to the new backend endpoint
            const response = await api.post(`/contracts/${contractId}/change`, payload);
            const newContractId = response.data.new_contract_id;

            if (!newContractId) {
                throw new Error("变更操作未返回新的合同ID。");
            }

            setAlert({ open: true, message: '合同变更成功！正在跳转到新合同...', severity: 'success' });
            handleCloseChangeModal();
            navigate(`/contract/detail/${newContractId}`);

        } catch (err) {
            console.error("变更合同失败:", err);
            const errorMessage = err.response?.data?.error || '变更操作失败，请检查所有字段并重试。';
            setAlert({ open: true, message: `变更失败: ${errorMessage}`, severity: 'error' });
        } finally {
            setLoading(false);
        }
    };




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
            <Typography variant="body2" color="text.secondary" gutterBottom>试工结果</Typography>
            <Chip
                label={TRIAL_OUTCOME_INFO[contract.trial_outcome]?.label || contract.trial_outcome}
                color={TRIAL_OUTCOME_INFO[contract.trial_outcome]?.color || 'default'}
                size="small"
            />
        </Grid>
    ) : null;

    const convertedToField = contract.converted_to_formal_contract_id ? (
        <Grid item xs={12} sm={6} md={4}>
            <Typography variant="body2" color="text.secondary" gutterBottom>后续合同</Typography>
            <Chip
                icon={<LinkIcon />}
                label={`已转为正式合同`}
                variant="outlined"
                onClick={() => navigate(`/contract/detail/${contract.converted_to_formal_contract_id}`)}
                sx={{ cursor: 'pointer', '&:hover': { backgroundColor: 'action.hover' } }}
            />
        </Grid>
    ) : null;

    // --- 新增：费用转移目标账单的链接 ---
    // const transferredToBillField = targetBillId ? (
    //     <Grid item xs={12} sm={6} md={4}>
    //         <Typography variant="body2" color="text.secondary" gutterBottom>费用结算</Typography>
    //         <Chip
    //             icon={<ReceiptLongIcon />}
    //             label="查看费用所在账单"
    //             variant="filled"
    //             color="info"
    //             size="small"
    //             onClick={() => handleOpenBillModal({ id: targetBillId })}
    //             sx={{ cursor: 'pointer' }}
    //         />
    //     </Grid>
    // ) : null;

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
            // 第一步：更新实际上户日期
            await api.put(`/billing/contracts/${contractToSetDate.id}`, {
                actual_onboarding_date: newOnboardingDate.toISOString().split('T')[0]
            });
            setAlert({ open: true, message: '上户日期已更新，正在为您预生成所有账单...', severity: 'info' });

            // 第二步：触发后台任务，生成所有账单
            await api.post(`/billing/contracts/${contractToSetDate.id}/generate-all-bills`);

            setAlert({ open: true, message: '所有账单已成功预生成！', severity: 'success' });
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
            setAlert({ open: true, message: '定金支付记录成功！', severity: 'success' });
            handleCloseDepositDialog();
            fetchData(); // 重新获取所有数据
        } catch (error) {
            setAlert({ open: true, message: `操作失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        }
    };

    const handleOpenTerminationDialog = async () => {
        if (!contract) return;

        const defaultDate = contract.start_date ? new Date(contract.start_date) : new Date();
        setTerminationDate(defaultDate);
        setTerminationDialogOpen(true);

        // 重置所有转签相关的状态
        setIsTransfer(false);
        setSelectedSubstituteUserId('');
        setSelectedNewContractId('');
        setEligibleContracts([]); // 清空旧的合同列表
        setSubstitutes([]); // 清空旧的替班列表

        setLoadingTransferOptions(true);
        try {
            // 现在只获取替班员工列表
            const substitutesRes = await api.get(`/contracts/${contractId}/substitutes`);
            // 去重，确保每个替班员工只在下拉列表中出现一次
            const uniqueSubstitutes = Array.from(new Map(substitutesRes.data.map(item => [item.substitute_user_id, item])).values());
            setSubstitutes(uniqueSubstitutes);
        } catch (error) {
            setAlert({ open: true, message: `获取替班员工列表失败: ${error.message}`, severity: 'warning' });
        } finally {
            setLoadingTransferOptions(false);
        }
    };


    const handleCloseTerminationDialog = () => {
        setTerminationDialogOpen(false);
        setTerminationDate(null);
        // 关闭时也要重置转签状态
        setIsTransfer(false);
    };

    const handleConfirmTermination = async () => {
        if (!contract || !terminationDate) return;

        let payload = {
            termination_date: terminationDate.toISOString().split('T')[0],
            charge_on_termination_date: chargeOnTerminationDate,
        };

        if (isTransfer) {
            if (!selectedNewContractId) {
                setAlert({ open: true, message: '请选择要转入的目标合同', severity: 'warning' });
                return;
            }
            if (filterMethod === 'employee' && !selectedSubstituteUserId) {
                setAlert({ open: true, message: '请选择要转签的员工', severity: 'warning' });
                return;
            }

            payload.transfer_options = {
                new_contract_id: selectedNewContractId,
            };
            if (filterMethod === 'employee' && selectedSubstituteUserId) {
                payload.transfer_options.substitute_user_id = selectedSubstituteUserId;
            }
        }

        try {
            await api.post(`/billing/contracts/${contract.id}/terminate`, payload);
            setAlert({ open: true, message: '合同终止操作成功！', severity: 'success' });
            handleCloseTerminationDialog();
            fetchData();
        } catch (error) {
            setAlert({ open: true, message: `操作失败: ${error.response?.data?.message || error.message}`, severity: 'error' });
        }
    };

    const handleTrialSucceeded = async () => {
        if (!contract) {
            setAlert({ open: true, message: '合同数据尚未加载完成，请稍后再试。', severity: 'warning' });
            return;
        }
        const employeeId = contract.service_personnel_id;

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
            setAlert({ open: true, message: '请选择一个要关联的正式合同。', severity: 'warning' });
            return;
        }

        // ... in handleConfirmConversion
        try {
            await api.post(`/billing/nanny-trial-contracts/${contractId}/convert`, {
                formal_contract_id: selectedFormalContractId
            });

            // 优化提示信息，告诉用户即将发生跳转
            setAlert({ open: true, message: '试工合同转换成功！正在跳转到正式合同页面...', severity: 'success' });
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

    const handleSaveSignatureRequirement = async () => {
        try {
            console.log('DEBUG - Saving signature requirement:', {
                contract_id: contract.id,
                requires_signature: requiresSignature,
                url: `/billing/contracts/${contract.id}`
            });

            const response = await api.put(`/billing/contracts/${contract.id}`, {
                requires_signature: requiresSignature,
            });

            console.log('DEBUG - Save response:', response.data);

            setAlert({ open: true, message: '签署需求更新成功！', severity: 'success' });
            setIsEditingSignature(false);
            fetchData();
        } catch (error) {
            console.error('DEBUG - Save error:', error);
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
                    setAlert({ open: true, message: `操作失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
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
            status: contract.status, // Pass status to the modal
            billingMonth: bill.billing_period
        });

        try {
            const response = await api.get('/billing/details', { params: { bill_id: bill.id } });
            setSelectedBillDetails(response.data);
        } catch (error) {
            setAlert({ open: true, message: `获取账单详情失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
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
        '家庭管理': <FamilyIdManager contract={contract} onUpdate={fetchData} />,
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
        '级别/日薪': `¥${formatCurrency(contract.employee_level)}`,
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

    const onboardingDateField = (contract.contract_type_value === 'maternity_nurse') ? (
        <Grid item xs={12} sm={6} md={4}>
            <Typography variant="body2" color="text.secondary" gutterBottom>实际上户日期</Typography>
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

    const depositField = (contract.contract_type_value === 'maternity_nurse') ? (
        <Grid item xs={12} sm={6} md={4}>
            <Typography variant="body2" color="text.secondary" gutterBottom>定金</Typography>
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


    // --- 【核心修改】根据管理费率或介绍费，动态显示不同内容 ---
    const isTrialWithRate = contract.contract_type_value === 'nanny_trial' && contract.management_fee_rate > 0;

    // 1. 定义管理费率字段
    const managementRateField = isTrialWithRate ? (
        <Grid item xs={12} sm={6} md={4}>
            <Typography variant="body2" color="text.secondary" gutterBottom>管理费率</Typography>
            <Typography variant="body1" component="div" sx={{ fontWeight: 500 }}>
                {`${contract.management_fee_rate * 100}%`}
            </Typography>
        </Grid>
    ) : null;

    // 2. 改造介绍费字段
    const introFeeField = (['nanny', 'nanny_trial'].includes(contract.contract_type_value)) ? (
        isTrialWithRate ? (
            // 如果按费率收费，则显示提示文字
            <Grid item xs={12} sm={6} md={4}>
                <Typography variant="body2" color="text.secondary" gutterBottom>介绍费</Typography>
                <Typography variant="body1" component="div" sx={{ fontStyle: 'italic', color: 'text.secondary' }}>
                    {`按${contract.management_fee_rate * 100}%收取管理费, 免收介绍费`}
                </Typography>
            </Grid>
        ) : (
            // 否则，保持原有的可编辑介绍费字段
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
        )
    ) : null;
    // --- 修改结束 ---
    const attachmentContentField = contract.attachment_content ? (
        <Grid item xs={12}>
            <Typography variant="body2" color="text.secondary" gutterBottom>附件信息</Typography>
            <Paper variant="outlined" sx={{ p: 2, whiteSpace: 'pre-wrap', backgroundColor: '#f9f9f9' }}>
                <Typography variant="body1">{contract.attachment_content}</Typography>
            </Paper>
        </Grid>
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
                const separator = '\n\n--- 运营备注 ---\n';
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

    // 是否需要签署字段
    const signatureRequirementField = (
        <Grid item xs={12} sm={6} md={4}>
            <Typography variant="body2" color="text.secondary" gutterBottom>是否需要签署</Typography>
            {isEditingSignature ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <FormControlLabel
                        control={
                            <Switch
                                checked={requiresSignature === true}
                                onChange={(e) => setRequiresSignature(e.target.checked)}
                            />
                        }
                        label={requiresSignature ? "需要签署" : "无需签署"}
                    />
                    <IconButton size="small" color="primary" onClick={handleSaveSignatureRequirement}>
                        <CheckCircleIcon />
                    </IconButton>
                    <IconButton size="small" color="error" onClick={() => {
                        setIsEditingSignature(false);
                        setRequiresSignature(contract.requires_signature);
                    }}>
                        <CancelIcon />
                    </IconButton>
                </Box>
            ) : (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Chip
                        label={requiresSignature === true ? "需要签署" : requiresSignature === false ? "无需签署" : "未设置"}
                        color={requiresSignature === true ? "primary" : requiresSignature === false ? "default" : "warning"}
                        size="small"
                    />
                    <IconButton size="small" onClick={() => setIsEditingSignature(true)}>
                        <EditIcon fontSize="small" />
                    </IconButton>
                </Box>
            )}
        </Grid>
    );

    const sourceContractField = contract.source_trial_contract_id ? (
        <Grid item xs={12} sm={6} md={4}>
            <Typography variant="body2" color="text.secondary" gutterBottom>合同来源</Typography>
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

    const previousContractField = contract.previous_contract_id ? (
        <Grid item xs={12} sm={6} md={4}>
            <Typography variant="body2" color="text.secondary" gutterBottom>源合同</Typography>
            <Chip
                icon={<LinkIcon />}
                label={`查看源合同`}
                variant="outlined"
                onClick={() => navigate(`/contract/detail/${contract.previous_contract_id}`)}
                sx={{
                    cursor: 'pointer',
                    '&:hover': {
                        backgroundColor: 'action.hover'
                    }
                }}
            />
        </Grid>
    ) : null;

    const successorContractField = contract.successor_contract_id ? (
        <Grid item xs={12} sm={6} md={4}>
            <Typography variant="body2" color="text.secondary" gutterBottom>续约合同</Typography>
            <Chip
                icon={<LinkIcon />}
                label={`查看续约合同`}
                variant="outlined"
                onClick={() => navigate(`/contract/detail/${contract.successor_contract_id}`)}
                sx={{
                    cursor: 'pointer',
                    '&:hover': {
                        backgroundColor: 'action.hover'
                    }
                }}
            />
        </Grid>
    ) : null;

    const terminationDateField = contract.status === 'terminated' ? (
        <Grid item xs={12} sm={6} md={4}>
            <Typography variant="body2" color="text.secondary" gutterBottom>终止时间</Typography>
            <Typography variant="body1" component="div" sx={{ fontWeight: 500, color: 'error.main' }}>
                {formatDate(contract.termination_date)}
            </Typography>
        </Grid>
    ) : null;

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Box>
                <AlertMessage open={alert.open} message={alert.message} severity={alert.severity} onClose={() => setAlert(prev => ({ ...prev, open: false }))} />
                <PageHeader
                    title="合同详情"
                    description={`${contract.customer_name} - ${contract.employee_name}`}
                    actions={
                        <Stack direction="row" spacing={2}>
                            <Button variant="contained" color="primary" startIcon={<ArrowBackIcon />} onClick={() => navigate(state?.from || '/contracts/all')}>
                                返回列表
                            </Button>
                            <Button variant="contained" color="primary" startIcon={<EditIcon />} onClick={() => setIsEditModalOpen(true)}>
                                编辑
                            </Button>
                            {contract.contract_type_value !== 'nanny_trial' && (
                                <Button variant="contained" color="secondary" startIcon={<AutorenewIcon />} onClick={handleOpenRenewModal}>
                                    续约
                                </Button>
                            )}
                            {contract.contract_type_value !== 'nanny_trial' && (
                                <Button variant="contained" color="warning" startIcon={<EditIcon />} onClick={handleOpenChangeModal}>
                                    变更合同
                                </Button>
                            )}
                            {contract.status === 'active' && contract.contract_type_value !== 'nanny_trial' && (
                                <Button variant="contained" color="error" onClick={handleOpenTerminationDialog}>
                                    终止合同
                                </Button>
                            )}
                            {/* 试工合同的操作按钮 */}
                            {contract.contract_type_value === 'nanny_trial' && contract.trial_outcome === 'pending' && (
                                <>
                                    <Tooltip title={!contract.can_convert_to_formal ? "客户与员工名下无已生效的正式合同，无法关联" : ""}>
                                        <span>
                                            <Button
                                                variant="contained"
                                                color="success"
                                                startIcon={<CheckCircleIcon />}
                                                onClick={() => conversionActions.openConversionDialog(contract)}
                                                disabled={!contract.can_convert_to_formal}
                                            >
                                                试工成功
                                            </Button>
                                        </span>
                                    </Tooltip>
                                    <Button
                                        variant="contained"
                                        color="error"
                                        startIcon={<CancelIcon />}
                                        onClick={handleOpenTerminationDialog}
                                    >
                                        试工失败
                                    </Button>
                                </>
                            )}
                            {contract.status === 'pending' && (
                                <Button
                                    variant="contained"
                                    color="error"
                                    onClick={handleDeleteContract}
                                >
                                    删除合同
                                </Button>
                            )}
                        </Stack>
                    }
                />
                <Grid container spacing={3}>
                    <Grid item xs={12}>
                        <Paper sx={{ p: 3 }}>
                            <Typography variant="h3" gutterBottom>合同信息</Typography>
                            <Divider sx={{ my: 2 }} />
                            <Grid container spacing={3}>
                                {Object.entries(baseFields).map(([label, value]) => <DetailItem key={label} label={label} value={value} />)}
                                {Object.entries(specificFields).map(([label, value]) => < DetailItem key={label} label={label} value={value} />)}
                                {trialOutcomeField}
                                {convertedToField}
                                {sourceContractField}
                                {previousContractField}
                                {successorContractField}
                                {terminationDateField}
                                {onboardingDateField}
                                {depositField}
                                {autoRenewField}
                                {managementRateField}
                                {introFeeField}
                                {attachmentContentField}
                                {signatureRequirementField}
                                {notesField}
                                {/* {transferredToBillField} */}
                            </Grid>
                        </Paper>
                        <Box sx={{ my: 3, display: 'flex', gap: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
                            {/* DEBUG: 调试签署状态 */}
                            {console.log('DEBUG - Contract Signing Info:', {
                                signing_status: contract.signing_status,
                                requires_signature: contract.requires_signature,
                                shouldShowButtons: contract.signing_status !== 'NOT_REQUIRED'
                            })}
                            {/* 只在 signing_status !== 'NOT_REQUIRED' 时显示签署相关按钮 */}
                            {contract.signing_status !== 'NOT_REQUIRED' && (
                                <>
                                    <Button
                                        variant="contained"
                                        startIcon={<PictureAsPdfIcon />}
                                        onClick={handlePreviewPdf}
                                    >
                                        预览合同
                                    </Button>
                                    <Button
                                        variant="contained"
                                        startIcon={<DownloadIcon />}
                                        onClick={handleDownloadPdf}
                                    >
                                        下载合同
                                    </Button>
                                    {contract.signing_status !== 'SIGNED' && (
                                        <>
                                            <Button variant="contained" color="primary" startIcon={<MessageIcon />} onClick={() => handleOpenSigningModal('customer')}>
                                                客户签约消息
                                            </Button>
                                            <Button variant="contained" color="primary" startIcon={<MessageIcon />} onClick={() => handleOpenSigningModal('employee')}>
                                                员工签约消息
                                            </Button>
                                        </>
                                    )}
                                </>
                            )}
                        </Box>
                    </Grid>

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
                                                <TableCell>应付/已付金额</TableCell>
                                                <TableCell>支付状态</TableCell>
                                                <TableCell align="right">操作</TableCell>
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {bills.map((bill) => (
                                                <TableRow
                                                    key={bill.id}
                                                    hover

                                                >
                                                    <TableCell>
                                                        {bill.billing_period}
                                                        {bill.isTransferredBill && (
                                                            <Tooltip title="试工费用已结算至此账单">
                                                                <Chip label="费用转移至此账单" size="small" sx={{ ml: 1 }} />
                                                            </Tooltip>
                                                        )}
                                                    </TableCell>
                                                    <TableCell>{formatDate(bill.cycle_start_date)}~ {formatDate(bill.cycle_end_date)}</TableCell>
                                                    <TableCell>
                                                        {bill.base_work_days} 天
                                                        {bill.is_substitute_bill && (
                                                            <Chip label="替" size="small" color="info" sx={{ ml: 1 }} />
                                                        )}
                                                    </TableCell>
                                                    <TableCell>{bill.overtime_days} 天</TableCell>
                                                    <TableCell sx={{ fontWeight: 'bold', fontFamily: 'monospace' }}>
                                                        <Typography variant="body2" component="div">
                                                            应付: ¥{formatCurrency(bill.total_due)}
                                                        </Typography>
                                                        <Typography variant="caption" component="div" color="success.dark">
                                                            已付: ¥{formatCurrency(bill.total_paid)}
                                                        </Typography>
                                                    </TableCell>
                                                    <TableCell><Chip label={bill.status} color={bill.status === '已支付' ? 'success' : 'warning'} size="small" /></TableCell>
                                                    <TableCell align="right">
                                                        <Button variant="contained" size="small" onClick={() => handleOpenBillModal(bill)}>
                                                            去管理
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </TableContainer>
                            ) : (
                                <Typography variant="body1" sx={{ py: 3, textAlign: 'center', color: 'text.secondary' }}>
                                    暂无关联账单
                                </Typography>
                            )}
                        </Paper>
                    </Grid>
                </Grid>

                {/* --- 修改 3: 添加确认弹窗 --- */}
                <Dialog open={terminationDialogOpen} onClose={handleCloseTerminationDialog} fullWidth maxWidth="sm">
                    <DialogTitle>确认合同终止操作</DialogTitle>
                    <DialogContent>
                        <Alert severity="warning" sx={{ mt: 1, mb: 2 }}>
                            您正在为 <b>{contract?.customer_name}({contract?.employee_name})</b> 的合同进行操作。
                        </Alert>
                        <DatePicker
                            label="终止日期"
                            value={terminationDate}
                            onChange={(date) => setTerminationDate(date)}
                            minDate={contract.start_date ? new Date(contract.start_date) : undefined}
                            sx={{ width: '100%', mt: 1 }}
                        />
                        <FormControl component="fieldset" sx={{ mt: 2 }}>
                            <FormLabel component="legend">管理费计算规则</FormLabel>
                            <RadioGroup
                                row
                                value={chargeOnTerminationDate}
                                onChange={(e) => setChargeOnTerminationDate(e.target.value === 'true')}
                            >
                                <FormControlLabel value={true} control={<Radio />} label="收取终止日当天管理费" />
                                <FormControlLabel value={false} control={<Radio />} label="不收取当天管理费" />
                            </RadioGroup>
                        </FormControl>
                        {/* --- 新增：转签开关 --- */}
                        <FormControlLabel
                            control={<Switch checked={isTransfer} onChange={(e) => setIsTransfer(e.target.checked)} />}
                            label="是否为转签新合同？（将当前合同的替班费用转移到新合同）"
                            sx={{ mt: 2 }}
                        />
                        {/* --- 新增：转签选项的条件渲染 --- */}
                        {isTransfer && (
                            <Box sx={{ mt: 2, border: '1px dashed grey', p: 2, borderRadius: 1 }}>
                                <FormControl component="fieldset" sx={{ mb: 2 }}>
                                    <FormLabel component="legend">筛选目标合同方式</FormLabel>
                                    <RadioGroup row value={filterMethod} onChange={(e) => setFilterMethod(e.target.value)}>
                                        <FormControlLabel value="employee" control={<Radio />} label="按替班员工" />
                                        <FormControlLabel value="customer" control={<Radio />} label="按客户" />
                                    </RadioGroup>
                                </FormControl>

                                {loadingTransferOptions ? <CircularProgress size={24} /> : (
                                    <Stack spacing={2}>
                                        {filterMethod === 'employee' && (
                                            <TextField
                                                select
                                                fullWidth
                                                label="选择替班员工"
                                                value={selectedSubstituteUserId}
                                                onChange={(e) => setSelectedSubstituteUserId(e.target.value)}
                                                helperText={substitutes.length === 0 ? "此合同无替班记录" : "选择要转正的员工"}
                                                disabled={substitutes.length === 0}
                                            >
                                                {substitutes.map(sub => (
                                                    <MenuItem key={sub.substitute_user_id} value={sub.substitute_user_id}>
                                                        {sub.substitute_user_name}
                                                    </MenuItem>
                                                ))}
                                            </TextField>
                                        )}
                                        <TextField
                                            select
                                            fullWidth
                                            label="选择要转入的新合同"
                                            value={selectedNewContractId}
                                            onChange={(e) => setSelectedNewContractId(e.target.value)}
                                            helperText={eligibleContracts.length === 0 ? "未找到符合条件的生效合同" : ""}
                                            disabled={(filterMethod === 'employee' && !selectedSubstituteUserId) || eligibleContracts.length === 0}
                                        >
                                            {eligibleContracts.map(c => (
                                                <MenuItem key={c.id} value={c.id}>
                                                    {`合同: ${c.employee_name} (${formatDate(c.start_date)} - ${formatDate(c.end_date)})`}
                                                </MenuItem>
                                            ))}
                                        </TextField>
                                    </Stack>
                                )}
                            </Box>
                        )}
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
                        billId={selectedBillDetails?.customer_bill_details?.id}
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
                <Dialog open={onboardingDialogOpen} onClose={handleCloseOnboardingDialog}>
                    <DialogTitle>设置实际上户日期</DialogTitle>
                    <DialogContent>
                        <Alert severity="info" sx={{ mt: 1, mb: 2 }}>
                            为月嫂合同 <b>{contractToSetDate?.customer_name}({contractToSetDate?.employee_name})</b> 设置实际上户日期。
                            <br />
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
                                    setAlert({ open: true, message: '错误：未能在当前合同下找到对应的账单。', severity: 'error' });
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
                                <br />
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
                <TrialConversionDialog {...conversionActions} />
                <SigningMessageModal
                    open={signingModalOpen}
                    onClose={() => setSigningModalOpen(false)}
                    title={signingModalTitle}
                    initialMessage={signingMessage}
                />
                <Dialog open={isRenewModalOpen} onClose={() => setIsRenewModalOpen(false)}>
                    <DialogTitle>续约合同</DialogTitle>
                    <DialogContent>
                        <DatePicker
                            label="新合同开始日期"
                            value={renewalData.start_date}
                            onChange={(date) => setRenewalData({ ...renewalData, start_date: date })}
                            sx={{ width: '100%', mt: 2 }}
                        />
                        <DatePicker
                            label="新合同结束日期"
                            value={renewalData.end_date}
                            onChange={(date) => setRenewalData({ ...renewalData, end_date: date })}
                            sx={{ width: '100%', mt: 2 }}
                        />
                        <TextField
                            label="员工级别/月薪"
                            type="number"
                            fullWidth
                            margin="normal"
                            value={renewalData.employee_level}
                            onChange={(e) => setRenewalData({ ...renewalData, employee_level: e.target.value })}
                        />
                        <TextField
                            label="管理费率"
                            type="number"
                            fullWidth
                            margin="normal"
                            value={renewalData.management_fee_rate * 100} // Display as percentage
                            onChange={(e) => {
                                const rawValue = e.target.value;
                                // 允许清空输入框，否则转换为小数
                                const decimalValue = rawValue === '' ? '' : parseFloat(rawValue) / 100;
                                setRenewalData({ ...renewalData, management_fee_rate: decimalValue });
                            }}
                            onWheel={(e) => e.target.blur()} // 禁用鼠标滚动
                            InputProps={{
                                endAdornment: <InputAdornment position="end">%</InputAdornment>,
                            }}
                            helperText="输入百分比，例如 10 代表 10%"
                        />
                        <TextField
                            label="管理费金额"
                            type="number"
                            fullWidth
                            margin="normal"
                            value={renewalData.management_fee_amount}
                            onChange={(e) => setRenewalData({ ...renewalData, management_fee_amount: e.target.value })}
                            helperText={renewalData.management_fee_rate > 0 ? `根据 ${renewalData.management_fee_rate * 100}% 的费率自动计算` : ''}
                        />

                        {/* --- 新增：月嫂续约显示预计客交保证金 --- */}
                        {contract?.contract_type_value === 'maternity_nurse' && (
                            <TextField
                                label="预计客交保证金 (自动计算)"
                                value={
                                    (parseFloat(renewalData.employee_level || 0) + parseFloat(renewalData.management_fee_amount || 0)).toFixed(2)
                                }
                                fullWidth
                                margin="normal"
                                InputProps={{
                                    readOnly: true,
                                    startAdornment: <InputAdornment position="start">¥</InputAdornment>,
                                }}
                                helperText="月嫂合同：保证金 = 员工级别 + 管理费"
                                variant="filled"
                            />
                        )}
                        {/* --- 新增结束 --- */}

                        {/* --- 新增开关 --- */}
                        <FormControlLabel
                            control={
                                <Switch
                                    checked={renewalData.transfer_deposit}
                                    onChange={(e) => setRenewalData({ ...renewalData, transfer_deposit: e.target.checked })}
                                    name="transfer_deposit"
                                />
                            }
                            label="是否转移保证金"
                            sx={{ mt: 2, display: 'block' }}
                        />
                        <Typography variant="caption" color="text.secondary">如果不转移，旧合同的保证金将按终止流程处理（通常为退款），新合同则需支付新的保证金。</Typography>

                        {/* --- 新增：是否需要客户签署 --- */}
                        <FormControl fullWidth required sx={{ mt: 2 }}>
                            <InputLabel>是否需要客户签署</InputLabel>
                            <Select
                                value={renewalData.requires_signature ?? ''}
                                onChange={(e) => setRenewalData({ ...renewalData, requires_signature: e.target.value === 'true' })}
                                label="是否需要客户签署"
                            >
                                <MenuItem value="">
                                    <em>请选择</em>
                                </MenuItem>
                                <MenuItem value="true">是</MenuItem>
                                <MenuItem value="false">否</MenuItem>
                            </Select>
                        </FormControl>
                        {/* --- 新增结束 --- */}
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setIsRenewModalOpen(false)}>取消</Button>
                        <Button onClick={handleRenewContract} variant="contained">确认续约</Button>
                    </DialogActions>
                </Dialog>
                {/* --- Change Contract Modal --- */}
                <Dialog open={isChangeModalOpen} onClose={handleCloseChangeModal} maxWidth="sm" fullWidth>
                    <DialogTitle>变更合同</DialogTitle>
                    <DialogContent>
                        <Autocomplete
                            options={personnelOptions}
                            filterOptions={(x) => x} // <-- 新增的行
                            getOptionLabel={(option) => `${option.name} (${option.phone})`}
                            renderInput={(params) => (
                                <TextField
                                    {...params}
                                    label="选择新服务人员"
                                    variant="outlined"
                                    onChange={(e) => setPersonnelSearchTerm(e.target.value)}
                                    helperText="输入姓名或手机号搜索"
                                />
                            )}
                            value={personnelOptions.find(p => p.id === changeData.service_personnel_id) || null}
                            onChange={(event, newValue) => {
                                setChangeData({ ...changeData, service_personnel_id: newValue ? newValue.id : '' });
                            }}
                            sx={{ mt: 2 }}
                        />
                        <DatePicker
                            label="新合同开始日期"
                            value={changeData.start_date}
                            onChange={(date) => setChangeData({ ...changeData, start_date: date })}
                            sx={{ width: '100%', mt: 2 }}
                        />
                        <DatePicker
                            label="新合同结束日期"
                            value={changeData.end_date}
                            onChange={(date) => setChangeData({ ...changeData, end_date: date })}
                            sx={{ width: '100%', mt: 2 }}
                        />
                        <TextField
                            label="新员工级别/月薪"
                            type="number"
                            fullWidth
                            margin="normal"
                            value={changeData.employee_level}
                            onChange={(e) => setChangeData({ ...changeData, employee_level: e.target.value })}
                        />
                        <TextField
                            label="新管理费率"
                            type="number"
                            fullWidth
                            margin="normal"
                            value={changeData.management_fee_rate * 100}
                            onChange={(e) => {
                                const rawValue = e.target.value;
                                const decimalValue = rawValue === '' ? '' : parseFloat(rawValue) / 100;
                                setChangeData({ ...changeData, management_fee_rate: decimalValue });
                            }}
                            onWheel={(e) => e.target.blur()}
                            InputProps={{
                                endAdornment: <InputAdornment position="end">%</InputAdornment>,
                            }}
                            helperText="输入百分比，例如 10 代表 10%"
                        />
                        <TextField
                            label="管理费金额"
                            type="number"
                            fullWidth
                            margin="normal"
                            value={changeData.management_fee_amount}
                            onChange={(e) => setChangeData({ ...changeData, management_fee_amount: e.target.value })}
                            helperText={changeData.management_fee_rate > 0 ? `根据 ${changeData.management_fee_rate * 100}% 的费率自动计算` : ''}
                        />
                        {/* --- 新增开关 --- */}
                        <FormControlLabel
                            control={
                                <Switch
                                    checked={changeData.transfer_deposit}
                                    onChange={(e) => setChangeData({ ...changeData, transfer_deposit: e.target.checked })}
                                    name="transfer_deposit"
                                />
                            }
                            label="是否转移保证金"
                            sx={{ mt: 2, display: 'block' }}
                        />
                        <Typography variant="caption" color="text.secondary">如果不转移，旧合同的保证金将按终止流程处理（通常为退款），新合同则需支付新的保证金。</Typography>

                        {/* --- 新增：是否需要客户签署 --- */}
                        <FormControl fullWidth required sx={{ mt: 2 }}>
                            <InputLabel>是否需要客户签署</InputLabel>
                            <Select
                                value={changeData.requires_signature ?? ''}
                                onChange={(e) => setChangeData({ ...changeData, requires_signature: e.target.value === 'true' })}
                                label="是否需要客户签署"
                            >
                                <MenuItem value="">
                                    <em>请选择</em>
                                </MenuItem>
                                <MenuItem value="true">是</MenuItem>
                                <MenuItem value="false">否</MenuItem>
                            </Select>
                        </FormControl>
                        {/* --- 新增结束 --- */}
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={handleCloseChangeModal}>取消</Button>
                        <Button onClick={handleConfirmChange} variant="contained" disabled={loading}>
                            {loading ? <CircularProgress size={24} /> : '确认变更'}
                        </Button>
                    </DialogActions>
                </Dialog>
                {/* --- 新增：渲染编辑弹窗 --- */}
                <EditContractModal
                    open={isEditModalOpen}
                    onClose={() => setIsEditModalOpen(false)}
                    contractId={contractId}
                    onSuccess={() => {
                        setIsEditModalOpen(false);
                        setAlert({ open: true, message: '合同已成功更新！', severity: 'success' });
                        fetchData(); // 重新加载详情页数据
                    }}
                />
            </Box>
        </LocalizationProvider>
    );
};

export default ContractDetail;