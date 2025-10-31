// frontend/src/components/FinancialManagementModal.jsx (最终重构版)

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Button, Typography, Paper, Grid, Dialog, DialogTitle, DialogContent, 
  DialogActions, Divider, CircularProgress, Tooltip, IconButton, List, ListItem, 
  ListItemIcon, ListItemText, ListItemSecondaryAction, Alert, Switch, TextField, 
  FormControlLabel, Chip, TableContainer, Table, TableHead, TableRow, TableCell, TableBody, TableFooter
} from '@mui/material';
import {
    Edit as EditIcon, Save as SaveIcon, Close as CloseIcon, Cancel as CancelIcon, 
    Add as AddIcon, Remove as RemoveIcon, Info as InfoIcon, Delete as DeleteIcon,
    ArrowUpward as ArrowUpwardIcon, ArrowDownward as ArrowDownwardIcon,
    ReceiptLong as ReceiptLongIcon, History as HistoryIcon,
    EditCalendar as EditCalendarIcon,
    CheckCircle as CheckCircleIcon, HighlightOff as HighlightOffIcon,
    ArticleOutlined as ArticleOutlinedIcon,
    Link as LinkIcon,
    Lock as LockIcon, // <-- 添加图标
    ArrowBackIosNew as ArrowBackIosNewIcon,
    ArrowForwardIos as ArrowForwardIosIcon
} from '@mui/icons-material';import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { Timeline } from '@mui/lab';

import api from '../api/axios'; 
import { mergeBills } from '../api/bill_merge';
import AdjustmentDialog, { AdjustmentTypes } from './AdjustmentDialog';
import InvoiceDetailsDialog from './InvoiceDetailsDialog';
import LogItem from './LogItem';
import { CallMerge as CallMergeIcon, PeopleAlt as PeopleAltIcon } from '@mui/icons-material';
import SubstituteDialog from './SubstituteDialog';
import TransferDepositDialog from './TransferDepositDialog';
import PaymentDialog from './PaymentDialog';
import AlertMessage from './AlertMessage';
import PayoutDialog from './PayoutDialog';
import PaymentMessageModal from './PaymentMessageModal';
import MergePreviewModal from './MergePreviewModal'; // 新增导入


// --- 辅助函数 ---
const formatDateForAPI = (date) => {
    if (!date) return null;
    const d = new Date(date);
    if (isNaN(d.getTime())) return null;

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
};

const formatDateRange = (dateRangeString) => {
    if (!dateRangeString || !dateRangeString.includes('~')) return '—';
    const [startStr, endStr] = dateRangeString.split('~').map(d => d.trim());
    if (startStr === 'N/A' || endStr === 'N/A') return '—';
    try {
        const startDate = new Date(startStr);
        const endDate = new Date(endStr);
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return '无效日期';
        // 计算天数：结束日 - 开始日
        const diffDays = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        const format = (date) => date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }).replace('/', '-');
        return `${format(startDate)} ~ ${format(endDate)} (${diffDays}天)`;
    } catch (e) { return '无效日期范围'; }
};

const formatDateTimeRange = (startStr, endStr) => {
    if (!startStr || !endStr) return '—';
    try {
        const startDate = new Date(startStr);
        const endDate = new Date(endStr);
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return '无效日期';

        // console.log("DEBUG: startStr:", startStr, "startDate:", startDate);
        // console.log("DEBUG: endStr:", endStr, "endDate:", endDate);
        // console.log("DEBUG: startDate.getHours():", startDate.getHours(),"startDate.getMinutes():", startDate.getMinutes());
        // console.log("DEBUG: endDate.getHours():", endDate.getHours(), "endDate.getMinutes():",endDate.getMinutes());

        // 检查开始和结束时间是否都为午夜 (00:00:00)，以此判断是否为旧数据
        const isOldData = startStr.includes('T00:00:00') && endStr.includes('T00:00:00');

        // console.log("DEBUG: isOldData:", isOldData);

        const formatDateOnly = (date) => date.toLocaleDateString('zh-CN', { year: 'numeric', month:'2-digit', day: '2-digit' }).replace(/\//g, '-');
        const formatDateTime = (date) => date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute:'2-digit', hour12: false }).replace(/\//g, '-');
        if (isOldData) {
            // 如果是旧数据，只显示日期
            return `${formatDateOnly(startDate)} ~ ${formatDateOnly(endDate)}`;
        } else {
            // 如果是新数据，显示日期和时间
            return `${formatDateTime(startDate)} ~ ${formatDateTime(endDate)}`;
        }
    } catch (e) {
        console.error("Error in formatDateTimeRange:", e);
        return '无效日期范围';
    }
};            

