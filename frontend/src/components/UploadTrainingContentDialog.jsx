// frontend/src/components/UploadTrainingContentDialog.jsx
import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  FormControl, InputLabel, Select, MenuItem, CircularProgress, Box, Typography
} from '@mui/material';
import { ttsApi } from '../api/tts'; // 确保路径正确

const UploadTrainingContentDialog = ({ open, onClose, courseId, onUploadSuccess }) => {
  const [contentName, setContentName] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [llmOralPromptId, setLlmOralPromptId] = useState('');
  const [llmRefinePromptId, setLlmRefinePromptId] = useState('');
  const [prompts, setPrompts] = useState([]);
  const [loadingPrompts, setLoadingPrompts] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      // 重置表单
      setContentName('');
      setOriginalContent('');
      setLlmOralPromptId('');
      setLlmRefinePromptId('');
      setError('');
      fetchPrompts();
    }
  }, [open]);

  const fetchPrompts = async () => {
    setLoadingPrompts(true);
    try {
      const response = await ttsApi.getLlmPrompts();
      setPrompts(response.data || []);
    } catch (err) {
      console.error("获取Prompts失败:", err);
      setError("获取提示词列表失败，请稍后重试。");
    } finally {
      setLoadingPrompts(false);
    }
  };

  const handleSubmit = async () => {
    if (!contentName.trim() || !originalContent.trim() || !courseId) {
      setError('内容名称、原始文本和课程ID不能为空。');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const payload = {
        course_id: courseId,
        content_name: contentName.trim(),
        original_content: originalContent.trim(),
        llm_oral_prompt_id: llmOralPromptId || null, // 发送 null 如果未选择
        llm_refine_prompt_id: llmRefinePromptId || null, // 发送 null 如果未选择
      };
      await ttsApi.createTrainingContent(payload);
      onUploadSuccess('培训内容上传成功，后台正在处理脚本...');
      onClose(); // 关闭对话框
    } catch (err) {
      console.error("上传培训内容失败:", err);
      setError(err.response?.data?.error || '上传失败，请重试。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>上传新的培训内容</DialogTitle>
      <DialogContent dividers>
        {error && <Typography color="error" sx={{ mb: 2 }}>{error}</Typography>}
        <TextField
          autoFocus
          margin="dense"
          label="培训内容名称"
          type="text"
          fullWidth
          variant="outlined"
          value={contentName}
          onChange={(e) => setContentName(e.target.value)}
          required
          sx={{ mb: 2 }}
        />
        <TextField
          margin="dense"
          label="原始培训内容文本"
          type="text"
          fullWidth
          multiline
          rows={10}
          variant="outlined"
          value={originalContent}
          onChange={(e) => setOriginalContent(e.target.value)}
          required
          sx={{ mb: 2 }}
          helperText="请在此处粘贴或输入您的培训文档原始内容。"
        />
        {loadingPrompts ? <CircularProgress size={24} /> : (
          <>
            <FormControl fullWidth margin="dense" sx={{ mb: 2 }}>
              <InputLabel id="llm-oral-prompt-label">选择口语化处理Prompt (可选)</InputLabel>
              <Select
                labelId="llm-oral-prompt-label"
                value={llmOralPromptId}
                label="选择口语化处理Prompt (可选)"
                onChange={(e) => setLlmOralPromptId(e.target.value)}
              >
                <MenuItem value=""><em>不选择 (使用默认或不处理)</em></MenuItem>
                {prompts.filter(p => p.status === 'active').map((prompt) => (
                  <MenuItem key={prompt.id} value={prompt.id}>
                    {prompt.prompt_name} (v{prompt.version}) - {prompt.prompt_identifier}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth margin="dense">
              <InputLabel id="llm-refine-prompt-label">选择LLM最终修订Prompt (可选)</InputLabel>
              <Select
                labelId="llm-refine-prompt-label"
                value={llmRefinePromptId}
                label="选择LLM最终修订Prompt (可选)"
                onChange={(e) => setLlmRefinePromptId(e.target.value)}
              >
                <MenuItem value=""><em>不选择 (使用默认或不处理)</em></MenuItem>
                {prompts.filter(p => p.status === 'active').map((prompt) => (
                  <MenuItem key={prompt.id} value={prompt.id}>
                    {prompt.prompt_name} (v{prompt.version}) - {prompt.prompt_identifier}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} disabled={submitting}>取消</Button>
        <Button onClick={handleSubmit} variant="contained" disabled={submitting || loadingPrompts}>
          {submitting ? <CircularProgress size={24} color="inherit" /> : '上传并开始处理'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default UploadTrainingContentDialog;