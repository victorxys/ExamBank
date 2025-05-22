// frontend/src/components/CourseResource/CourseResourceList.jsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, List, ListItem, ListItemText, IconButton, Paper,ListItemIcon,
  CircularProgress, Alert, Chip, Tooltip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Button, TextField
} from '@mui/material';
import {
    Delete as DeleteIcon, PlayArrow as PlayArrowIcon, Audiotrack as AudiotrackIcon,
    PictureAsPdf as PdfIcon, Description as DocIcon, Edit as EditIcon
} from '@mui/icons-material';
import api from '../../api/axios'; // 您的 axios 实例
import { API_BASE_URL } from '../../config'; // 用于构建文件URL (如果需要)

const getFileIcon = (fileType, mimeType) => {
  if (fileType === 'video') return <PlayArrowIcon color="primary" />;
  if (fileType === 'audio') return <AudiotrackIcon color="secondary" />;
  if (fileType === 'document') {
    if (mimeType === 'application/pdf') return <PdfIcon sx={{ color: 'red' }} />;
    return <DocIcon sx={{ color: 'blue' }} />;
  }
  return <DocIcon color="disabled" />;
};

const CourseResourceList = ({ courseId, onResourceDeleted, onResourceUpdated }) => {
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [currentResource, setCurrentResource] = useState(null);
  const [formData, setFormData] = useState({ name: '', description: '', sort_order: 0 });

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [resourceToDelete, setResourceToDelete] = useState(null);
  const [alert, setAlert] = useState({ open: false, message: '', severity: 'info' });



  const fetchResources = useCallback(async () => {
    if (!courseId) {
      setResources([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await api.get(`/courses/${courseId}/resources`);
      setResources(response.data || []);
    } catch (err) {
      console.error('获取课程资源失败:', err);
      setError(err.response?.data?.error || err.message || '获取资源列表失败。');
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    fetchResources();
  }, [fetchResources]);

  const handleOpenEditDialog = (resource) => {
    setCurrentResource(resource);
    setFormData({
      name: resource.name,
      description: resource.description || '',
      sort_order: resource.sort_order || 0,
    });
    setEditDialogOpen(true);
  };

  const handleCloseEditDialog = () => {
    setEditDialogOpen(false);
    setCurrentResource(null);
  };

  const handleSaveEdit = async () => {
    if (!currentResource) return;
    try {
        const response = await api.put(`/resources/${currentResource.id}`, formData);
        if (response.status === 200) {
            setAlert({ open: true, message: '资源信息更新成功！', severity: 'success' });
            handleCloseEditDialog();
            fetchResources(); // 重新加载列表
            if (typeof onResourceUpdated === 'function') {
                onResourceUpdated(response.data.resource);
            }
        } else {
            throw new Error(response.data?.error || '更新失败');
        }
    } catch (err) {
        console.error('更新资源失败:', err);
        setAlert({ open: true, message: `更新失败: ${err.message}`, severity: 'error' });
    }
  };
  
  const handleOpenDeleteDialog = (resource) => {
    setResourceToDelete(resource);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!resourceToDelete) return;
    try {
      await api.delete(`/resources/${resourceToDelete.id}`);
      setResources(prev => prev.filter(res => res.id !== resourceToDelete.id));
      setDeleteDialogOpen(false);
      if (typeof onResourceDeleted === 'function') {
        onResourceDeleted(resourceToDelete.id);
      }
      // 可以选择在这里添加一个成功提示
    } catch (err) {
      console.error('删除资源失败:', err);
      setError(err.response?.data?.error || err.message || '删除资源失败。');
      setDeleteDialogOpen(false); // 也关闭对话框
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0 || !bytes) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}><CircularProgress /></Box>;
  }

  return (
    <Paper elevation={1} sx={{ p: 2 }}>
      <Typography variant="h6" gutterBottom>课程资源列表</Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {resources.length === 0 ? (
        <Typography color="textSecondary">该课程下暂无资源。</Typography>
      ) : (
        <List dense>
          {resources.map(resource => (
            <ListItem
              key={resource.id}
              divider
              secondaryAction={
                <>
                  <Tooltip title="编辑信息">
                    <IconButton edge="end" aria-label="edit" onClick={() => handleOpenEditDialog(resource)} size="small" sx={{mr: 0.5}}>
                      <EditIcon fontSize="small"/>
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="删除资源">
                    <IconButton edge="end" aria-label="delete" onClick={() => handleOpenDeleteDialog(resource)} size="small">
                      <DeleteIcon color="error" fontSize="small"/>
                    </IconButton>
                  </Tooltip>
                </>
              }
              sx={{ '&:hover': { backgroundColor: 'action.hover' }, borderRadius: 1, mb: 0.5 }}
            >
              <ListItemIcon sx={{minWidth: 36}}>
                {getFileIcon(resource.file_type, resource.mime_type)}
              </ListItemIcon>
              <ListItemText
                primary={
                  <Typography variant="subtitle1" component="span" sx={{ fontWeight: 500 }}>
                    {resource.name}
                     <Chip label={`排序: ${resource.sort_order}`} size="small" sx={{ml: 1, fontSize: '0.7rem'}}/>
                  </Typography>
                }
                secondary={
                  <>
                    <Typography component="span" variant="body2" color="textSecondary">
                      {resource.description || '暂无描述'}
                    </Typography>
                    <br />
                    <Typography component="span" variant="caption" color="textSecondary">
                      类型: {resource.file_type} | 
                      大小: {formatFileSize(resource.size_bytes)} | 
                      上传者: {resource.uploader_name || '未知'} | 
                      上传时间: {new Date(resource.created_at).toLocaleDateString()}
                      {/* 播放链接 - 为后续播放功能预留 */}
                      {/* <Button size="small" sx={{ml:1}} onClick={() => window.open(`${API_BASE_URL.replace('/api', '')}/course_resources_files/${resource.file_path}`, '_blank')}>预览/播放</Button> */}
                    </Typography>
                  </>
                }
              />
            </ListItem>
          ))}
        </List>
      )}

      {/* 编辑资源对话框 */}
      <Dialog open={editDialogOpen} onClose={handleCloseEditDialog} maxWidth="sm" fullWidth>
        <DialogTitle>编辑资源信息</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="资源名称"
            type="text"
            fullWidth
            variant="outlined"
            value={formData.name}
            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
            sx={{ mb: 2 }}
          />
          <TextField
            margin="dense"
            label="资源描述"
            type="text"
            fullWidth
            multiline
            rows={3}
            variant="outlined"
            value={formData.description}
            onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
            sx={{ mb: 2 }}
          />
          <TextField
            margin="dense"
            label="排序号"
            type="number"
            fullWidth
            variant="outlined"
            value={formData.sort_order}
            onChange={(e) => setFormData(prev => ({ ...prev, sort_order: parseInt(e.target.value, 10) || 0 }))}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseEditDialog}>取消</Button>
          <Button onClick={handleSaveEdit} variant="contained">保存</Button>
        </DialogActions>
      </Dialog>

      {/* 删除确认对话框 */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>确认删除资源</DialogTitle>
        <DialogContent>
          <DialogContentText>
            确定要删除资源 "{resourceToDelete?.name}" 吗？此操作将同时删除服务器上的文件，且不可恢复。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>取消</Button>
          <Button onClick={handleConfirmDelete} color="error" variant="contained">
            确认删除
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};

export default CourseResourceList;