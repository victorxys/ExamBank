import React, { useState, useEffect } from 'react';
import {
  Container,
  Paper,
  Typography,
  Button,
  List,
  ListItem,
  ListItemText,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  IconButton,
  Box,
  Divider,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip
} from '@mui/material';
import { Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon } from '@mui/icons-material';
import axios from 'axios';

const KnowledgePointManagement = () => {
  const [courses, setCourses] = useState([]);
  const [selectedCourse, setSelectedCourse] = useState('');
  const [knowledgePoints, setKnowledgePoints] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPoint, setEditingPoint] = useState(null);
  const [formData, setFormData] = useState({
    content: '',
    description: ''
  });

  useEffect(() => {
    fetchCourses();
  }, []);

  useEffect(() => {
    if (selectedCourse) {
      fetchKnowledgePoints();
    }
  }, [selectedCourse]);

  const fetchCourses = async () => {
    try {
      const response = await axios.get('/api/courses');
      setCourses(response.data);
    } catch (error) {
      console.error('获取课程列表失败:', error);
    }
  };

  const fetchKnowledgePoints = async () => {
    try {
      const response = await axios.get(`/api/courses/${selectedCourse}/knowledge-points`);
      setKnowledgePoints(response.data);
    } catch (error) {
      console.error('获取知识点列表失败:', error);
    }
  };

  const handleOpenDialog = (point = null) => {
    if (point) {
      setEditingPoint(point);
      setFormData({
        content: point.content,
        description: point.description || ''
      });
    } else {
      setEditingPoint(null);
      setFormData({
        content: '',
        description: ''
      });
    }
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingPoint(null);
    setFormData({
      content: '',
      description: ''
    });
  };

  const handleSubmit = async () => {
    try {
      if (editingPoint) {
        await axios.put(`/api/knowledge-points/${editingPoint.id}`, {
          ...formData,
          course_id: selectedCourse
        });
      } else {
        await axios.post('/api/knowledge-points', {
          ...formData,
          course_id: selectedCourse
        });
      }
      fetchKnowledgePoints();
      handleCloseDialog();
    } catch (error) {
      console.error('保存知识点失败:', error);
    }
  };

  const handleDelete = async (pointId) => {
    if (window.confirm('确定要删除这个知识点吗？')) {
      try {
        await axios.delete(`/api/knowledge-points/${pointId}`);
        fetchKnowledgePoints();
      } catch (error) {
        console.error('删除知识点失败:', error);
      }
    }
  };

  const handleExtractKnowledgePoints = async () => {
    try {
      // 这里可以调用后端的知识点提取API
      // 目前是一个示例实现
      const response = await axios.post(`/api/courses/${selectedCourse}/extract-knowledge-points`);
      const extractedPoints = response.data;
      
      // 将提取的知识点添加到数据库
      for (const point of extractedPoints) {
        await axios.post('/api/knowledge-points', {
          course_id: selectedCourse,
          content: point.content,
          description: point.description
        });
      }
      
      fetchKnowledgePoints();
    } catch (error) {
      console.error('知识点提取失败:', error);
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Paper elevation={3} sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Typography variant="h5" component="h1">
            知识点管理
          </Typography>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button
              variant="contained"
              color="secondary"
              onClick={handleExtractKnowledgePoints}
              disabled={!selectedCourse}
            >
              提取知识点
            </Button>
            <Button
              variant="contained"
              color="primary"
              startIcon={<AddIcon />}
              onClick={() => handleOpenDialog()}
              disabled={!selectedCourse}
            >
              添加知识点
            </Button>
          </Box>
        </Box>

        <FormControl fullWidth sx={{ mb: 3 }}>
          <InputLabel>选择课程</InputLabel>
          <Select
            value={selectedCourse}
            onChange={(e) => setSelectedCourse(e.target.value)}
            label="选择课程"
          >
            {courses.map((course) => (
              <MenuItem key={course.id} value={course.id}>
                {course.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <List>
          {knowledgePoints.map((point) => (
            <React.Fragment key={point.id}>
              <ListItem
                secondaryAction={
                  <Box>
                    <IconButton edge="end" onClick={() => handleOpenDialog(point)}>
                      <EditIcon />
                    </IconButton>
                    <IconButton edge="end" onClick={() => handleDelete(point.id)}>
                      <DeleteIcon />
                    </IconButton>
                  </Box>
                }
              >
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="subtitle1">{point.content}</Typography>
                      <Chip
                        label={courses.find(c => c.id === point.course_id)?.name}
                        size="small"
                        color="primary"
                      />
                    </Box>
                  }
                  secondary={point.description}
                />
              </ListItem>
              <Divider />
            </React.Fragment>
          ))}
        </List>
      </Paper>

      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingPoint ? '编辑知识点' : '添加知识点'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="知识点内容"
              fullWidth
              multiline
              rows={2}
              value={formData.content}
              onChange={(e) => setFormData({ ...formData, content: e.target.value })}
            />
            <TextField
              label="知识点描述"
              fullWidth
              multiline
              rows={4}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>取消</Button>
          <Button onClick={handleSubmit} variant="contained" color="primary">
            保存
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default KnowledgePointManagement;
