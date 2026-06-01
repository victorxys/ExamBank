// frontend/src/pages/WechatMessageLogs.jsx
import React, { useState, useEffect } from 'react';
import {
  Box, Card, CardContent, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TablePagination, Typography, TextField, MenuItem,
  Select, FormControl, InputLabel, Button, Grid, Chip, Dialog,
  DialogTitle, DialogContent, DialogActions, Paper, IconButton, Tooltip,
  CircularProgress, Alert
} from '@mui/material';
import {
  History as HistoryIcon,
  Search as SearchIcon,
  Refresh as RefreshIcon,
  Close as CloseIcon,
  Visibility as VisibilityIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Info as InfoIcon,
  Assignment as AssignmentIcon,
  Description as DescriptionIcon,
  EventNote as EventNoteIcon,
  Warning as WarningIcon
} from '@mui/icons-material';
import { getWechatMessageLogs, retryWechatMessage } from '../api/wechat';
import { useToast } from '../components/ui/use-toast';
import { Replay as ReplayIcon } from '@mui/icons-material';
import PageHeader from '../components/PageHeader';

// 消息类型常量映射
const MESSAGE_TYPES = {
  'contract_signed': { label: '合同签署通知', icon: <AssignmentIcon sx={{ color: '#26A69A' }} /> },
  'contract_expiring': { label: '合同即将到期', icon: <WarningIcon sx={{ color: '#fb6340' }} /> },
  'attendance_reminder': { label: '月初考勤收集', icon: <EventNoteIcon sx={{ color: '#11cdef' }} /> },
  'maternity_due': { label: '月嫂预产期提醒', icon: <DescriptionIcon sx={{ color: '#f5365c' }} /> }
};

// 剥离 HTML 标签并截取前 20 个字作为缩略显示
const getCleanSnippet = (htmlText) => {
  if (!htmlText) return '-';
  const cleanText = htmlText.replace(/<[^>]+>/g, '').trim();
  if (cleanText.length <= 20) return cleanText;
  return cleanText.substring(0, 20) + '...';
};

