// frontend/src/components/ConflictCheckerPage.jsx
import React, { useState } from 'react';
import {
  Box, Button, Typography, Paper, CircularProgress, Grid, Card, CardContent, CardHeader, Divider, Link, Chip, TextField
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { Search as SearchIcon, Warning as WarningIcon, People as PeopleIcon } from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { zhCN } from 'date-fns/locale';
import api from '../api/axios';
import PageHeader from './PageHeader';
import AlertMessage from './AlertMessage';

const ConflictCard = ({ conflict, type }) => {
  const isEmployeeConflict = type === 'employee';
  const identifierName = isEmployeeConflict ? conflict.identifier_name : conflict.identifier_name;

  return (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardHeader
        avatar={isEmployeeConflict ? <PeopleIcon /> : <WarningIcon />}
        title={`${isEmployeeConflict ? '员工' : '客户'}: ${identifierName}`}
        titleTypographyProps={{ variant: 'h6' }}
        sx={{ bgcolor: 'grey.100' }}
      />
      <CardContent>
        <Grid container spacing={2}>
          {conflict.conflicts.map((bill, index) => (
            <Grid item xs={12} key={index}>
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle1">
                  {isEmployeeConflict ? `客户: ${bill.customer_name}` : `员工: ${bill.employee_name}`}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  合同类型: {bill.contract_type}
                  {bill.is_substitute_bill && <Chip label="替班" size="small" color="info" sx={{ ml: 1 }} />}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  冲突周期: {bill.cycle_start_date} ~ {bill.cycle_end_date}
                </Typography>
                {!bill.is_substitute_bill && (
                  <Typography variant="body2" color="text.secondary">
                    合同周期: {bill.contract_start_date || 'N/A'} ~ {bill.contract_end_date || 'N/A'}
                  </Typography>
                )}
                <Typography variant="body2" color="text.secondary">
                  账单金额: ¥{parseFloat(bill.total_due).toLocaleString()}
                </Typography>                                
                <Typography variant="body2" color="text.secondary">
                  管理费: ¥{parseFloat(bill.management_fee).toLocaleString()}
                </Typography>                               
                <Box mt={1}>                                
                  <Button                                   
                    component={RouterLink}                  
                    to={`/contracts/${bill.contract_id}`}   
                    target="_blank" // 在新标签页中打开     
                    rel="noopener noreferrer" // 安全性考虑 
                    size="small"                            
                    variant="contained"                     
                  >                                         
                    处理                                    
                  </Button>                                 
                </Box>                                      
              </Paper>                                      
            </Grid>
          ))}
        </Grid>
      </CardContent>
    </Card>
  );
};

const ConflictCheckerPage = () => {
  const [selectedMonth, setSelectedMonth] = useState(new Date());
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [alert, setAlert] = useState({ open: false, message: '', severity: 'info' });

  const handleDetection = async () => {
    setLoading(true);
    setResults(null);
    try {
      const monthString = `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, '0')}`;
      const response = await api.get('/billing/conflicts', {
        params: { billing_month: monthString }
      });
      setResults(response.data);
    } catch (error) {
      setAlert({
        open: true,
        message: `检测失败: ${error.response?.data?.error || error.message}`,
        severity: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
      <Box>
        <AlertMessage
          open={alert.open}
          message={alert.message}
          severity={alert.severity}
          onClose={() => setAlert({ ...alert, open: false })}
        />
        <PageHeader
          title="合同冲突检测"
          description="检测指定月份内，是否存在员工或客户的服务时间重叠问题。"
        />
        <Paper sx={{ p: 2, mb: 3, display: 'flex', gap: 2, alignItems: 'center' }}>
          <DatePicker
            label="选择检测月份"
            views={['year', 'month']}
            value={selectedMonth}
            onChange={(newValue) => setSelectedMonth(newValue)}
            renderInput={(params) => <TextField {...params} helperText={null} />}
          />
          <Button
            variant="contained"
            onClick={handleDetection}
            disabled={loading}
            startIcon={loading ? <CircularProgress size={20} /> : <SearchIcon />}
          >
            {loading ? '检测中...' : '开始检测'}
          </Button>
        </Paper>

        {results && (
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Typography variant="h5" gutterBottom>员工冲突</Typography>
              {results.employee_conflicts.length > 0 ? (
                results.employee_conflicts.map((conflict, index) => (
                  <ConflictCard key={index} conflict={conflict} type="employee" />
                ))
              ) : (
                <Typography>未发现员工冲突。</Typography>
              )}
            </Grid>
            <Grid item xs={12} md={6}>
              <Typography variant="h5" gutterBottom>客户冲突</Typography>
              {results.customer_conflicts.length > 0 ? (
                results.customer_conflicts.map((conflict, index) => (
                  <ConflictCard key={index} conflict={conflict} type="customer" />
                ))
              ) : (
                <Typography>未发现客户冲突。</Typography>
              )}
            </Grid>
          </Grid>
        )}
      </Box>
    </LocalizationProvider>
  );
};

export default ConflictCheckerPage;
