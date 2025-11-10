import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Box, Card, CardContent, CardHeader, CircularProgress, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Button } from '@mui/material';
import api from '../api';
import PageHeader from './PageHeader';

function StaffDetailPage() {
  const { employeeId } = useParams();
  const navigate = useNavigate();
  const [employee, setEmployee] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchDetails = async () => {
      try {
        setLoading(true);
        const response = await api.staff.getEmployeeDetails(employeeId);
        setEmployee(response.data);
      } catch (err) {
        setError('获取员工详细信息失败。');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchDetails();
  }, [employeeId]);

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}><CircularProgress /></Box>;
  }

  if (error) {
    return <Typography color="error">{error}</Typography>;
  }

  if (!employee) {
    return <Typography>未找到员工信息。</Typography>;
  }

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString();
  };

  const SalaryChangeArrow = ({ previous, current }) => {
    const prev = parseFloat(previous);
    const curr = parseFloat(current);

    if (previous === null || isNaN(prev) || isNaN(curr)) return null;
    if (curr > prev) return <span style={{ color: 'green' }}>↑</span>;
    if (curr < prev) return <span style={{ color: 'red' }}>↓</span>;
    return null;
  };

  return (
    <Box>
      <PageHeader
        title={employee.name}
        description="员工详细信息和薪资历史"
        onBack={() => navigate('/staff-management')}
      />
      <Card sx={{ mb: 3 }}>
        <CardHeader title="基本信息" />
        <CardContent>
          <Typography><strong>姓名:</strong> {employee.name}</Typography>
          <Typography><strong>电话:</strong> {employee.phone_number}</Typography>
          <Typography><strong>身份证号:</strong> {employee.id_card_number || 'N/A'}</Typography>
          <Typography><strong>地址:</strong> {employee.address || 'N/A'}</Typography>
          <Typography><strong>状态:</strong> {employee.is_active ? '在职' : '离职'}</Typography>
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="薪资变更历史" />
        <CardContent>
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>客户名称</TableCell>
                  <TableCell>合同周期</TableCell>
                  <TableCell>上户地址</TableCell>
                  <TableCell>原月薪</TableCell>
                  <TableCell>变更后月薪</TableCell>
                  <TableCell>变化</TableCell>
                  <TableCell>生效日期</TableCell>
                  <TableCell>合同备注</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {employee.salary_history && employee.salary_history.length > 0 ? (
                  employee.salary_history.map(record => (
                    <TableRow key={record.id}>
                      <TableCell>{record.customer_name || 'N/A'}</TableCell>
                      <TableCell>{formatDate(record.contract_start_date)} - {formatDate(record.contract_end_date)}</TableCell>
                      <TableCell>{record.customer_address || 'N/A'}</TableCell>
                      <TableCell>{record.previous_salary || 'N/A'}</TableCell>
                      <TableCell>{record.new_salary}</TableCell>
                      <TableCell><SalaryChangeArrow previous={record.previous_salary} current={record.new_salary} /></TableCell>
                      <TableCell>{formatDate(record.effective_date)}</TableCell>
                      <TableCell>{record.contract_notes || 'N/A'}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={8} align="center">暂无薪资变更记录</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>
    </Box>
  );
}

export default StaffDetailPage;
