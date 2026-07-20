// frontend/src/components/DashboardPage.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Paper, Box, Typography, Grid, CircularProgress, List, ListItem,ListItemText, ListItemIcon, Divider, Chip, Button,Tooltip, Stack, Dialog, DialogTitle, DialogContent, DialogActions, Alert, TextField, MenuItem,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow
} from '@mui/material';
import {
    AccountBalanceWallet as AccountBalanceWalletIcon,
    Event as EventIcon, // 用于预产期
    EventBusy as EventBusyIcon,
    Groups as GroupsIcon,
    TrendingUp as TrendingUpIcon,
    Assignment as AssignmentIcon,
    ArrowForward as ArrowForwardIcon,
    Badge as BadgeIcon,
    PieChart as PieChartIcon,
    CheckCircle as CheckCircleIcon,
    Cancel as CancelIcon,
    OpenInNew as OpenInNewIcon,
    EventNote as EventNoteIcon,
} from '@mui/icons-material';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import ReactApexChart from 'react-apexcharts';
import { useTheme } from '@mui/material/styles';

import api from '../api/axios';
import PageHeader from './PageHeader';
import FinancialManagementModal from './FinancialManagementModal';
import AlertMessage from './AlertMessage';
import { useTrialConversion } from '../hooks/useTrialConversion.js';
import TrialConversionDialog from './modals/TrialConversionDialog.jsx';

// KPI 卡片组件 (保持不变)
const KpiCard = ({ icon, title, value, subtitle, color }) => {
    const theme = useTheme();
    const colorMap = {
        indigo: theme.palette.primary,
        emerald: theme.palette.success,
        amber: theme.palette.warning,
        sky: theme.palette.info,
        error: theme.palette.error,
        warning: theme.palette.warning,
    };
    const selectedColor = colorMap[color] || theme.palette.primary;

    return (
        <Paper
            elevation={2}
            sx={{
                p: { xs: 2, md: 1.75 },
                borderRadius: 3,
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                minWidth: 0,
                transition: 'all 0.3s',
                '&:hover': { transform: 'translateY(-3px)', boxShadow: 6 },
            }}
        >
            <Box
                sx={{
                    p: 1.25,
                    bgcolor: selectedColor.light,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                }}
            >
                {icon}
            </Box>
            <Box ml={1.5} minWidth={0} flex={1}>
                <Typography
                    variant="body2"
                    color="text.secondary"
                    noWrap
                    title={typeof title === 'string' ? title : undefined}
                >
                    {title}
                </Typography>
                <Typography
                    variant="h6"
                    component="p"
                    sx={{
                        fontWeight: 'bold',
                        lineHeight: 1.25,
                        wordBreak: 'break-word',
                        fontSize: { xs: '1.1rem', md: '1rem', lg: '1.15rem' },
                    }}
                >
                    {value}
                </Typography>
                {subtitle && (
                    <Typography variant="caption" color="text.secondary" noWrap display="block" title={subtitle}>
                        {subtitle}
                    </Typography>
                )}
            </Box>
        </Paper>
    );
};

// 待办事项列表项组件 (修改)
const TodoListItem = ({ primary, secondary, amount, amountColor, type, onClick}) => {
    const iconStyles = {
        expiring: { icon: <EventBusyIcon sx={{ fontSize: 20, color: '#b45309' }} />, bg: '#fef3c7' },
        approaching: { icon: <EventIcon sx={{ fontSize: 20, color: '#0369a1' }} />, bg: '#e0f2fe' },
        payment: { icon: <AccountBalanceWalletIcon sx={{ fontSize: 20, color: '#b91c1c' }} />, bg: '#fee2e2' },
        maternity_attendance: { icon: <EventNoteIcon sx={{ fontSize: 20, color: '#0f766e' }} />, bg: '#ccfbf1' },
        default: { icon: <AssignmentIcon sx={{ fontSize: 20, color: '#4f46e5' }} />, bg: '#e0e7ff' },
    };
    const style = iconStyles[type] || iconStyles.default;
    return (
        <ListItem button onClick={onClick} sx={{ borderRadius: 2, px: 1, '&:hover': {bgcolor: 'action.hover' } }}>
            <ListItemIcon sx={{ minWidth: 44 }}>
                <Box
                    sx={{
                        width: 36,
                        height: 36,
                        borderRadius: '10px',
                        bgcolor: style.bg,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                    }}
                >
                    {style.icon}
                </Box>
            </ListItemIcon>
            <ListItemText
                primary={<Typography variant="body1" sx={{ fontWeight: 500 }}>{primary}</Typography>}
                secondary={secondary}
            />
            {amount && <Typography variant="body1" sx={{ fontWeight: 'bold', color: amountColor || 'text.primary' }}>{`¥${amount}`}</Typography>}
            <ArrowForwardIcon sx={{ ml: 1, color: 'text.disabled', fontSize: 18 }} />
        </ListItem>
    );
};

