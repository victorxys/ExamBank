// frontend/src/components/LlmApiKeyManagement.jsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Button, Typography, Paper, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, IconButton, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, CircularProgress, Select,
  MenuItem, FormControl, InputLabel, Chip, Tooltip
} from '@mui/material';
import { Edit as EditIcon, Delete as DeleteIcon, Add as AddIcon, Visibility, VisibilityOff } from '@mui/icons-material';
import { llmApi } from '../api/llm';
import AlertMessage from './AlertMessage';
import PageHeader from './PageHeader';
import { useTheme } from '@mui/material/styles';

const LlmApiKeyManagement = () => {
  const theme = useTheme();
  const [apiKeys, setApiKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState({ open: false, message: '', severity: 'info' });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [currentApiKey, setCurrentApiKey] = useState(null);
  const [showApiKey, setShowApiKey] = useState(false); // 控制API Key是否可见
  const [formData, setFormData] = useState({
    key_name: '', api_key: '', provider: 'Google', status: 'active', notes: ''
  });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [apiKeyToDelete, setApiKeyToDelete] = useState(null);

  const fetchApiKeys = useCallback(async () => {
    setLoading(true);
    try {
      const response = await llmApi.getApiKeys();
      setApiKeys(response.data || []);
    } catch (error) {
      console.error("获取API Keys失败:", error);
      setAlert({ open: true, message: '获取API Keys失败: ' + (error.response?.data?.error || error.message), severity: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchApiKeys();
  }, [fetchApiKeys]);

  const handleOpenDialog = (apiKey = null) => {
    setShowApiKey(false); // 每次打开弹窗时默认隐藏Key
    if (apiKey) {
      setEditMode(true);
      setCurrentApiKey(apiKey);
      // 编辑时不显示实际的key，让用户如果需要修改则重新输入
      setFormData({ ...apiKey, api_key: '' }); 
    } else {
      setEditMode(false);
      setCurrentApiKey(null);
      setFormData({ key_name: '', api_key: '', provider: 'Google', status: 'active', notes: '' });
    }
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setCurrentApiKey(null);
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async () => {
    if (!formData.key_name.trim() || !formData.provider.trim()) {
        setAlert({ open: true, message: 'Key名称和提供商不能为空', severity: 'warning' });
        return;
    }
    // 如果是创建模式，或者编辑模式下用户输入了新的 api_key，则 api_key 字段不能为空
    if ((!editMode && !formData.api_key.trim()) || (editMode && formData.api_key && !formData.api_key.trim())) {
        setAlert({ open: true, message: 'API Key 值不能为空', severity: 'warning' });
        return;
    }

    setLoading(true);
    try {
      // 只有当 formData.api_key 有值时才发送它，否则后端会保留旧的加密值
      const payload = { ...formData };
      if (!payload.api_key) {
        delete payload.api_key; // 如果为空，不发送此字段，让后端保留旧值
      }

      if (editMode && currentApiKey) {
        await llmApi.updateApiKey(currentApiKey.id, payload);
        setAlert({ open: true, message: 'API Key更新成功', severity: 'success' });
      } else {
        await llmApi.createApiKey(payload); // 创建时 api_key 是必须的
        setAlert({ open: true, message: 'API Key创建成功', severity: 'success' });
      }
      fetchApiKeys();
      handleCloseDialog();
    } catch (error) {
      console.error("保存API Key失败:", error);
      setAlert({ open: true, message: error.response?.data?.error || '保存API Key失败', severity: 'error' });
    } finally {
      setLoading(false);
    }
  };
  
  const handleOpenDeleteDialog = (apiKey) => {
    setApiKeyToDelete(apiKey);
    setDeleteDialogOpen(true);
  };

  const handleCloseDeleteDialog = () => {
    setApiKeyToDelete(null);
    setDeleteDialogOpen(false);
  };

  const handleDeleteConfirm = async () => {
    if (!apiKeyToDelete) return;
    setLoading(true);
    try {
      await llmApi.deleteApiKey(apiKeyToDelete.id);
      setAlert({ open: true, message: 'API Key删除成功', severity: 'success' });
      fetchApiKeys();
      handleCloseDeleteDialog();
    } catch (error) {
      console.error("删除API Key失败:", error);
      setAlert({ open: true, message: error.response?.data?.error || '删除API Key失败', severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const providers = ["Google", "OpenAI", "Azure", "AWS", "HuggingFace", "Jinshuju", "Other"];

  return (
    <Box>
      <AlertMessage open={alert.open} message={alert.message} severity={alert.severity} onClose={() => setAlert(prev => ({ ...prev, open: false }))} />
      <PageHeader title="LLM API Key管理" description="管理系统访问大语言模型所需的API Keys（密钥）。请妥善保管。" />
      <Paper sx={{ p: 2, mb: 2 }}>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpenDialog()} sx={{ mb: 2 }}>
          添加 API Key
        </Button>
        {loading && !apiKeys.length ? <Box sx={{display: 'flex', justifyContent: 'center', p:3}}><CircularProgress /></Box> : (
          <TableContainer>
            <Table stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Key 名称</TableCell>
                  <TableCell>提供商</TableCell>
                  <TableCell>状态</TableCell>
                  <TableCell>备注</TableCell>
                  <TableCell>创建时间</TableCell>
                  <TableCell>操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {apiKeys.map((key) => (
                  <TableRow hover key={key.id}>
                    <TableCell>{key.key_name}</TableCell>
                    <TableCell>{key.provider}</TableCell>
                    <TableCell>
                      <Chip
                        label={key.status === 'active' ? '激活' : '停用'}
                        color={key.status === 'active' ? 'success' : 'default'}
                        size="small"
                      />
                    </TableCell>
                    <TableCell sx={{maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                        <Tooltip title={key.notes || ''} placement="top-start">
                            <span>{key.notes || '-'}</span>
                        </Tooltip>
                    </TableCell>
                    <TableCell>{key.created_at ? new Date(key.created_at).toLocaleDateString() : '-'}</TableCell>
                    <TableCell>
                      <IconButton onClick={() => handleOpenDialog(key)} size="small"><EditIcon /></IconButton>
                      <IconButton onClick={() => handleOpenDeleteDialog(key)} size="small" color="error"><DeleteIcon /></IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{editMode ? '编辑 API Key' : '添加 API Key'}</DialogTitle>
        <DialogContent>
          <TextField autoFocus margin="dense" name="key_name" label="Key 名称 (易于识别)" type="text" fullWidth value={formData.key_name} onChange={handleChange} sx={{ mb: 2 }} required />
          <FormControl fullWidth margin="dense" sx={{ mb: 2 }} required>
            <InputLabel id="provider-select-label-apikey">提供商</InputLabel>
            <Select labelId="provider-select-label-apikey" name="provider" value={formData.provider} label="提供商" onChange={handleChange}>
              {providers.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField
            margin="dense"
            name="api_key"
            label={editMode ? "API Key (如需更改请输入新值)" : "API Key 值"}
            type={showApiKey ? "text" : "password"}
            fullWidth
            value={formData.api_key}
            onChange={handleChange}
            sx={{ mb: 2 }}
            required={!editMode} // 创建时必填
            InputProps={{
              endAdornment: (
                <IconButton onClick={() => setShowApiKey(!showApiKey)} edge="end">
                  {showApiKey ? <VisibilityOff /> : <Visibility />}
                </IconButton>
              )
            }}
            helperText={editMode ? "留空则不更改现有密钥" : "请粘贴您的API Key"}
          />
          <TextField margin="dense" name="notes" label="备注 (可选)" type="text" fullWidth multiline rows={3} value={formData.notes || ''} onChange={handleChange} sx={{ mb: 2 }} />
          <FormControl fullWidth margin="dense" required>
            <InputLabel id="status-select-label-apikey">状态</InputLabel>
            <Select labelId="status-select-label-apikey" name="status" value={formData.status} label="状态" onChange={handleChange}>
              <MenuItem value="active">激活 (Active)</MenuItem>
              <MenuItem value="inactive">停用 (Inactive)</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>取消</Button>
          <Button onClick={handleSubmit} variant="contained" disabled={loading}>{loading ? <CircularProgress size={24} /> : '保存'}</Button>
        </DialogActions>
      </Dialog>
      
      <Dialog open={deleteDialogOpen} onClose={handleCloseDeleteDialog}>
        <DialogTitle>确认删除 API Key</DialogTitle>
        <DialogContent>
          <Typography>确定要删除API Key "{apiKeyToDelete?.key_name}" 吗？此操作不可撤销。</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDeleteDialog}>取消</Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained" disabled={loading}>
            {loading ? <CircularProgress size={24} /> : '删除'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default LlmApiKeyManagement;