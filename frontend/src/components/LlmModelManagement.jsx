// frontend/src/components/LlmModelManagement.jsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Button, Typography, Paper, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, IconButton, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, CircularProgress, Select,
  MenuItem, FormControl, InputLabel, Chip, Tooltip
} from '@mui/material';
import { Edit as EditIcon, Delete as DeleteIcon, Add as AddIcon } from '@mui/icons-material';
import { llmApi } from '../api/llm'; // 确认 API 客户端路径
import AlertMessage from './AlertMessage';
import PageHeader from './PageHeader';
import { useTheme } from '@mui/material/styles';

const LlmModelManagement = () => {
  const theme = useTheme();
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState({ open: false, message: '', severity: 'info' });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [currentModel, setCurrentModel] = useState(null);
  const [formData, setFormData] = useState({
    model_name: '', model_identifier: '', provider: 'Google', description: '', status: 'active'
  });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [modelToDelete, setModelToDelete] = useState(null);

  const fetchModels = useCallback(async () => {
    setLoading(true);
    try {
      const response = await llmApi.getModels();
      setModels(response.data || []);
    } catch (error) {
      console.error("获取模型列表失败:", error);
      setAlert({ open: true, message: '获取模型列表失败: ' + (error.response?.data?.error || error.message), severity: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  const handleOpenDialog = (model = null) => {
    if (model) {
      setEditMode(true);
      setCurrentModel(model);
      setFormData({ ...model });
    } else {
      setEditMode(false);
      setCurrentModel(null);
      setFormData({ model_name: '', model_identifier: '', provider: 'Google', description: '', status: 'active' });
    }
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setCurrentModel(null);
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async () => {
    if (!formData.model_name.trim() || !formData.model_identifier.trim() || !formData.provider.trim()) {
      setAlert({ open: true, message: '模型名称、标识符和提供商不能为空', severity: 'warning' });
      return;
    }
    setLoading(true); // 用于提交时的加载状态
    try {
      if (editMode && currentModel) {
        await llmApi.updateModel(currentModel.id, formData);
        setAlert({ open: true, message: '模型更新成功', severity: 'success' });
      } else {
        await llmApi.createModel(formData);
        setAlert({ open: true, message: '模型创建成功', severity: 'success' });
      }
      fetchModels();
      handleCloseDialog();
    } catch (error) {
      console.error("保存模型失败:", error);
      setAlert({ open: true, message: error.response?.data?.error || '保存模型失败', severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDeleteDialog = (model) => {
    setModelToDelete(model);
    setDeleteDialogOpen(true);
  };

  const handleCloseDeleteDialog = () => {
    setModelToDelete(null);
    setDeleteDialogOpen(false);
  };

  const handleDeleteConfirm = async () => {
    if (!modelToDelete) return;
    setLoading(true);
    try {
      await llmApi.deleteModel(modelToDelete.id);
      setAlert({ open: true, message: '模型删除成功', severity: 'success' });
      fetchModels();
      handleCloseDeleteDialog();
    } catch (error) {
      console.error("删除模型失败:", error);
      setAlert({ open: true, message: error.response?.data?.error || '删除模型失败', severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const providers = ["Google", "OpenAI", "Azure", "AWS", "HuggingFace", "Other"];

  return (
    <Box>
      <AlertMessage open={alert.open} message={alert.message} severity={alert.severity} onClose={() => setAlert(prev => ({ ...prev, open: false }))} />
      <PageHeader title="大语言模型管理" description="管理系统集成的大语言模型信息。" />
      <Paper sx={{ p: 2, mb: 2 }}>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpenDialog()} sx={{ mb: 2 }}>
          添加新模型
        </Button>
        {loading && !models.length ? <Box sx={{display: 'flex', justifyContent: 'center', p:3}}><CircularProgress /></Box> : (
          <TableContainer>
            <Table stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>模型名称</TableCell>
                  <TableCell>模型标识符 (API用)</TableCell>
                  <TableCell>提供商</TableCell>
                  <TableCell>状态</TableCell>
                  <TableCell>描述</TableCell>
                  <TableCell>操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {models.map((model) => (
                  <TableRow hover key={model.id}>
                    <TableCell>{model.model_name}</TableCell>
                    <TableCell>{model.model_identifier}</TableCell>
                    <TableCell>{model.provider}</TableCell>
                    <TableCell>
                      <Chip
                        label={model.status === 'active' ? '激活' : '停用'}
                        color={model.status === 'active' ? 'success' : 'default'}
                        size="small"
                      />
                    </TableCell>
                    <TableCell sx={{maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                        <Tooltip title={model.description || ''} placement="top-start">
                            <span>{model.description || '-'}</span>
                        </Tooltip>
                    </TableCell>
                    <TableCell>
                      <IconButton onClick={() => handleOpenDialog(model)} size="small"><EditIcon /></IconButton>
                      <IconButton onClick={() => handleOpenDeleteDialog(model)} size="small" color="error"><DeleteIcon /></IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{editMode ? '编辑模型' : '添加新模型'}</DialogTitle>
        <DialogContent>
          <TextField autoFocus margin="dense" name="model_name" label="模型名称 (用户友好)" type="text" fullWidth value={formData.model_name} onChange={handleChange} sx={{ mb: 2 }} required />
          <TextField margin="dense" name="model_identifier" label="模型标识符 (API调用时使用)" type="text" fullWidth value={formData.model_identifier} onChange={handleChange} sx={{ mb: 2 }} required helperText="例如: gemini-1.5-pro-latest"/>
          <FormControl fullWidth margin="dense" sx={{ mb: 2 }} required>
            <InputLabel id="provider-select-label">提供商</InputLabel>
            <Select labelId="provider-select-label" name="provider" value={formData.provider} label="提供商" onChange={handleChange}>
              {providers.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField margin="dense" name="description" label="描述 (可选)" type="text" fullWidth multiline rows={3} value={formData.description || ''} onChange={handleChange} sx={{ mb: 2 }} />
          <FormControl fullWidth margin="dense" required>
            <InputLabel id="status-select-label">状态</InputLabel>
            <Select labelId="status-select-label" name="status" value={formData.status} label="状态" onChange={handleChange}>
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
        <DialogTitle>确认删除模型</DialogTitle>
        <DialogContent>
          <Typography>确定要删除模型 "{modelToDelete?.model_name}" 吗？此操作不可撤销。</Typography>
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

export default LlmModelManagement;