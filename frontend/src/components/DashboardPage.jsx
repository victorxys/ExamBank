// frontend/src/components/DashboardPage.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Paper, Box, Typography, Grid, CircularProgress, List, ListItem, ListItemText, ListItemIcon, Divider, Chip,ToggleButtonGroup, ToggleButton } from '@mui/material';
import {
    AccountBalanceWallet as AccountBalanceWalletIcon,
    Event as EventIcon, // 用于预产期
    EventBusy as EventBusyIcon,
    Groups as GroupsIcon,
    TrendingUp as TrendingUpIcon,
    Assignment as AssignmentIcon,
    ArrowForward as ArrowForwardIcon,
    Badge as BadgeIcon,
    PieChart as PieChartIcon
} from '@mui/icons-material';
import ReactApexChart from 'react-apexcharts';
import { useTheme } from '@mui/material/styles';

import api from '../api/axios';
import PageHeader from './PageHeader';
import FinancialManagementModal from './FinancialManagementModal';

// KPI 卡片组件 (保持不变)
const KpiCard = ({ icon, title, value, subtitle, color }) => {
    const theme = useTheme();
    const colorMap = {
        indigo: theme.palette.primary,
        emerald: theme.palette.success,
        amber: theme.palette.warning,
        sky: theme.palette.info,
    };
    const selectedColor = colorMap[color] || theme.palette.primary;

    return (
        <Paper elevation={2} sx={{ p: 3, borderRadius: 4, display: 'flex', alignItems: 'center', transition: 'all 0.3s', '&:hover': { transform: 'translateY(-5px)', boxShadow: 6 } }}>
            <Box sx={{ p: 2, bgcolor: selectedColor.light, borderRadius: '50%', display: 'flex', alignItems: 'center',justifyContent: 'center' }}>
                {icon}
            </Box>
            <Box ml={3}>
                <Typography variant="body2" color="text.secondary">{title}</Typography>
                <Typography variant="h5" component="p" sx={{ fontWeight: 'bold' }}>
                    {value}
                </Typography>
                {subtitle && <Typography variant="caption" color="text.secondary">{subtitle}</Typography>}
            </Box>
        </Paper>
    );
};

