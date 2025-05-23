// frontend/src/components/CourseResource/CourseResourceList.jsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, List, ListItem, ListItemText, IconButton, Paper, ListItemIcon,
  CircularProgress, Alert, Chip, Tooltip, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, Button, TextField, Input // Input 用于文件类型
} from '@mui/material';
import {
    Delete as DeleteIcon, PlayArrow as PlayArrowIcon, Audiotrack as AudiotrackIcon,
    PictureAsPdf as PdfIcon, Description as DocIcon, Edit as EditIcon, OndemandVideo as VideoIcon,
    CloudUpload as CloudUploadIcon
} from '@mui/icons-material';
import api from '../../api/axios'; // 您的 axios 实例

const getFileIcon = (fileType, mimeType) => {
  if (fileType === 'video') return <VideoIcon color="primary" />;
  if (fileType === 'audio') return <AudiotrackIcon color="primary" />;
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
  const [newFileForEdit, setNewFileForEdit] = useState(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [resourceToDelete, setResourceToDelete] = useState(null);
  const [alertState, setAlertState] = useState({ open: false, message: '', severity: 'info' });

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
    setNewFileForEdit(null);
    setEditDialogOpen(true);
  };

  const handleCloseEditDialog = () => {
    setEditDialogOpen(false);
    setCurrentResource(null);
    setNewFileForEdit(null);
  };

  const handleNewFileChange = (event) => {
    setNewFileForEdit(event.target.files[0] || null);
  };

  const handleSaveEdit = async () => {
    console.log("Current Resource:", currentResource);
    console.log("Form Data State:", formData);
    console.log("New File for Edit:", newFileForEdit);
    if (!currentResource || !formData.name.trim()) {
      setAlertState({ open: true, message: '资源名称不能为空', severity: 'warning' });
      return;
    }
    
    const payload = new FormData(); // <<<--- 必须使用 FormData
    payload.append('name', formData.name.trim());
    payload.append('description', formData.description.trim());
    payload.append('sort_order', formData.sort_order.toString());
    if (newFileForEdit) {
      payload.append('file', newFileForEdit);
    }
    // console.log("FormData 'name':", payload.get('name'));
    // console.log("FormData 'description':", payload.get('description'));
    // console.log("FormData 'sort_order':", payload.get('sort_order'));
    // console.log("FormData 'file':", payload.get('file')); // 这会显示 File 对象
    try {
        // 当发送 FormData 时，Axios 会自动设置 Content-Type 为 multipart/form-data
        // 不需要手动在 headers 中设置 Content-Type
        const response = await api.put(`/resources/${currentResource.id}`, payload, {
          // headers: { // 如果全局 axios 实例有默认的 'Content-Type': 'application/json'，可能需要覆盖
          //   'Content-Type': 'multipart/form-data', // 或者让 axios 自动处理
          // },
        });

        if (response.status === 200) {
            setAlertState({ open: true, message: '资源信息更新成功！', severity: 'success' });
            handleCloseEditDialog();
            fetchResources(); // 重新加载列表
            if (typeof onResourceUpdated === 'function') {
                onResourceUpdated(response.data.resource);
            }
        } else {
            // 如果后端返回非200但被axios的validateStatus接受了，需要检查response.data中的错误
            throw new Error(response.data?.error || `更新失败，状态码: ${response.status}`);
        }
    } catch (err) {
        console.error('更新资源失败:', err);
        // 尝试从 err.response.data.error 获取后端返回的错误信息
        const serverErrorMessage = err.response?.data?.error;
        setAlertState({ 
            open: true, 
            message: `更新失败: ${serverErrorMessage || err.message || '未知错误'}`, 
            severity: 'error' 
        });
    }
  };
  
   // Helper function to get file extension
  const getFileExtension = (filename) => {
    if (!filename || typeof filename !== 'string') return '';
    const lastDot = filename.lastIndexOf('.');
    if (lastDot === -1 || lastDot === 0 || lastDot === filename.length - 1) return ''; // No extension or hidden file
    return filename.substring(lastDot + 1).toLowerCase();
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
      setAlertState({ open: true, message: '资源删除成功！', severity: 'success' });
    } catch (err) {
      console.error('删除资源失败:', err);
      setError(err.response?.data?.error || err.message || '删除资源失败。');
      setAlertState({ open: true, message: `删除失败: ${err.response?.data?.error || err.message}`, severity: 'error' });
      setDeleteDialogOpen(false);
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
      {alertState.open && <Alert severity={alertState.severity} sx={{ mb: 2 }} onClose={() => setAlertState(prev => ({...prev, open: false}))}>{alertState.message}</Alert>}
      {error && !alertState.open && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

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
                    </Typography>
                  </>
                }
              />
            </ListItem>
          ))}
        </List>
      )}

      <Dialog open={editDialogOpen} onClose={handleCloseEditDialog} maxWidth="sm" fullWidth>
        <DialogTitle>编辑资源信息</DialogTitle>
        <DialogContent>
          <TextField autoFocus margin="dense" label="资源名称" type="text" fullWidth variant="outlined" value={formData.name} onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))} sx={{ mb: 2 }} />
          <TextField margin="dense" label="资源描述" type="text" fullWidth multiline rows={3} variant="outlined" value={formData.description} onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))} sx={{ mb: 2 }} />
          <TextField margin="dense" label="排序号" type="number" fullWidth variant="outlined" value={formData.sort_order} onChange={(e) => setFormData(prev => ({ ...prev, sort_order: parseInt(e.target.value, 10) || 0 }))} sx={{ mb: 2 }} />
          
          <Typography variant="subtitle2" color="textSecondary" sx={{ mt: 2, mb: 1 }}>
            替换资源文件 (可选):
          </Typography>
          <Button
            variant="outlined"
            component="label" // 关键：使 Button 表现为 label
            startIcon={<CloudUploadIcon />}
            fullWidth
            sx={{ textTransform: 'none' }} // 防止按钮文字大写
          >
            {newFileForEdit ? `已选择: ${newFileForEdit.name}` : "选择新文件"}
            <input 
              type="file" 
              hidden // 关键：隐藏原生的 input
              onChange={handleNewFileChange} 
              // 可选：通过 accept 属性限制文件类型
              // accept=".mp4,.mov,.mp3,.wav,.pdf,.doc,.docx,image/*" 
            />
          </Button>
          {newFileForEdit && (
            <Typography variant="caption" display="block" sx={{ mt: 1 }}>
              已选择新文件: {newFileForEdit.name}
            </Typography>
          )}
          {!newFileForEdit && currentResource?.file_path && (
           <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 1 }}>
              当前文件: {currentResource.name}
              {/* 显示文件类型/后缀名 */}
              {currentResource.file_path && `.${getFileExtension(currentResource.file_path)}`}
              <br />
              {/* 可选：如果原始文件名和存储文件名不同，可以都显示 */}
              {currentResource.name !== currentResource.file_path.split('/').pop() && 
                currentResource.file_path.split('/').pop() !== `${currentResource.name}.${getFileExtension(currentResource.file_path)}` && // 避免重复显示 name.ext (name.ext)
                ` (实际存储: ${currentResource.file_path.split('/').pop()})`
              }
              . <br />
              如不选择新文件，则保留此文件。
           </Typography>
        )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseEditDialog}>取消</Button>
          <Button onClick={handleSaveEdit} variant="contained">保存更改</Button>
        </DialogActions>
      </Dialog>

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