const formatDate = (dateString) => {
    if (!dateString || dateString.includes('N/A')) return '—';
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return '无效日期';
        return date.toLocaleDateString('zh-CN', {  month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
    } catch (e) {
        return '无效日期';
    }
};


const formatValue = (key, value, calculationDetails) => { // 添加 calculationDetails 参数
    if (value === null || value === undefined || value === '' || String(value).includes('待计算'))
        return <Box component="span" sx={{ color: 'text.disabled' }}>{value || '—'}</Box>;

    // Handle '劳务时间段' specifically
    if (key === '劳务时间段') {
        // 使用 calculationDetails 中新的精确日期时间字段（如果可用）
        if (calculationDetails?.cycle_start_datetime && calculationDetails?.cycle_end_datetime) {
            return formatDateTimeRange(calculationDetails.cycle_start_datetime,calculationDetails.cycle_end_datetime);
        }
        // 如果新字段不可用，则回退到原始值
        if (!value || !value.includes(' to ')) return String(value);
        const [startStr, endStr] = value.split(' to ').map(d => d.trim());
        return formatDateTimeRange(startStr, endStr);
    }

    if (key === '加班天数' || key === '替班天数' || key === '基本劳务天数' || key ==='实际劳务天数' || key === '总劳务天数') {
        const num = parseFloat(value);
        return isNaN(num) ? `${value} 天` : `${num.toFixed(3)} 天`;
    }
    if (key.includes('费率')) {
        const num = Number(value);
        return isNaN(num) ? String(value) : `${(num * 100).toFixed(0)}%`;
    }
    const isMoney = !key.includes('天数') && !key.includes('费率');
    if (isMoney && /^-?\d+(\.\d+)?$/.test(String(value))) {
        const num = Number(value);
        return isNaN(num) ? String(value) : `¥${num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return String(value);
};

const getTooltipContent = (fieldName, billingDetails, isCustomer, adjustment = null) => {
    // --- 新增：优先处理来自 adjustment 的 tooltip ---
    if (adjustment) {
        // 检查描述中是否包含括号括起来的计算过程
        const calculationMatch = adjustment.description.match(/\((.*)\)/);
        if (calculationMatch) {
            const calculationText = calculationMatch[1];
            return (
                <Box sx={{ p: 1, maxWidth: 350 }}>
                    <Typography variant="caption" sx={{ fontWeight: 'bold', color:'common.white', display: 'block', mb: 1 }}>
                        计算过程
                    </Typography>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', color:'grey.200', whiteSpace: 'pre-wrap', wordBreak:'break-all' }}>
                        {adjustment.description}
                    </Typography>
                </Box>
            );
        }
    }
    // --- 新增结束 ---

    // 如果没有传入 adjustment，或者 adjustment 中没有计算过程，则执行原有的逻辑
    const details = isCustomer ? billingDetails?.customer_bill_details : billingDetails?.employee_payroll_details;
    const calc = details?.calculation_details;

    if (!calc || (!calc.calculation_log && !calc.log_extras)) {
        return null;
    }

    const fieldToLogKeyMap = {
        '基础劳务费': '基础劳务费',
        '试工费': '试工费',
        '加班费': '加班费',
        '延长服务天数': 'extension_days_reason',
        '延长期服务费': 'extension_fee_reason',
        '延长期管理费': 'extension_manage_fee_reason',
        '本次交管理费': 'management_fee_reason',
        '被替班费用': '被替班扣款',
        '客应付款': '客应付款',
        '萌嫂保证金(工资)': '员工工资',
        '5%奖励': '5%奖励',
        '萌嫂应领款': '萌嫂应领款',
        '首月员工10%费用': '首月员工10%费用',
        '加班工资': '加班费',
        '实际劳务天数': 'base_work_days_reason',
        '应发总额': '员工应发总额(Gross)',
    };

    const logKey = fieldToLogKeyMap[fieldName];
    if (!logKey) return null;

    const logSource = calc.calculation_log || {};
    const logExtrasSource = calc.log_extras || {};
    const logMessage = logExtrasSource[logKey] || logSource[logKey];

    if (!logMessage) return null;

    return (
        <Box sx={{ p: 1, maxWidth: 350 }}>
            <Typography variant="caption" sx={{ fontWeight: 'bold', color: 'common.white',display: 'block', mb: 1 }}>
                计算过程
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'grey.200',whiteSpace: 'pre-wrap', wordBreak:'break-all' }}>
                {logMessage}
            </Typography>
        </Box>
    );
};


// --- 主组件 ---
const FinancialManagementModal = ({ open, onClose, contract, billingMonth, billingDetails: initialBillingDetails, loading, onSave, onNavigateToBill }) => {
    // console.log("[DEBUG] FinancialManagementModal received contract prop:", contract);
    const [latestSavedData, setLatestSavedData] = useState(null);
    const navigate = useNavigate();
    const [isEditMode, setIsEditMode] = useState(false);
    const billIdRef = useRef(null);
    const [editableOvertime, setEditableOvertime] = useState(0);
    const [adjustments, setAdjustments] = useState([]);
    const [editableInvoice, setEditableInvoice] = useState({ number: '', amount: '', date: null });
    const [isAdjustmentDialogOpen, setIsAdjustmentDialogOpen] = useState(false);
    const [editingAdjustment, setEditingAdjustment] = useState(null);
    const [adjustmentFilter, setAdjustmentFilter] = useState('all');
    const [activityLogs, setActivityLogs] = useState([]);
    const [loadingLogs, setLoadingLogs] = useState(false);
    const [isCycleEditDialogOpen, setIsCycleEditDialogOpen] = useState(false);
    const [editableCycle, setEditableCycle] = useState({ start: null, end: null });
    const [isSubstituteDialogOpen, setIsSubstituteDialogOpen] = useState(false);
    const [substituteRecords, setSubstituteRecords] = useState([]);
    const [editableActualWorkDays, setEditableActualWorkDays] = useState(26);
    
    // --- Gemini: New State Management ---
    const [currentBillingMonth, setCurrentBillingMonth] = useState(billingMonth);
    const [billingDetails, setBillingDetails] = useState(initialBillingDetails);
    const [isSwitchingMonth, setIsSwitchingMonth] = useState(false);
    const [hasPrevBill, setHasPrevBill] = useState(false);
    const [hasNextBill, setHasNextBill] = useState(false);
    // --- End of New State ---

    const [isExtensionDialogOpen, setIsExtensionDialogOpen] = useState(false);
    const [extensionDate, setExtensionDate] = useState(null);
    const [isInvoiceNeeded, setIsInvoiceNeeded] = useState(false);
    const [editableInvoices, setEditableInvoices] = useState([]);
    const [isInvoiceDialogOpen, setIsInvoiceDialogOpen] = useState(false);
    const [isTransferDialogOpen, setIsTransferDialogOpen] = useState(false);
    const [transferringAdjustment, setTransferringAdjustment] = useState(null);
    const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
    const [alert, setAlert] = useState({ open: false, message: '', severity: 'info' });
    const [isPayoutDialogOpen, setIsPayoutDialogOpen] = useState(false);

    const [isMessageModalOpen, setIsMessageModalOpen] = useState(false);
    const [generatedMessage, setGeneratedMessage] = useState('');
    const [isGeneratingMessage, setIsGeneratingMessage] = useState(false);

    const [isTransferBalanceDialogOpen, setIsTransferBalanceDialogOpen] = useState(false);
    const [deletionHappened, setDeletionHappened] = useState(false);
    const [successorContract, setSuccessorContract] = useState(null);
    const [isMergePreviewOpen, setIsMergePreviewOpen] = useState(false);
    const [isProcessingSuccessorAction, setIsProcessingSuccessorAction] = useState(false);
    const [mergePreviewData, setMergePreviewData] = useState(null);
    const [previewDataForModal, setPreviewDataForModal] = useState({ transferableAdjustments: [], sourceContractInfo: null, targetContractInfo: null });

    const handleOpenMergePreview = async () => {
        if (!billingDetails?.customer_bill_details?.id || !successorContract?.id) {
            setAlert({ open: true, message: '缺少源账单ID或续约合同ID，无法获取预览。', severity:'error' });
            return;
        }

        setIsProcessingSuccessorAction(true);
        setMergePreviewData(null); // 清空旧数据
        try {
            // 调用新的 bill_merge API
            const response = await mergeBills(billingDetails.customer_bill_details.id,successorContract.id, true);
            setMergePreviewData(response.data);
            setIsMergePreviewOpen(true);
        } catch (error) {
            setAlert({
                open: true,
                message: `获取合并预览失败: ${error.response?.data?.message || error.message}`,
                severity: 'error'
            });
        } finally {
            setIsProcessingSuccessorAction(false);
        }
    };

    const handlePostMergeRefresh = async () => {
        const billId = billIdRef.current;
        if (!billId) {
            setAlert({ open: true, message: '刷新失败，缺少账单ID', severity: 'error' });
            return;
        }

        setIsMergePreviewOpen(false);
        setAlert({ open: true, message: '合并操作成功！正在刷新数据...', severity: 'success' });

        try {
            const detailsResponse = await api.get('/billing/details', {
                params: { bill_id: billId }
            });
            setBillingDetails(detailsResponse.data);
            // 刷新后，也重置续约合同状态，因为源账单不再是 is_last_bill
            setSuccessorContract(null);
        } catch (error) {
            setAlert({
                open: true,
                message: `刷新数据失败: ${error.response?.data?.error || error.message}`,
                severity: 'error'
            });
        }
    };

    const handleConfirmTransferBalance = async (transferData) => {
        const { destinationType, destinationId } = transferData;
        const billId = billingDetails?.customer_bill_details?.id;
        if (!billId) {
            setAlert({ open: true, message: '无法操作，缺少账单ID', severity: 'error' });
            return;
        }
        try {
            const payload = destinationType === 'bill'
                ? { destination_bill_id: destinationId }
                : { destination_contract_id: destinationId };

            const response = await api.post(
                `/billing/bills/${billId}/transfer-balance`,
                payload
            );
            setAlert({ open: true, message: '余额结转成功！', severity: 'success' });
            setIsTransferBalanceDialogOpen(false);
            // Refresh the data
            if (response.data.latest_details) {
                setBillingDetails(response.data.latest_details);
            } else {
                // Or refetch
                const freshDetails = await api.get('/billing/details', { params: { bill_id: billId } });
                setBillingDetails(freshDetails.data);
            }
        } catch (error) {
            console.error("余额结转失败:", error);
            setAlert({ open: true, message: `操作失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        }
    };

    useEffect(() => {
        setCurrentBillingMonth(billingMonth);
        setBillingDetails(initialBillingDetails);
    }, [billingMonth, initialBillingDetails]);

    useEffect(() => {
        if (open && billingDetails) {
            const newBillId = billingDetails.customer_bill_details?.id;

            // 仅当账单ID实际发生变化时（例如切换月份），才重置编辑模式
            if (newBillId !== billIdRef.current) {
                setIsEditMode(false);
                billIdRef.current = newBillId;
            }

            // Set navigation boundaries
            setHasPrevBill(billingDetails.has_prev_bill || false);
            setHasNextBill(billingDetails.has_next_bill || false);

            const customerDetails = billingDetails.customer_bill_details || {};
            const employeeDetails = billingDetails.employee_payroll_details || {};
            
            setEditableOvertime(parseFloat(billingDetails.attendance?.overtime_days) || 0);
            
            setAdjustments(billingDetails.adjustments || []);

            const actualDaysFromBill = customerDetails.actual_work_days;
            const baseDaysFromCalc = customerDetails.calculation_details?.base_work_days;
            if (actualDaysFromBill !== null && actualDaysFromBill !== undefined) {
                setEditableActualWorkDays(parseFloat(actualDaysFromBill));
            } else if (baseDaysFromCalc !== null && baseDaysFromCalc !== undefined) {
                setEditableActualWorkDays(parseFloat(baseDaysFromCalc));
            } else {
                setEditableActualWorkDays(26);
            }

            setEditableInvoices(billingDetails.invoice_balance?.invoice_records || []);

            if (customerDetails.id || employeeDetails.id) {
                setLoadingLogs(true);
                api.get('/billing/logs', { params: { bill_id: customerDetails.id, payroll_id: employeeDetails.id } })
                    .then(res => setActivityLogs(res.data))
                    .catch(err => console.error("获取日志失败:", err))
                    .finally(() => setLoadingLogs(false));
            }
            if (contract?.contract_id) {
                api.get(`/contracts/${contract.contract_id}/substitutes`)
                    .then(res => setSubstituteRecords(res.data))
                    .catch(err => console.error("获取替班记录失败:", err));

                // --- 新增逻辑 ---
                if (billingDetails.is_last_bill) {
                    api.get(`/contracts/${contract.contract_id}/successor`)
                        .then(res => {
                            if (res.status === 200) {
                                setSuccessorContract(res.data);
                            } else {
                                setSuccessorContract(null);
                            }
                        })
                        .catch(() => setSuccessorContract(null));
                } else {
                    setSuccessorContract(null);
                }
                // --- 新增结束 ---
            }
        }
    }, [open, billingDetails, contract?.contract_id]);

    const handleGenerateSingleMessage = async () => {
        const billId = billingDetails?.customer_bill_details?.id;
        if (!billId) {
            setAlert({ open: true, message: '无法生成消息，缺少账单ID', severity: 'error' });
            return;
        }
        setIsGeneratingMessage(true);
        try {
            const response = await api.post('/billing/generate_payment_message', {
                bill_ids: [billId],
            });
            setGeneratedMessage(response.data);
            setIsMessageModalOpen(true);
        } catch (error) {
            console.error("生成催款消息失败:", error);
            setAlert({ open: true, message: `生成消息失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        } finally {
            setIsGeneratingMessage(false);
        }
    };

    // --- Gemini: New Month Change Handler ---
    const handleMonthChange = async (direction) => {
        if (!currentBillingMonth || !contract?.contract_id) return;

        setIsSwitchingMonth(true);
        setAlert({ open: false, message: '', severity: 'info' });

        const [year, month] = currentBillingMonth.split('-').map(Number);
        const currentDate = new Date(year, month - 1, 1);

        if (direction === 'prev') {
            currentDate.setMonth(currentDate.getMonth() - 1);
        } else {
            currentDate.setMonth(currentDate.getMonth() + 1);
        }

        const newYear = currentDate.getFullYear();
        const newMonth = String(currentDate.getMonth() + 1).padStart(2, '0');
        const newBillingMonth = `${newYear}-${newMonth}`;

        try {
            const response = await api.get('/billing/details', {
                params: {
                    contract_id: contract.contract_id,
                    month: newBillingMonth,
                }
            });
            setBillingDetails(response.data);
            setCurrentBillingMonth(newBillingMonth);
        } catch (error) {
            console.error(`获取 ${newBillingMonth} 账单失败:`, error);
            setAlert({ open: true, message: `无法加载 ${newBillingMonth} 的账单数据。`, severity: 'error' });
        } finally {
            setIsSwitchingMonth(false);
        }
    };
    // --- End of New Handler ---

    const handleOpenSubstituteDialog = () => {
        setIsSubstituteDialogOpen(true);
    }

    const handleCloseSubstituteDialog = () => {
        setIsSubstituteDialogOpen(false);
    };

    const handleSaveSubstitute = async (substituteData) => {
        try {
            // Add originalBillId to substituteData
            const payload = {
                ...substituteData,
                original_bill_id: billingDetails?.customer_bill_details?.id,
            };
            const response = await api.post(`/contracts/${contract.contract_id}/substitutes`,payload);

            // 不要用 alert()，要用 setAlert() 来触发你自己的提示组件
            setAlert({ open: true, message: '替班记录添加成功！', severity: 'success' });

            // 只要用后端返回的最新账单详情更新状态即可
            if (response.data.latest_details) {
                setBillingDetails(response.data.latest_details);
            }

            // 【修复】保存成功后，立即刷新替班记录列表，确保即时显示
            if (contract?.contract_id) {
                api.get(`/contracts/${contract.contract_id}/substitutes`)
                    .then(res => setSubstituteRecords(res.data))
                    .catch(err => console.error("获取替班记录失败:", err));
            }

            handleCloseSubstituteDialog();
        } catch (error) {
            console.error("保存替班记录失败:", error);
            // 错误提示同样要用 setAlert
            setAlert({ open: true, message:'添加替班记录失败，同一时间段可能已有替班记录，不能重复添加。', severity: 'error'});
        }
    };
    const handleDeleteSubstitute = async (recordId) => {
        if (window.confirm("确定要删除这条替班记录吗？相关账单将重新计算。")) {
            try {
                // 正常尝试删除
                await api.delete(`/contracts/substitutes/${recordId}`);
                
                // 如果上面没有抛出错误（即 status 2xx），则代表成功
                setAlert({ open: true, message: '替班记录删除成功！', severity: 'success' });
                setSubstituteRecords(prev => prev.filter(r => r.id !== recordId));
                // 可以在这里触发账单刷新逻辑
                
            } catch (error) {
                // 专门处理 409 Conflict 错误
                if (error.response && error.response.status === 409) {
                    if (window.confirm("注意：此替班记录关联的账单已产生操作日志。\\n\\n是否要强制删除此记录及其所有关联日志？此操作不可逆！")) {
                        try {
                            // 发送带 force=true 参数的强制删除请求
                            await api.delete(`/contracts/substitutes/${recordId}?force=true`);
                            setAlert({ open: true, message: '强制删除成功！', severity: 'success' });
                            setSubstituteRecords(prev => prev.filter(r => r.id !== recordId));
                            // 可以在这里也触发账单刷新逻辑
                        } catch (forceError) {
                            setAlert({ open: true, message: `强制删除失败: ${forceError.response?.data?.message || '未知错误'}`, severity: 'error' });
                        }
                    }
                } else {
                    // 处理其他所有错误 (如 500, 网络问题等)
                    setAlert({ open: true, message: `删除失败: ${error.response?.data?.message || error.message}`, severity: 'error' });
                }
            }
        }
    };

    const handleOpenPaymentDialog = () => setIsPaymentDialogOpen(true);
    const handleClosePaymentDialog = () => setIsPaymentDialogOpen(false);

    const handleRecordSaveSuccess = async (paymentData) => {
        // 这个函数在支付/发放记录成功保存后被调用，只负责刷新数据和关闭弹窗
        try {
            const billId = billingDetails?.customer_bill_details?.id;
            if (!billId) {
                console.error("无法刷新：缺少账单ID。");
                return;
            }

            handleClosePaymentDialog();
            handleClosePayoutDialog();

            const response = await api.get('/billing/details', { params: { bill_id:billId } });
            setBillingDetails(response.data);
            setAlert({ open: true, message: '记录已成功保存！', severity: 'success' });

        } catch (error) {
            setAlert({ open: true, message: `刷新数据失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        }
    };

    const handleOpenPayoutDialog = () => setIsPayoutDialogOpen(true);
    const handleClosePayoutDialog = () => setIsPayoutDialogOpen(false);

    const handleSavePayout = async (payoutData) => {
        try {
            const payrollId = billingDetails?.employee_payroll_details?.id;
            const billId = billingDetails?.customer_bill_details?.id;
            if (!payrollId || !billId) {
                alert('错误：缺少薪酬单ID。');
                return;
            }
            await api.post(`/billing/payrolls/${payrollId}/payouts`, payoutData);
            setAlert({ open: true, message: '工资发放记录添加成功!', severity: 'success' });
            handleClosePayoutDialog();

            // 重新获取最新的账单详情以刷新界面
            const response = await api.get('/billing/details', { params: { bill_id: billId } });
            setBillingDetails(response.data);

        } catch (error) {
            setAlert({ open: true, message: `添加失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        }
    };

    const handleDeletePayment = async (paymentId) => {
        if (window.confirm("确定要删除这笔收款记录吗？此操作将同步更新关联银行流水的已分配额度。")) {
            try {
                // 核心修正：调用新的、正确的后端端点
                await api.delete(`/payment-records/${paymentId}`);
                setAlert({ open: true, message: '收款记录已删除，关联流水已更新', severity: 'success' });

                // 刷新账单详情以显示最新状态
                const response = await api.get('/billing/details', { params: { bill_id: billingDetails.customer_bill_details.id } });
                setBillingDetails(response.data);

                // 新增：调用 onSave 回调函数通知父组件刷新
                if (onSave) {
                    onSave();
                }
            } catch (error) {
                setAlert({ open: true, message: `删除失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
            }
        }
    };

    const handleDeletePayout = async (payoutId) => {
        if (window.confirm("确定要删除这笔工资发放记录吗？")) {
            try {
                await api.delete(`/billing/payouts/${payoutId}`);
                setAlert({ open: true, message: '工资发放记录已删除', severity: 'success' });
                const response = await api.get('/billing/details', { params: { bill_id: billingDetails.customer_bill_details.id } });
                setBillingDetails(response.data);
            } catch (error) {
                setAlert({ open: true, message: `删除失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
            }
        }
    };

    const handleSave = () => {
        const billId = billingDetails?.customer_bill_details?.id;
        if (!billId) {
            alert("无法保存，缺少关键的账单ID。");
            return;
        }
        // console.log("--- [DEBUG 3] Final payload to be sent. Adjustments are:", adjustments);

        const payload = {
            bill_id: billId,
            overtime_days: editableOvertime,
            actual_work_days: editableActualWorkDays,
            adjustments: adjustments, // <-- 使用净化后的数据
            // settlement_status: editableSettlement,
            invoices: editableInvoices,
            invoice_needed: billingDetails.invoice_needed,
            was_deletion: deletionHappened,
        };

        onSave(payload);
        setIsEditMode(false);
        setDeletionHappened(false);
    };

    const handleEnterEditMode = () => {
        setIsEditMode(true);
        setDeletionHappened(false);
    };

    const handleCancelEdit = () => {
        if (billingDetails) {
            const customerDetails = billingDetails.customer_bill_details || {};
            const employeeDetails = billingDetails.employee_payroll_details || {};
            const invoiceDetails = billingDetails.invoice_details || {};
            setEditableOvertime(parseFloat(billingDetails.attendance?.overtime_days) || 0);
            setAdjustments(billingDetails.adjustments || []);
            setEditableInvoice({
                number: invoiceDetails.number || '',
                amount: invoiceDetails.amount || '',
                date: invoiceDetails.date ? new Date(invoiceDetails.date) : null,
            });
            const customerPayment = customerDetails.payment_status || {};
            const employeePayment = employeeDetails.payment_status || {};
        }
        if (initialBillingDetails) {
            const effectiveNeeded = initialBillingDetails.invoice_balance?.auto_invoice_needed ||false;
            const updatedDetails = {
                ...initialBillingDetails,
                invoice_needed: effectiveNeeded
            };
            setBillingDetails(updatedDetails);
        }
        setIsEditMode(false);
        setDeletionHappened(false);
    };
    
    const handleSaveAdjustment = (savedAdj) => {
        console.log("--- [DEBUG 2] AdjustmentDialog saved. Data from dialog:", savedAdj);
        setAdjustments(prev => {
            const existing = prev.find(a => a.id === savedAdj.id);
            if (existing) return prev.map(a => a.id === savedAdj.id ? savedAdj : a);
            return [...prev, { ...savedAdj, id: `temp-${Date.now()}` }];
        });
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
    const handleDeleteAdjustment = (id) => {
        setAdjustments(prev => prev.filter(adj => adj.id !== id));
        setDeletionHappened(true);
    };
    const handleInvoiceNeededChange = async (event) => {
        const checked = event.target.checked;

        // 1. 乐观更新UI，让开关立即响应，提升体验
        setBillingDetails(prev => ({
            ...prev,
            invoice_needed: checked
        }));

        try {
            const billId = billingDetails.customer_bill_details.id;
            // 2. 调用我们新的、专属的API
            const response = await api.post(`/billing/bills/${billId}/set-invoice-needed`, {
                invoice_needed: checked
            });

            // 3. 用后端返回的权威数据，精确更新发票管理模块
            setBillingDetails(prev => ({
                ...prev,
                invoice_needed: response.data.invoice_needed,
                invoice_balance: response.data.invoice_balance
            }));

        } catch (error) {
            // 4. 如果API调用失败，把开关状态恢复到之前的值
            setBillingDetails(prev => ({
                ...prev,
                invoice_needed: !checked
            }));
            setAlert({ open: true, message: `保存失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        }
    };
    // const handleSettlementChange = (event) => {
    //     const { name, value, checked, type } = event.target;
    //     setEditableSettlement(prev => ({
    //         ...prev,
    //         [name]: type === 'checkbox' ? checked : value,
    //     }));
    // };
    // const handleDateChange = (name, newDate) => {
    //     setEditableSettlement(prev => ({ ...prev, [name]: newDate }));
    // };
    const handleOpenInvoiceDialog = () => setIsInvoiceDialogOpen(true);
    const handleCloseInvoiceDialog = () => setIsInvoiceDialogOpen(false);
    const handleSaveInvoice = (newInvoiceData) => setEditableInvoice(newInvoiceData);


    const handleCloseTransferDialog = () => {
        setTransferringAdjustment(null);
        setIsTransferDialogOpen(false);
    };
    
    const handleInitiateTransfer = async (adjustment, destinationContractId = null)=> {
        const adjToTransfer = adjustment || transferringAdjustment;
        if (!adjToTransfer) {
            console.error("无法转移，目标调整项丢失。");
            return;
        }

        try {
            const payload = destinationContractId ? { destination_contract_id:destinationContractId } : {};
            const response = await api.post(
                `/billing/financial-adjustments/${adjToTransfer.id}/transfer`,
                payload
            );
            setAlert({ open: true, message: '款项转移成功！', severity: 'success'});
            handleCloseTransferDialog();
            if (response.data.latest_details) {
                setBillingDetails(response.data.latest_details);
            }
        } catch (error) {
            // --- DEBUGGING START ---
            console.log("进入了 catch 块");
            const errorMessage = error.response?.data?.error ||'操作失败，请查看控制台。';
            console.log("收到的原始错误信息对象:", error.response?.data);
            console.log("解析后的 errorMessage 字符串:", errorMessage);

            const searchString = "未指定可供转移的目标合同";
            console.log("将要搜索的子字符串:", searchString);

            const isSignal = errorMessage.includes(searchString);
            console.log("判断条件 (errorMessage.includes(searchString)) 的结果是:",isSignal);
            // --- DEBUGGING END ---

            if (isSignal) {
                console.log("判断为“信号”，准备打开对话框...");
                setTransferringAdjustment(adjToTransfer);
                setIsTransferDialogOpen(true);
            } else {
                console.log("判断为“真实错误”，显示错误提示。");
                console.error("转移款项失败:", error);
                setAlert({ open: true, message: errorMessage, severity: 'error' });
                handleCloseTransferDialog();
            }
        }
    };
    const customerData = billingDetails?.customer_bill_details || {};
    const employeeData = billingDetails?.employee_payroll_details || {};

    const handleOpenCycleEditDialog = () => setIsCycleEditDialogOpen(true);
    const handleCloseCycleEditDialog = () => setIsCycleEditDialogOpen(false);
    const handleCycleDateChange = (name, newDate) => {
        setEditableCycle(prev => ({ ...prev, [name]: newDate }));
    };
    // 目标：在员工薪酬卡片中也显示“劳务周期”
    // 方法：从客户账单数据中找到“劳务周期”组，并将其添加到员工薪酬数据的组列表的开头。
    const laborCycleGroup = customerData?.groups?.find(g => g.name === '劳务周期');

    if (laborCycleGroup && employeeData?.groups) {
      // 检查是否已存在，防止重复添加
      if (!employeeData.groups.some(g => g.name === '劳务周期')) {
        employeeData.groups.unshift(laborCycleGroup);
      }
    }
    const handleSaveCycle = async () => {
        if (!editableCycle.start || !editableCycle.end) {
            alert("请提供完整的周期起止日期！");
            return;
        }
        try {
            const billId = billingDetails.customer_bill_details.id;
            await api.post(`/billing/bills/${billId}/update-cycle`, {
                new_start_date: editableCycle.start.toISOString().split('T')[0],
                new_end_date: editableCycle.end.toISOString().split('T')[0],
            });
            onClose(); 
            alert("周期已更新，后续账单已顺延！请在新的月份查看后续账单。");
        } catch (error) {
            console.error("更新周期失败:", error);
        } finally {
            handleCloseCycleEditDialog();
        }
    };

    const handleOpenExtensionDialog = () => {
        // 初始化日期为当前账单的结束日期
        setExtensionDate(billingDetails.cycle_end_date ? new Date(billingDetails.cycle_end_date) : null);
        setIsExtensionDialogOpen(true);
    };

    const handleCloseExtensionDialog = () => setIsExtensionDialogOpen(false);

    const handleConfirmExtension = async () => {
        if (!extensionDate) {
            setAlert({ open: true, message: '请选择延长至的日期！', severity:'warning' });
            return;
        }
        try {
            await api.post(`/billing/bills/${billingDetails.customer_bill_details.id}/extend`, {
                new_end_date: formatDateForAPI(extensionDate), // <-- 使用我们新的、安全的格式化函数
            });

            setAlert({ open: true, message: '服务已成功延长！正在刷新账单详情...',severity: 'success' });

            const freshDetailsResponse = await api.get(`/billing/details?bill_id=${billingDetails.customer_bill_details.id}`);

            if (freshDetailsResponse.data) {
                setBillingDetails(freshDetailsResponse.data);
            }

            handleCloseExtensionDialog();

        } catch (error) {
            console.error("延长服务失败:", error);
            const errorMessage = error.response?.data?.message ||'延长服务失败，请查看控制台。';
            setAlert({ open: true, message: errorMessage, severity: 'error' });
        }
    };
    const contractInfo = billingDetails?.contract_info;
    const infoTooltip = contractInfo ? (
        <React.Fragment>
            <Typography color="inherit" sx={{ mb: 0.5 }}><b>类型:</b> {contractInfo.contract_type_label}</Typography>
            <Typography color="inherit" sx={{ mb: 0.5 }}><b>周期:</b> {contractInfo.start_date} ~ {contractInfo.end_date}</Typography>
            <Typography color="inherit" sx={{ mb: 0.5 }}><b>备注:</b> {contractInfo.notes || '无'}</Typography>
            <Typography color="inherit"><b>有效期:</b>{contractInfo.remaining_months}</Typography>
        </React.Fragment>
    ) : '加载合同信息...';
    const renderCardContent = (data, isCustomer, billingDetails) => {
        if (!data || !data.groups) return null;
        const isSubstituteBill = data.calculation_details?.type === 'substitute';
        const isNannyContract = contract?.contract_type_value === 'nanny';
        const isTrialTerminationBill = data.calculation_details?.type === 'nanny_trial_termination';

        // 从 calculation_details 中提取替班天数和费用
        const substituteDays = data.calculation_details?.substitute_days;
        const substituteDeduction = data.calculation_details?.substitute_deduction;

        const currentAdjustments = adjustments.filter(adj => {
            // 1. 仍然保留我们的安全检查
            if (!adj) {
                console.log('Filtering out a null/undefined adjustment item.');
                return false;
            }

            // 2. 把判断的各个部分拆开，打印出来，看看到底是哪里出了问题
            const expectedType = isCustomer ? 'customer' : 'employee';
            const adjustmentConfig = AdjustmentTypes[adj.adjustment_type];
            const actualType = adjustmentConfig?.type;

            // console.log({
            //     'Backend adjustment_type': adj.adjustment_type,
            //     'Lookup result in AdjustmentTypes map': adjustmentConfig,
            //     'Type from map': actualType,
            //     'Expected type for this card': expectedType,
            //     'Does it match?': actualType === expectedType
            // });

        // 3. 返回最终的判断结果
        return actualType === expectedType;
    });
        
        
        // 【V2.6 核心逻辑】开始：后端已统一处理，前端只做展示
        const statusObject = isCustomer ? data.payment_status : data.payout_status;

        // 应付总额直接从后端获取
        const displayTotalDue = parseFloat(statusObject?.total_due || 0);

        // 实付总额也直接从后端获取。该值已包含所有收付款记录和结算项。
        const totalPaidOrSettled = parseFloat(isCustomer ? statusObject?.total_paid: statusObject?.total_paid_out) || 0;

        // 待付总额
        const pendingAmount = displayTotalDue - totalPaidOrSettled;

        // 状态判断 (逻辑不变)
        let displayStatus = 'unknown';
        const epsilon = 0.01;
        if (Math.abs(pendingAmount) < epsilon) {
            displayStatus = 'paid';
        } else if (pendingAmount < 0) {
            displayStatus = isCustomer ? 'overpaid' : 'paid';
        } else if (totalPaidOrSettled !== 0) {
            displayStatus = 'partially_paid';
        } else {
            displayStatus = 'unpaid';
        }
        const statusLabelMap = isCustomer ? {
            'unpaid': '未支付', 'partially_paid': '部分支付', 'paid': '已结清','overpaid': '超额支付'
        } : {
            'unpaid': '未发放', 'partially_paid': '部分发放', 'paid': '已结清'
        };
        const displayStatusLabel = statusLabelMap[displayStatus] || '未知';
        // 【V2.6 核心逻辑】结束

        const fieldOrder = {
            "级别与保证金": ["级别", "客交保证金", "定金", "介绍费", "管理费", "合同备注"],
            "劳务周期": ["劳务时间段", "基本劳务天数","延长服务天数", "加班天数", "被替班天数", "总劳务天数"],
            "费用明细": ["管理费率", "延长期管理费", "本次交管理费", "基础劳务费", "试工费", "加班费", "被替班费用", "优惠"],
            "薪酬明细": ["级别", "萌嫂保证金(工资)", "试工费", "基础劳务费", "加班费", "被替班天数", "延长期服务费", "被替班费用", "5%奖励", "首月员工10%费用"],
        };

        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                {data.groups.map(group => (
                    <Box key={group.name}>
                        <Divider textAlign="left" sx={{ mb: 1.5 }}><Typography variant="overline" color="text.secondary">{group.name}</Typography></Divider>
                        <Grid container rowSpacing={1.5} columnSpacing={2}>
                            {(fieldOrder[group.name] || Object.keys(group.fields)).map(key => {
                                const isBaseWorkDaysField = key === '基本劳务天数';  
                                // =================== 核心显示逻辑 ===================
                                // 根据账单类型，条件渲染字段
                                if (isTrialTerminationBill) {
                                    // 试工账单：隐藏“客交保证金”和“定金”
                                    if (key === '客交保证金' || key === '定金') return null;
                                } else {
                                    // 非试工账单：隐藏“介绍费”和“合同备注”
                                    if (key === '介绍费' || key === '合同备注') return null;
                                }

                                // 通用逻辑：隐藏替班账单中的某些字段
                                if (isSubstituteBill && (key === '客交保证金' || key === '首月员工10%费用' || key === '定金' || key === '优惠')) {
                                    return null;
                                }
                                
                                // 如果字段不存在，则不渲染
                                if (!group.fields.hasOwnProperty(key)) return null;
                                const value = group.fields[key];
                                const tooltipContent = getTooltipContent(key, billingDetails, isCustomer);
                                if ((key === '被替班费用' || key === '被替班天数') && Number(value) != 0) {
                                    
                                    return (
                                        <React.Fragment key={key}>
                                            <Grid item xs={5}>
                                                <Typography variant="body2" color="text.secondary">{key}:</Typography>
                                            </Grid>
                                            <Grid item xs={7} sx={{ display: 'flex', justifyContent: 'flex-end', alignItems:'center' }}>
                                                {/* 添加红色的向下箭头 */}
                                                <ArrowDownwardIcon color="error" sx={{ fontSize: '1rem', mr: 0.5 }} />
                                                {/* 添加负号，并将文本颜色设为红色 */}
                                                <Typography variant="body1" sx={{ textAlign: 'right', fontWeight: 500, fontFamily:'monospace', color: 'error.main' }}>
                                                    - {formatValue(key, value)}
                                                </Typography>
                                                {/* 保留原有的计算过程提示 */}
                                                {tooltipContent && !isEditMode && (
                                                    <Tooltip title={tooltipContent} arrow>
                                                        <InfoIcon sx={{ fontSize: '1rem', color: 'action.active', ml: 0.5, cursor:'help' }} />
                                                    </Tooltip>
                                                )}
                                            </Grid>
                                        </React.Fragment>
                                    );
                                }
                                // 特殊处理“合同备注”的渲染
                                if (key === '合同备注') {
                                    return (
                                        <React.Fragment key={key}>
                                            <Grid item xs={5}><Typography variant="body2" color="text.secondary">{key}:</Typography></Grid>
                                            <Grid item xs={7} sx={{ textAlign: 'right' }}>
                                                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontStyle: 'italic', color: 'text.secondary' }}>
                                                    {value || '—'}
                                                </Typography>
                                            </Grid>
                                        </React.Fragment>
                                    );
                                }

                                const isOvertimeField = key === '加班天数';

                                if (isEditMode && isOvertimeField) {
                                    return (
                                        <React.Fragment key="overtime_edit">
                                            <Grid item xs={5} sx={{ display: 'flex', alignItems: 'center' }}>
                                                <Typography variant="body2" color="text.secondary">加班天数:</Typography>
                                            </Grid>
                                            <Grid item xs={7} sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                                                <TextField
                                                    type="number"
                                                    value={editableOvertime}
                                                    onChange={(e) => {
                                                        const value = e.target.value;
                                                        // 允许为空或数字输入
                                                        if (value === '' || !isNaN(value)) {
                                                            setEditableOvertime(value);
                                                        }
                                                    }}
                                                    variant="standard"
                                                    size="small"
                                                    inputProps={{
                                                        step: 0.001,
                                                        style: { textAlign: 'right', fontFamily: 'monospace', fontWeight: 500 }
                                                    }}
                                                    sx={{ maxWidth: '80px' }}
                                                />
                                            </Grid>
                                        </React.Fragment>
                                    );
                                }

                                if (isEditMode && isNannyContract && isBaseWorkDaysField) {
                                    return (
                                        <React.Fragment key="base_work_days_edit">
                                            <Grid item xs={5} sx={{ display: 'flex', alignItems: 'center' }}>
                                                <Typography variant="body2" color="text.secondary">实际劳务天数:</Typography>
                                            </Grid>
                                            <Grid item xs={7} sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                                                <TextField
                                                    type="number"
                                                    value={editableActualWorkDays}
                                                    onChange={(e) => {
                                                        const value = e.target.value;
                                                        if (value === '' || !isNaN(value)) {
                                                            setEditableActualWorkDays(value);
                                                        }
                                                    }}
                                                    variant="standard"
                                                    size="small"
                                                    inputProps={{
                                                        step: 0.001,
                                                        style: { textAlign: 'right', fontFamily: 'monospace', fontWeight: 500 }
                                                    }}
                                                    sx={{ maxWidth: '80px' }}
                                                />
                                            </Grid>
                                        </React.Fragment>
                                    );
                                }

                                const isOvertimeFeeField = key === '加班费';
                                
                                if ((key === '替班天数' || key === '被替班费用') && Number(value) === 0) {
                                    return null;
                                }
                                if ((key === '定金' || key === '被替班费用') && Number(value) === 0) {
                                    return null;
                                }
                                if (key === '5%奖励' && (Number(value) === 0 || value === '待计算')) {
                                    return null;
                                }
                                if (key === '首月员工10%费用' && (Number(value) === 0 || value === '待计算')) {
                                    return null;
                                }
                                if (key === '被替班费用' && (Number(value) === 0 || value === '待计算')) {
                                    return null;
                                }
                                if (key === '被替班天数' && (Number(value) === 0 || value === '待计算')) {
                                    return null;
                                }
                                if (key === '优惠' && (Number(value) === 0 || value === '待计算')) {
                                    return null;
                                }
                                if ((isOvertimeField || isOvertimeFeeField) && Number(value) === 0) {
                                    return null;
                                }

                                return (
                                    <React.Fragment key={key}>
                                        <Grid item xs={5}><Typography variant="body2" color="text.secondary">{(isNannyContract &&isBaseWorkDaysField) ? '实际劳务天数' : key}:</Typography></Grid>
                                        <Grid item xs={7} sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center'}}>
                                            <Typography variant="body1" sx={{ textAlign: 'right',fontWeight: 500, fontFamily:'monospace' }}>
                                                {formatValue((isNannyContract &&isBaseWorkDaysField) ? '实际劳务天数' : key, value, data.calculation_details)}
                                            </Typography>
                                            {tooltipContent && !isEditMode && (
                                                <Tooltip title={tooltipContent} arrow>
                                                    <InfoIcon sx={{ fontSize: '1rem', color: 'action.active', ml: 0.5, cursor:'help' }} />
                                                </Tooltip>
                                            )}
                                            
                                            {key === '劳务时间段' &&
                                                (
                                                    (
                                                        contract?.contract_type_value=== 'nanny' && !contract?.is_monthly_auto_renew
                                                    ) ||
                                                    contract?.contract_type_value=== 'maternity_nurse' ||
                                                    contract?.contract_type_value=== 'external_substitution'
                                                ) &&
                                                billingDetails?.is_last_bill &&
                                                !isEditMode && (
                                                    <Tooltip title="为本期账单延长服务天数">
                                                        <IconButton size="small" sx={{ ml: 1 }}onClick={handleOpenExtensionDialog}>
                                                            <EditCalendarIcon fontSize="small" />
                                                        </IconButton>
                                                    </Tooltip>
                                            )}
                                        </Grid>
                                    </React.Fragment>
                                );
                            })}
                        </Grid>
                    </Box>
                ))}
                
                
                {(currentAdjustments.length > 0  || isEditMode) && (
                    <Box>
                        <Divider textAlign="left" sx={{ mb: 1.5 }}><Typography variant="overline" color="text.secondary">财务调整</Typography></Divider>
                        <List dense disablePadding>
                            {currentAdjustments.map(adj => {
                                // (V18) 增加专门的逻辑来识别和处理镜像调整项
                                const isMirrored = adj.adjustment_type === 'DEPOSIT_PAID_SALARY' && adj.mirrored_adjustment_id;
                                const isOriginalWithMirror = adj.adjustment_type === 'COMPANY_PAID_SALARY' && adj.mirrored_adjustment_id;
                                const isSystemCalculated = isMirrored || isOriginalWithMirror;

                                // 是否可编辑：系统计算的条目（原始项和镜像项）和顺延费用不可编辑
                                const isEditable = !isSystemCalculated && adj.adjustment_type !== 'deferred_fee';

                                // 是否可删除：已结算、已转移或顺延费用不可删除。系统计算的条目可以删除。
                                const isPartOfTransfer = adj.details?.status?.includes('transfer');
                                const isSettled = adj.is_settled;
                                const isDeletable = adj.adjustment_type !== 'deferred_fee' && !isPartOfTransfer && !isSettled;

                                const tooltipForLock = isMirrored
                                    ? "此为'公司代付工资'的系统镜像项，金额自动同步，不可直接编辑。"
                                    : isOriginalWithMirror
                                    ? "此调整项已生成镜像项，修改或删除将同步进行。"
                                    : "";

                                const isTransferable = !isEditMode &&
                                    !adj.is_settled &&
                                    adj.description !== '[系统添加] 保证金' &&
                                    (!adj.details || !['transferred_out', 'offsetting_transfer'].includes(adj.details.status));

                                return (
                                    <ListItem
                                        key={adj.id}
                                        button={isEditMode && isEditable} // 使用 isEditable
                                        onClick={isEditMode && isEditable ? () => { setEditingAdjustment(adj); setIsAdjustmentDialogOpen(true); } : undefined}
                                        secondaryAction={
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                {isTransferable && (
                                                    <Chip
                                                        label="转移"
                                                        size="small"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleInitiateTransfer(adj);
                                                        }}
                                                        clickable
                                                        variant="outlined"
                                                        color="primary"
                                                    />
                                                )}
                                                {isEditMode && (() => {
                                                    let tooltipTitle = '';
                                                    if (!isDeletable) {
                                                        if (isSettled) tooltipTitle = '请先取消结算，再执行删除';
                                                        else if (isPartOfTransfer) tooltipTitle = '有关联的转移记录，无法直接删除';
                                                        else if (adj.adjustment_type === 'deferred_fee') tooltipTitle = '系统生成的条目，无法删除';
                                                    }

                                                    return (
                                                        <Tooltip title={tooltipTitle}>
                                                            <span>
                                                                <IconButton
                                                                    edge="end"
                                                                    size="small"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleDeleteAdjustment(adj.id);
                                                                    }}
                                                                    disabled={!isDeletable}
                                                                >
                                                                    <DeleteIcon fontSize="small" />
                                                                </IconButton>
                                                            </span>
                                                        </Tooltip>
                                                    );
                                                })()}
                                            </Box>
                                        }
                                        disablePadding
                                        sx={{ pl: 2, pr: '120px' }}
                                    >
                                        <ListItemIcon sx={{ minWidth: 'auto', mr: 1.5 }}>
                                            {AdjustmentTypes[adj.adjustment_type]?.effect > 0 ? <ArrowUpwardIcon color="success" fontSize="small" /> : <ArrowDownwardIcon color="error" fontSize="small" />}
                                        </ListItemIcon>
                                        <ListItemText
                                            primary={
                                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                        <Typography component="span" variant="body1">
                                                            {AdjustmentTypes[adj.adjustment_type]?.label}
                                                        </Typography>
                                                        {isSystemCalculated && (
                                                            <Tooltip title={tooltipForLock} arrow>
                                                                <LockIcon fontSize="small" color="action" />
                                                            </Tooltip>
                                                        )}
                                                        {adj.is_settled && (
                                                            <Chip label="已结算" color="success" size="small" variant="outlined" />
                                                        )}
                                                        {adj.is_settled && (
                                                            <Tooltip title={`结算日期: ${adj.settlement_date || '无'} | 备注: ${(adj.settlement_details && adj.settlement_details.notes) || '无'}`}> 
                                                                <InfoIcon sx={{ fontSize: '1rem', color: 'action.active', ml: 0.5, cursor: 'help' }} />
                                                            </Tooltip>
                                                        )}
                                                    </Box>
                                                    <Typography component="span" variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 'bold' }}>
                                                        {AdjustmentTypes[adj.adjustment_type]?.effect > 0 ? '+' : '-'} {formatValue('', adj.amount)}
                                                    </Typography>
                                                </Box>
                                            }
    
                                        secondary={(() => {
                                            const adjTooltipContent = getTooltipContent(null, billingDetails, !isCustomer, adj);
                                            const mainDescription = adj.description;

                                            const details = adj.details || {};

                                            // --- 核心修正：优先使用新的、简单的 linked_bill_id ---
                                            let linkBillId = details.linked_bill_id || details.linked_payroll_id;

                                            // 如果新的字段不存在，则回退到旧的逻辑以保持兼容
                                            if (!linkBillId) {
                                                const status = details.status || '';
                                                if (status === 'transferred_out' || status === 'transferred' || status ==='offsetting_transfer') {
                                                    linkBillId = details.transferred_to_bill_id;
                                                } else if (status === 'transferred_in') {
                                                    linkBillId = details.transferred_from_bill_id;
                                                }
                                            }

                                            const sourceContractId = details.source_contract_id || adj.source_contract_id;
                                            const destinationContractId = details.destination_contract_id;

                                            let linkContractId = null;
                                            let tooltipTitle = "";

                                            if (sourceContractId) {
                                                linkContractId = sourceContractId;
                                                tooltipTitle = details.source_contract_id ? "查看费用来源合同" : "查看源试工合同";
                                            } else if (destinationContractId) {
                                                linkContractId = destinationContractId;
                                                tooltipTitle = "查看费用覆盖的新合同";
                                            }

                                            return (
                                                <Typography variant="body2" component="span" sx={{ display: 'inline-flex', alignItems:'center', flexWrap: 'wrap', whiteSpace: 'pre-wrap', wordBreak: 'break-word'}}>
                                                    {mainDescription}

                                                    {adjTooltipContent && (
                                                        <Tooltip title={adjTooltipContent} arrow>
                                                            <InfoIcon sx={{ fontSize: '1rem', color: 'action.active', ml: 0.5, cursor:'help' }} />
                                                        </Tooltip>
                                                    )}

                                                    {linkContractId && !linkBillId && (
                                                        <Tooltip title={tooltipTitle}>
                                                            <IconButton
                                                                size="small"
                                                                onClick={(e) => { e.stopPropagation(); navigate(`/contract/detail/${linkContractId}`); onClose(); }}
                                                                sx={{ ml: 0.5, p: 0.2 }}
                                                            >
                                                                <LinkIcon fontSize="inherit" />
                                                            </IconButton>
                                                        </Tooltip>
                                                    )}

                                                    {linkBillId && (
                                                        <Button
                                                            size="small" variant="text"
                                                            sx={{ p: 0, m: 0, height: 'auto', verticalAlign: 'baseline', lineHeight:'inherit', mx: 0.5, minWidth: 'auto' }}
                                                            onClick={(e) => { e.stopPropagation(); if (onNavigateToBill) onNavigateToBill(linkBillId); }}
                                                        >
                                                            (查看详情)
                                                        </Button>
                                                    )}
                                                </Typography>
                                            );
                                        })()}
                                        />
                                    </ListItem>
                                );
                            })}
                        </List>
                        {isEditMode && (<Box sx={{ mt: 1, display: 'flex', justifyContent: 'center' }}><Button size="small" variant="text" startIcon={<AddIcon />} onClick={() => { setEditingAdjustment(null); setAdjustmentFilter(isCustomer ? 'customer' :'employee'); setIsAdjustmentDialogOpen(true); }}>添加调整</Button></Box>)}
                    </Box>
                )}

                <Box>
                    <Divider textAlign="left" sx={{ mb: 1.5 }}><Typography variant="overline" color="text.secondary">最终结算</Typography></Divider>
                    <Grid container spacing={1.5}>
                        {/* 应收/应发总额 */}
                        <Grid item xs={12}>
                            <Box sx={{ display: 'flex', justifyContent:'space-between', alignItems: 'center' }}>
                                <Typography variant="body2" color="text.secondary">{isCustomer ? '应收总额:' : '应发总额:'}</Typography>
                                <Box sx={{ display: 'flex', alignItems: 'center',gap: 0.5 }}>
                                    <Typography variant="body1" sx={{ fontWeight:500, fontFamily: 'monospace' }}>
                                        {formatValue('', displayTotalDue)}
                                    </Typography>
                                    {(() => {
                                        const tooltipContent = getTooltipContent(isCustomer ? '客应付款' : '萌嫂应领款', billingDetails, isCustomer);
                                        if (tooltipContent && !isEditMode) {
                                            return (
                                                <Tooltip title={tooltipContent}arrow>
                                                    <InfoIcon sx={{ fontSize:'1rem', color: 'action.active', cursor: 'help' }} />
                                                </Tooltip>
                                            );
                                        }
                                        return null;
                                    })()}
                                </Box>
                            </Box>
                        </Grid>
                        {/* 实收/实发总额 */}
                        <Grid item xs={12}>
                            <Box sx={{ display: 'flex', justifyContent:'space-between', alignItems: 'center' }}>
                                <Typography variant="body2" color="text.secondary">{isCustomer ? '实收总额:' : '实发总额:'}</Typography>
                                <Typography variant="body1" sx={{ fontWeight: 500,fontFamily: 'monospace', color: 'success.main' }}>
                                    {formatValue('', totalPaidOrSettled)}
                                </Typography>
                            </Box>
                        </Grid>
                                                {/* 待收/待付总额 */}
                        <Grid item xs={12}>
                            <Box sx={{ display: 'flex', justifyContent:'space-between', alignItems: 'center' }}>
                                <Typography variant="body2" color="text.secondary">{isCustomer ? '待收总额:' : '待付总额:'}</Typography>
                                <Box sx={{ display: 'flex', alignItems: 'center',gap: 0.5 }}>
                                    <Typography variant="body1" sx={{ fontWeight:'bold', fontFamily: 'monospace', color: pendingAmount > 0 ? 'error.main' :'text.primary' }}>
                                        {formatValue('', pendingAmount)}
                                    </Typography>
                                    <Tooltip title={`应收/付总额 (${displayTotalDue.toFixed(2)}) - 实收/付总额 (${totalPaidOrSettled.toFixed(2)})`}arrow>
                                        <InfoIcon sx={{ fontSize: '1rem', color:'action.active', cursor: 'help' }} />
                                    </Tooltip>
                                </Box>
                            </Box>
                        </Grid>

                        {/* Transfer Balance Button */}
                        {isCustomer && billingDetails.is_last_bill && ['terminated', 'finished'].includes(contract?.status) && Math.abs(pendingAmount) > 0.01 && (
                            <Grid item xs={12} sx={{ display: 'flex', justifyContent: 'center', mt: 1 }}>
                                <Button 
                                    variant="contained"
                                    color="secondary"
                                    onClick={() => setIsTransferBalanceDialogOpen(true)}
                                >
                                    转移此账单余额
                                </Button>
                            </Grid>
                        )}

                        <Grid item xs={12}>
                            <Divider sx={{ my: 1 }} />
                        </Grid>
                        {/* 最终状态 */}
                        <Grid item xs={12}>
                            <Box sx={{ display: 'flex', justifyContent:'space-between', alignItems: 'center' }}>
                                <Typography variant="h6">当前状态:</Typography>
                                <Chip
                                    label={displayStatusLabel}
                                    color={
                                        displayStatus === 'paid' ? 'success' :
                                        displayStatus === 'unpaid' ? 'default' :
                                        displayStatus === 'overpaid' ? 'info' :'warning'
                                    }
                                />
                            </Box>
                        </Grid>
                    </Grid>
                </Box>
                {/* --- 收款记录模块 (仅客户) --- */}
                {isCustomer && (
                    <Box sx={{ mt: 2 }}>
                        <Divider textAlign="left" sx={{ mb: 1.5 }}><Typography variant="overline" color="text.secondary">收款记录</Typography></Divider>
                        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
                            <Button
                                variant="contained"
                                size="small"
                                startIcon={<AddIcon />}
                                onClick={handleOpenPaymentDialog}
                                disabled={isEditMode}
                            >
                                记录收款
                            </Button>
                        </Box>
                        <TableContainer>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>收款日期</TableCell>
                                        <TableCell>收款方式</TableCell>
                                        <TableCell>备注</TableCell>
                                        <TableCell align="right">收款金额</TableCell>
                                        <TableCell align="center">凭证</TableCell>
                                        <TableCell align="center">操作</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {billingDetails?.payment_records?.length > 0 ? (
                                        billingDetails.payment_records.map(p => (
                                            <TableRow key={p.id}>
                                                <TableCell>{formatDate(p.payment_date)}</TableCell>
                                                <TableCell>{p.method || '—'}</TableCell>
                                                <TableCell>{p.notes || '—'}</TableCell>
                                                <TableCell align="right">{formatValue('', p.amount)}</TableCell>
                                                <TableCell align="center">
                                                    {p.image_url ? (
                                                        <IconButton component="a" href={p.image_url} target="_blank" rel="noopener noreferrer" size="small">
                                                            <ArticleOutlinedIcon fontSize="small" />
                                                        </IconButton>
                                                    ) : (
                                                        '—'
                                                    )}
                                                </TableCell>
                                                <TableCell align="center">
                                                    <IconButton size="small" onClick={() => handleDeletePayment(p.id)} disabled={isEditMode}>
                                                        <DeleteIcon fontSize="small" />
                                                    </IconButton>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    ) : (
                                        <TableRow>
                                            <TableCell colSpan={6} align="center">
                                                暂无收款记录
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                                <TableFooter>
                                    <TableRow>
                                        <TableCell colSpan={3} align="right"><Typography variant="body1" sx={{ fontWeight: 'bold' }}>总计:</Typography></TableCell>
                                        <TableCell align="right"><Typography variant="body1" sx={{ fontWeight: 'bold' }}>{formatValue('', billingDetails?.payment_records?.reduce((acc, p) => acc + parseFloat(p.amount), 0))}</Typography></TableCell>
                                        <TableCell />
                                        <TableCell />
                                    </TableRow>
                                </TableFooter>
                            </Table>
                        </TableContainer>
                    </Box>
                )}

                {/* --- 工资发放记录模块 (仅员工) --- */}
                {!isCustomer && (
                    <Box sx={{ mt: 2 }}>
                        <Divider textAlign="left" sx={{ mb: 1.5 }}><Typography variant="overline" color="text.secondary">工资发放记录</Typography></Divider>
                        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
                            <Button
                                variant="contained"
                                size="small"
                                startIcon={<AddIcon />}
                                onClick={handleOpenPayoutDialog}
                                disabled={isEditMode}
                            >
                                记录工资发放
                            </Button>
                        </Box>
                        <TableContainer>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>发放日期</TableCell>
                                        <TableCell>付款方</TableCell>
                                        <TableCell>发放方式</TableCell>
                                        <TableCell>备注</TableCell>
                                        <TableCell align="right">发放金额</TableCell>
                                        <TableCell align="center">凭证</TableCell>
                                        <TableCell align="center">操作</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {billingDetails?.payout_records?.length > 0 ? (
                                        billingDetails.payout_records.map(p => (
                                            <TableRow key={p.id}>
                                                <TableCell>{formatDate(p.payout_date)}</TableCell>
                                                <TableCell>{p.payer || '公司代付'}</TableCell>
                                                <TableCell>{p.method || '—'}</TableCell>
                                                <TableCell>{p.notes || '—'}</TableCell>
                                                <TableCell align="right">{formatValue('', p.amount)}</TableCell>
                                                <TableCell align="center">
                                                    {p.image_url ? (
                                                        <IconButton component="a" href={p.image_url} target="_blank" rel="noopener noreferrer" size="small">
                                                            <ArticleOutlinedIcon fontSize="small" />
                                                        </IconButton>
                                                    ) : (
                                                        '—'
                                                    )}
                                                </TableCell>
                                                <TableCell align="center">
                                                    <IconButton size="small" onClick={() => handleDeletePayout(p.id)} disabled={isEditMode}>
                                                        <DeleteIcon fontSize="small" />
                                                    </IconButton>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    ) : (
                                        <TableRow>
                                            <TableCell colSpan={7} align="center">
                                                暂无工资发放记录
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                                <TableFooter>
                                    <TableRow>
                                        <TableCell colSpan={4} align="right"><Typography variant="body1" sx={{ fontWeight: 'bold' }}>总计:</Typography></TableCell>
                                        <TableCell align="right"><Typography variant="body1" sx={{ fontWeight: 'bold' }}>{formatValue('', billingDetails?.payout_records?.reduce((acc, p) => acc + parseFloat(p.amount), 0))}</Typography></TableCell>
                                        <TableCell />
                                        <TableCell />
                                    </TableRow>
                                </TableFooter>
                            </Table>
                        </TableContainer>
                    </Box>
                )}
            </Box>
        );
    };

    const watermarkText = currentBillingMonth ? `${parseInt(currentBillingMonth.split('-')[1], 10)}月` : '';

    return (
        <>
            <AlertMessage
                open={alert.open}
                message={alert.message}
                severity={alert.severity}
                onClose={() => setAlert({ ...alert, open: false })}
            />
            <Dialog
                open={open}
                onClose={(event, reason) => {
                    if (reason && (reason === 'backdropClick' || reason === 'escapeKeyDown')) {
                        onClose(billingDetails);
                    }
                }}
                maxWidth="lg"
                fullWidth
                scroll="paper"
            >
                <DialogTitle variant="h5" sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                     <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <IconButton onClick={() => handleMonthChange('prev')} size="small" disabled={!hasPrevBill || isSwitchingMonth}>
                                <ArrowBackIosNewIcon fontSize="inherit" />
                            </IconButton>
                            <Typography variant="h5" component="span" sx={{ minWidth: '180px', textAlign: 'center' }}>
                                财务管理 - {currentBillingMonth}
                            </Typography>
                            <IconButton onClick={() => handleMonthChange('next')} size="small" disabled={!hasNextBill || isSwitchingMonth}>
                                <ArrowForwardIosIcon fontSize="inherit" />
                            </IconButton>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', borderLeft: 1, borderColor: 'divider', pl: 2 }}>
                            <Typography variant="subtitle1" color="text.secondary">合同简介</Typography>
                            <Tooltip title={infoTooltip}>
                                <IconButton size="small" sx={{ml: 0.5 }}>
                                    <InfoIcon fontSize="small"/>
                                </IconButton>
                            </Tooltip>
                        </Box>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        {!billingDetails?.is_substitute_bill && (
                            <Button
                                variant="outlined"
                                size="small"
                                startIcon={<PeopleAltIcon />}
                                onClick={handleOpenSubstituteDialog}
                                disabled={isEditMode || isSwitchingMonth}
                                sx={{ mr: 2 }}
                            >
                                添加替班记录
                            </Button>
                        )}
                        <Button
                            component="a"
                            href={`/contract/detail/${contract?.contract_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            startIcon={<ArticleOutlinedIcon />}
                            variant="outlined"
                            size="small"
                        >
                            查看合同
                        </Button>
                        <IconButton onClick={() => onClose(billingDetails)} sx={{ ml: 1 }}><CloseIcon /></IconButton>
                    </Box>
                </DialogTitle>
                <DialogContent dividers sx={{ bgcolor: 'grey.50', p: { xs: 1, sm: 2, md: 3 }, position: 'relative' }}>
                    {isSwitchingMonth && (
                        <Box sx={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            backgroundColor: 'rgba(255, 255, 255, 0.7)',
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            zIndex: 10,
                        }}>
                            <CircularProgress />
                        </Box>
                    )}

                    {isEditMode && (<Alert severity="info" sx={{ mb: 2, position: 'relative', zIndex: 1 }}>您正处于编辑模式。所有更改将在点击“保存”后生效。</Alert>)}
                    
                    {(loading && !isSwitchingMonth) ? (<Box sx={{ display: 'flex', justifyContent: 'center', p: 5 }}><CircularProgress /></Box>) 
                    : billingDetails ? (
                        <Grid container spacing={3} sx={{ position: 'relative', zIndex: 1 }}>
                            <Grid item xs={12} md={6}>
                                <Paper sx={{ p: 3, borderRadius: 2, boxShadow: 1, position: 'relative', overflow: 'hidden' }}>
                                    <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: '8rem', fontWeight: 'bold', color: 'rgba(0, 0, 0, 0.05)', zIndex: 0, pointerEvents: 'none', userSelect: 'none' }}>
                                        {watermarkText}
                                    </Box>
                                    <Typography variant="h3" gutterBottom component="div" sx={{ display: 'flex', alignItems: 'center' }}>
                                        客户账单 ~ 
                                         <Typography variant="h5" component="span" color="text.secondary">
                                               {customerData?.customer_name || contract?.customer_name}
                                        </Typography>
                                        {customerData.calculation_details?.type === 'substitute' && <Chip label="替班" color="warning" size="small" sx={{ ml: 1 }} />}
                                    </Typography>
                                    {renderCardContent(customerData, true, billingDetails)}
                                </Paper>
                            </Grid>
                            <Grid item xs={12} md={6}>
                                <Paper sx={{ p: 3, borderRadius: 2, boxShadow: 1, position: 'relative', overflow: 'hidden' }}>
                                     <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: '8rem', fontWeight: 'bold', color: 'rgba(0, 0, 0, 0.05)', zIndex: 0, pointerEvents: 'none', userSelect: 'none' }}>
                                        {watermarkText}
                                    </Box>
                                    <Typography variant="h3" gutterBottom component="div" sx={{ display: 'flex', alignItems: 'center' }}>
                                        员工薪酬 ~ 
                                         <Typography variant="h5" component="span" color="text.secondary">
                                               {employeeData?.employee_name || contract?.employee_name}
                                        </Typography>
                                        {employeeData.calculation_details?.type === 'substitute' && <Chip label="替班" color="warning" size="small" sx={{ ml: 1 }} />}
                                    </Typography>
                                    {renderCardContent(employeeData, false, billingDetails)}
                                </Paper>
                            </Grid>
                            {billingDetails?.customer_bill_details && (
                                <Grid item xs={12}>
                                    <Paper sx={{ p: 3, borderRadius: 2, boxShadow: 1 }}>
                                        <Typography variant="h3" gutterBottom>发票管理</Typography>
                                        <Box sx={{
                                            border: '1px dashed',
                                            borderColor: 'divider',
                                            borderRadius: 1,
                                            p: 1.5,
                                            mt: 2
                                        }}>
                                            <Grid container spacing={2} alignItems="center"justifyContent="space-between">
                                                <Grid item>
                                                    <FormControlLabel
                                                        control={
                                                            <Switch
                                                                checked={billingDetails?.invoice_needed || false}
                                                                onChange={handleInvoiceNeededChange}
                                                            />
                                                        }
                                                        label="需要开具发票"
                                                    />
                                                </Grid>
                                                <Grid item>
                                                    <Button
                                                        variant="outlined"
                                                        size="small"
                                                        startIcon={<ReceiptLongIcon />}
                                                        onClick={handleOpenInvoiceDialog}
                                                        disabled={!billingDetails?.invoice_needed}
                                                    >
                                                        管理发票记录 ({editableInvoices.length}条)
                                                    </Button>
                                                </Grid>
                                            </Grid>

                                            {billingDetails?.invoice_needed && billingDetails?.invoice_balance && (
                                                <Box sx={{ mt: 2, pt: 2, borderTop: 1,borderColor: 'divider' }}>
                                                    <Grid container spacing={1.5} alignItems="center">
                                                        <Grid item xs={12} md={7}>
                                                            <Typography variant="body2" color="text.secondary">
                                                                本期应开: <Typography component="span" sx={{ fontFamily: 'monospace', fontWeight: 500 }}>{formatValue('',billingDetails.invoice_balance.total_invoiceable_amount)}</Typography>
                                                                {' / '}
                                                                本期已开: <Typography component="span" sx={{ fontFamily: 'monospace', fontWeight: 500 }}>{formatValue('',billingDetails.invoice_balance.invoiced_this_period)}</Typography>
                                                            </Typography>
                                                        </Grid>
                                                        <Grid item xs={12} md={5} sx={{ display:'flex', justifyContent: { md: 'flex-end' }, alignItems: 'center' }}>
                                                            <Typography variant="body2" color="text.secondary">
                                                                历史欠票:
                                                                <Typography component="span"sx={{ fontFamily: 'monospace', fontWeight: 500, ml: 0.5 }}>
                                                                    {formatValue('',billingDetails.invoice_balance.total_carried_forward)}
                                                                </Typography>
                                                                {billingDetails.invoice_balance.carried_forward_breakdown && billingDetails.invoice_balance.carried_forward_breakdown.length > 0&& (
                                                                    <Tooltip
                                                                        arrow
                                                                        title={
                                                                            <React.Fragment>
                                                                                <Typography variant="caption" sx={{ fontWeight: 'bold', color: 'common.white', display: 'block', mb: 1}}>历史欠票明细</Typography>
                                                                                {billingDetails.invoice_balance.carried_forward_breakdown.map((item, index) => (
                                                                                    <Typography key={index} variant="body2" sx={{ fontFamily: 'monospace', color: 'grey.200' }}>{item.month}月:¥{item.unpaid_amount}</Typography>
                                                                                ))}
                                                                            </React.Fragment>
                                                                        }
                                                                    >
                                                                        <InfoIcon sx={{ fontSize:'1rem', color: 'action.active', ml: 0.5, cursor: 'help', verticalAlign: 'middle' }} />
                                                                    </Tooltip>
                                                                )}
                                                                {' / '}
                                                                <Typography component="span"color="error.dark" sx={{ fontWeight: 'bold' }}>
                                                                    总计待开:
                                                                    <Typography component="span"sx={{ fontFamily: 'monospace', ml: 0.5 }}>
                                                                        {formatValue('',billingDetails.invoice_balance.remaining_un_invoiced)}
                                                                    </Typography>
                                                                </Typography>
                                                            </Typography>
                                                        </Grid>
                                                    </Grid>
                                                </Box>
                                            )}
                                        </Box>
                                    </Paper>
                                </Grid>
                            )}
                            {!billingDetails?.is_substitute_bill && (
                                <Grid item xs={12}>
                                    <Paper sx={{ p: 3, borderRadius: 2, boxShadow: 1 }}>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                                            <Typography variant="h3">替班记录</Typography>
                                        </Box>
                                        {(() => {
                                            const currentBillId = billingDetails?.customer_bill_details?.id;
                                            const relevantSubstituteRecords = substituteRecords.filter(record => currentBillId && record.original_customer_bill_id === currentBillId);
                                            return (
                                                <List dense>
                                                    {relevantSubstituteRecords.length > 0 ? relevantSubstituteRecords.map(record => (
                                                        <ListItem
                                                            key={record.id}
                                                            button
                                                            onClick={() => {
                                                                if (onNavigateToBill && record.substitute_customer_bill_id) {
                                                                    onNavigateToBill(record.substitute_customer_bill_id);
                                                                } else {
                                                                    setAlert({ open: true, message: '无法导航：缺少替班账单ID。', severity: 'warning' });
                                                                }
                                                            }}
                                                        >
                                                            <ListItemText
                                                                primary={`${record.substitute_user_name} (日薪: ¥${record.substitute_salary})`}
                                                                secondary={`从 ${formatDateTimeRange(record.start_date, record.end_date)}`}
                                                            />
                                                            <ListItemSecondaryAction>
                                                                <IconButton
                                                                    edge="end"
                                                                    aria-label="delete"
                                                                    disabled={isEditMode}
                                                                    onClick={(e) => {
                                                                        e.stopPropagation(); 
                                                                        handleDeleteSubstitute(record.id);
                                                                    }}
                                                                >
                                                                    <DeleteIcon />
                                                                </IconButton>
                                                            </ListItemSecondaryAction>
                                                        </ListItem>
                                                    )) : (
                                                        <Typography variant="body2" color="text.secondary" sx={{ pl: 2 }}>本期账单无关联的替班记录</Typography>
                                                    )}
                                                </List>
                                            );
                                        })()}
                                    </Paper>
                                </Grid>
                            )}
                            <Grid item xs={12}>
                                <Paper sx={{ p: 3, borderRadius: 2, boxShadow: 1 }}>
                                    <Typography variant="h3" gutterBottom>操作日志</Typography>
                                    {loadingLogs ? <CircularProgress size={24} /> : (<Timeline sx={{ p: 0, m: 0 }}>{activityLogs.length > 0 ? activityLogs.map((log, index) => (
                                        <LogItem 
                                            key={log.id} 
                                            log={log} 
                                            isLast={index === activityLogs.length - 1}
                                            navigate={navigate}
                                            onClose={onClose}
                                        />)) : (<Typography variant="body2" color="text.secondary">暂无操作日志</Typography>)}
                                    </Timeline>)}
                                </Paper>
                            </Grid>
                        </Grid>
                    ) : (<Typography color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>无此月份的账单数据，请先计算账单。</Typography>)}
                </DialogContent>
                <DialogActions sx={{ p: 2 }}>
                    {isEditMode ? (<>
                    <Button onClick={handleCancelEdit} variant="text" startIcon={<CancelIcon />}>取消</Button><Button onClick={handleSave} variant="contained" color="primary" startIcon={<SaveIcon />}>保存并重新计算</Button></>) 
                    : (<>
                    <Button 
                        onClick={handleGenerateSingleMessage} 
                        variant="outlined"
                        disabled={isGeneratingMessage || isSwitchingMonth}
                        startIcon={isGeneratingMessage ? <CircularProgress size={20} /> : null}
                    >
                        生成催款信息
                    </Button>
                        {successorContract && !isEditMode && (
                            <Button
                                variant="contained"
                                color="secondary"
                                startIcon={isProcessingSuccessorAction ? <CircularProgress size={20} /> : <CallMergeIcon />}
                                onClick={handleOpenMergePreview} // <--- 修改这里
                                disabled={isSwitchingMonth || isProcessingSuccessorAction}
                            >
                                {isProcessingSuccessorAction ? '获取预览中...' : '合并至续约账单'} 
                            </Button>
                        )}
                    <Button onClick={() => onClose(billingDetails)}>关闭</Button><Button onClick={handleEnterEditMode} variant="contained" startIcon={<EditIcon />} disabled={isSwitchingMonth}>进入编辑模式</Button></>)}
                </DialogActions>
            </Dialog>
            <InvoiceDetailsDialog
                open={isInvoiceDialogOpen}
                onClose={() => setIsInvoiceDialogOpen(false)}
                onSave={(newInvoices) => {
                    onSave({
                        bill_id: billingDetails.customer_bill_details.id,
                        overtime_days: editableOvertime,
                        actual_work_days: editableActualWorkDays,
                        adjustments: adjustments,
                        invoices: newInvoices, 
                        invoice_needed: billingDetails.invoice_needed,
                    });
                }}
                invoices={editableInvoices}
                invoiceBalance={billingDetails?.invoice_balance}
            />
            <Dialog open={isCycleEditDialogOpen} onClose={handleCloseCycleEditDialog} maxWidth="xs" fullWidth>
                <DialogTitle>修改并顺延服务周期</DialogTitle>
                <DialogContent>
                    <Alert severity="warning" sx={{mb: 2}}>注意：修改本期结束日期将会自动顺延所有后续的账单周期和月份。</Alert>
                    <Grid container spacing={2} sx={{pt: 1}}>
                        <Grid item xs={12}><DatePicker label="本期开始日期" value={editableCycle.start} onChange={(d) => handleCycleDateChange('start', d)} sx={{width: '100%'}} /></Grid>
                        <Grid item xs={12}><DatePicker label="本期结束日期" value={editableCycle.end} onChange={(d) => handleCycleDateChange('end', d)} sx={{width: '100%'}} /></Grid>
                    </Grid>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseCycleEditDialog}>取消</Button>
                    <Button onClick={handleSaveCycle} variant="contained">确认修改</Button>
                </DialogActions>
            </Dialog>
            <AdjustmentDialog open={isAdjustmentDialogOpen} onClose={handleCloseAdjustmentDialog} onSave={handleSaveAdjustment} adjustment={editingAdjustment} typeFilter={adjustmentFilter}/>
            <SubstituteDialog
                open={isSubstituteDialogOpen}
                onClose={handleCloseSubstituteDialog}
                onSave={handleSaveSubstitute}
                contractId={contract?.contract_id}
                contractType={contract?.contract_type_value}
                billMonth={currentBillingMonth}
                originalBillCycleStart={billingDetails?.cycle_start_date}
                originalBillCycleEnd={billingDetails?.cycle_end_date}
                originalBillId={billingDetails?.customer_bill_details?.id}
            />
            <Dialog open={isExtensionDialogOpen} onClose={handleCloseExtensionDialog} maxWidth="xs" fullWidth>
                <DialogTitle>延长服务期</DialogTitle>
                <DialogContent sx={{ pt: '20px !important' }}>
                    <DatePicker
                        label="延长服务至"
                        value={extensionDate}
                        onChange={setExtensionDate}
                        minDate={billingDetails?.cycle_end_date ? new Date(billingDetails.cycle_end_date) : null}
                        sx={{ width: '100%' }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseExtensionDialog}>取消</Button>
                    <Button onClick={handleConfirmExtension} variant="contained">确认延长</Button>
                </DialogActions>
            </Dialog>
            <Dialog open={isTransferDialogOpen} onClose={handleCloseTransferDialog}>
                <DialogTitle>转移保证金</DialogTitle>
                <DialogContent>
                    <Typography>（转移功能开发中...）</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseTransferDialog}>取消</Button>
                </DialogActions>
            </Dialog>
                    
            <TransferDepositDialog
                open={isTransferDialogOpen}
                onClose={handleCloseTransferDialog}
                adjustment={transferringAdjustment}
                sourceContract={contract}
                onConfirm={(destinationContractId) => handleInitiateTransfer(null,destinationContractId)}
            />
            <TransferDepositDialog
                open={isTransferBalanceDialogOpen}
                onClose={() => setIsTransferBalanceDialogOpen(false)}
                sourceContract={contract}
                onConfirm={handleConfirmTransferBalance}
                sourceBillEndDate={billingDetails?.cycle_end_date}
            />
            <PaymentDialog
                open={isPaymentDialogOpen}
                onClose={handleClosePaymentDialog}
                onSave={handleRecordSaveSuccess}
                totalDue={billingDetails?.customer_bill_details?.payment_status?.total_due}
                totalPaid={billingDetails?.customer_bill_details?.payment_status?.total_paid}
                recordType="payment"
                recordId={billingDetails?.customer_bill_details?.id}
            />
            <PayoutDialog
                open={isPayoutDialogOpen}
                onClose={handleClosePayoutDialog}
                onSave={handleRecordSaveSuccess}
                totalDue={billingDetails?.employee_payroll_details?.payout_status?.total_due}
                totalPaidOut={billingDetails?.employee_payroll_details?.payout_status?.total_paid_out}
                recordType="payout"
                recordId={billingDetails?.employee_payroll_details?.id}
            />
            <PaymentMessageModal
                open={isMessageModalOpen}
                onClose={() => setIsMessageModalOpen(false)}
                initialMessage={generatedMessage}
                onAlert={(msg, sev) => setAlert({ open: true, message: msg, severity: sev })}
            />
            {/* 新增：合并预览模态框 */}
            <MergePreviewModal
                open={isMergePreviewOpen}
                onClose={() => setIsMergePreviewOpen(false)}
                onConfirm={handlePostMergeRefresh}
                previewData={mergePreviewData}
                sourceBillId={billingDetails?.customer_bill_details?.id}
                targetContractId={successorContract?.id}
            />
        </>
    );
};

export default FinancialManagementModal;
