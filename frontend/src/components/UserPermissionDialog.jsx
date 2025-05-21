// frontend/src/components/UserPermissionDialog.jsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box,
  CircularProgress, Typography, Checkbox, List, ListItem, ListItemText,
  ListItemIcon, Collapse, IconButton, Paper, Alert // <<<--- 新增 Alert
} from '@mui/material';
import { 
    ExpandMore, ExpandLess, Folder, FolderOpen, 
    Audiotrack, OndemandVideo, Article // 确保这些图标已导入
} from '@mui/icons-material';
import api from '../api/axios';

const UserPermissionDialog = ({ open, onClose, userId, userName }) => {
  const [loadingData, setLoadingData] = useState(true); // 用于加载初始数据
  const [saving, setSaving] = useState(false);         // 用于保存时的加载状态
  const [error, setError] = useState('');
  const [allCoursesWithResources, setAllCoursesWithResources] = useState([]);
  
  const [selectedCourses, setSelectedCourses] = useState(new Set());
  const [selectedResources, setSelectedResources] = useState(new Set());
  const [expandedCourses, setExpandedCourses] = useState({});

  const fetchData = useCallback(async () => {
    if (!open || !userId) return;
    setLoadingData(true);
    setError('');
    try {
      const [coursesRes, permissionsRes] = await Promise.all([
        api.get('/permissions/all-courses-with-resources'),
        api.get(`/permissions/user/${userId}`)
      ]);
      
      const coursesData = coursesRes.data || [];
      setAllCoursesWithResources(coursesData);
      
      const currentPermissions = permissionsRes.data || { granted_course_ids: [], granted_resource_ids: [] };
      setSelectedCourses(new Set(currentPermissions.granted_course_ids || []));
      setSelectedResources(new Set(currentPermissions.granted_resource_ids || []));

      const initialExpanded = {};
      coursesData.forEach(course => {
        const hasDirectCourseAccess = (currentPermissions.granted_course_ids || []).includes(course.id);
        const hasGrantedResourceUnderCourse = course.resources.some(res => 
          (currentPermissions.granted_resource_ids || []).includes(res.id)
        );
        // 默认展开有直接课程权限，或者课程下有资源权限的课程
        initialExpanded[course.id] = hasDirectCourseAccess || hasGrantedResourceUnderCourse;
      });
      setExpandedCourses(initialExpanded);

    } catch (err) {
      console.error("获取权限数据失败:", err);
      setError(err.response?.data?.error || err.message || '获取权限数据失败。');
    } finally {
      setLoadingData(false);
    }
  }, [open, userId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]); // fetchData 包含了 open 和 userId 作为依赖

  const handleToggleCourseExpand = (courseId) => {
    setExpandedCourses(prev => ({ ...prev, [courseId]: !prev[courseId] }));
  };

  const handleCourseSelection = (courseId) => {
    const newSelectedCourses = new Set(selectedCourses);
    const course = allCoursesWithResources.find(c => c.id === courseId);
    if (!course) return;

    const isCurrentlySelected = newSelectedCourses.has(courseId);
    const newSelectedResources = new Set(selectedResources);

    if (isCurrentlySelected) {
      newSelectedCourses.delete(courseId);
      // 当取消课程勾选时，也取消其下所有资源的勾选
      course.resources.forEach(resource => newSelectedResources.delete(resource.id));
    } else {
      newSelectedCourses.add(courseId);
      // 当勾选课程时，自动勾选其下所有资源
      course.resources.forEach(resource => newSelectedResources.add(resource.id));
    }
    setSelectedCourses(newSelectedCourses);
    setSelectedResources(newSelectedResources);
  };

  const handleResourceSelection = (resourceId, courseId) => {
    const newSelectedResources = new Set(selectedResources);
    const isCurrentlySelected = newSelectedResources.has(resourceId);

    if (isCurrentlySelected) {
      newSelectedResources.delete(resourceId);
      // 检查取消这个资源后，是否还需要保持课程的勾选状态
      const course = allCoursesWithResources.find(c => c.id === courseId);
      if (course) {
        const hasOtherSelectedResourcesInCourse = course.resources.some(
          res => res.id !== resourceId && newSelectedResources.has(res.id)
        );
        // 如果该课程下没有其他选中的资源了，并且课程本身不是通过直接勾选课程而选中的，则取消课程勾选
        // （这条逻辑可以更复杂，取决于产品需求：是资源决定课程，还是课程优先）
        // 简单处理：如果取消最后一个资源，不自动取消课程勾选，让用户手动操作课程勾选框
      }
    } else {
      newSelectedResources.add(resourceId);
      // 如果勾选了某个资源，确保其所属课程也被勾选
      if (courseId && !selectedCourses.has(courseId)) {
        const newSelectedCourses = new Set(selectedCourses);
        newSelectedCourses.add(courseId);
        setSelectedCourses(newSelectedCourses);
      }
    }
    setSelectedResources(newSelectedResources);
  };

  const handleSavePermissions = async () => {
    setSaving(true);
    setError('');
    try {
      await api.put(`/permissions/user/${userId}`, {
        granted_course_ids: Array.from(selectedCourses),
        granted_resource_ids: Array.from(selectedResources),
      });
      onClose(true); // 传递 true 表示保存成功
    } catch (err) {
      console.error("保存权限失败:", err);
      setError(err.response?.data?.error || err.message || '保存权限失败。');
    } finally {
      setSaving(false);
    }
  };
  
  const getResourceIcon = (fileType) => {
    if (fileType === 'video') return <OndemandVideo fontSize="small" color="action" />;
    if (fileType === 'audio') return <Audiotrack fontSize="small" color="action" />;
    if (fileType === 'document') return <Article fontSize="small" color="action" />;
    return <Article fontSize="small" color="disabled" />;
  };

  return (
    <Dialog open={open} onClose={() => onClose(false)} maxWidth="md" fullWidth scroll="paper">
      <DialogTitle>
        设置用户 "{userName || userId?.substring(0,8) + '...'}" 的课程访问权限
      </DialogTitle>
      <DialogContent dividers>
        {loadingData && <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}><CircularProgress /></Box>}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {!loadingData && !error && (
          <List dense sx={{ width: '100%', bgcolor: 'background.paper' }}>
            {allCoursesWithResources.map((course) => (
              <React.Fragment key={course.id}>
                <Paper elevation={0} sx={{mb: 0.5, border: '1px solid #eee', borderRadius: 1}}>
                  <ListItem 
                    secondaryAction={
                      course.resources?.length > 0 ? ( // 只有当课程下有资源时才显示展开按钮
                        <IconButton edge="end" onClick={() => handleToggleCourseExpand(course.id)}>
                          {expandedCourses[course.id] ? <ExpandLess /> : <ExpandMore />}
                        </IconButton>
                      ) : null
                    }
                    sx={{pl: 1}}
                  >
                    <ListItemIcon sx={{minWidth: 'auto', mr: 1}}>
                      <Checkbox
                        edge="start"
                        checked={selectedCourses.has(course.id)}
                        onChange={() => handleCourseSelection(course.id)}
                        tabIndex={-1}
                        disableRipple
                      />
                    </ListItemIcon>
                    <ListItemIcon sx={{minWidth: 'auto', mr: 1}}>
                      {expandedCourses[course.id] ? <FolderOpen color="primary"/> : <Folder color="action"/>}
                    </ListItemIcon>
                    <ListItemText 
                      primary={course.name} 
                      secondary={`${course.resources?.length || 0} 个资源`}
                      primaryTypographyProps={{ fontWeight: selectedCourses.has(course.id) ? 'bold' : 'normal' }}
                    />
                  </ListItem>
                </Paper>
                {course.resources?.length > 0 && ( // 只有当课程下有资源时才渲染 Collapse
                  <Collapse in={expandedCourses[course.id]} timeout="auto" unmountOnExit>
                    <List component="div" disablePadding dense sx={{ pl: 2, borderLeft: '1px dashed #ccc', ml: 2, mb:1 }}>
                      {course.resources.map((resource) => (
                        <ListItem key={resource.id} sx={{pl: 1}}>
                          <ListItemIcon sx={{minWidth: 'auto', mr: 1}}>
                            <Checkbox
                              edge="start"
                              checked={selectedResources.has(resource.id)}
                              onChange={() => handleResourceSelection(resource.id, course.id)}
                              tabIndex={-1}
                              disableRipple
                              // 如果课程未被选中，其下资源不可单独勾选 (除非你有特定逻辑允许)
                              // 如果希望课程勾选后自动全选/取消全选资源，在 handleCourseSelection 中实现
                              disabled={!selectedCourses.has(course.id)} 
                            />
                          </ListItemIcon>
                          <ListItemIcon sx={{minWidth: 'auto', mr: 1}}>
                             {getResourceIcon(resource.file_type)}
                           </ListItemIcon>
                          <ListItemText 
                            primary={resource.name} 
                            primaryTypographyProps={{ 
                              variant: 'body2', 
                              color: selectedResources.has(resource.id) ? 'text.primary' : 'text.secondary',
                              fontWeight: selectedResources.has(resource.id) ? 'medium' : 'normal'
                            }} 
                          />
                        </ListItem>
                      ))}
                    </List>
                  </Collapse>
                )}
              </React.Fragment>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose(false)} disabled={loadingData || saving}>取消</Button>
        <Button onClick={handleSavePermissions} variant="contained" disabled={loadingData || saving}>
          {saving ? <CircularProgress size={20} /> : '保存权限'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default UserPermissionDialog;