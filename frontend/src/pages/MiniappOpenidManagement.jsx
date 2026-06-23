import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  DeleteOutline as DeleteOutlineIcon,
  BugReport as BugReportIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import PageHeader from '../components/PageHeader';
import { useToast } from '../components/ui/use-toast';
import {
  createMiniappDebugAccess,
  deleteMiniappDebugAccess,
  deleteMiniappOpenidLink,
  getMiniappDebugAccess,
  getMiniappOpenidLinks,
} from '../api/wechat';

const ROLE_LABELS = {
  customer: '客户',
  employee: '员工',
};

const BIND_METHOD_LABELS = {
  contract_sign: '合同签署',
  phone_verify: '手机号验证',
  phone_id_card_verify: '手机号+身份证',
  admin: '管理员',
  dev_mock: '开发联调',
};

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const pad = (item) => String(item).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function roleChip(role) {
  const isEmployee = role === 'employee';
  return (
    <Chip
      size="small"
      label={ROLE_LABELS[role] || role || '-'}
      sx={{
        bgcolor: isEmployee ? 'rgba(37, 99, 235, 0.12)' : 'rgba(38, 166, 154, 0.14)',
        color: isEmployee ? '#2563eb' : '#04786d',
        fontWeight: 700,
      }}
    />
  );
}

