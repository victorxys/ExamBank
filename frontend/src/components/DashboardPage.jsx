// frontend/src/components/DashboardPage.jsx

import React, { useState, useEffect } from 'react';
import { Paper, Box, Typography, Grid, CircularProgress, List, ListItem, ListItemText, ListItemIcon, Divider, Chip } from '@mui/material';
import {
    AccountBalanceWallet as AccountBalanceWalletIcon,
    Payments as PaymentsIcon,
    EventBusy as EventBusyIcon,
    Groups as GroupsIcon,
    TrendingUp as TrendingUpIcon,
    Assignment as AssignmentIcon,
    Person as PersonIcon,
    ArrowForward as ArrowForwardIcon,
    Badge as BadgeIcon
} from '@mui/icons-material';
import ReactApexChart from 'react-apexcharts';
import { useTheme } from '@mui/material/styles';

import api from '../api/axios';
import PageHeader from './PageHeader'; // 假设您有一个通用的页面头部组件

// KPI 卡片组件
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
            <Box sx={{ p: 2, bgcolor: selectedColor.light, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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

// 待办事项列表项组件
const TodoListItem = ({ primary, secondary, amount, amountColor, type }) => (
    <ListItem button sx={{ borderRadius: 2, '&:hover': { bgcolor: 'action.hover' } }}>
        <ListItemIcon sx={{ minWidth: 40 }}>
            {type === 'expiring' ? <EventBusyIcon color="warning" /> : <AssignmentIcon color="primary" />}
        </ListItemIcon>
        <ListItemText
            primary={<Typography variant="body1" sx={{ fontWeight: 500 }}>{primary}</Typography>}
            secondary={secondary}
        />
        {amount && <Typography variant="body1" sx={{ fontWeight: 'bold', color: amountColor || 'text.primary' }}>{`¥${amount}`}</Typography>}
        <ArrowForwardIcon sx={{ ml: 2, color: 'text.disabled' }} />
    </ListItem>
);


const DashboardPage = () => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const theme = useTheme();

    useEffect(() => {
        const fetchData = async () => {
            try {
                setLoading(true);
                const response = await api.get('/billing/dashboard/summary');
                setData(response.data);
            } catch (err) {
                setError('加载仪表盘数据失败，请稍后重试。');
                console.error(err);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    const chartOptions = {
        chart: {
            type: 'bar',
            height: 350,
            toolbar: { show: false },
            fontFamily: theme.typography.fontFamily,
        },
        plotOptions: {
            bar: {
                borderRadius: 8,
                horizontal: false,
                columnWidth: '55%',
            },
        },
        dataLabels: { enabled: false },
        stroke: { show: true, width: 2, colors: ['transparent'] },
        xaxis: {
            categories: data?.revenue_trend.categories || [],
            labels: { style: { colors: theme.palette.text.secondary } },
        },
        yaxis: {
            title: { text: '管理费收入 (元)', style: { color: theme.palette.text.secondary } },
            labels: {
                style: { colors: theme.palette.text.secondary },
                formatter: (value) => `¥${value.toLocaleString()}`
            }
        },
        fill: { opacity: 1 },
        tooltip: {
            y: { formatter: (val) => `¥ ${val.toLocaleString()}` },
            theme: 'dark'
        },
        grid: {
            borderColor: theme.palette.divider,
            strokeDashArray: 4,
        },
        colors: [theme.palette.primary.main]
    };

    if (loading) {
        return <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}><CircularProgress /></Box>;
    }

    if (error) {
        return <Typography color="error">{error}</Typography>;
    }

    if (!data) {
        return <Typography>暂无数据。</Typography>;
    }

    return (
        <Box sx={{ p: 3 }}>
            <PageHeader title="运营仪表盘" description={`数据更新于 ${new Date().toLocaleDateString('zh-CN')} ${new Date().toLocaleTimeString('zh-CN')}`} />
            
            {/* 1. 核心KPI卡片 */}
            <Grid container spacing={3} mb={4}>
                <Grid item xs={12} sm={6} md={3}>
                    <KpiCard 
                        icon={<TrendingUpIcon sx={{ fontSize: 32 }} />}
                        title="年度管理费 (已收/应收)"
                        value={`¥${parseFloat(data.kpis.monthly_management_fee_received).toLocaleString()}`}
                        subtitle={`/ ¥${parseFloat(data.kpis.monthly_management_fee_total).toLocaleString()}`}
                        color="indigo"
                    />
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                    <KpiCard 
                        icon={<GroupsIcon sx={{ fontSize: 32 }} />}
                        title="活跃客户数"
                        value={data.kpis.active_contracts_count}
                        color="sky"
                    />
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                    <KpiCard 
                        icon={<BadgeIcon sx={{ fontSize: 32 }} />}
                        title="在户员工数"
                        value={data.kpis.active_employees_count}
                        color="amber"
                    />
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                    <KpiCard 
                        icon={<EventBusyIcon sx={{ fontSize: 32 }} />}
                        title="即将到期合同"
                        value={data.todo_lists.expiring_contracts.length}
                        subtitle="30天内"
                        color="warning"
                    />
                </Grid>
            </Grid>

            {/* 2. 主内容区 */}
            <Grid container spacing={3}>
                <Grid item xs={12} lg={8}>
                    <Paper elevation={2} sx={{ p: 3, borderRadius: 4, height: '100%' }}>
                        <Typography variant="h6" sx={{ fontWeight: 'bold' }} gutterBottom>月度管理费收入趋势</Typography>
                        <ReactApexChart options={chartOptions} series={data.revenue_trend.series} type="bar" height={350} />
                    </Paper>
                </Grid>
                <Grid item xs={12} lg={4}>
                    <Paper elevation={2} sx={{ p: 3, borderRadius: 4, height: '100%' }}>
                        <Typography variant="h6" sx={{ fontWeight: 'bold' }} gutterBottom>核心待办事项</Typography>
                        <Divider sx={{ my: 2 }} />
                        <Box>
                            <Typography variant="subtitle2" color="text.secondary" sx={{mb: 1}}>即将到期合同</Typography>
                            <List dense>
                                {data.todo_lists.expiring_contracts.map(c => (
                                    <TodoListItem 
                                        key={c.customer_name}
                                        type="expiring"
                                        primary={`${c.customer_name} / ${c.employee_name}`}
                                        secondary={`${c.expires_in_days}天后到期 (${c.end_date})`}
                                    />
                                ))}
                            </List>
                        </Box>
                        <Divider sx={{ my: 2 }} />
                        <Box>
                            <Typography variant="subtitle2" color="text.secondary" sx={{mb: 1}}>本月待收管理费</Typography>
                            <List dense>
                                {data.todo_lists.pending_payments.map(p => (
                                    <TodoListItem 
                                        key={p.customer_name}
                                        primary={p.customer_name}
                                        secondary={p.contract_type}
                                        amount={p.amount}
                                        amountColor="error.main"
                                    />
                                ))}
                            </List>
                        </Box>
                        <Divider sx={{ my: 2 }} />
                        <Box>
                            <Typography variant="subtitle2" color="text.secondary" sx={{mb: 1}}>本月待付员工薪酬</Typography>
                            <List dense>
                                {data.todo_lists.pending_payouts.map(p => (
                                    <TodoListItem 
                                        key={p.employee_name}
                                        primary={p.employee_name}
                                        secondary={p.contract_type}
                                        amount={p.amount}
                                        amountColor="success.main"
                                    />
                                ))}
                            </List>
                        </Box>
                    </Paper>
                </Grid>
            </Grid>
        </Box>
    );
};

export default DashboardPage;
