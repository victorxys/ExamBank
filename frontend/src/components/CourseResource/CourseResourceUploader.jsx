// frontend/src/components/CourseResource/CourseResourceUploader.jsx
import React, { useState } from 'react';
import { Button, TextField, Box, CircularProgress, Typography, Alert, Paper } from '@mui/material';
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

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      setSelectedFile(file);
      setResourceName(file.name.split('.').slice(0, -1).join('.')); // 默认使用文件名（不含扩展名）
      setError('');
      setSuccessMessage('');
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
      const errMsg = err.response?.data?.error || err.message || '上传过程中发生错误。';
      setError(errMsg);
      if (typeof onUploadError === 'function') {
        onUploadError(errMsg);
      }
    } finally {
      setUploading(false);
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
      
      <Button
        variant="contained"
        color="primary"
        onClick={handleUpload}
        disabled={!selectedFile || uploading || !courseId}
        sx={{ mt: 2 }}
        startIcon={uploading ? <CircularProgress size={20} color="inherit" /> : null}
      >
        {uploading ? '上传中...' : '开始上传'}
      </Button>
    </Paper>
  );
};

export default CourseResourceUploader;