// 待办事项列表项组件 (修改)
const TodoListItem = ({ primary, secondary, amount, amountColor, type, onClick}) => {
    const getIcon = () => {
        switch(type) {
            case 'expiring': return <EventBusyIcon color="warning" />;
            case 'approaching': return <EventIcon color="info" />;
            case 'payment': return <AccountBalanceWalletIcon color="error" />;
            default: return <AssignmentIcon color="primary" />;
        }
    };
    return (
        <ListItem button onClick={onClick} sx={{ borderRadius: 2, '&:hover': {bgcolor: 'action.hover' } }}>
            <ListItemIcon sx={{ minWidth: 40 }}>
                {getIcon()}
            </ListItemIcon>
            <ListItemText
                primary={<Typography variant="body1" sx={{ fontWeight: 500 }}>{primary}</Typography>}
                secondary={secondary}
            />
            {amount && <Typography variant="body1" sx={{ fontWeight: 'bold', color: amountColor || 'text.primary' }}>{`¥${amount}`}</Typography>}
            <ArrowForwardIcon sx={{ ml: 2, color: 'text.disabled' }} />
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

    useEffect(() => {
        const fetchData = async () => {
            try {
                setLoading(true);
                const [summaryRes, trialsRes] = await Promise.all([
                    api.get('/billing/dashboard/summary'),
                    api.get('/billing/contracts/pending-trials') // 并行获取待处理合同
                ]);
                setData(summaryRes.data);
                setPendingTrials(trialsRes.data); // 设置新的 state
            } catch (err) {
                setError('加载仪表盘数据失败，请稍后重试。');
                console.error(err);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

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
        <Box sx={{ p: 3 }}>
            <PageHeader title="运营仪表盘" description={`数据更新于 ${new Date().toLocaleDateString('zh-CN')} ${new Date().toLocaleTimeString('zh-CN')}`} />

            <Grid container spacing={3} mb={4}>
                <Grid item xs={12} sm={6} md={3}><KpiCard icon={<TrendingUpIcon sx={{ fontSize: 32 }} />} title="年度管理费" value={`已收:¥${parseFloat(data.kpis.monthly_management_fee_received).toLocaleString()}`} subtitle={`应收:¥${parseFloat(data.kpis.monthly_management_fee_total).toLocaleString()}`} color="indigo" /></Grid>
                {/* <Grid item xs={12} sm={6} md={3}><KpiCard icon={<GroupsIcon sx={{ fontSize: 32 }} />} title="活跃客户数"value={data.kpis.active_contracts_count} color="sky" /></Grid> */}
                <Grid item xs={12} sm={6} md={3}><KpiCard icon={<BadgeIcon sx={{ fontSize: 32 }} />} title="在户员工数"value={data.kpis.active_employees_count} color="amber" /></Grid>
                {/* --- 【新增的待收定金卡片】 --- */}
                <Grid item xs={12} sm={6} md={3}>
                    {/* 用一个带 onClick 事件的 Box 包裹，使其可点击 */}
                    <Box onClick={() => navigate('/contracts/all?deposit_status=unpaid')}sx={{ cursor: 'pointer' }}>
                        <KpiCard
                            icon={<AccountBalanceWalletIcon sx={{ fontSize: 32 }} />}
                            title="待收定金"
                            value={data.kpis.pending_deposit_count}
                            subtitle="点击查看详情"
                            color="error" // 使用醒目的颜色
                        />
                    </Box>
                </Grid>
                {/* --- 新增结束 --- */}
                <Grid item xs={12} sm={6} md={3}><KpiCard icon={<EventBusyIcon sx={{ fontSize: 32 }} />} title="即将到期合同"value={data.todo_lists.expiring_contracts.length} subtitle="30天内" color="warning" /></Grid>
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
                            <Grid item xs={12} md={4}>
                                <Typography variant="subtitle2" color="text.secondary">临近预产期 (14天内)</Typography>
                                <List dense>
                                    {data.todo_lists.approaching_provisional.map(c => (
                                        <TodoListItem
                                            key={'approaching-' + c.id}
                                            onClick={() => navigate(`/contract/detail/${c.id}`)}
                                            type="approaching"
                                            primary={c.customer_name}
                                            secondary={`预产期: ${c.provisional_start_date} (${c.days_until}天后)`}
                                        />
                                    ))}
                                </List>
                            </Grid>
                            <Grid item xs={12} md={4}>
                                <Typography variant="subtitle2" color="text.secondary">本月待收管理费</Typography>
                                <List dense>
                                    {data.todo_lists.pending_payments.map(p => (
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
                                </List>
                            </Grid>
                            <Grid item xs={12} md={4}>
                                <Typography variant="subtitle2" color="text.secondary">即将到期合同 (30天内)</Typography>
                                <List dense>
                                    {data.todo_lists.expiring_contracts.map(c=> (
                                        <TodoListItem
                                            key={'expiring-' + c.id}
                                            onClick={() => navigate(`/contract/detail/${c.id}`)}
                                            type="expiring"
                                            primary={`${c.customer_name} / ${c.employee_name}`}
                                            secondary={`${c.expires_in_days}天后到期 (${c.end_date})`}
                                        />
                                    ))}
                                </List>
                            </Grid>
                            {pendingTrials.length > 0 && (
                                <Grid item xs={12}>
                                    <Divider sx={{ my: 2 }} />
                                    <Typography variant="subtitle2" color="error.main">待处理试工合同</Typography>
                                    <List dense>
                                        {pendingTrials.map(c => (
                                            <TodoListItem
                                                key={'trial-' + c.id}
                                                onClick={() => navigate(`/contract/detail/${c.id}`)}
                                                type="assignment" // 使用一个通用的图标类型
                                                primary={c.message}
                                            />
                                        ))}
                                    </List>
                                </Grid>
                            )}
                        </Grid>
                    </Paper>
                </Grid>
            </Grid>
            {/* --- 5. 在这里添加弹窗组件的渲染 --- */}
            {isModalOpen && (
                <FinancialManagementModal
                    open={isModalOpen}
                    onClose={handleCloseModal}
                    billingDetails={selectedBillDetails}
                    loading={isModalLoading}
                    contract={selectedBillDetails?.contract_info}
                    billingMonth={selectedBillDetails?.billing_month}
                    onSave={() => {
                        // 仪表盘是只读的，但 onSave 是必需的 prop，我们提供一个空实现
                        // 如果需要刷新，可以在这里重新获取仪表盘数据
                    }}
                    onNavigateToBill={handleBillClick} // 允许在弹窗内部跳转到另一个账单
                />
            )}
        </Box>
    );
};

export default DashboardPage;