const ReceivablesSummary = ({ summary }) => {
    const theme = useTheme();

    // 为饼图准备数据和标签
    const seriesData = [
        parseFloat(summary.management_fee) || 0,
        parseFloat(summary.introduction_fee) || 0,
        parseFloat(summary.employee_first_month_fee) || 0,
        // parseFloat(summary.other_receivables) || 0
    ];

    const labels = ['管理费', '介绍费', '员工首月佣金'];

    const options = {
        chart: {
            type: 'pie', // <-- 图表类型改为 'pie'
            height: 350,
            fontFamily: theme.typography.fontFamily
        },
        labels: labels, // <-- 设置饼图的标签
        colors: [
            theme.palette.primary.main,
            theme.palette.success.main,
            theme.palette.info.main,
            theme.palette.warning.main,
        ],
        tooltip: {
            y: {
                formatter: (val) => `¥ ${val.toLocaleString()}`
            },
            theme: 'dark'
        },
        legend: {
            position: 'bottom'
        },
        title: {
            text: '应收款构成',
            align: 'center',
            style: {
                fontWeight: 'bold',
                color: theme.palette.text.primary
            }
        },
        // 优化数据标签显示，使其更易读
        dataLabels: {
            enabled: true,
            formatter: function (val, opts) {
                const name = opts.w.globals.labels[opts.seriesIndex];
                // 当数值过小时，可能不显示标签，以避免重叠
                if (val < 5) {
                    return '';
                }
                return `${name} ${val.toFixed(1)}%`;
            }
        },
        responsive: [{
            breakpoint: 480,
            options: {
                chart: {
                    width: 200
                },
                legend: {
                    position: 'bottom'
                }
            }
        }]
    };

    return (
        <Paper elevation={2} sx={{ p: 3, borderRadius: 4, height: '100%' }}>
            <ReactApexChart options={options} series={seriesData} type="pie"height={350} />
        </Paper>
    );
};


