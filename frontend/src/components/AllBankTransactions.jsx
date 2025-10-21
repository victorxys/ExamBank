import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { reconciliationApi } from '../api/reconciliationApi';
import PageHeader from './PageHeader'; // 引入PageHeader
import { pinyin } from 'pinyin-pro'; // 导入pinyin-pro库
import {
  Box, Typography, TextField, Button, Table, TableBody, TableCell, TableContainer, 
  TableHead, TableRow, Paper, Modal, CircularProgress, Alert, Pagination,
  Select, MenuItem, InputLabel, FormControl, Grid, Chip
} from '@mui/material';

const statusOptions = {
  'unmatched': { label: '未分配', color: 'warning' },
  'partially_allocated': { label: '部分分配', color: 'info' },
  'matched': { label: '已分配', color: 'success' },
  'ignored': { label: '已忽略', color: 'default' },
  'error': { label: '错误', color: 'error' },
};

const directionOptions = {
    'CREDIT': { label: '入账', color: 'success' },
    'DEBIT': { label: '出账', color: 'error' },
};

const AllBankTransactions = () => {
  const navigate = useNavigate();
  const { year: yearParam, month: monthParam } = useParams();

  const [transactions, setTransactions] = useState([]);
  
  const [inputFilters, setInputFilters] = useState(() => {
    const year = parseInt(yearParam, 10);
    const month = parseInt(monthParam, 10);
    if (year && month) return { year, month, search_term: '', status: '', direction: '' };
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1, search_term: '', status: '', direction: '' };
  });

  const [activeFilters, setActiveFilters] = useState(inputFilters);
  const [page, setPage] = useState(1);
  const [paginationInfo, setPaginationInfo] = useState({ total: 0, pages: 1 });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    const year = parseInt(yearParam, 10);
    const month = parseInt(monthParam, 10);
    if (year && month) {
        if (year !== activeFilters.year || month !== activeFilters.month) {
            const newFilters = { ...activeFilters, year, month };
            setActiveFilters(newFilters);
            setInputFilters(newFilters);
        }
    } else {
        const now = new Date();
        navigate(`/finance/all-transactions/${now.getFullYear()}/${now.getMonth() + 1}`, { replace: true });
    }
  }, [yearParam, monthParam, navigate, activeFilters]);

  useEffect(() => {
    const doFetch = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = { ...activeFilters, page, per_page: 15 };
        const response = await reconciliationApi.getAllTransactions(params);
        setTransactions(response.data.items || []);
        setPaginationInfo({
          total: response.data.total,
          pages: response.data.pages,
        });
      } catch (err) {
        setError('获取流水数据失败，请检查网络或联系管理员。');
        console.error(err);
      }
      setLoading(false);
    };
    doFetch();
  }, [activeFilters, page]);

  const filteredTransactions = useMemo(() => {
    const list = transactions || [];
    if (!inputFilters.search_term) return list;
    const searchTerm = inputFilters.search_term.toLowerCase();
    return list.filter(txn => {
      if (!txn) return false;

      // 搜索流水号
      if (txn.transaction_id && txn.transaction_id.toLowerCase().includes(searchTerm)) return true;
      // 搜索备注
      if (txn.summary && txn.summary.toLowerCase().includes(searchTerm)) return true;

      // 搜索打款人姓名 (原有逻辑)
      if (txn.payer_name) {
        const payerName = txn.payer_name.toLowerCase();
        if (payerName.includes(searchTerm)) return true;
        try {
          const pinyinName = pinyin(payerName, { toneType: 'none', nonZh: 'consecutive' }).replace(/\s/g, '').toLowerCase();
          if (pinyinName.includes(searchTerm)) return true;
          const pinyinInitials = pinyin(payerName, { pattern: 'first', toneType: 'none', nonZh: 'consecutive' }).replace(/\s/g, '').toLowerCase();
          if (pinyinInitials.includes(searchTerm)) return true;
        } catch (e) {
          console.error("pinyin-pro failed:", e);
        }
      }
      return false;
    });
  }, [transactions, inputFilters.search_term]);

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    const newFilters = { ...inputFilters, [name]: value };
    setInputFilters(newFilters);
    if (name === 'year' || name === 'month') {
        navigate(`/finance/all-transactions/${newFilters.year}/${newFilters.month}`);
    }
  };

  const handleSearch = () => {
    setPage(1);
    setActiveFilters(inputFilters);
  };

  const handlePageChange = (event, value) => {
    setPage(value);
  };

  const handleViewDetails = (transaction) => {
    setSelectedTransaction(transaction);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedTransaction(null);
  };

  return (
    <Box>
      <PageHeader
        title="银行流水总览"
        description="查看、搜索所有已导入的银行流水记录。"
        actions={(
            <Box sx={{ display: 'flex', gap: 2 }}>
                <FormControl size="small" variant="outlined" sx={{ minWidth: 100, '& .MuiInputLabel-root': { color: 'rgba(255, 255, 255, 0.7)' }, '& .MuiInputLabel-root.Mui-focused': { color: 'white' } }}>
                    <InputLabel id="year-select-label">年份</InputLabel>
                    <Select labelId="year-select-label" label="年份" name="year" value={inputFilters.year} onChange={handleFilterChange} sx={{ color: 'white', '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255, 255, 255, 0.5)' },'&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'white' }, '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor:'white' }, '& .MuiSelect-icon': { color: 'white' } }}>
                        {[2024, 2025, 2026].map(y => <MenuItem key={y} value={y}>{y}</MenuItem>)}
                    </Select>
                </FormControl>
                <FormControl size="small" variant="outlined" sx={{ minWidth: 100, '& .MuiInputLabel-root': { color: 'rgba(255, 255, 255, 0.7)' }, '& .MuiInputLabel-root.Mui-focused': { color: 'white' } }}>
                    <InputLabel id="month-select-label">月份</InputLabel>
                    <Select labelId="month-select-label" label="月份" name="month" value={inputFilters.month} onChange={handleFilterChange} sx={{ color: 'white', '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255, 255, 255, 0.5)' },'&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'white' }, '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor:'white' }, '& .MuiSelect-icon': { color: 'white' } }}>
                        {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <MenuItem key={m} value={m}>{m}月</MenuItem>)}
                    </Select>
                </FormControl>
            </Box>
        )}
      />
      <Box sx={{ px: 0, py: 0 }}>
        <Paper sx={{ p: 2, mb: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={4}><TextField label="搜索 (流水号/打款人/备注)" name="search_term" value={inputFilters.search_term} onChange={handleFilterChange} fullWidth size="small"/></Grid>
            <Grid item xs={12} sm={3}>
              <FormControl fullWidth size="small">
                <InputLabel>状态</InputLabel>
                <Select name="status" value={inputFilters.status} label="状态" onChange={handleFilterChange}>
                  <MenuItem value=""><em>全部</em></MenuItem>
                  {Object.entries(statusOptions).map(([key, { label }]) => (
                    <MenuItem key={key} value={key}>{label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={3}>
              <FormControl fullWidth size="small">
                <InputLabel>方向</InputLabel>
                <Select name="direction" value={inputFilters.direction} label="方向" onChange={handleFilterChange}>
                  <MenuItem value=""><em>全部</em></MenuItem>
                  <MenuItem value="CREDIT">入账</MenuItem>
                  <MenuItem value="DEBIT">出账</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={2}><Button variant="contained" onClick={handleSearch} fullWidth>搜索</Button></Grid>
          </Grid>
        </Paper>

        {loading && <Box sx={{ display: 'flex', justifyContent: 'center', my: 4 }}><CircularProgress /></Box>}
        {error && <Alert severity="error">{error}</Alert>}

        {!loading && !error && (
          <>
            <TableContainer component={Paper}>
              <Table sx={{ minWidth: 650 }} aria-label="simple table">
                <TableHead>
                  <TableRow>
                    <TableCell>交易时间</TableCell>
                    <TableCell>流水号</TableCell>
                    <TableCell>打款人</TableCell>
                    <TableCell>方向</TableCell>
                    <TableCell align="right">金额</TableCell>
                    <TableCell>备注</TableCell>
                    <TableCell>状态</TableCell>
                    <TableCell>操作</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredTransactions.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{new Date(row.transaction_time).toLocaleString()}</TableCell>
                      <TableCell>{row.transaction_id}</TableCell>
                      <TableCell>{row.payer_name}</TableCell>
                      <TableCell>
                        <Chip 
                          label={directionOptions[row.direction]?.label || row.direction}
                          color={directionOptions[row.direction]?.color || 'default'}
                          size="small"
                        />
                      </TableCell>
                      <TableCell align="right">{row.amount}</TableCell>
                      <TableCell>{row.summary}</TableCell>
                      <TableCell>
                        <Chip 
                          label={statusOptions[row.status]?.label || row.status}
                          color={statusOptions[row.status]?.color || 'default'}
                          size="small"
                        />
                      </TableCell>
                      <TableCell>
                        <Button size="small" onClick={() => handleViewDetails(row)}>查看详情</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
              <Pagination count={paginationInfo.pages} page={page} onChange={handlePageChange} color="primary" />
            </Box>
          </>
        )}
      </Box>

      <Modal open={isModalOpen} onClose={handleCloseModal}>
        <Box sx={modalStyle}>
          <Typography variant="h6" component="h2">流水分配详情</Typography>
          {selectedTransaction && (
            <Box sx={{ mt: 2 }}>
              <Typography><b>流水号:</b> {selectedTransaction.transaction_id}</Typography>
              <Typography><b>打款人:</b> {selectedTransaction.payer_name}</Typography>
              <Typography><b>总金额:</b> {selectedTransaction.amount}</Typography>
              <Typography><b>已分配金额:</b> {selectedTransaction.allocated_amount}</Typography>
              <hr style={{ margin: '16px 0' }}/>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>分配记录:</Typography>
              {selectedTransaction.allocations && selectedTransaction.allocations.length > 0 ? (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>客户</TableCell>
                      <TableCell>服务人员</TableCell>
                      <TableCell>账单周期</TableCell>
                      <TableCell align="right">分配金额</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {selectedTransaction.allocations.map((alloc, index) => (
                      <TableRow key={index}>
                        <TableCell>{alloc.customer_name}</TableCell>
                        <TableCell>{alloc.employee_name}</TableCell>
                        <TableCell>{alloc.cycle}</TableCell>
                        <TableCell align="right">{alloc.allocated_amount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <Typography sx={{ mt: 1 }}>无分配记录。</Typography>
              )}
            </Box>
          )}
          <Button onClick={handleCloseModal} sx={{ mt: 2 }}>关闭</Button>
        </Box>
      </Modal>
    </Box>
  );
};

const modalStyle = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: 600,
  bgcolor: 'background.paper',
  border: '2px solid #000',
  boxShadow: 24,
  p: 4,
};

export default AllBankTransactions;