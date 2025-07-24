// frontend/src/components/BillingDashboard.jsx (与UserManagement样式完全对齐版)

import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Box, Button, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TablePagination, IconButton, CircularProgress,
  TextField, Select, MenuItem, FormControl, InputLabel, Chip, Tooltip,
  Card, CardHeader, CardContent, Grid, Dialog, DialogTitle, DialogContent, DialogActions, Divider, List, ListItem, ListItemText, ListItemIcon, Alert
} from '@mui/material';
import { 
    Edit as EditIcon, Sync as SyncIcon, Calculate as CalculateIcon, Add as AddIcon, Save as SaveIcon,
    AccountBalanceWallet as AccountBalanceWalletIcon, // 客户账单图标
    MonetizationOn as MonetizationOnIcon, // 员工薪酬图标
    EventAvailable as EventAvailableIcon, // 考勤图标
    ArrowUpward as ArrowUpwardIcon, // 用于增款
    ArrowDownward as ArrowDownwardIcon, // 用于减款/优惠
    TrendingDown as TrendingDownIcon, // 用于应退
    EventBusy as EventBusyIcon, // 或者 HelpOutline as HelpOutlineIcon
    CheckCircle as CheckCircleIcon,
    HighlightOff as HighlightOffIcon
} from '@mui/icons-material';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';

import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import { useTheme, alpha } from '@mui/material/styles';


import api from '../api/axios';
import PageHeader from './PageHeader';
import AlertMessage from './AlertMessage';
import useTaskPolling from '../utils/useTaskPolling'; // <<<--- 1. 导入 useTaskPolling Hook
import FinancialManagementModal from './FinancialManagementModal'; // 1. 导入新组件



// 1. 修正 formatDate 函数，使其能优雅地处理双日期字符串
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