const DashboardPage = () => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [pieChartTimespan, setPieChartTimespan] = useState('this_year');
    const [isModalOpen, setIsModalOpen] = useState(false); // <-- 2. 弹窗开关
    const [selectedBillDetails, setSelectedBillDetails] = useState(null); // <-- 3. 存储账单详情
    const [isModalLoading, setIsModalLoading] = useState(false); // <-- 4. 弹窗内部的加载状态
    const navigate = useNavigate(); 
    const theme = useTheme();
    const [pendingTrials, setPendingTrials] = useState([]);

    const [alert, setAlert] = useState({ open: false, message: '', severity:'info' });

    // --- 用于弹窗的状态 ---
    // const [contractToProcess, setContractToProcess] = useState(null);
    // const [terminationDialogOpen, setTerminationDialogOpen] = useState(false);
    // const [terminationDate, setTerminationDate] = useState(null);
    // const [conversionDialogOpen, setConversionDialogOpen] = useState(false);
    // const [eligibleContracts, setEligibleContracts] = useState([]);
    // const [loadingEligible, setLoadingEligible] = useState(false);
    // const [selectedFormalContractId, setSelectedFormalContractId] = useState('');

    // --- “试工失败”的逻辑 ---
    const [terminationDialogOpen, setTerminationDialogOpen] = useState(false);
    const [terminationDate, setTerminationDate] = useState(null);
    const [contractToProcess, setContractToProcess] = useState(null);
    // --- 逻辑结束 ---

    // 待确认月嫂考勤弹窗
    const [maternityAttendanceDialogOpen, setMaternityAttendanceDialogOpen] = useState(false);


    const formatDate = (isoString) => {
        if (!isoString) return '—';
        try {
            const date = new Date(isoString);
            if (isNaN(date.getTime())) return '无效日期';
            return date.toLocaleDateString('zh-CN', { year: 'numeric', month:'2-digit', day: '2-digit' });
        } catch (e) { return '无效日期'; }
    };

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            const [summaryRes, trialsRes] = await Promise.all([
                api.get('/billing/dashboard/summary'),
                api.get('/billing/contracts/pending-trials')
            ]);
            setData(summaryRes.data);

            // 过滤掉2025年之前的试工合同
            const twentyTwentyFive = new Date('2025-09-01');
            const filteredTrials = trialsRes.data.filter(c => {
                // 如果合同没有结束日期，则不应出现在“待处理”列表中
                if (!c.start_date) {
                    return false;
                }
                const startDate = new Date(c.start_date);
                // 只显示2025年1月1日及以后结束的待处理合同
                return startDate >= twentyTwentyFive;
            });
            setPendingTrials(filteredTrials);

        } catch (err) {
            setError('加载仪表盘数据失败，请稍后重试。');
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, []);


    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const refreshPendingTrials = async () => {
        try {
            const trialsRes = await api.get('/billing/contracts/pending-trials');
            const twentyTwentyFive = new Date('2025-09-01');
            const filteredTrials = trialsRes.data.filter(c => {
                if (!c.end_date) {
                    return false;
                }
                const endDate = new Date(c.end_date);
                return endDate >= twentyTwentyFive;
            });
            setPendingTrials(filteredTrials);
        } catch (err) {
            console.error("Failed to refresh pending trials:", err);
            setAlert({ open: true, message: '刷新待处理列表失败', severity: 'error' });
        }
    };

    const conversionActions = useTrialConversion((formalContractId) => {
        // 无论用户选择哪个按钮，我们都先刷新待办列表
        refreshPendingTrials();

        // 如果 formalContractId 存在 (意味着用户点击了“查看正式合同”)，则执行跳转
        if (formalContractId) {
            navigate(`/contract/detail/${formalContractId}`);
        }
    });

    /** 打开 Web 版考勤（管理端只读/可查看填写与签署） */
    const openMaternityAttendance = (item) => {
        if (!item) return;
        // 待确认上户：跳转合同详情，运营可查看/设置上户日
        if (item.status === 'need_onboarding') {
            if (item.contract_id) {
                navigate(`/contract/detail/${item.contract_id}`);
            }
            return;
        }
        // 有表用 form_id；无表（仅有上户日占位）用员工 token + 周期，进入考勤页自动建表
        const token = item.form_id || item.employee_access_token || item.employee_id;
        if (!token) {
            if (item.contract_id) {
                navigate(`/contract/detail/${item.contract_id}`);
            } else {
                setAlert({ open: true, message: '暂无可用考勤链接', severity: 'warning' });
            }
            return;
        }
        const params = new URLSearchParams();
        if (item.cycle_start_date) {
            const d = new Date(item.cycle_start_date);
            if (!Number.isNaN(d.getTime())) {
                params.set('year', String(d.getFullYear()));
                params.set('month', String(d.getMonth() + 1));
            }
            params.set('cycleStart', item.cycle_start_date);
        }
        if (item.cycle_end_date) params.set('cycleEnd', item.cycle_end_date);
        if (item.contract_id) params.set('contractId', item.contract_id);
        const qs = params.toString();
        // 新窗口打开，便于运营边看列表边跟进
        window.open(`/attendance-admin/${token}${qs ? `?${qs}` : ''}`, '_blank');
    };

    const maternityStatusChipColor = (status) => {
        if (status === 'employee_confirmed') return 'warning';
        if (status === 'draft') return 'info';
        if (status === 'need_onboarding') return 'error';
        return 'default';
    };

    // --- 弹窗相关的处理函数 ---
    const handleOpenTerminationDialog = (contract) => {
        setContractToProcess(contract);
        const defaultDate = contract.start_date ? new Date(contract.start_date) : new Date();
        setTerminationDate(defaultDate);
        setTerminationDialogOpen(true);
    };

    const handleCloseTerminationDialog = () => {
        setTerminationDialogOpen(false);
        setContractToProcess(null);
    };

    const handleConfirmTermination = async () => {
        if (!contractToProcess || !terminationDate) return;
        try {
            await api.post(`/billing/contracts/${contractToProcess.id}/terminate`, {
                termination_date: terminationDate.toISOString().split('T')[0],
            });
            setAlert({ open: true, message: '试工合同已标记为失败。',severity: 'success' });
            handleCloseTerminationDialog();
            refreshPendingTrials(); // 调用局部刷新
        } catch (error) {
            setAlert({ open: true, message: `操作失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        }
    };

    // const handleTrialSucceeded = async (contract) => {
    //     setContractToProcess(contract);
    //     const employeeId = contract.user_id || contract.service_personnel_id;

    //     setLoadingEligible(true);
    //     setConversionDialogOpen(true);
    //     setSelectedFormalContractId('');

    //     try {
    //         const response = await api.get('/billing/contracts', {
    //             params: {
    //                 customer_name: contract.customer_name,
    //                 employee_id: employeeId,
    //                 type: 'nanny',
    //                 status: 'active',
    //                 per_page: 100
    //             }
    //         });
    //         const eligible = response.data.items.filter(c => c.id !==contract.id);
    //         setEligibleContracts(eligible);
    //     } catch (error) {
    //         setAlert({ open: true, message: `获取可关联的正式合同列表失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
    //         setConversionDialogOpen(false);
    //     } finally {
    //         setLoadingEligible(false);
    //     }
    // };

    // const handleConfirmConversion = async () => {
    //     if (!selectedFormalContractId) {
    //         setAlert({ open: true, message: '请选择一个要关联的正式合同。',severity: 'warning' });
    //         return;
    //     }

    //     try {
    //         await api.post(`/billing/nanny-trial-contracts/${contractToProcess.id}/convert`, {
    //             formal_contract_id: selectedFormalContractId
    //         });

    //         setAlert({ open: true, message: '试工合同转换成功！', severity:'success' });
    //         setConversionDialogOpen(false);
    //         fetchData(); // 重新加载数据
    //     } catch (error) {
    //         setAlert({ open: true, message: `操作失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
    //     }
    // };

    // const handleCloseConversionDialog = () => {
    //     setConversionDialogOpen(false);
    //     setContractToProcess(null);
    // };

    const handleBillClick = async (billId) => {
        if (!billId) return;

        setIsModalOpen(true);
        setIsModalLoading(true);
        setSelectedBillDetails(null); // 打开时先清空旧数据

        try {
            const response = await api.get('/billing/details', { params: {bill_id: billId } });
            setSelectedBillDetails(response.data);
        } catch (error) {
            console.error("获取账单详情失败:", error);
            alert("获取账单详情失败，请检查控制台。");
            setIsModalOpen(false); // 出错时关闭弹窗
        } finally {
            setIsModalLoading(false);
        }
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setSelectedBillDetails(null); // 关闭时清空数据
    };

    const barChartOptions = {
        chart: { type: 'bar', height: 350, toolbar: { show: false }, fontFamily: theme.typography.fontFamily },
        plotOptions: { bar: { borderRadius: 8, horizontal: false, columnWidth: '55%' } },
        dataLabels: { enabled: false },
        stroke: { show: true, width: 2, colors: ['transparent'] },
        xaxis: { categories: data?.revenue_trend.categories || [], labels: { style: { colors: theme.palette.text.secondary } } },
        yaxis: { title: { text: '管理费收入 (元)', style: { color: theme.palette.text.secondary } }, labels: { style: { colors:theme.palette.text.secondary }, formatter: (value) => `¥${value.toLocaleString()}` } },
        fill: { opacity: 1 },
        tooltip: { y: { formatter: (val) => `¥ ${val.toLocaleString()}` }, theme: 'dark' },
        grid: { borderColor: theme.palette.divider, strokeDashArray: 4 },
        colors: [theme.palette.primary.main]
    };

    const pieChartData = data?.management_fee_distribution[pieChartTimespan];
    const pieChartOptions = {
        chart: { type: 'pie', height: 350, fontFamily: theme.typography.fontFamily },
        labels: pieChartData?.labels || [],
        responsive: [{ breakpoint: 480, options: { chart: { width: 200 }, legend: { position: 'bottom' } } }],
        tooltip: { y: { formatter: (val) => `¥ ${val.toLocaleString()}` }, theme: 'dark' },
        colors: [theme.palette.primary.main, theme.palette.success.main, theme.palette.warning.main, theme.palette.info.main],
        legend: { position: 'bottom' }
    };


    if (loading) {
        return <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}><CircularProgress /></Box>;
    }
    if (error) { return <Typography color="error">{error}</Typography>; }
    if (!data) { return <Typography>暂无数据。</Typography>; }

    return (
        <>
        <Box sx={{ p: 3 }}>
            <AlertMessage open={alert.open} message={alert.message}severity={alert.severity} onClose={() => setAlert(prev => ({...prev, open:false}))} />
            <PageHeader title="运营仪表盘" description={`数据更新于 ${new Date().toLocaleDateString('zh-CN')} ${new Date().toLocaleTimeString('zh-CN')}`} />

            {/* 5 个 KPI：md+ 等宽一行不换行；xs 单列 / sm 双列 */}
            <Grid
                container
                spacing={2}
                mb={4}
                sx={{
                    flexWrap: { xs: 'wrap', md: 'nowrap' },
                }}
            >
                <Grid item xs={12} sm={6} md sx={{ minWidth: 0, flex: { md: '1 1 0' }, maxWidth: { md: 'none' } }}>
                    <KpiCard icon={<TrendingUpIcon sx={{ fontSize: 28 }} />} title="年度管理费" value={`已收:¥${parseFloat(data.kpis.monthly_management_fee_received).toLocaleString()}`} subtitle={`应收:¥${parseFloat(data.kpis.monthly_management_fee_total).toLocaleString()}`} color="indigo" />
                </Grid>
                <Grid item xs={12} sm={6} md sx={{ minWidth: 0, flex: { md: '1 1 0' }, maxWidth: { md: 'none' } }}>
                    <KpiCard icon={<BadgeIcon sx={{ fontSize: 28 }} />} title="在户员工数" value={data.kpis.active_employees_count} color="amber" />
                </Grid>
                <Grid item xs={12} sm={6} md sx={{ minWidth: 0, flex: { md: '1 1 0' }, maxWidth: { md: 'none' } }}>
                    <Box onClick={() => navigate('/contracts/all?deposit_status=unpaid')} sx={{ cursor: 'pointer', height: '100%' }}>
                        <KpiCard
                            icon={<AccountBalanceWalletIcon sx={{ fontSize: 28 }} />}
                            title="待收定金"
                            value={data.kpis.pending_deposit_count}
                            subtitle="点击查看详情"
                            color="error"
                        />
                    </Box>
                </Grid>
                <Grid item xs={12} sm={6} md sx={{ minWidth: 0, flex: { md: '1 1 0' }, maxWidth: { md: 'none' } }}>
                    <KpiCard icon={<EventBusyIcon sx={{ fontSize: 28 }} />} title="即将到期合同" value={data.todo_lists.expiring_contracts.length} subtitle="30天内" color="warning" />
                </Grid>
                <Grid item xs={12} sm={6} md sx={{ minWidth: 0, flex: { md: '1 1 0' }, maxWidth: { md: 'none' } }}>
                    <Box onClick={() => setMaternityAttendanceDialogOpen(true)} sx={{ cursor: 'pointer', height: '100%' }}>
                        <KpiCard
                            icon={<EventNoteIcon sx={{ fontSize: 28, color: '#0f766e' }} />}
                            title="待确认月嫂考勤"
                            value={(data.todo_lists.pending_maternity_attendance || []).length}
                            subtitle="点击查看填写/签署情况"
                            color="sky"
                        />
                    </Box>
                </Grid>
            </Grid>

            <Grid container spacing={3}>
                <Grid item xs={12} lg={8}>
                    <Paper elevation={2} sx={{ p: 3, borderRadius: 4, height: '100%' }}>
                        <Typography variant="h6" sx={{ fontWeight: 'bold' }} gutterBottom>月度管理费收入趋势 (最近12个月)</Typography>
                        <ReactApexChart options={barChartOptions} series={data.revenue_trend.series} type="bar" height={350} />
                    </Paper>
                </Grid>
                {/* ------------------- 以下是核心修改 ------------------- */}
                    {/* 用新的应收款图表替换掉旧的饼图 */}
                    <Grid item xs={12} lg={4}>
                        {data.receivables_summary && <ReceivablesSummary summary=
                        {data.receivables_summary} />}
                    </Grid>
                    {/* ------------------- 以上是核心修改 ------------------- */}
                                <Grid item xs={12}>
                    <Paper elevation={2} sx={{ p: 3, borderRadius: 4 }}>
                        <Typography variant="h6" sx={{ fontWeight: 'bold' }}gutterBottom>核心待办事项</Typography>
                        <Grid container spacing={3}>
                            {/* 第一位：待确认月嫂考勤 */}
                            <Grid item xs={12} md={3}>
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                        <Box
                                            sx={{
                                                width: 28,
                                                height: 28,
                                                borderRadius: '8px',
                                                bgcolor: '#ccfbf1',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                            }}
                                        >
                                            <EventNoteIcon sx={{ fontSize: 18, color: '#0f766e' }} />
                                        </Box>
                                        <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 700 }}>
                                            待确认月嫂考勤
                                        </Typography>
                                        {(data.todo_lists.pending_maternity_attendance || []).length > 0 && (
                                            <Chip
                                                size="small"
                                                label={(data.todo_lists.pending_maternity_attendance || []).length}
                                                sx={{
                                                    height: 20,
                                                    fontWeight: 700,
                                                    bgcolor: '#0f766e',
                                                    color: '#fff',
                                                }}
                                            />
                                        )}
                                    </Box>
                                    {(data.todo_lists.pending_maternity_attendance || []).length > 0 && (
                                        <Button size="small" onClick={() => setMaternityAttendanceDialogOpen(true)}>
                                            全部
                                        </Button>
                                    )}
                                </Box>
                                <List dense>
                                    {(data.todo_lists.pending_maternity_attendance || []).slice(0, 5).map(item => (
                                        <TodoListItem
                                            key={'mat-att-' + item.id}
                                            onClick={() => openMaternityAttendance(item)}
                                            type="maternity_attendance"
                                            primary={`${item.customer_name} / ${item.employee_name}`}
                                            secondary={`${item.status_label}${item.cycle_start_date ? ` · ${item.cycle_start_date}~${item.cycle_end_date || ''}` : ''}`}
                                        />
                                    ))}
                                    {(data.todo_lists.pending_maternity_attendance || []).length === 0 && (
                                        <Typography variant="body2" color="text.disabled" sx={{ px: 2, py: 1 }}>暂无</Typography>
                                    )}
                                </List>
                            </Grid>
                            <Grid item xs={12} md={3}>
                                <Typography variant="subtitle2" color="text.secondary">临近预产期 (14天内)</Typography>
                                <List dense>
                                    {(data.todo_lists.approaching_provisional || []).map(c => (
                                        <TodoListItem
                                            key={'approaching-' + c.id}
                                            onClick={() => navigate(`/contract/detail/${c.id}`)}
                                            type="approaching"
                                            primary={c.customer_name}
                                            secondary={`预产期: ${c.provisional_start_date} (${c.days_until}天后)`}
                                        />
                                    ))}
                                    {(data.todo_lists.approaching_provisional || []).length === 0 && (
                                        <Typography variant="body2" color="text.disabled" sx={{ px: 2, py: 1 }}>暂无</Typography>
                                    )}
                                </List>
                            </Grid>
                            <Grid item xs={12} md={3}>
                                <Typography variant="subtitle2" color="text.secondary">本月待收管理费</Typography>
                                <List dense>
                                    {(data.todo_lists.pending_payments || []).map(p => (
                                        <TodoListItem
                                            key={'payment-' + p.bill_id}
                                            onClick={() => handleBillClick(p.bill_id)}
                                            type="payment"
                                            primary={p.customer_name}
                                            secondary={p.contract_type}
                                            amount={p.amount}
                                            amountColor="error.main"
                                        />
                                    ))}
                                    {(data.todo_lists.pending_payments || []).length === 0 && (
                                        <Typography variant="body2" color="text.disabled" sx={{ px: 2, py: 1 }}>暂无</Typography>
                                    )}
                                </List>
                            </Grid>
                            <Grid item xs={12} md={3}>
                                <Typography variant="subtitle2" color="text.secondary">即将到期合同 (30天内)</Typography>
                                <List dense>
                                    {(data.todo_lists.expiring_contracts || []).map(c=> (
                                        <TodoListItem
                                            key={'expiring-' + c.id}
                                            onClick={() => navigate(`/contract/detail/${c.id}`)}
                                            type="expiring"
                                            primary={`${c.customer_name} / ${c.employee_name}`}
                                            secondary={`${c.expires_in_days}天后到期 (${c.end_date})`}
                                        />
                                    ))}
                                    {(data.todo_lists.expiring_contracts || []).length === 0 && (
                                        <Typography variant="body2" color="text.disabled" sx={{ px: 2, py: 1 }}>暂无</Typography>
                                    )}
                                </List>
                            </Grid>
                                {pendingTrials.length > 0 && (
                                    <Grid item xs={12}>
                                        <Divider sx={{ my: 2 }} />
                                        <Typography variant="subtitle2"color="error.main">待处理试工合同</Typography>
                                        <List dense>
                                            {pendingTrials.map(c => (
                                                <ListItem
                                                    key={'trial-' + c.id}
                                                    secondaryAction={
                                                        <Stack direction="row"spacing={1}>
                                                            <Tooltip title={!c.can_convert_to_formal ? "客户与员工名下无已生效的正式合同，无法关联" : ""}>
                                                                <span>
                                                                    <Button
                                                                        size="small"
                                                                        variant="outlined"
                                                                        color="success"
                                                                        startIcon={<CheckCircleIcon />}
                                                                        onClick={() => conversionActions.openConversionDialog(c)}
                                                                        disabled={!c.can_convert_to_formal}
                                                                    >
                                                                        成功
                                                                    </Button>
                                                                </span>
                                                            </Tooltip>
                                                            <Button
                                                                size="small"
                                                                variant="outlined"
                                                                color="error"
                                                                startIcon={<CancelIcon />}
                                                                onClick={() =>handleOpenTerminationDialog(c)}
                                                            >
                                                                失败
                                                            </Button>
                                                        </Stack>
                                                    }
                                                    sx={{ borderRadius: 2,'&:hover': { bgcolor: 'action.hover' } }}
                                                >
                                                    <ListItemText
                                                        primary={<Typography variant="body1" sx={{ fontWeight: 500 }}>{c.message}</Typography>}
                                                        secondary={`客户: ${c.customer_name} | 员工:${c.employee_name} | 试工周期: ${formatDate(c.start_date)} ~ ${formatDate(c.end_date)}`}
                                                        onClick={() => navigate(`/contract/detail/${c.id}`)}
                                                        sx={{ cursor: 'pointer' }}
                                                    />
                                                </ListItem>
                                            ))}
                                        </List>
                                    </Grid>
                                )}
                        </Grid>
                    </Paper>
                </Grid>
            </Grid>
            {/* 待确认月嫂考勤详情弹窗 */}
            <Dialog
                open={maternityAttendanceDialogOpen}
                onClose={() => setMaternityAttendanceDialogOpen(false)}
                fullWidth
                maxWidth="md"
            >
                <DialogTitle>
                    待确认月嫂考勤
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        用于运营跟进：提醒月嫂填写/提交考勤，并跟进客户签署。点击「查看考勤」打开 Web 考勤页。
                    </Typography>
                </DialogTitle>
                <DialogContent dividers>
                    {(data?.todo_lists?.pending_maternity_attendance || []).length === 0 ? (
                        <Alert severity="success">当前没有待确认的月嫂考勤。</Alert>
                    ) : (
                        <TableContainer>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>客户</TableCell>
                                        <TableCell>员工</TableCell>
                                        <TableCell>考勤周期</TableCell>
                                        <TableCell>状态</TableCell>
                                        <TableCell align="right">操作</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {(data.todo_lists.pending_maternity_attendance || []).map((item) => (
                                        <TableRow key={item.id} hover>
                                            <TableCell>{item.customer_name || '—'}</TableCell>
                                            <TableCell>{item.employee_name || '—'}</TableCell>
                                            <TableCell>
                                                {item.cycle_start_date
                                                    ? `${item.cycle_start_date} ~ ${item.cycle_end_date || '—'}`
                                                    : '—'}
                                            </TableCell>
                                            <TableCell>
                                                <Chip
                                                    size="small"
                                                    color={maternityStatusChipColor(item.status)}
                                                    label={item.status_label || item.status}
                                                />
                                            </TableCell>
                                            <TableCell align="right">
                                                <Stack direction="row" spacing={1} justifyContent="flex-end">
                                                    <Button
                                                        size="small"
                                                        variant="outlined"
                                                        onClick={() => item.contract_id && navigate(`/contract/detail/${item.contract_id}`)}
                                                    >
                                                        合同
                                                    </Button>
                                                    <Button
                                                        size="small"
                                                        variant="contained"
                                                        endIcon={<OpenInNewIcon fontSize="small" />}
                                                        onClick={() => openMaternityAttendance(item)}
                                                    >
                                                        {item.status === 'need_onboarding' ? '去处理上户' : '查看考勤'}
                                                    </Button>
                                                </Stack>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => navigate('/attendance-management')}>打开考勤管理</Button>
                    <Button onClick={() => setMaternityAttendanceDialogOpen(false)} variant="contained">关闭</Button>
                </DialogActions>
            </Dialog>

            {/* --- 5. 在这里添加弹窗组件的渲染 --- */}
            {isModalOpen && (
                <FinancialManagementModal
                    open={isModalOpen}
                    onClose={handleCloseModal}
                    // billingDetails={selectedBillDetails}
                    // loading={isModalLoading}
                    // contract={selectedBillDetails?.contract_info}
                    // billingMonth={selectedBillDetails?.billing_month}
                    billId={selectedBillDetails?.customer_bill_details?.id}
                    onSave={() => {
                        // 仪表盘是只读的，但 onSave 是必需的 prop，我们提供一个空实现
                        // 如果需要刷新，可以在这里重新获取仪表盘数据
                    }}
                    onNavigateToBill={handleBillClick} // 允许在弹窗内部跳转到另一个账单
                />
            )}
        </Box>
        {/* --- 在这里添加“试工成功”弹窗 ---
        <Dialog open={conversionDialogOpen}onClose={handleCloseConversionDialog} fullWidth maxWidth="sm">
            <DialogTitle>关联到正式合同</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" color="text.secondary" sx={{mb: 2 }}>
                        请为这个成功的试工合同选择一个要转入的正式育儿嫂合同。试工期间的费用将会附加到所选正式合同的第一个账单上。
                    </Typography>

                    {loadingEligible ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center',my: 3 }}>
                            <CircularProgress />
                        </Box>
                    ) : eligibleContracts.length > 0 ? (
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
                        <Alert severity="warning">
                            客户({contractToProcess?.customer_name})-员工({contractToProcess?.employee_name}):尚未签订正式育儿嫂合同,无法关联。
                            <br/>
                            请先签署正式合同后再执行此操作。
                        </Alert>
                    )}
                </DialogContent>
            <DialogActions>
                <Button onClick={handleCloseConversionDialog}>取消</Button>
                <Button
                    onClick={handleConfirmConversion}
                    variant="contained"
                    color="primary"
                    disabled={!selectedFormalContractId || loadingEligible}
                >
                    确认并转换
                </Button>
            </DialogActions>
        </Dialog> */}
        {/* --- 添加“试工失败”弹窗 --- */}
        <Dialog open={terminationDialogOpen}onClose={handleCloseTerminationDialog}>
            <DialogTitle>确认试工失败</DialogTitle>
            <DialogContent>
                <Alert severity="warning" sx={{ mt: 1, mb: 2 }}>
                    您正在为 <b>{contractToProcess?.customer_name}({contractToProcess?.employee_name})</b> 的合同标记为“试工失败”。
                    <br/>
                    此操作将把合同的最终状态设置为“已终止”。
                </Alert>
                <DatePicker
                    label="终止日期"
                    value={terminationDate}
                    onChange={(date) => setTerminationDate(date)}
                    minDate={contractToProcess?.start_date ? new Date(contractToProcess.start_date) : undefined}
                    sx={{ width: '100%', mt: 1 }}
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={handleCloseTerminationDialog}>取消</Button>
                <Button onClick={handleConfirmTermination} variant="contained" color="error">确认失败</Button>
            </DialogActions>
        </Dialog>

        {/* --- 添加“试工成功”弹窗 --- */}
        <TrialConversionDialog {...conversionActions} />
        </>
    );
};

export default DashboardPage;