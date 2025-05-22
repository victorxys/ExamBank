// frontend/src/components/CourseResource/CourseResourceUploader.jsx
import React, { useState } from 'react';
import { Button, TextField, Box, CircularProgress, Typography, Alert, Paper, LinearProgress } from '@mui/material';
import { CloudUpload as CloudUploadIcon} from '@mui/icons-material';
import api from '../../api/axios'; // 您的 axios 实例

const CourseResourceUploader = ({ courseId, onUploadSuccess, onUploadError }) => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [resourceName, setResourceName] = useState('');
  const [description, setDescription] = useState('');
  const [sortOrder, setSortOrder] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0); // <<<--- 新增：上传进度状态 (0-100)


  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      setSelectedFile(file);
      setResourceName(file.name.split('.').slice(0, -1).join('.')); // 默认使用文件名（不含扩展名）
      setError('');
      setSuccessMessage('');
      setUploadProgress(0); // <<<--- 重置进度
    }
  };

  const handleNameChange = (event) => {
    setResourceName(event.target.value);
  };

  const handleDescriptionChange = (event) => {
    setDescription(event.target.value);
  };

  const handleSortOrderChange = (event) => {
    const value = parseInt(event.target.value, 10);
    setSortOrder(isNaN(value) ? 0 : value);
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setError('请先选择一个文件。');
      return;
    }
    if (!courseId) {
      setError('未指定课程ID。');
      return;
    }

    setUploading(true);
    setError('');
    setSuccessMessage('');
    setUploadProgress(0); // <<<--- 开始上传前重置进度


    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('name', resourceName || selectedFile.name.split('.').slice(0, -1).join('.'));
    formData.append('description', description);
    formData.append('sort_order', sortOrder.toString());

    try {
      const response = await api.post(`/courses/${courseId}/resources`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 300000, // 300秒 (5分钟) 超时
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) { // 确保 total 有效
              const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
              setUploadProgress(percentCompleted); // <<<--- 更新上传进度状态

              console.log(`Upload Progress: ${percentCompleted}%`);
              // TODO: 更新一个 state 来在 UI 中显示上传进度，例如 setUploadProgress(percentCompleted);
          }
        }
      });

      if (response.status === 201 && response.data.resource) {
        setSuccessMessage(`文件 "${response.data.resource.name}" 上传成功！`);
        setSelectedFile(null);
        setResourceName('');
        setDescription('');
        setSortOrder(0);
        if (typeof onUploadSuccess === 'function') {
          onUploadSuccess(response.data.resource);
        }
      } else {
        throw new Error(response.data?.error || '上传失败，请重试。');
      }
    } catch (err) {
      console.error('上传资源失败:', err);
      // 处理 Axios 超时错误 (err.code === 'ECONNABORTED' 且 err.message.includes('timeout'))
      let errMsg = '';
      if (err.code === 'ECONNABORTED' && err.message.includes('timeout')) {
          errMsg = `文件上传超时 (超过 ${300000 / 1000 / 60} 分钟)，请检查您的网络连接或尝试上传较小的文件。`;
      } else {
          errMsg = err.response?.data?.error || err.message || '上传过程中发生错误。';
      }
      setError(errMsg);
      if (typeof onUploadError === 'function') {
        onUploadError(errMsg);
      }
    } finally {
      setUploading(false);
      setUploadProgress(100); // <<<--- 上传完成后设置进度为100%

    }
  };

  return (
    <Paper elevation={1} sx={{ p: 2, mb: 2 }}>
      <Typography variant="h6" gutterBottom>上传新资源</Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {successMessage && <Alert severity="success" sx={{ mb: 2 }}>{successMessage}</Alert>}
      
      <TextField
        fullWidth
        label="资源显示名称 (可选)"
        value={resourceName}
        onChange={handleNameChange}
        size="small"
        sx={{ mb: 2 }}
        helperText={!resourceName && selectedFile ? `默认为文件名: ${selectedFile.name.split('.').slice(0, -1).join('.')}` : ""}
      />
      <TextField
        fullWidth
        label="资源描述 (可选)"
        value={description}
        onChange={handleDescriptionChange}
        multiline
        rows={2}
        size="small"
        sx={{ mb: 2 }}
      />
       <TextField
        fullWidth
        label="排序号 (可选, 数字越小越靠前)"
        type="number"
        value={sortOrder}
        onChange={handleSortOrderChange}
        size="small"
        sx={{ mb: 2 }}
      />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Button
          variant="outlined"
          component="label"
          startIcon={<CloudUploadIcon />}
          disabled={uploading}
        >
          选择文件
          <input
            type="file"
            hidden
            onChange={handleFileChange}
            // accept=".mp4,.mov,.mp3,.wav,.pdf,.doc,.docx" // 根据您的 ALLOWED_EXTENSIONS 调整
          />
        </Button>
        {selectedFile && (
          <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            已选: {selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
          </Typography>
        )}
      </Box>
      {/* <<<--- 新增：显示上传进度条 ---<<< */}
      {uploading && (
        <Box sx={{ width: '100%', mt: 1, mb: 1 }}>
          <LinearProgress variant="determinate" value={uploadProgress} />
          <Typography variant="caption" display="block" align="right" sx={{mt: 0.5}}>
            {uploadProgress}%
          </Typography>
        </Box>
      )}
      <Button
        variant="contained"
        color="primary"
        onClick={handleUpload}
        disabled={!selectedFile || uploading || !courseId}
        sx={{ mt: 2 }}
        startIcon={uploading && uploadProgress === 0 ? <CircularProgress size={20} color="inherit" /> : null} // 只在刚开始上传且无进度时显示菊花图
      >
        {uploading ? (uploadProgress > 0 ? `上传中... ${uploadProgress}%` : '准备上传...') : '开始上传'}
      </Button>
    </Paper>
  );
};

export default CourseResourceUploader;