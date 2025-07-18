// frontend/src/components/ContractDetail.jsx (最终完整版)

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Paper, Grid, CircularProgress, Button,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip,
  List, ListItem, ListItemText, Divider
} from '@mui/material';
import { ArrowBack as ArrowBackIcon, Edit as EditIcon } from '@mui/icons-material';

import api from '../api/axios';
import PageHeader from './PageHeader';

const formatDate = (isoString) => {
  if (!isoString) return '—';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '无效日期';
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch (e) { return '无效日期'; }
};

// 辅助组件用于渲染详情项
const DetailItem = ({ label, value }) => (
    <Grid item xs={12} sm={6} md={4}>
        <Typography variant="body2" color="text.secondary" gutterBottom>{label}</Typography>
        {/* 使用 component="div" 来包裹可能包含其他组件的 value */}
        <Typography variant="body1" component="div" sx={{ fontWeight: 500 }}>{value || '—'}</Typography>
    </Grid>
);

const ContractDetail = () => {
    const { contractId } = useParams();
    const navigate = useNavigate();
    const [contract, setContract] = useState(null);
    const [bills, setBills] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
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
                console.error("获取数据失败:", error);
            } finally {
                setLoading(false);
            }
        };
        if (contractId) {
            fetchData();
        }
    }, [contractId]);

    const handleNavigateToBill = (bill) => {
        navigate(`/billing?month=${bill.billing_period}&open_bill_id=${bill.id}`);
    };

    if (loading) return <CircularProgress />;
    if (!contract) return <Typography>未找到合同信息。</Typography>;

    // 准备要显示的基础字段和特定字段
    // **核心修正 2**: 移除不存在的字段，并整理数据
    const baseFields = {
        '客户姓名': contract.customer_name,
        '联系人': contract.contact_person,
        '服务人员': contract.employee_name,
        '状态': <Chip label={contract.status} color={contract.status === 'active' ? 'success' : 'default'} size="small" />,
        '合同周期': `${formatDate(contract.start_date)} ~ ${formatDate(contract.end_date)}`,
        '合同剩余月数': contract.remaining_months, // <-- 新增字段
        '创建时间': new Date(contract.created_at).toLocaleString('zh-CN'),
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
    } : {
        '合同类型': '育儿嫂合同',
        '级别/月薪': `¥${contract.employee_level}`,
        '是否自动月签': contract.is_monthly_auto_renew ? '是' : '否',
    };

    return (
        <Box>
            <PageHeader
                title="合同详情"
                description={`${contract.customer_name} - ${contract.employee_name}`}
                actionButton={
                    <Button variant="outlined" startIcon={<ArrowBackIcon />} onClick={() => navigate('/contracts')}>
                        返回列表
                    </Button>
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
                
                {contract.contract_type === 'maternity_nurse' && (
                    <Grid item xs={12}>
                        <Paper sx={{ p: 3 }}>
                            <Typography variant="h6" gutterBottom>关联账单列表</Typography>
                            <TableContainer>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>账单周期 (所属月份)</TableCell>
                                            <TableCell>服务周期</TableCell>
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
                                                <TableCell>{bill.overtime_days} 天</TableCell>
                                                <TableCell sx={{fontWeight: 'bold'}}>¥{bill.total_payable}</TableCell>
                                                <TableCell><Chip label={bill.status} color={bill.status === '已支付' ? 'success' : 'warning'} size="small" /></TableCell>
                                                <TableCell align="right">
                                                <Button
                                                    variant="contained"
                                                    size="small"
                                                    onClick={() => handleNavigateToBill(bill)}
                                                >
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
                )}
            </Grid>
        </Box>
    );
};

export default ContractDetail;