const formatValue = (key, value) => {
    if (value === null || value === undefined || value === '' || String(value).includes('待计算'))
        return <Box component="span" sx={{ color: 'text.disabled' }}>{value || '—'}</Box>;

    const isMoney = ['级别', '应付', '应收'].some(k => key.includes(k));
    if (isMoney && /^-?\d+(\.\d+)?$/.test(String(value))) {
        const num = Number(value);
        return isNaN(num) ? String(value) : `¥${num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return String(value);
};

// 1. 增强 formatDate，使其能计算天数并返回需要的格式
const formatDateRange = (dateRangeString) => {
    if (!dateRangeString || !dateRangeString.includes('~')) return '—';
    
    const [startStr, endStr] = dateRangeString.split('~').map(d => d.trim());
    if (startStr === 'N/A' || endStr === 'N/A') return '—';

    try {
        const startDate = new Date(startStr);
        const endDate = new Date(endStr);
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return '无效日期';

        // 计算天数差
        const diffTime = Math.abs(endDate - startDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 因为包含起止两天

        const format = (date) => date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }).replace('/', '-');

        return `${format(startDate)} ~ ${format(endDate)} (${diffDays}天)`;

    } catch (e) {
        return '无效日期范围';
    }
};

// --- 复刻Excel的详情卡片 (最终版) ---
const ExcelStyleDetailCard = ({ title, data = {}, isCustomerBill }) => {
    const formatValue = (key, value) => {
        if (value === null || value === undefined || value === '' || value === '待计算') 
            return <Box component="span" sx={{ color: 'text.disabled' }}>{value || '—'}</Box>;

        // **新增**：如果值是 React 元素 (例如 formatDate 返回的 Box)，直接渲染
        if (React.isValidElement(value)) {
            return value;
        }

        // **核心修正 1**: 对“加班天数”进行特殊处理，不加货币符号
        if (key === '加班天数') {
            return `${value} 天`;
        }
        
        // 规则1：如果是费率，格式化为百分比
        if (key.includes('费率')) {
            const num = Number(value);
            return isNaN(num) ? String(value) : `${(num * 100).toFixed(0)}%`;
        }
        if (key === '劳务费时段') {
            if (typeof value === 'string' && value.includes('~')) {
                const [start, end] = value.split('~').map(d => d.trim());
                return `${formatDate(start)} ~ ${formatDate(end)}`;
            }
        }
        if (key === '劳务天数' && typeof value === 'string' && value.includes('|')) {
            const [mainText, tooltipText] = value.split('|').map(s => s.trim());
            return (
                <Tooltip title={tooltipText} arrow>
                    <Box component="span" sx={{ color: 'info.main', fontWeight: 'bold', cursor: 'help' }}>
                        {mainText}
                    </Box>
                </Tooltip>
            );
        }
        // 规则2：如果键名包含金额相关的词，或值是纯数字/可转为数字的字符串，则格式化为货币
        const isMoney = ['级别', '定金', '保证金', '劳务费', '管理费', '优惠', '款', '奖励', '应领', '应付', '结余'].some(k => key.includes(k));
        if (isMoney || /^-?\d+(\.\d+)?$/.test(String(value))) {
            const num = Number(value);
            return isNaN(num) ? String(value) : `¥${num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }
        
        // 规则3：其他情况直接返回字符串
        return String(value);
    };
    // 定义字段的逻辑分组和顺序
    const fieldGroups = {
        customer: {
            '合同基石': ['级别', '定金', '客交保证金'],
            '本期输入': ['加班天数', '劳务时间段', '出勤总天数'], // 修改
            '费用明细': ['管理费率', '管理费', '基本劳务费', '加班工资'], // 修改
            '财务调整': ['优惠', '客增加款', '退客户款'],
            '最终结算': ['客户付款', '是否打款', '打款时间及渠道', '发票记录']
        },
        employee: {
            '本期输入': ['出勤天数', '加班天数'], // 示例，员工侧也应分组
            '薪酬明细': ['萌嫂保证金(工资)', '加班费', '5%奖励'],
            '财务调整': ['萌嫂增款', '减萌嫂款'],
            '最终结算': ['萌嫂应领款', '是否领款', '领款时间及渠道', '实际领款', '萌嫂结余', '备注']
        }
    };
    
    const groups = isCustomerBill ? fieldGroups.customer : fieldGroups.employee;
    const allGroupedFields = Object.values(groups).flat();
    const ungroupedFields = Object.keys(data).filter(key => !allGroupedFields.includes(key));

    return (
        <Paper variant="outlined" sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Typography variant="h6" gutterBottom>{title}</Typography>
            <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {Object.entries(groups).map(([groupName, fields]) => (
                    <Box key={groupName}>
                        <Divider textAlign="left" sx={{mb: 1.5}}>
                            <Typography variant="overline" color="text.secondary">{groupName}</Typography>
                        </Divider>
                        <Grid container spacing={1.5}>
                            {fields.filter(key => data.hasOwnProperty(key)).map(key => (
                                <React.Fragment key={key}>
                                    <Grid item xs={5}><Typography variant="body2" color="text.secondary">{key}:</Typography></Grid>
                                    <Grid item xs={7}>
                                        <Typography 
                                            variant="body1" 
                                            noWrap
                                            sx={{ 
                                                textAlign: 'right',
                                                fontWeight: key.includes('应付') || key.includes('应领') ? 'bold' : 'medium',
                                                color: key.includes('应付') ? 'error.main' : (key.includes('应领') ? 'success.main' : 'text.primary'),
                                                // 特别高亮默认值
                                                ...(String(data[key]).includes('(默认)') && { fontStyle: 'italic', color: 'info.main' }),
                                            }}
                                        >
                                            {key === '劳务时间段' ? formatDateRange(data[key]) : formatValue(key, data[key])}
                                            
                                        </Typography>
                                    </Grid>
                                </React.Fragment>
                            ))}
                        </Grid>
                        {/* 将“添加增/减款”按钮放在“财务调整”组的末尾 */}
                        {groupName === '财务调整' && (
                            <Box sx={{mt: 1, textAlign: 'right'}}>
                                <Button size="small" variant="text" startIcon={<AddIcon />}>添加增/减款</Button>
                            </Box>
                        )}
                    </Box>
                ))}
                {/* 渲染任何未被分组的字段，以防万一 */}
                {ungroupedFields.length > 0 && (
                    <Box>
                        <Divider><Typography variant="overline">其他</Typography></Divider>
                        {/* ... 渲染 ungroupedFields ... */}
                    </Box>
                )}
            </Box>
        </Paper>
    );
};