export default function MiniappOpenidManagement() {
  const { toast } = useToast();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [appliedRole, setAppliedRole] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [debugDialogOpen, setDebugDialogOpen] = useState(false);
  const [debugAccessItems, setDebugAccessItems] = useState([]);
  const [debugAccessLoading, setDebugAccessLoading] = useState(false);
  const [debugForm, setDebugForm] = useState({
    debugger_openid: '',
    role: 'employee',
    target_id: '',
    expires_in_minutes: 120,
    reason: '',
  });

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getMiniappOpenidLinks({
        page: page + 1,
        per_page: rowsPerPage,
        search: appliedSearch || undefined,
        role: appliedRole || undefined,
      });
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error('获取小程序 OpenID 绑定失败:', err);
      setError(err.response?.data?.error || '无法获取小程序 OpenID 绑定列表。');
    } finally {
      setLoading(false);
    }
  }, [appliedRole, appliedSearch, page, rowsPerPage]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const handleFilterSubmit = (event) => {
    event.preventDefault();
    setAppliedSearch(search.trim());
    setAppliedRole(role);
    setPage(0);
  };

  const handleReset = () => {
    setSearch('');
    setRole('');
    setAppliedSearch('');
    setAppliedRole('');
    setPage(0);
  };

  const handleRowsPerPageChange = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleConfirmDelete = async () => {
    if (!selectedAccount) return;
    setDeleting(true);
    try {
      await deleteMiniappOpenidLink(selectedAccount.role, selectedAccount.id);
      toast({
        title: '解绑成功',
        description: '已解绑身份绑定，合同/考勤访问和历史签署记录未删除。',
        variant: 'success',
      });
      setSelectedAccount(null);
      fetchItems();
    } catch (err) {
      toast({
        title: '解绑失败',
        description: err.response?.data?.error || '请稍后重试。',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  const fetchDebugAccess = useCallback(async (params = {}) => {
    setDebugAccessLoading(true);
    try {
      const data = await getMiniappDebugAccess({ include_disabled: true, ...params });
      setDebugAccessItems(data.items || []);
    } catch (err) {
      toast({
        title: '获取调试授权失败',
        description: err.response?.data?.error || '请稍后重试。',
        variant: 'destructive',
      });
    } finally {
      setDebugAccessLoading(false);
    }
  }, [toast]);

  const openDebugDialog = (account = null) => {
    setDebugForm({
      debugger_openid: '',
      role: account?.role || 'employee',
      target_id: account?.subject_id || '',
      expires_in_minutes: 120,
      reason: '',
    });
    setDebugDialogOpen(true);
    fetchDebugAccess(account?.subject_id ? { target_id: account.subject_id } : {});
  };

  const handleCreateDebugAccess = async () => {
    try {
      await createMiniappDebugAccess(debugForm);
      toast({
        title: '授权已创建',
        description: '调试人员可用自己的微信临时登录目标身份，不影响真实绑定。',
        variant: 'success',
      });
      fetchDebugAccess(debugForm.target_id ? { target_id: debugForm.target_id } : {});
    } catch (err) {
      toast({
        title: '创建授权失败',
        description: err.response?.data?.error || '请检查 OpenID 和目标ID。',
        variant: 'destructive',
      });
    }
  };

  const handleDisableDebugAccess = async (accessId) => {
    try {
      await deleteMiniappDebugAccess(accessId);
      toast({ title: '授权已停用', variant: 'success' });
      fetchDebugAccess(debugForm.target_id ? { target_id: debugForm.target_id } : {});
    } catch (err) {
      toast({
        title: '停用授权失败',
        description: err.response?.data?.error || '请稍后重试。',
        variant: 'destructive',
      });
    }
  };

  return (
    <Box sx={{ p: { xs: 2, sm: 4 }, minHeight: '100%' }}>
      <PageHeader
        title="微信小程序绑定"
        subtitle="查看客户与服务人员的小程序 OpenID 身份绑定，并处理误绑定解绑。"
      />

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Button variant="outlined" startIcon={<BugReportIcon />} onClick={() => openDebugDialog()}>
          临时调试授权
        </Button>
      </Box>

      <Card sx={{ mb: 4, boxShadow: '0 0 2rem 0 rgba(136,168,170,.08)', border: '1px solid rgba(0,0,0,.03)' }}>
        <CardContent sx={{ p: 3 }}>
          <form onSubmit={handleFilterSubmit}>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} md={5}>
                <TextField
                  fullWidth
                  size="small"
                  label="搜索"
                  placeholder="OpenID、姓名、手机号、绑定方式"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </Grid>
              <Grid item xs={12} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>角色</InputLabel>
                  <Select value={role} label="角色" onChange={(event) => setRole(event.target.value)}>
                    <MenuItem value=""><em>全部</em></MenuItem>
                    <MenuItem value="customer">客户</MenuItem>
                    <MenuItem value="employee">员工</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={4}>
                <Box sx={{ display: 'flex', gap: 1, justifyContent: { xs: 'stretch', md: 'flex-end' } }}>
                  <Button type="submit" variant="contained" startIcon={<SearchIcon />} disabled={loading} sx={{ flex: { xs: 1, md: 'initial' } }}>
                    查询
                  </Button>
                  <Button variant="outlined" startIcon={<RefreshIcon />} onClick={handleReset} disabled={loading} sx={{ flex: { xs: 1, md: 'initial' } }}>
                    重置
                  </Button>
                </Box>
              </Grid>
            </Grid>
          </form>
        </CardContent>
      </Card>

      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      <Card sx={{ boxShadow: '0 0 2rem 0 rgba(136,168,170,.08)', border: '1px solid rgba(0,0,0,.03)' }}>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>角色</TableCell>
                <TableCell>姓名</TableCell>
                <TableCell>手机号</TableCell>
                <TableCell>OpenID</TableCell>
                <TableCell>绑定方式</TableCell>
                <TableCell>绑定时间</TableCell>
                <TableCell>最近登录</TableCell>
                <TableCell align="right">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 8 }}>
                    <CircularProgress size={28} />
                  </TableCell>
                </TableRow>
              ) : items.length ? (
                items.map((item) => (
                  <TableRow key={`${item.role}-${item.id}`} hover>
                    <TableCell>{roleChip(item.role)}</TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{item.name || '-'}</Typography>
                    </TableCell>
                    <TableCell>{item.phone_number || '-'}</TableCell>
                    <TableCell sx={{ maxWidth: 280 }}>
                      <Tooltip title={item.mini_openid || ''}>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.mini_openid || '-'}
                        </Typography>
                      </Tooltip>
                    </TableCell>
                    <TableCell>{BIND_METHOD_LABELS[item.bind_method] || item.bind_method || '-'}</TableCell>
                    <TableCell>{formatDateTime(item.verified_at || item.created_at)}</TableCell>
                    <TableCell>{formatDateTime(item.last_login_at)}</TableCell>
                    <TableCell align="right">
                      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<BugReportIcon />}
                          onClick={() => openDebugDialog(item)}
                        >
                          调试授权
                        </Button>
                        <Button
                          color="error"
                          size="small"
                          variant="outlined"
                          startIcon={<DeleteOutlineIcon />}
                          onClick={() => setSelectedAccount(item)}
                        >
                          解绑
                        </Button>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 8, color: 'text.secondary' }}>
                    暂无小程序 OpenID 绑定记录
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={total}
          page={page}
          rowsPerPage={rowsPerPage}
          onPageChange={(event, nextPage) => setPage(nextPage)}
          onRowsPerPageChange={handleRowsPerPageChange}
          rowsPerPageOptions={[10, 20, 50, 100]}
          labelRowsPerPage="每页行数"
        />
      </Card>

      <Dialog open={Boolean(selectedAccount)} onClose={() => setSelectedAccount(null)} maxWidth="sm" fullWidth>
        <DialogTitle>确认解绑小程序 OpenID</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            将解绑 {selectedAccount?.role_label || ROLE_LABELS[selectedAccount?.role]}「{selectedAccount?.name || '-'}」的身份绑定。
          </Typography>
          <Alert severity="warning">
            只解绑身份绑定，不删除合同/考勤访问和历史签署记录。
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedAccount(null)} disabled={deleting}>取消</Button>
          <Button color="error" variant="contained" onClick={handleConfirmDelete} disabled={deleting}>
            {deleting ? '解绑中...' : '确认解绑'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={debugDialogOpen} onClose={() => setDebugDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>临时调试授权</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            临时授权不会修改真实员工/客户的正式 OpenID 绑定，到期或停用后自动失效。
          </Alert>
          <Grid container spacing={2} sx={{ mt: 0 }}>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                size="small"
                label="调试人员 OpenID"
                value={debugForm.debugger_openid}
                onChange={(event) => setDebugForm((prev) => ({ ...prev, debugger_openid: event.target.value.trim() }))}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel>角色</InputLabel>
                <Select
                  value={debugForm.role}
                  label="角色"
                  onChange={(event) => setDebugForm((prev) => ({ ...prev, role: event.target.value }))}
                >
                  <MenuItem value="employee">员工</MenuItem>
                  <MenuItem value="customer">客户</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                size="small"
                type="number"
                label="有效分钟"
                value={debugForm.expires_in_minutes}
                onChange={(event) => setDebugForm((prev) => ({ ...prev, expires_in_minutes: Number(event.target.value) }))}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                size="small"
                label="目标员工/客户ID"
                value={debugForm.target_id}
                onChange={(event) => setDebugForm((prev) => ({ ...prev, target_id: event.target.value.trim() }))}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                size="small"
                label="授权原因"
                value={debugForm.reason}
                onChange={(event) => setDebugForm((prev) => ({ ...prev, reason: event.target.value }))}
              />
            </Grid>
          </Grid>

          <Box sx={{ mt: 3, mb: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>最近调试授权</Typography>
            <Button size="small" onClick={() => fetchDebugAccess(debugForm.target_id ? { target_id: debugForm.target_id } : {})}>
              刷新
            </Button>
          </Box>
          <TableContainer sx={{ border: '1px solid rgba(0,0,0,.08)', borderRadius: 1 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>调试 OpenID</TableCell>
                  <TableCell>目标</TableCell>
                  <TableCell>状态</TableCell>
                  <TableCell>过期时间</TableCell>
                  <TableCell align="right">操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {debugAccessLoading ? (
                  <TableRow><TableCell colSpan={5} align="center"><CircularProgress size={20} /></TableCell></TableRow>
                ) : debugAccessItems.length ? (
                  debugAccessItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell sx={{ maxWidth: 220 }}>
                        <Tooltip title={item.debugger_openid || ''}>
                          <Typography variant="caption" sx={{ fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                            {item.debugger_openid}
                          </Typography>
                        </Tooltip>
                      </TableCell>
                      <TableCell>{item.role_label} · {item.target_name || item.target_id}</TableCell>
                      <TableCell>
                        <Chip size="small" label={item.is_active ? '生效中' : '已失效'} color={item.is_active ? 'success' : 'default'} />
                      </TableCell>
                      <TableCell>{formatDateTime(item.expires_at)}</TableCell>
                      <TableCell align="right">
                        {item.enabled && (
                          <Button size="small" color="error" onClick={() => handleDisableDebugAccess(item.id)}>
                            停用
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow><TableCell colSpan={5} align="center">暂无调试授权</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDebugDialogOpen(false)}>关闭</Button>
          <Button variant="contained" startIcon={<BugReportIcon />} onClick={handleCreateDebugAccess}>
            创建授权
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
