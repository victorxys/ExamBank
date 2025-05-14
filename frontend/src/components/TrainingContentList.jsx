// frontend/src/components/TrainingContentList.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Button, Typography, Paper, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, IconButton, CircularProgress, Chip,
  Dialog, // <--- 确保 Dialog 已导入
  DialogTitle, // <--- 确保 DialogTitle 已导入 (如果使用了)
  DialogContent, // <--- 确保 DialogContent 已导入 (如果使用了)
  DialogActions, // <--- 确保 DialogActions 已导入 (如果使用了)
} from '@mui/material';
import { Add as AddIcon, Visibility as VisibilityIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { ttsApi } from '../api/tts'; // 确保路径正确
import AlertMessage from './AlertMessage';
import PageHeader from './PageHeader';
import UploadTrainingContentDialog from './UploadTrainingContentDialog'; // 引入对话框组件
import { formatRelativeTime } from '../api/dateUtils'; // 引入时间格式化工具

const TrainingContentList = () => {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const [contents, setContents] = useState([]);
  const [courseName, setCourseName] = useState('');
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState({ open: false, message: '', severity: 'info' });
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [contentToDelete, setContentToDelete] = useState(null);


  const fetchTrainingContents = useCallback(async () => {
    if (!courseId) return;
    setLoading(true);
    try {
      // 先获取课程信息，以便显示课程名称
      // (如果课程信息不重要，或者可以从其他地方获取，可以省略这一步)
      // const courseResponse = await api.get(`/courses/${courseId}`); 
      // setCourseName(courseResponse.data.course_name);

      const response = await ttsApi.getTrainingContentsByCourse(courseId);
      setContents(response.data || []);
    } catch (error) {
      console.error("获取培训内容列表失败:", error);
      setAlert({ open: true, message: '获取培训内容列表失败: ' + (error.response?.data?.error || error.message), severity: 'error' });
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    fetchTrainingContents();
  }, [fetchTrainingContents]);

  const handleUploadSuccess = (message) => {
    setAlert({ open: true, message: message, severity: 'success' });
    fetchTrainingContents(); // 上传成功后刷新列表
  };

  const handleOpenDeleteDialog = (content) => {
    setContentToDelete(content);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!contentToDelete) return;
    try {
      await ttsApi.deleteTrainingContent(contentToDelete.id);
      setAlert({ open: true, message: '培训内容删除成功', severity: 'success' });
      fetchTrainingContents(); // 删除成功后刷新列表
    } catch (error) {
      console.error("删除培训内容失败:", error);
      setAlert({ open: true, message: '删除失败: ' + (error.response?.data?.error || error.message), severity: 'error' });
    } finally {
      setDeleteDialogOpen(false);
      setContentToDelete(null);
    }
  };


  return (
    <Box>
      <AlertMessage open={alert.open} message={alert.message} severity={alert.severity} onClose={() => setAlert(prev => ({ ...prev, open: false }))} />
      <PageHeader 
        title={courseName ? `${courseName} - 培训内容` : "培训内容管理"} 
        description="管理课程的培训材料，并将其转换为语音。" 
      />
      <Paper sx={{ p: 2, mb: 2 }}>
        <Button 
          variant="contained" 
          startIcon={<AddIcon />} 
          onClick={() => setUploadDialogOpen(true)}
          sx={{ mb: 2 }}
        >
          上传新培训内容
        </Button>

        {loading ? <Box sx={{display: 'flex', justifyContent: 'center', p:3}}><CircularProgress /></Box> : (
          <TableContainer>
            <Table stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>内容名称</TableCell>
                  <TableCell>状态</TableCell>
                  <TableCell>上传者</TableCell>
                  <TableCell>创建时间</TableCell>
                  <TableCell>操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {contents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} align="center">
                      <Typography sx={{p:2}}>该课程下暂无培训内容。</Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  contents.map((content) => (
                    <TableRow hover key={content.id}>
                      <TableCell>
                        <Typography 
                          component="a" 
                          onClick={() => navigate(`/tts/content/${content.id}`)} // 假设详情页路由
                          sx={{cursor: 'pointer', '&:hover': {textDecoration: 'underline'}}}
                          color="primary"
                        >
                          {content.content_name}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip label={content.status || '未知'} size="small" 
                          color={
                            content.status === 'completed' ? 'success' : 
                            content.status?.startsWith('pending') ? 'warning' : 
                            content.status?.startsWith('processing') ? 'info' : 
                            'default'
                          }
                        />
                      </TableCell>
                      <TableCell>{content.uploader_username}</TableCell>
                      <TableCell>{formatRelativeTime(content.created_at)}</TableCell>
                      <TableCell>
                        <IconButton onClick={() => navigate(`/tts/content/${content.id}`)} size="small" title="查看详情">
                          <VisibilityIcon />
                        </IconButton>
                        <IconButton onClick={() => handleOpenDeleteDialog(content)} size="small" color="error" title="删除内容">
                          <DeleteIcon />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      <UploadTrainingContentDialog
        open={uploadDialogOpen}
        onClose={() => setUploadDialogOpen(false)}
        courseId={courseId}
        onUploadSuccess={handleUploadSuccess}
      />
      
      {/* 删除确认对话框 */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent>
          <Typography>
            确定要删除培训内容 "{contentToDelete?.content_name}" 吗？
            这将同时删除其下所有相关的脚本、句子和语音文件记录。此操作不可撤销。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>取消</Button>
          <Button onClick={handleConfirmDelete} color="error" variant="contained">
            删除
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default TrainingContentList;