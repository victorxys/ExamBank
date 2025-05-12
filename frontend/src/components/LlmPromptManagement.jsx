// frontend/src/components/LlmPromptManagement.jsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Button, Typography, Paper, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, IconButton, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, CircularProgress, Select,
  MenuItem, FormControl, InputLabel, Chip, Tooltip
} from '@mui/material';
import { Edit as EditIcon, Delete as DeleteIcon, Add as AddIcon } from '@mui/icons-material';
import { llmApi } from '../api/llm';
import AlertMessage from './AlertMessage';
import PageHeader from './PageHeader';
import { useTheme } from '@mui/material/styles';

const LlmPromptManagement = () => {
  const theme = useTheme();
  const [prompts, setPrompts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState({ open: false, message: '', severity: 'info' });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [currentPrompt, setCurrentPrompt] = useState(null);
  const [models, setModels] = useState([]); // 用于选择关联模型
  const [formData, setFormData] = useState({
    prompt_name: '', prompt_identifier: '', prompt_template: '', model_identifier: '', version: 1, status: 'active', description: ''
  });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [promptToDelete, setPromptToDelete] = useState(null);

  const fetchPromptsAndModels = useCallback(async () => {
    setLoading(true);
    try {
      const [promptsResponse, modelsResponse] = await Promise.all([
        llmApi.getPrompts(),
        llmApi.getModels() // 获取模型列表用于下拉选择
      ]);
      setPrompts(promptsResponse.data || []);
      setModels(modelsResponse.data || []);
    } catch (error) {
      console.error("获取数据失败:", error);
      setAlert({ open: true, message: '获取提示词或模型列表失败: ' + (error.response?.data?.error || error.message), severity: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPromptsAndModels();
  }, [fetchPromptsAndModels]);

  const handleOpenDialog = (prompt = null) => {
    if (prompt) {
      setEditMode(true);
      setCurrentPrompt(prompt);
      setFormData({ ...prompt, model_identifier: prompt.model_identifier || '' }); // 确保 model_identifier 不是 null
    } else {
      setEditMode(false);
      setCurrentPrompt(null);
      setFormData({ prompt_name: '', prompt_identifier: '', prompt_template: '', model_identifier: '', version: 1, status: 'active', description: '' });
    }
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setCurrentPrompt(null);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: name === 'version' ? parseInt(value, 10) || 1 : value }));
  };

  const handleSubmit = async () => {
    if (!formData.prompt_name.trim() || !formData.prompt_identifier.trim() || !formData.prompt_template.trim()) {
      setAlert({ open: true, message: '提示词名称、标识符和模板内容不能为空', severity: 'warning' });
      return;
    }
    setLoading(true);
    try {
      const payload = {...formData};
      // 如果 model_identifier 为空字符串，则发送 null
      if (payload.model_identifier === '') {
        payload.model_identifier = null;
      }

      if (editMode && currentPrompt) {
        await llmApi.updatePrompt(currentPrompt.id, payload);
        setAlert({ open: true, message: '提示词更新成功', severity: 'success' });
      } else {
        await llmApi.createPrompt(payload);
        setAlert({ open: true, message: '提示词创建成功', severity: 'success' });
      }
      fetchPromptsAndModels();
      handleCloseDialog();
    } catch (error) {
      console.error("保存提示词失败:", error);
      setAlert({ open: true, message: error.response?.data?.error || '保存提示词失败', severity: 'error' });
    } finally {
      setLoading(false);
    }
  };
  
  const handleOpenDeleteDialog = (prompt) => {
    setPromptToDelete(prompt);
    setDeleteDialogOpen(true);
  };

  const handleCloseDeleteDialog = () => {
    setPromptToDelete(null);
    setDeleteDialogOpen(false);
  };

  const handleDeleteConfirm = async () => {
    if (!promptToDelete) return;
    setLoading(true);
    try {
      await llmApi.deletePrompt(promptToDelete.id);
      setAlert({ open: true, message: '提示词删除成功', severity: 'success' });
      fetchPromptsAndModels();
      handleCloseDeleteDialog();
    } catch (error) {
      console.error("删除提示词失败:", error);
      setAlert({ open: true, message: error.response?.data?.error ||'删除提示词失败', severity: 'error' });
    } finally {
      setLoading(false);
    }
  };


  return (
    <Box>
      <AlertMessage open={alert.open} message={alert.message} severity={alert.severity} onClose={() => setAlert(prev => ({ ...prev, open: false }))} />
      <PageHeader title="LLM 提示词管理" description="管理系统在与大语言模型交互时使用的提示词模板。" />
      <Paper sx={{ p: 2, mb: 2 }}>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpenDialog()} sx={{ mb: 2 }}>
          添加新提示词
        </Button>
        {loading && !prompts.length ? <Box sx={{display: 'flex', justifyContent: 'center', p:3}}><CircularProgress /></Box> : (
          <TableContainer>
            <Table stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>提示词名称</TableCell>
                  <TableCell>标识符</TableCell>
                  <TableCell>版本</TableCell>
                  <TableCell>关联模型</TableCell>
                  <TableCell>状态</TableCell>
                  <TableCell>操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {prompts.map((prompt) => (
                  <TableRow hover key={prompt.id}>
                    <TableCell>{prompt.prompt_name}</TableCell>
                    <TableCell>{prompt.prompt_identifier}</TableCell>
                    <TableCell>{prompt.version}</TableCell>
                    <TableCell>{prompt.model_name || (prompt.model_identifier ? `(标识符: ${prompt.model_identifier})` : '未指定')}</TableCell>
                    <TableCell>
                       <Chip
                        label={prompt.status === 'active' ? '激活' : (prompt.status === 'draft' ? '草稿' : '归档')}
                        color={prompt.status === 'active' ? 'success' : (prompt.status === 'draft' ? 'warning' : 'default')}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      <IconButton onClick={() => handleOpenDialog(prompt)} size="small"><EditIcon /></IconButton>
                      <IconButton onClick={() => handleOpenDeleteDialog(prompt)} size="small" color="error"><DeleteIcon /></IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="md" fullWidth>
        <DialogTitle>{editMode ? '编辑提示词' : '添加新提示词'}</DialogTitle>
        <DialogContent>
          <TextField autoFocus margin="dense" name="prompt_name" label="提示词名称 (用户友好)" type="text" fullWidth value={formData.prompt_name} onChange={handleChange} sx={{ mb: 2 }} required />
          <TextField margin="dense" name="prompt_identifier" label="提示词标识符 (程序使用)" type="text" fullWidth value={formData.prompt_identifier} onChange={handleChange} sx={{ mb: 2 }} required helperText="例如: EMPLOYEE_SUMMARY_V1"/>
          <TextField margin="dense" name="version" label="版本号" type="number" fullWidth value={formData.version} onChange={handleChange} sx={{ mb: 2 }} InputProps={{ inputProps: { min: 1 } }} required/>
          <FormControl fullWidth margin="dense" sx={{ mb: 2 }}>
            <InputLabel id="model-select-label">关联模型 (可选)</InputLabel>
            <Select labelId="model-select-label" name="model_identifier" value={formData.model_identifier || ''} label="关联模型 (可选)" onChange={handleChange}>
              <MenuItem value=""><em>无 (通用提示词)</em></MenuItem>
              {models.map(model => (
                <MenuItem key={model.id} value={model.model_identifier}>{model.model_name} ({model.model_identifier})</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            margin="dense"
            name="prompt_template"
            label="提示词模板内容"
            type="text"
            fullWidth
            multiline
            rows={10}
            value={formData.prompt_template}
            onChange={handleChange}
            sx={{ mb: 2 }}
            required
            helperText="可以使用 {placeholder} 形式的占位符。"
          />
          <TextField margin="dense" name="description" label="描述 (可选)" type="text" fullWidth multiline rows={3} value={formData.description || ''} onChange={handleChange} sx={{ mb: 2 }} />
          <FormControl fullWidth margin="dense" required>
            <InputLabel id="status-select-label-prompt">状态</InputLabel>
            <Select labelId="status-select-label-prompt" name="status" value={formData.status} label="状态" onChange={handleChange}>
              <MenuItem value="active">激活 (Active)</MenuItem>
              <MenuItem value="draft">草稿 (Draft)</MenuItem>
              <MenuItem value="archived">归档 (Archived)</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>取消</Button>
          <Button onClick={handleSubmit} variant="contained" disabled={loading}>{loading ? <CircularProgress size={24} /> : '保存'}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteDialogOpen} onClose={handleCloseDeleteDialog}>
        <DialogTitle>确认删除提示词</DialogTitle>
        <DialogContent>
          <Typography>确定要删除提示词 "{promptToDelete?.prompt_name} (v{promptToDelete?.version})" 吗？此操作不可撤销。</Typography>
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

export default LlmPromptManagement;