export default function WechatMessageLogs() {
  const { toast } = useToast();
  
  // 状态变量
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(15);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [retryingId, setRetryingId] = useState(null); // 记录正在重发的ID

  // 筛选器状态
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [touserFilter, setTouserFilter] = useState('');

  // 弹窗详情状态
  const [selectedLog, setSelectedLog] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // 加载数据
  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getWechatMessageLogs({
        page: page + 1,
        per_page: rowsPerPage,
        status: statusFilter || undefined,
        message_type: typeFilter || undefined,
        touser: touserFilter || undefined
      });
      setLogs(data.items || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error('获取推送日志失败:', err);
      setError('无法获取企业微信通知日志，请检查网络或系统权限。');
    } finally {
      setLoading(false);
    }
  };

  // 重试发送消息
  const handleRetry = async (logId, e) => {
    if (e) e.stopPropagation();
    setRetryingId(logId);
    try {
      await retryWechatMessage(logId);
      toast({
        title: "重发成功",
        description: `已成功为日志 ID: ${logId} 重新投递微信通知`,
        variant: "success"
      });
      // 重新加载列表数据
      fetchLogs();
      // 如果弹窗打开且就是当前日志，更新状态
      if (selectedLog && selectedLog.id === logId) {
        setSelectedLog(prev => ({ ...prev, status: 'success', error_details: null }));
      }
    } catch (err) {
      console.error("重发消息失败:", err);
      const errMsg = err.response?.data?.error || "发送失败，请检查微信网关配置。";
      toast({
        title: "重发失败",
        description: errMsg,
        variant: "destructive"
      });
    } finally {
      setRetryingId(null);
    }
  };

  // 智能解析并渲染微信原生 div 卡片样式
  const renderWechatCardContent = (htmlText) => {
    if (!htmlText) return '无正文描述';
    
    // 匹配所有的 <div class="xxx">内容</div> 格式
    const regex = /<div class="(gray|normal|highlight)">(.*?)<\/div>/gs;
    const elements = [];
    let match;
    
    while ((match = regex.exec(htmlText)) !== null) {
      const [, className, content] = match;
      
      let style = { mb: 0.8, display: 'block', lineHeight: 1.5 };
      if (className === 'gray') {
        style = { ...style, color: 'grey.600', fontSize: '0.78rem' };
      } else if (className === 'normal') {
        style = { ...style, color: '#333333', fontSize: '0.85rem' };
      } else if (className === 'highlight') {
        style = { ...style, color: '#26A69A', fontWeight: 600, fontSize: '0.85rem' };
      }
      
      // 剥离任何可能多余的嵌套标签 (如遗留的 b) 并清洗
      const cleanContent = content.replace(/<[^>]+>/g, '').trim();
      
      elements.push(
        <Typography key={match.index} variant="body2" sx={style}>
          {cleanContent}
        </Typography>
      );
    }
    
    // 如果没有匹配上任何微信特定 div 标签，回退为常规纯文本渲染
    if (elements.length === 0) {
      return (
        <Typography variant="body2" sx={{ color: '#666666', whiteSpace: 'pre-line' }}>
          {htmlText}
        </Typography>
      );
    }
    
    return <Box>{elements}</Box>;
  };

  // 监听分页与筛选变化
  useEffect(() => {
    fetchLogs();
  }, [page, rowsPerPage]);

  // 处理筛选提交
  const handleFilterSubmit = (e) => {
    e.preventDefault();
    setPage(0);
    fetchLogs();
  };

  // 重置筛选
  const handleResetFilters = () => {
    setStatusFilter('');
    setTypeFilter('');
    setTouserFilter('');
    setPage(0);
    // 直接延迟一下或依赖 useEffect，但此处直接调用
    setTimeout(() => {
      fetchLogs();
    }, 50);
  };

  // 分页更改
  const handleChangePage = (event, newPage) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  // 打开详情弹窗
  const handleOpenDetail = (log) => {
    setSelectedLog(log);
    setDetailOpen(true);
  };

  const handleCloseDetail = () => {
    setDetailOpen(false);
    setSelectedLog(null);
  };

  // 安全解析 JSON 字符串
  const parseJsonSafe = (val) => {
    if (!val) return null;
    if (typeof val === 'object') return val;
    try {
      return JSON.parse(val);
    } catch (e) {
      return { raw: val };
    }
  };

  // 获取状态 Chip 样式
  const getStatusChip = (status) => {
    switch (status) {
      case 'success':
        return <Chip label="发送成功" size="small" icon={<CheckCircleIcon />} sx={{ bgcolor: 'rgba(45, 206, 137, 0.15)', color: '#2dce89', fontWeight: 600 }} />;
      case 'failed':
        return <Chip label="发送失败" size="small" icon={<ErrorIcon />} sx={{ bgcolor: 'rgba(245, 54, 92, 0.15)', color: '#f5365c', fontWeight: 600 }} />;
      case 'pending':
        return <Chip label="处理中" size="small" icon={<InfoIcon />} sx={{ bgcolor: 'rgba(17, 205, 239, 0.15)', color: '#11cdef', fontWeight: 600 }} />;
      default:
        return <Chip label={status} size="small" />;
    }
  };

  // 获取消息卡片的图标
  const getMessageIcon = (messageType) => {
    const config = MESSAGE_TYPES[messageType];
    return config ? config.icon : <InfoIcon sx={{ color: '#8898aa' }} />;
  };

  const getMessageLabel = (messageType) => {
    const config = MESSAGE_TYPES[messageType];
    return config ? config.label : messageType;
  };

  return (
    <Box sx={{ p: { xs: 2, sm: 4 }, minHeight: '100%' }}>
      <PageHeader
        title="企业微信通知审计"
        subtitle="集中式监控系统与企业微信的集成推送服务，保障重要提醒无一漏发。"
      />

      {/* 筛选面板 */}
      <Card sx={{ mb: 4, boxShadow: '0 0 2rem 0 rgba(136,168,170,.08)', border: '1px solid rgba(0,0,0,.03)' }}>
        <CardContent sx={{ p: 3 }}>
          <form onSubmit={handleFilterSubmit}>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} sm={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>发送状态</InputLabel>
                  <Select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    label="发送状态"
                  >
                    <MenuItem value=""><em>全部</em></MenuItem>
                    <MenuItem value="success">发送成功</MenuItem>
                    <MenuItem value="failed">发送失败</MenuItem>
                    <MenuItem value="pending">处理中</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>通知类型</InputLabel>
                  <Select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                    label="通知类型"
                  >
                    <MenuItem value=""><em>全部</em></MenuItem>
                    {Object.entries(MESSAGE_TYPES).map(([key, config]) => (
                      <MenuItem key={key} value={key}>{config.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField
                  fullWidth
                  size="small"
                  label="接收人 (touser)"
                  value={touserFilter}
                  onChange={(e) => setTouserFilter(e.target.value)}
                  placeholder="运营微信 UserID"
                />
              </Grid>
              <Grid item xs={12} sm={3} sx={{ display: 'flex', gap: 1 }}>
                <Button
                  variant="contained"
                  color="primary"
                  type="submit"
                  size="medium"
                  startIcon={<SearchIcon />}
                  fullWidth
                  disabled={loading}
                >
                  搜索
                </Button>
                <Button
                  variant="outlined"
                  onClick={handleResetFilters}
                  size="medium"
                  fullWidth
                  disabled={loading}
                >
                  重置
                </Button>
              </Grid>
            </Grid>
          </form>
        </CardContent>
      </Card>

      {/* 错误提示 */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* 日志表格 */}
      <Card sx={{ boxShadow: '0 0 2rem 0 rgba(136,168,170,.08)', border: '1px solid rgba(0,0,0,.03)' }}>
        <TableContainer component={Box} sx={{ position: 'relative', minHeight: '300px' }}>
          {loading && (
            <Box sx={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              bgcolor: 'rgba(255, 255, 255, 0.7)', zIndex: 1,
              display: 'flex', justifyContent: 'center', alignItems: 'center'
            }}>
              <CircularProgress color="primary" />
            </Box>
          )}

          <Table sx={{ minWidth: 650 }}>
            <TableHead sx={{ bgcolor: 'grey.50' }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 600, color: 'grey.800' }}>消息内容</TableCell>
                <TableCell sx={{ fontWeight: 600, color: 'grey.800' }}>通知类型</TableCell>
                <TableCell sx={{ fontWeight: 600, color: 'grey.800' }}>接收人</TableCell>
                <TableCell sx={{ fontWeight: 600, color: 'grey.800' }}>发送状态</TableCell>
                <TableCell sx={{ fontWeight: 600, color: 'grey.800' }}>触发时间</TableCell>
                <TableCell align="center" sx={{ fontWeight: 600, color: 'grey.800' }}>操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {logs.length > 0 ? (
                logs.map((log) => (
                  <TableRow
                    key={log.id}
                    hover
                    sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                  >
                    <TableCell sx={{ maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <Tooltip title={log.description ? log.description.replace(/<[^>]+>/g, '').trim() : ''} placement="top" arrow>
                        <span style={{ cursor: 'pointer', display: 'inline-block', width: '100%' }}>
                          {log.description ? getCleanSnippet(log.description) : '-'}
                        </span>
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {getMessageIcon(log.message_type)}
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {getMessageLabel(log.message_type)}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{log.touser || '未指定'}</TableCell>
                    <TableCell>{getStatusChip(log.status)}</TableCell>
                    <TableCell>{log.sent_at ? new Date(log.sent_at).toLocaleString('zh-CN') : '-'}</TableCell>
                    <TableCell align="center">
                      <Box sx={{ display: 'flex', justifyContent: 'center', gap: 0.5 }}>
                        <Tooltip title="查看详细推送日志与卡片预览">
                          <IconButton
                            color="primary"
                            onClick={() => handleOpenDetail(log)}
                            size="small"
                            sx={{ '&:hover': { bgcolor: 'rgba(38, 166, 154, 0.08)' } }}
                          >
                            <VisibilityIcon />
                          </IconButton>
                        </Tooltip>

                        <Tooltip title="重新发送微信消息">
                          <IconButton
                            onClick={(e) => handleRetry(log.id, e)}
                            size="small"
                            disabled={retryingId !== null}
                            sx={{
                              color: log.status === 'success' ? '#26A69A' : '#fb6340',
                              '&:hover': {
                                bgcolor: log.status === 'success' ? 'rgba(38, 166, 154, 0.08)' : 'rgba(251, 99, 64, 0.08)'
                              }
                            }}
                          >
                            {retryingId === log.id ? (
                              <CircularProgress size={18} color="inherit" />
                            ) : (
                              <ReplayIcon fontSize="small" />
                            )}
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                    <Box sx={{ color: 'grey.500', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                      <HistoryIcon sx={{ fontSize: 48, color: 'grey.300' }} />
                      <Typography variant="body1">暂无匹配的微信推送日志记录</Typography>
                    </Box>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>

        <TablePagination
          rowsPerPageOptions={[15, 30, 50]}
          component="div"
          count={total}
          rowsPerPage={rowsPerPage}
          page={page}
          onPageChange={handleChangePage}
          onRowsPerPageChange={handleChangeRowsPerPage}
          labelRowsPerPage="每页显示行数:"
          labelDisplayedRows={({ from, to, count }) => `${from}-${to} 共 ${count}`}
        />
      </Card>

      {/* 推送详情及企业微信消息卡片预览弹窗 */}
      <Dialog
        open={detailOpen}
        onClose={handleCloseDetail}
        maxWidth="md"
        fullWidth
        scroll="paper"
        PaperProps={{
          sx: { borderRadius: '0.5rem', boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }
        }}
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(0,0,0,0.08)', pb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <HistoryIcon color="primary" />
            <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
              推送详细日志审计 (ID: {selectedLog?.id})
            </Typography>
          </Box>
          <IconButton onClick={handleCloseDetail} size="small">
            <CloseIcon />
          </IconButton>
        </DialogTitle>

        <DialogContent sx={{ p: 3 }}>
          {selectedLog && (
            <Grid container spacing={3}>
              {/* 左侧：企业微信文本卡片预览效果 */}
              <Grid item xs={12} md={5}>
                <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600, color: 'grey.700' }}>
                  📱 企业微信端卡片呈现预览
                </Typography>
                <Paper
                  variant="outlined"
                  sx={{
                    p: 2,
                    borderRadius: '8px',
                    borderColor: 'rgba(0,0,0,0.1)',
                    background: '#f8f9fa',
                    minHeight: '260px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between'
                  }}
                >
                  <Box>
                    {/* 卡片头部 */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                      <Box sx={{ p: 0.5, bgcolor: '#ffffff', borderRadius: '4px', display: 'flex', border: '1px solid rgba(0,0,0,0.05)' }}>
                        {getMessageIcon(selectedLog.message_type)}
                      </Box>
                      <Typography variant="caption" sx={{ color: 'grey.600', fontWeight: 600 }}>
                        {getMessageLabel(selectedLog.message_type)}
                      </Typography>
                    </Box>

                    {/* 卡片内容 */}
                    <Typography variant="body1" sx={{ fontWeight: 700, color: '#333333', mb: 1, fontSize: '0.95rem' }}>
                      {selectedLog.title || '无标题'}
                    </Typography>

                    <Box
                      sx={{
                        bgcolor: '#ffffff',
                        p: 1.5,
                        borderRadius: '6px',
                        border: '1px solid rgba(0,0,0,0.03)',
                        minHeight: '120px'
                      }}
                    >
                      {renderWechatCardContent(selectedLog.description)}
                    </Box>
                  </Box>

                  {/* 卡片跳转按钮 */}
                  <Box sx={{ mt: 2, borderTop: '1px solid rgba(0,0,0,0.06)', pt: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="caption" sx={{ color: '#32325d', fontWeight: 600 }}>
                      查看详情
                    </Typography>
                    {selectedLog.jump_url && (
                      <Button
                        variant="text"
                        size="small"
                        component="a"
                        href={selectedLog.jump_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        sx={{ color: '#26A69A', fontWeight: 600, fontSize: '0.75rem', p: 0 }}
                      >
                        立即前往
                      </Button>
                    )}
                  </Box>
                </Paper>
              </Grid>

              {/* 右侧：技术参数与底层报错审计 */}
              <Grid item xs={12} md={7}>
                <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600, color: 'grey.700' }}>
                  🛠️ 推送底层技术参数
                </Typography>
                
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Paper variant="outlined" sx={{ p: 2, bgcolor: '#fafafa' }}>
                    <Typography variant="caption" sx={{ display: 'block', mb: 0.5, fontWeight: 600, color: 'grey.600' }}>
                      通知事件类型 (message_type)
                    </Typography>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                      {selectedLog.message_type}
                    </Typography>
                  </Paper>

                  <Paper variant="outlined" sx={{ p: 2, bgcolor: '#fafafa' }}>
                    <Typography variant="caption" sx={{ display: 'block', mb: 0.5, fontWeight: 600, color: 'grey.600' }}>
                      请求的 Payload
                    </Typography>
                    <Box
                      component="pre"
                      sx={{
                        m: 0, p: 1, overflowX: 'auto', fontSize: '0.75rem',
                        fontFamily: 'monospace', bgcolor: '#ffffff', borderRadius: '4px',
                        border: '1px solid rgba(0,0,0,0.05)', maxHeight: '150px'
                      }}
                    >
                      {JSON.stringify({
                        touser: selectedLog.touser,
                        msgtype: "textcard",
                        textcard: {
                          title: selectedLog.title,
                          description: selectedLog.description,
                          url: selectedLog.jump_url,
                          btntxt: "查看详情"
                        }
                      }, null, 2)}
                    </Box>
                  </Paper>

                  {/* 报错详情展示 */}
                  {selectedLog.status === 'failed' && (
                    <Paper variant="outlined" sx={{ p: 2, bgcolor: 'rgba(245, 54, 92, 0.04)', borderColor: 'rgba(245, 54, 92, 0.2)' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1, color: '#f5365c' }}>
                        <ErrorIcon fontSize="small" />
                        <Typography variant="caption" sx={{ fontWeight: 700 }}>
                          企业微信 API 错误详情 (error_details)
                        </Typography>
                      </Box>
                      <Box
                        component="pre"
                        sx={{
                          m: 0, p: 1.5, overflowX: 'auto', fontSize: '0.75rem',
                          fontFamily: 'monospace', bgcolor: '#ffffff', borderRadius: '4px',
                          border: '1px solid rgba(245, 54, 92, 0.15)', color: '#ea0038',
                          maxHeight: '150px'
                        }}
                      >
                        {JSON.stringify(parseJsonSafe(selectedLog.error_details), null, 2) || '微信API返回空错误描述'}
                      </Box>
                    </Paper>
                  )}
                </Box>
              </Grid>
            </Grid>
          )}
        </DialogContent>

        <DialogActions sx={{ p: 2, borderTop: '1px solid rgba(0,0,0,0.08)', display: 'flex', justifyContent: 'space-between', width: '100%' }}>
          <Box>
            {selectedLog && (
              <Button
                onClick={(e) => handleRetry(selectedLog.id, e)}
                variant="contained"
                sx={{
                  background: selectedLog.status === 'success'
                    ? 'linear-gradient(87deg, #26A69A 0, #56aea2 100%)'
                    : 'linear-gradient(87deg, #fb6340 0, #f5365c 100%)',
                  boxShadow: '0 4px 6px rgba(50,50,93,.11), 0 1px 3px rgba(0,0,0,.08)',
                  color: 'white',
                  '&:hover': {
                    transform: 'translateY(-1px)',
                    boxShadow: '0 7px 14px rgba(50,50,93,.1), 0 3px 6px rgba(0,0,0,.08)',
                  }
                }}
                startIcon={retryingId === selectedLog.id ? <CircularProgress size={16} color="inherit" /> : <ReplayIcon />}
                disabled={retryingId !== null}
              >
                {retryingId === selectedLog.id ? '正在重发...' : '重新发送通知'}
              </Button>
            )}
          </Box>
          <Button onClick={handleCloseDetail} variant="outlined" color="primary">
            关闭审计窗口
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
