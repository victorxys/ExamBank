import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Paper,
  Typography,
  Box,
  FormControlLabel,
  Checkbox,
  Button,
  Card,
  CardContent,
  Divider,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  TextField,
  IconButton,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import AlertMessage from './AlertMessage';
import api from '../api/axios';
import PageHeader from './PageHeader';

const EvaluationManagement = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [alertMessage, setAlertMessage] = useState(null);
  const [alertOpen, setAlertOpen] = useState(false);
  const [evaluationStructure, setEvaluationStructure] = useState([]);
  const [visibilitySettings, setVisibilitySettings] = useState({});
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedAspect, setSelectedAspect] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [newItemData, setNewItemData] = useState({
    name: '',
    description: ''
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await api.get('/evaluation/structure');
        if (Array.isArray(response.data)) {
          setEvaluationStructure(response.data);
          const initialVisibility = {};
          response.data.forEach(aspect => {
            aspect.children?.forEach(category => {
              category.children?.forEach(item => {
                initialVisibility[item.id] = item.is_visible_to_client || false;
              });
            });
          });
          setVisibilitySettings(initialVisibility);
        } else {
          throw new Error('评价结构数据格式不正确');
        }
      } catch (error) {
        console.error('获取数据失败:', error);
        setAlertMessage({
          severity: 'error',
          message: '获取数据失败: ' + (error.response?.data?.message || error.message)
        });
        setAlertOpen(true);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleVisibilityChange = (itemId) => (event) => {
    setVisibilitySettings(prev => ({
      ...prev,
      [itemId]: event.target.checked
    }));
  };

  const handleSave = async () => {
    try {
      await api.put('/evaluation/visibility', {
        visibilitySettings
      });
      setAlertMessage({
        severity: 'success',
        message: '可见性设置保存成功'
      });
      setAlertOpen(true);
    } catch (error) {
      console.error('保存失败:', error);
      setAlertMessage({
        severity: 'error',
        message: error.response?.data?.message || error.message || '保存失败，请稍后重试'
      });
      setAlertOpen(true);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  const handleAlertClose = () => {
    setAlertOpen(false);
  };

  const handleEditClick = (aspect, category, item) => {
    setSelectedAspect(aspect);
    setSelectedCategory(category);
    setSelectedItem(item);
    setNewItemData({
      name: item.name,
      description: item.description || ''
    });
    setEditDialogOpen(true);
  };

  const handleDeleteClick = (aspect, category, item) => {
    setSelectedAspect(aspect);
    setSelectedCategory(category);
    setSelectedItem(item);
    setDeleteDialogOpen(true);
  };

  const handleAddItem = (aspect, category) => {
    setSelectedAspect(aspect);
    setSelectedCategory(category);
    setSelectedItem(null);
    setNewItemData({
      name: '',
      description: ''
    });
    setEditDialogOpen(true);
  };

  const handleEditSave = async () => {
    try {
      if (!newItemData.name.trim()) {
        setAlertMessage({
          severity: 'error',
          message: '请输入评价项名称'
        });
        setAlertOpen(true);
        return;
      }

      const endpoint = selectedItem ? `/evaluation_item/${selectedItem.id}` : '/evaluation_item/';
      const method = selectedItem ? 'put' : 'post';
      const requestData = JSON.stringify({
        item_name: newItemData.name.trim(),
        description: newItemData.description.trim(),
        aspect_id: selectedAspect.id,
        category_id: selectedCategory.id,
        is_visible_to_client: false
      });
      console.log('完整请求URL:', `${api.defaults.baseURL}${endpoint}`);
      console.log('请求方法:', method);
      console.log('请求数据:', requestData);
      await api[method](endpoint, requestData, {
  headers: {
    'Content-Type': 'application/json'
  }
});

      setAlertMessage({
        severity: 'success',
        message: selectedItem ? '评价项更新成功' : '评价项创建成功'
      });
      setAlertOpen(true);
      setEditDialogOpen(false);

      // 重新获取评价结构
      const response = await api.get('/evaluation/structure');
      if (Array.isArray(response.data)) {
        setEvaluationStructure(response.data);
      }
    } catch (error) {
      console.error('保存失败:', error);
      setAlertMessage({
        severity: 'error',
        message: error.response?.data?.message || error.message || '保存失败，请稍后重试'
      });
      setAlertOpen(true);
    }
  };

  const handleDelete = async () => {
    try {
        await api.delete(`/evaluation_item/${selectedItem.id}`); // 使用 DELETE 方法和正确的 URL
        // console.log(`Item ${item_id} 删除成功`);
        

      setAlertMessage({
        severity: 'success',
        message: '评价项删除成功'
      });
      setAlertOpen(true);
      setDeleteDialogOpen(false);

      // 重新获取评价结构
      const response = await api.get('/evaluation/structure');
      if (Array.isArray(response.data)) {
        setEvaluationStructure(response.data);
      }
    } catch (error) {
      console.error('删除失败:', error);
      setAlertMessage({
        severity: 'error',
        message: error.response?.data?.message || error.message || '删除失败，请稍后重试'
      });
      setAlertOpen(true);
    }
  };

  return (
    <Container maxWidth="100%">
      <AlertMessage
        open={alertOpen}
        message={alertMessage?.message}
        severity={alertMessage?.severity || 'info'}
        onClose={handleAlertClose}
      />
      <PageHeader
        title="评价管理"
        description="管理评价项及其对客户的可见性"
      />
      {evaluationStructure.map(aspect => (
        <Card key={aspect.id} sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h2" gutterBottom textAlign={'center'}>{aspect.name}</Typography>
            {aspect.children?.map(category => (
              <Box key={category.id} sx={{ mb: 3 }}>
                <Typography variant="h3" gutterBottom>{category.name}</Typography>
                {category.children?.map(item => (
                  <Box key={item.id} sx={{ mb: 2 }}>
                    <Box display="flex" justifyContent="space-between" alignItems="center">
                      <Box display="flex" alignItems="center" gap={2}>
                        <Typography variant="body1">{item.name}</Typography>
                        <IconButton
                          size="small"
                          onClick={() => handleEditClick(aspect, category, item)}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={() => handleDeleteClick(aspect, category, item)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Box>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={visibilitySettings[item.id] || false}
                            onChange={handleVisibilityChange(item.id)}
                          />
                        }
                        label="开放给客户"
                      />
                    </Box>
                    {item.description && (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, ml: 2 }}>
                        {item.description}
                      </Typography>
                    )}
                  </Box>
                ))}
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() => handleAddItem(aspect, category)}
                  sx={{ mt: 2 }}
                >
                  添加评价项
                </Button>
                <Divider sx={{ my: 2 }} />
              </Box>
            ))}
          </CardContent>
        </Card>
      ))}
      <Box display="flex" justifyContent="center" mt={4}>
        <Button
          variant="contained"
          color="primary"
          onClick={handleSave}
        >
          保存设置
        </Button>
      </Box>
      {/* 编辑对话框 */}
      <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)}>
        <DialogTitle>{selectedItem ? '编辑评价项' : '添加评价项'}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="评价项名称"
            fullWidth
            value={newItemData.name}
            onChange={(e) => setNewItemData({ ...newItemData, name: e.target.value })}
          />
          <TextField
            margin="dense"
            label="评价项描述"
            fullWidth
            multiline
            rows={4}
            value={newItemData.description}
            onChange={(e) => setNewItemData({ ...newItemData, description: e.target.value })}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)}>取消</Button>
          <Button onClick={handleEditSave} variant="contained" color="primary">
            保存
          </Button>
        </DialogActions>
      </Dialog>

      {/* 删除确认对话框 */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent>
          <DialogContentText>
            确定要删除评价项 {selectedItem?.name} 吗？此操作不可撤销。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>取消</Button>
          <Button onClick={handleDelete} variant="contained" color="error">
            删除
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default EvaluationManagement;