// frontend/src/components/LlmCallLogList.jsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TablePagination, IconButton, CircularProgress,
  TextField, Button, Grid, Select, MenuItem, FormControl, InputLabel, Chip, Tooltip
} from '@mui/material';
import { Visibility as VisibilityIcon, FilterList as FilterListIcon, Clear as ClearIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { llmApi } from '../api/llm';
import AlertMessage from './AlertMessage';
import PageHeader from './PageHeader';
import { useTheme } from '@mui/material/styles';

const LlmCallLogList = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState({ open: false, message: '', severity: 'info' });
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [totalLogs, setTotalLogs] = useState(0);
  const [filters, setFilters] = useState({
    function_name: '',
    status: '',
    model_id: '',
    prompt_id: '',
    user_id: ''
  });
  const [filterDialogOpen, setFilterDialogOpen] = useState(false); // 用于控制筛选弹窗（如果需要更复杂的筛选）

  // 用于筛选下拉框的数据
  const [availableModels, setAvailableModels] = useState([]);
  const [availablePrompts, setAvailablePrompts] = useState([]);
  const [availableUsers, setAvailableUsers] = useState([]); // 如果需要按用户筛选

  const fetchFilterData = useCallback(async () => {
    try {
      const [modelsRes, promptsRes] = await Promise.all([
        llmApi.getModels(),
        llmApi.getPrompts(),
        // 如果需要用户筛选，这里也获取用户列表
        // llmApi.getUsersForFilter() 
      ]);
      setAvailableModels(modelsRes.data || []);
      setAvailablePrompts(promptsRes.data || []);
      // setAvailableUsers(usersRes.data || []);
    } catch (error) {
      console.error("获取筛选数据失败:", error);
      // 可以设置一个通用错误提示
    }
  }, []);
  
  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page: page + 1, per_page: rowsPerPage, ...filters };
      // 清理空过滤器
      Object.keys(params).forEach(key => {
        if (params[key] === '' || params[key] === null || params[key] === undefined) {
          delete params[key];
        }
      });
      const response = await llmApi.getCallLogs(params);
      setLogs(response.data.items || []);
      setTotalLogs(response.data.total || 0);
    } catch (error) {
      console.error("获取日志列表失败:", error);
      setAlert({ open: true, message: '获取日志列表失败: ' + (error.response?.data?.error || error.message), severity: 'error' });
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, filters]);

  useEffect(() => {
    fetchFilterData(); // 初始加载筛选选项数据
  }, [fetchFilterData]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]); // 当 fetchLogs (即 page, rowsPerPage, filters) 变化时重新获取

  const handleFilterChange = (e) => {
    setFilters(prev => ({ ...prev, [e.target.name]: e.target.value }));
    setPage(0); // 筛选条件改变时，重置到第一页
  };
  
  const handleClearFilters = () => {
    setFilters({ function_name: '', status: '', model_id: '', prompt_id: '', user_id: ''});
    setPage(0);
  };


  const handleChangePage = (event, newPage) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleViewDetail = (logId) => {
    navigate(`/admin/llm/call-logs/${logId}`);
  };

  return (
    <Box>
      <AlertMessage open={alert.open} message={alert.message} severity={alert.severity} onClose={() => setAlert(prev => ({ ...prev, open: false }))} />
      <PageHeader title="LLM 调用日志" description="查看系统与大语言模型交互的详细记录。" />
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="h6" gutterBottom>筛选日志</Typography>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={6} md={3}>
            <TextField fullWidth label="函数名称" name="function_name" value={filters.function_name} onChange={handleFilterChange} size="small" />
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <FormControl fullWidth size="small">
              <InputLabel>状态</InputLabel>
              <Select name="status" value={filters.status} label="状态" onChange={handleFilterChange}>
                <MenuItem value=""><em>全部</em></MenuItem>
                <MenuItem value="success">成功</MenuItem>
                <MenuItem value="error">失败</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <FormControl fullWidth size="small">
              <InputLabel>模型</InputLabel>
              <Select name="model_id" value={filters.model_id} label="模型" onChange={handleFilterChange}>
                <MenuItem value=""><em>全部</em></MenuItem>
                {availableModels.map(model => <MenuItem key={model.id} value={model.id}>{model.model_name}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          {/* 提示词和用户筛选类似，如果需要的话 */}
          <Grid item xs={12} sm={6} md={2}>
            <Button variant="outlined" onClick={handleClearFilters} startIcon={<ClearIcon />} fullWidth>清空筛选</Button>
          </Grid>
        </Grid>
        
        {loading ? <Box sx={{display: 'flex', justifyContent: 'center', p:3}}><CircularProgress /></Box> : (
          <>
            <TableContainer sx={{ mt: 2 }}>
              <Table stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>时间戳</TableCell>
                    <TableCell>函数名</TableCell>
                    <TableCell>模型</TableCell>
                    <TableCell>提示词</TableCell>
                    <TableCell>状态</TableCell>
                    <TableCell>耗时(ms)</TableCell>
                    <TableCell>用户</TableCell>
                    <TableCell>操作</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow hover key={log.id}>
                      <TableCell>
                        <Tooltip title={new Date(log.timestamp).toLocaleString()} placement="top">
                            <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                        </Tooltip>
                      </TableCell>
                      <TableCell>{log.function_name}</TableCell>
                      <TableCell>{log.model_name}</TableCell>
                      <TableCell>
                        {log.prompt_name} {log.prompt_version ? `(v${log.prompt_version})` : ''}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={log.status}
                          color={log.status === 'success' ? 'success' : 'error'}
                          size="small"
                        />
                      </TableCell>
                      <TableCell>{log.duration_ms}</TableCell>
                      <TableCell>{log.user_username}</TableCell>
                      <TableCell>
                        <IconButton onClick={() => handleViewDetail(log.id)} size="small" title="查看详情">
                          <VisibilityIcon />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              component="div"
              count={totalLogs}
              page={page}
              onPageChange={handleChangePage}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={handleChangeRowsPerPage}
              rowsPerPageOptions={[10, 20, 50, 100]}
              labelRowsPerPage="每页条数:"
            />
          </>
        )}
      </Paper>
    </Box>
  );
};

export default LlmCallLogList;