const BillingDashboard = () => {
    const theme = useTheme();
    const location = useLocation();
    const navigate = useNavigate();

    const [filters, setFilters] = useState({ 
        search: '', type: '', status: '', 
        payment_status: '', payout_status: '' 
    });
    const [contracts, setContracts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [alert, setAlert] = useState({ open: false, message: '', severity: 'info' });
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(10);
    const [totalContracts, setTotalContracts] = useState(0);
    const [calculating, setCalculating] = useState(false);
    
    const [selectedBillingMonth, setSelectedBillingMonth] = useState(() => {
        const params = new URLSearchParams(location.search);
        const month = params.get('month');
        if (month && /^\d{4}-\d{2}$/.test(month)) {
            return month;
        }
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });

    const [detailDialogOpen, setDetailDialogOpen] = useState(false);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [selectedContractForDetail, setSelectedContractForDetail] = useState(null);
    const [billingDetails, setBillingDetails] = useState(null);

    // --- 新增：用于在模态框中编辑考勤的状态 ---
    const [editableAttendance, setEditableAttendance] = useState(null);
    const [savingAttendance, setSavingAttendance] = useState(false);
    // ------------------------------------------

    // +++ 新增一个 state 来存储原始的周期数据 +++
    const [currentCycle, setCurrentCycle] = useState({ start: null, end: null });
    
            const fetchBills = useCallback(async () => {
                setLoading(true);
                try {
                    const params = { page: page + 1, per_page: rowsPerPage, billing_month: selectedBillingMonth, ...filters };
                    const response = await api.get('/billing/bills', { params });
                    console.log("Fetched bills:", response.data.items); // 调试输出
                    setContracts(response.data.items || []);
                    setTotalContracts(response.data.total || 0);
                } catch (error) {
                    setAlert({ open: true, message: `获取账单列表失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
                    setContracts([]);
                    setTotalContracts(0);
                } finally {
                    setLoading(false);
                }
            }, [page, rowsPerPage, filters, selectedBillingMonth]);

            // 这是一个辅助函数，确保在任何地方都能正确转换合同类型文本
            
            const get_contract_type_details = (contract_type) => {
                console.log("Contract type received:", contract_type); // 调试输出
                if (contract_type === 'nanny') return '育儿嫂';
                if (contract_type === 'maternity_nurse') return '月嫂';
                if (contract_type === 'nanny_trial') return '育儿嫂试工';
                return '未知类型';
            };

            useEffect(() => {
                const params = new URLSearchParams(location.search);
                const openBillId = params.get('open_bill_id');

                // 新的、健壮的函数，负责处理从查找、获取列表到打开弹窗的完整流程
                const findAndLoadBill = async (billId) => {
                    setLoading(true);
                    try {
                        // 第1步：调用 find API 找到账单的位置和基本信息
                        const findResponse = await api.get('/billing/bills/find', {
                            params: { bill_id: billId, per_page: rowsPerPage }
                        });

                        const { bill_details, page: targetPage, billing_month, context } = findResponse.data;

                        // 第2步：使用找到的页码，立即获取那一页的完整列表数据
                        const listResponse = await api.get('/billing/bills', {
                            params: { page: targetPage + 1, per_page: rowsPerPage, billing_month: billing_month, ...filters }
                        });

                        // 第3步：一次性更新所有状态，避免中间的无效状态
                        setContracts(listResponse.data.items || []);
                        setTotalContracts(listResponse.data.total || 0);
                        setPage(targetPage); // 现在更新 page 是安全的，因为 totalContracts 也被同时更新了
                        setSelectedBillingMonth(billing_month);

                        // 第4步：用已经获取到的数据打开弹窗
                        const billContextForModal = {
                            ...context,
                            // contract_type_label: get_contract_type_details(context.contract_type_value),
                        };
                        setSelectedContractForDetail(billContextForModal);
                        setBillingDetails(bill_details);

                        if (bill_details.cycle_start_date && bill_details.cycle_end_date) {
                            setCurrentCycle({ start: bill_details.cycle_start_date, end: bill_details.cycle_end_date });
                        }
                        if (bill_details.attendance) {
                            setEditableAttendance({ overtime_days: parseInt(bill_details.attendance.overtime_days, 10) || 0 });
                        }

                        setDetailDialogOpen(true);

                    } catch (error) {
                        setAlert({ open: true, message: `无法定位并加载账单: ${error.response?.data?.error || error.message}`, severity: 'error' });
                        // 如果任何一步失败，回退到加载默认列表
                        fetchBills();
                    } finally {
                        setLoading(false); // 无论成功失败，最后都停止加载动画
                        navigate(location.pathname, { replace: true }); // 清理URL
                    }
                };

                if (openBillId) {
                    findAndLoadBill(openBillId);
                } else {
                    fetchBills();
                }
            // 这个useEffect只应该在核心筛选条件变化时运行
            }, [page, rowsPerPage, filters, selectedBillingMonth]);


    const handleOpenOnboardingDateModal = (contracts_to_set) => {
        // +++++++++++++++++++++++++++++++++++++++++++++

        if (Array.isArray(contracts_to_set)) {
            // 场景1: 从 /pre-check API 传来
            setContractsMissingDate(contracts_to_set);
        } 
        else {
            const singleContract = contracts_to_set;
            setContractsMissingDate([singleContract]);
        }
        
        setPreCheckDialogOpen(true);
    };

    // ---  设置轮询 ---
    const handleTaskCompletion = useCallback((taskData, taskType) => {
        if (taskType === 'calculate_bills') {
        setAlert({ open: true, message: `账单计算任务已成功完成！`, severity: 'success' });
        fetchBills(); // 任务成功后，刷新列表以显示最新计算结果
        }
        // 这里可以为其他类型的任务（如同步）添加处理逻辑
    }, [fetchBills]); // 依赖 fetchBills

    const handleTaskFailure = useCallback((taskData, taskType) => {
        setAlert({ 
        open: true, 
        message: `任�� (${taskType}) 失败: ${taskData.error_message || '未知错误，请检查后台日志。'}`, 
        severity: 'error' 
        });
    }, []);

    const { pollingTask, isPolling, startPolling } = useTaskPolling(handleTaskCompletion, handleTaskFailure);
    // ---------------------

    const handleFilterChange = (e) => {
        setPage(0);
        setFilters(prev => ({ ...prev, [e.target.name]: e.target.value }));
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


    const handleOpenDetailDialog = async (bill) => {
        setSelectedContractForDetail(bill);
        setDetailDialogOpen(true);
        setLoadingDetail(true);
        try {
            const response = await api.get('/billing/details', { params: { bill_id: bill.id } });
            const responseData = response.data;
            setBillingDetails(responseData);
    
            // --- 核心修正：直接从API响应的顶层获取准确的周期日期 ---
            if (responseData.cycle_start_date && responseData.cycle_end_date) {
                setCurrentCycle({
                    start: responseData.cycle_start_date,
                    end: responseData.cycle_end_date
                });
            } else {
                // 如果万一没有返回，做一个安全的回退
                setCurrentCycle({ start: null, end: null });
                console.error("API did not return cycle_start_date or cycle_end_date at the top level.");
            }
            // (原有的 setEditableAttendance 逻辑保持不变)
            let initialAttendance = { overtime_days: 0 };
            if (responseData.attendance?.overtime_days) {
                initialAttendance.overtime_days = parseInt(responseData.attendance.overtime_days, 10) || 0;
            }
            setEditableAttendance(initialAttendance);
    
        } catch (error) {
            setAlert({ open: true, message: `获取详情失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
            setBillingDetails(null);
        } finally {
            setLoadingDetail(false);
        }
    };

    const handleCloseDetailDialog = () => {
        setDetailDialogOpen(false);
        setSelectedContractForDetail(null);
        setBillingDetails(null);
        setEditableAttendance(null); // 关闭时清空

    };

    // 2. 新增一个函数来处理从模态框传回的保存事件
    const handleSaveChanges = async (editedData) => {
        if (!selectedContractForDetail || !currentCycle.start) {
            setAlert({ open: true, message: '无法保存，缺少合同或周期信息。', severity: 'error' });
            return;
        }
        
        setLoadingDetail(true); // 让模态框显示加载中
        try {
            const payload = {
            bill_id: editedData.bill_id,
                
                // 考勤数据
                overtime_days: editedData.overtime_days,

                // 财务调整数据
                adjustments: editedData.adjustments,

                // 结算状态数据
                settlement_status: editedData.settlement_status
            };


            // const response = await api.post('/billing/attendance', payload);
            const response = await api.post('/billing/batch-update', payload);

            setBillingDetails(response.data.latest_details); // 用返回的最新数据更新详情
            setAlert({ open: true, message: response.data.message, severity: 'success' });

        } catch (error) {
            setAlert({ open: true, message: `保存失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        } finally {
            setLoadingDetail(false);
        }
    };

    // --- 新增：处理考勤表单编辑和保存的函数 ---
    const handleAttendanceChange = (e) => {
        const { name, value } = e.target;
        setEditableAttendance(prev => ({...prev, [name]: parseInt(value, 10) || 0 }));
    };

    const handleSaveAttendance = async () => {
        if (!selectedContractForDetail || !editableAttendance || !billingDetails) return;
        
        // 从账单详情中获取劳务费时段，这是最可靠的周期来源
        const cycleRange = billingDetails.customer_bill_details?.劳务费时段;
         // **核心修正**：直接从 state 中获取清晰的周期日期
        if (!currentCycle.start || !currentCycle.end) {
            setAlert({ open: true, message: "无法确定当前考勤周期，保存失败。", severity: 'error' });
            return;
        }

        setSavingAttendance(true);
        try {
          // 构建后端需要的、正确的 payload
          const payload = {
              contract_id: selectedContractForDetail.id,
              cycle_start_date: currentCycle.start,
              cycle_end_date: currentCycle.end,
              overtime_days: editableAttendance.overtime_days,
              billing_year: new Date(currentCycle.start).getFullYear(), // 从周期中推断年月
              billing_month: new Date(currentCycle.start).getMonth() + 1,
          };
          
          const response = await api.post('/billing/attendance', payload);
          const newDetails = response.data.latest_details;

          // +++ 核心修正：直接用返回的新数据更新状态 +++
          setBillingDetails(newDetails);
          // 同时，用新数据中的考勤来更新输入框
          // if (newDetails.attendance) {
          //     setEditableAttendance({
          //         total_days_worked: newDetails.attendance.total_days_worked,
          //         statutory_holiday_days: newDetails.attendance.statutory_holiday_days,
          //     });
          // }
          // **同时**，用返回的最新考勤数据，更新控制输入框的 state
          if (newDetails && newDetails.attendance) {
              setEditableAttendance({
                  overtime_days: newDetails.attendance.overtime_days,
                  // 未来如果还有其他考勤字段，也在这里更新
              });
          }
          setAlert({ open: true, message: response.data.message, severity: 'success' });

        } catch (error) {
            setAlert({ open: true, message: `保存考勤失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        } finally {
            setSavingAttendance(false);
        }
    };
    
    const [preCheckDialogOpen, setPreCheckDialogOpen] = useState(false);
    const [contractsMissingDate, setContractsMissingDate] = useState([]);
    const [dateEditing, setDateEditing] = useState({});

    const handleCalculateBills = async () => {
        if (!selectedBillingMonth) return;
        // --- 核心修正：获取当前显示的合同ID ---
        const currentContractIds = contracts.map(c => c.id);
        if (currentContractIds.length === 0) {
            setAlert({open: true, message: "当前列表没有可计算的合同。", severity: 'info'});
            return;
        }
        // ------------------------------------
        setCalculating(true);
        try {
            const preCheckResponse = await api.post('/billing/pre-check', { 
                contract_ids: currentContractIds,
                billing_month: selectedBillingMonth // 月份信息仍然需要，以备将来使用
            });
            if (preCheckResponse.data && preCheckResponse.data.length > 0) {
                // setContractsMissingDate(preCheckResponse.data);
                handleOpenOnboardingDateModal(preCheckResponse.data); // 复用打开弹窗的函数
                // setPreCheckDialogOpen(true);
            } else {
                await submitCalculationTask();
            }
        } catch (error) {
            setAlert({ open: true, message: `预检查失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        } finally {
            setCalculating(false);
        }
    };
    
    const submitCalculationTask = async () => {
        const [year, month] = selectedBillingMonth.split('-');
        // setCalculating(true) // calculating 状态由外层函数控制
        try {
            const response = await api.post('/billing/calculate-bills', { year: parseInt(year), month: parseInt(month) });
            if (response.data?.task_id) {
                startPolling(response.data.task_id, 'calculate_bills', `正在为 ${year}-${month} 计算账单...`);
                setAlert({ open: true, message: '计算任务已提交...', severity: 'info' });
            }
        } catch (error) {
            setAlert({ open: true, message: `提交计算任务失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        } finally {
            // setCalculating(false)
        }
    };

    const handleSetOnboardingDate = async (contractId, newDate) => {
        if (!newDate) return;
        try {
            await api.put(`/billing/contracts/${contractId}`, { actual_onboarding_date: newDate.toISOString().split('T')[0] });
            setContractsMissingDate(prev => prev.filter(c => c.id !== contractId));
            setDateEditing(prev => { const next = {...prev}; delete next[contractId]; return next; });
            setAlert({open: true, message: "上户日期已更新！", severity: 'success'});
        } catch (error) {
            setAlert({open: true, message: `更新日期失败: ${error.response?.data?.error || error.message}`, severity: 'error'});
        }
    };

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
      <Box>
        <AlertMessage open={alert.open} message={alert.message} severity={alert.severity} onClose={() => setAlert(prev => ({...prev, open: false}))} />
        <PageHeader title="月度账单管理" description="选特定月份的待结算账单，并进行财务管理。" />
        <Card sx={{ 
          boxShadow: '0 0 2rem 0 rgba(136, 152, 170, .15)',
          backgroundColor: 'white',
          borderRadius: '0.375rem'
        }}>
          <CardHeader
            sx={{ p: 3 }}
            title={
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} sm={6} md={3}>
                  <TextField fullWidth label="搜索客户/员工" name="search" value={filters.search} onChange={handleFilterChange} size="small" variant="outlined" />
                </Grid>
                <Grid item xs={6} sm={3} md={2}>
                  <FormControl fullWidth size="small"><InputLabel>合同类型</InputLabel><Select name="type" value={filters.type} label="合同类型" onChange={handleFilterChange}><MenuItem value=""><em>全部</em></MenuItem><MenuItem value="nanny">育儿嫂</MenuItem><MenuItem value="maternity_nurse">月嫂</MenuItem><MenuItem value="nanny_trial">育儿嫂试工</MenuItem></Select></FormControl>
                </Grid>
                <Grid item xs={6} sm={3} md={2}>
                  <FormControl fullWidth size="small"><InputLabel>合同状态</InputLabel><Select name="status" value={filters.status} label="合同状态" onChange={handleFilterChange}><MenuItem value=""><em>全部</em></MenuItem><MenuItem value="active">执行中</MenuItem><MenuItem value="finished">已结束</MenuItem><MenuItem value="terminated">已终止</MenuItem></Select></FormControl>
                </Grid>

                <Grid item xs={6} sm={3} md={2}>
                    <FormControl fullWidth size="small">
                        <InputLabel>客户付款状态</InputLabel>
                        <Select name="payment_status" value={filters.payment_status} label="客户付款状态" onChange={handleFilterChange}>
                            <MenuItem value=""><em>全部</em></MenuItem>
                            <MenuItem value="paid">已付款</MenuItem>
                            <MenuItem value="unpaid">未付款</MenuItem>
                        </Select>
                    </FormControl>
                </Grid>
                <Grid item xs={6} sm={3} md={2}>
                    <FormControl fullWidth size="small">
                        <InputLabel>员工领款状态</InputLabel>
                        <Select name="payout_status" value={filters.payout_status} label="员工领款状态" onChange={handleFilterChange}>
                            <MenuItem value=""><em>全部</em></MenuItem>
                            <MenuItem value="paid">已领款</MenuItem>
                            <MenuItem value="unpaid">未领款</MenuItem>
                        </Select>
                    </FormControl>
                </Grid>
                {/* 将操作按钮放在一个自适应的Grid item中 */}
                <Grid item xs={12} md sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2, flexWrap: 'wrap' }}>
                  <TextField label="账单月份" type="month" size="small" value={selectedBillingMonth} onChange={(e) => setSelectedBillingMonth(e.target.value)} InputLabelProps={{ shrink: true }} />
                  <Tooltip title={`计算 ${selectedBillingMonth} 的所有账单`}>
                      <span>
                          <Button
                              variant="contained"
                              color="success"
                              onClick={handleCalculateBills}
                              // 当正在初始提交(calculating)或正在轮询(isPolling)时都禁用
                              disabled={calculating || isPolling}
                              startIcon={(calculating || isPolling) ? <CircularProgress size={20} color="inherit" /> : <CalculateIcon />}
                          >
                              {isPolling ? (pollingTask?.message || '计算中...') : (calculating ? '提交中...' : '计算账单')}
                          </Button>
                      </span>
                  </Tooltip>
                  <Button variant="contained" onClick={handleTriggerSync} disabled={syncing} startIcon={syncing ? <CircularProgress size={20} color="inherit" /> : <SyncIcon />}>同步</Button>
                </Grid>
              </Grid>
            }
          />
          <CardContent sx={{ p: 3 }}>
            <TableContainer component={Paper} sx={{ boxShadow: 'none', border: '1px solid rgba(0, 0, 0, 0.1)', borderRadius: '0.375rem' }}>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>客户姓名</TableCell>
                    <TableCell>服务人员</TableCell>
                    <TableCell>合同类型</TableCell>
                    <TableCell>合同周期</TableCell>
                    <TableCell>劳务时间段</TableCell>
                    <TableCell>状态</TableCell>
                    <TableCell>月服务费/级别</TableCell>
                    <TableCell>本月应付/应收</TableCell>
                    <TableCell align="center">操作</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {loading ? ( <TableRow><TableCell colSpan={7} align="center" sx={{py: 5}}><CircularProgress /></TableCell></TableRow> )
                  : (
                    (contracts).map((bill) => (
                      <TableRow hover key={bill.id}>
                        <TableCell sx={{color: '#525f7f', fontWeight: 'bold'}}>
                            {bill.customer_name}
                            {bill.is_substitute_bill && <Chip label="替" size="small" color="warning" sx={{ ml: 1 }} />}
                        </TableCell>
                        <TableCell sx={{color: '#525f7f'}}>{bill.employee_name}</TableCell>
                        <TableCell><Chip label={bill.contract_type_label} size="small" sx={{ 
                            backgroundColor: bill.contract_type_value === 'nanny' 
                                ? alpha(theme.palette.primary.light, 0.2) 
                                : bill.contract_type_value === 'nanny_trial' 
                                    ? alpha(theme.palette.warning.light, 0.2) 
                                    : alpha(theme.palette.info.light, 0.2), 
                            color: bill.contract_type_value === 'nanny' 
                                ? theme.palette.primary.dark 
                                : bill.contract_type_value === 'nanny_trial' 
                                    ? theme.palette.warning.dark 
                                    : theme.palette.info.dark, 
                            fontWeight: 600 }}/></TableCell>
                        <TableCell>
                            <Typography variant="body2" sx={{ fontFamily: 'monospace', lineHeight: 1.5, whiteSpace: 'nowrap' }}>
                                {bill.contract_period ? bill.contract_period.split(' ~ ')[0] : '—'}
                                <br />
                                {bill.contract_period ? `~ ${bill.contract_period.split(' ~ ')[1]}` : '—'}
                            </Typography>
                        </TableCell>
                        <TableCell>
                          {bill.active_cycle_start && bill.active_cycle_end ? (
                            <Typography 
                              variant="body2" 
                              sx={{ 
                                fontWeight: 'medium', 
                                fontFamily: 'monospace',
                                lineHeight: 1.5
                              }}
                            >
                              {/* 直接显示这个跨月的、与当前账单月相关的26天服务周期 */}
                              {formatDate(bill.active_cycle_start)}
                              <br />
                              {formatDate(bill.active_cycle_end)}
                            </Typography>
                          ) : (
                            // 如果合同在本月没有服务周期，则显示占位符
                            <Tooltip title="点击设置实际上户日期" arrow>
                              <Chip
                                  icon={<EventBusyIcon />}
                                  label="未确认上户日期"
                                  size="small"
                                  variant="outlined"
                                  onClick={() => handleOpenOnboardingDateModal(bill)}
                                  sx={{
                                      borderColor: 'grey.400',
                                      borderStyle: 'dashed',
                                      color: 'text.secondary',
                                      cursor: 'pointer',
                                      '& .MuiChip-icon': {
                                          color: 'grey.500',
                                      },
                                      '&:hover': {
                                          backgroundColor: 'action.hover',
                                          borderColor: 'grey.600',
                                          color: 'text.primary',
                                      },
                                  }}
                              />
                          </Tooltip>
                          )}
                        </TableCell>

                        <TableCell><Chip label={bill.status} size="small" color={bill.status === 'active' ? 'success' : 'default'} /></TableCell>
                        
                        <TableCell sx={{color: '#525f7f', fontWeight: 'bold'}}>{formatValue('级别', bill.employee_level)}</TableCell>

                        <TableCell>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                <Tooltip title="客户应付款 / 支付状态">
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Typography sx={{ fontWeight: 'bold', color: 'error.main', width: '100px' }}>
                                            {bill.customer_payable ? `¥${bill.customer_payable}` : '待计算'}
                                        </Typography>
                                        {bill.customer_is_paid === true && <CheckCircleIcon color="success" fontSize="small" />}
                                        {bill.customer_is_paid === false && <HighlightOffIcon color="disabled" fontSize="small" />}
                                    </Box>
                                </Tooltip>
                                <Tooltip title="员工应领款 / 领款状态">
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Typography sx={{ fontWeight: 'bold', color: 'success.main', width: '100px' }}>
                                            {bill.employee_payout ? `¥${bill.employee_payout}` : '待计算'}
                                        </Typography>
                                        {bill.employee_is_paid === true && <CheckCircleIcon color="success" fontSize="small" />}
                                        {bill.employee_is_paid === false && <HighlightOffIcon color="disabled" fontSize="small" />}
                                    </Box>
                                </Tooltip>
                            </Box>
                        </TableCell>
                        <TableCell align="center">
                          <Button variant="contained" size="small" startIcon={<EditIcon />} onClick={() => handleOpenDetailDialog(bill)}>管理</Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              <TablePagination component="div" count={totalContracts} page={page} onPageChange={(e, newPage) => setPage(newPage)} rowsPerPage={rowsPerPage} onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }} labelRowsPerPage="每页行数:" />
            </TableContainer>
          </CardContent>
        </Card>
        {/* 3. 调用新的模态框组件，并传递所有需要的 props */}
        {detailDialogOpen && (
            <FinancialManagementModal
                open={detailDialogOpen}
                onClose={handleCloseDetailDialog}
                contract={selectedContractForDetail}
                billingMonth={selectedBillingMonth}
                billingDetails={billingDetails}
                loading={loadingDetail}
                onSave={handleSaveChanges}
            />
        )}
        
      {/* --- 预检查对话框 --- */}
      <Dialog 
        open={preCheckDialogOpen} 
        onClose={() => setPreCheckDialogOpen(false)} 
        maxWidth="md" fullWidth>
          <DialogTitle>上户日期确认</DialogTitle>
          <DialogContent>
              {/* <Alert severity="warning" sx={{mb: 2}}>以下合同缺少“实际上户日期”，将不会被计算。请为它们设置日期，或直接继续计算已有日期的合同。</Alert> */}
              <Alert severity="warning" sx={{mb: 2}}>
                  {contractsMissingDate.length > 1 
                      ? "以下合同缺少“实际上户日期”，将不会被计算。请为它们设置日期，或直接继续计算已有日期的合同。"
                      : "该合同缺少“实际上户日期”，请��置后才能进行财务管理。"}
              </Alert>
              <TableContainer component={Paper}>
                  <Table size="small">
                      <TableHead><TableRow><TableCell>客户</TableCell><TableCell>员工</TableCell><TableCell>预产期</TableCell><TableCell>设置实际上户日期</TableCell></TableRow></TableHead>
                      <TableBody>
                          {contractsMissingDate.map(c => (
                              <TableRow key={c.id}>
                                  <TableCell>{c.customer_name}</TableCell>
                                  <TableCell>{c.employee_name}</TableCell>
                                  <TableCell>{formatDate(c.provisional_start_date)}</TableCell>
                                  <TableCell>
                                      <DatePicker
                                          value={dateEditing[c.id] || null}
                                          onChange={(newDate) => setDateEditing(prev => ({...prev, [c.id]: newDate}))}
                                          slots={{ textField: (params) => <TextField {...params} size="small" /> }}
                                          onAccept={(newDate) => handleSetOnboardingDate(c.id, newDate)}
                                          format="yyyy-MM-dd"
                                      />
                                  </TableCell>
                              </TableRow>
                          ))}
                      </TableBody>
                  </Table>
              </TableContainer>
          </DialogContent>
          <DialogActions>
              <Button onClick={() => setPreCheckDialogOpen(false)}>稍后设置</Button>
              <Button 
                  variant="contained" 
                  onClick={async () => {
                      setPreCheckDialogOpen(false);
                      await submitCalculationTask();
                  }}
                  disabled={calculating || isPolling}
              >
                  仍然计算
              </Button>
          </DialogActions>
      </Dialog>
    </Box>
  </LocalizationProvider>
  );
};

export default BillingDashboard;