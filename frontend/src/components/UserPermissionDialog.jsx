// frontend/src/components/UserPermissionDialog.jsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box,
  CircularProgress, Typography, Checkbox, List, ListItem, ListItemText,
  ListItemIcon, Collapse, IconButton, Paper, Alert,
  Select, MenuItem, FormControl, InputLabel, TextField, Grid // <<<--- 新增
} from '@mui/material';
import { 
    ExpandMore, ExpandLess, Folder, FolderOpen, 
    Audiotrack, OndemandVideo, Article, AccessTime // <<<--- 新增 AccessTime
} from '@mui/icons-material';
import api from '../api/axios';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns'; // <--- 使用这个
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers';
import { isValid, formatISO, parseISO, addWeeks, startOfDay, endOfDay } from 'date-fns';
import { zhCN } from 'date-fns/locale';


const UserPermissionDialog = ({ open, onClose, userId, userName }) => {
  const [loadingData, setLoadingData] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [allCoursesWithResources, setAllCoursesWithResources] = useState([]);
  
  // selectedPermissions 结构: { courseId: Set(), resourceId: { expiry_type: string, custom_expiry_date: Date | null } }
  const [selectedCourseIds, setSelectedCourseIds] = useState(new Set());
  
  // resourcePermissions: Map<resourceId, { expiryType: string, customDate: Date | null }>
  const [resourcePermissions, setResourcePermissions] = useState(new Map()); 
  const [expandedCourses, setExpandedCourses] = useState({});

  const fetchData = useCallback(async () => {
    if (!open || !userId) return;
    setLoadingData(true); setError('');
    try {
      const [coursesRes, permissionsRes] = await Promise.all([
        api.get('/permissions/all-courses-with-resources'),
        api.get(`/permissions/user/${userId}`)
      ]);
      
      const coursesData = coursesRes.data || [];
      setAllCoursesWithResources(coursesData);
      
      const currentPermissions = permissionsRes.data || { granted_course_ids: [], granted_resource_details: [] };
      setSelectedCourseIds(new Set(currentPermissions.granted_course_ids || []));

      const initialResourcePerms = new Map();
      (currentPermissions.granted_resource_details || []).forEach(detail => {
        let expiryType = 'permanent';
        let customDate = null;
        if (detail.expires_at) {
          const expiryDate = parseISO(detail.expires_at);
          // 简单判断是否为一周，更精确的判断可能需要比较 granted_at
          // 这里简化为：如果过期时间存在，先认为是自定义，除非能匹配到 "一周"
          // （实际中，后端可能需要返回 expiry_type 以便前端正确恢复选择）
          // 为了简化前端，如果 expires_at 存在，我们先默认为 'custom'
          expiryType = 'custom';
          customDate = startOfDay(expiryDate); // 确保是日期对象，且时间部分不影响显示
        }
        initialResourcePerms.set(detail.resource_id, { expiryType, customDate });
      });
      setResourcePermissions(initialResourcePerms);

      const initialExpanded = {};
      coursesData.forEach(course => {
        initialExpanded[course.id] = (currentPermissions.granted_course_ids || []).includes(course.id) ||
          course.resources.some(res => initialResourcePerms.has(res.id));
      });
      setExpandedCourses(initialExpanded);

    } catch (err) {
      console.error("获取权限数据失败:", err);
      setError(err.response?.data?.error || err.message || '获取权限数据失败。');
    } finally {
      setLoadingData(false);
    }
  }, [open, userId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleToggleCourseExpand = (courseId) => {
    setExpandedCourses(prev => ({ ...prev, [courseId]: !prev[courseId] }));
  };

  const handleCourseSelection = (courseId) => {
    const newSelectedCourses = new Set(selectedCourseIds);
    const newResourcePerms = new Map(resourcePermissions);
    const course = allCoursesWithResources.find(c => c.id === courseId);
    if (!course) return;

    if (newSelectedCourses.has(courseId)) {
      newSelectedCourses.delete(courseId);
      course.resources.forEach(resource => newResourcePerms.delete(resource.id));
    } else {
      newSelectedCourses.add(courseId);
      course.resources.forEach(resource => {
        if (!newResourcePerms.has(resource.id)) { // 只为尚未设置权限的资源添加默认永久权限
          newResourcePerms.set(resource.id, { expiryType: 'permanent', customDate: null });
        }
      });
    }
    setSelectedCourseIds(newSelectedCourses);
    setResourcePermissions(newResourcePerms);
  };

  const handleResourceSelection = (resourceId, courseId) => {
    const newResourcePerms = new Map(resourcePermissions);
    if (newResourcePerms.has(resourceId)) {
      newResourcePerms.delete(resourceId);
      // 检查是否需要取消课程勾选 (如果课程下无任何资源被勾选，且课程不是独立勾选的)
      // (这部分逻辑可以根据产品需求调整，此处简化为不自动取消课程)
    } else {
      newResourcePerms.set(resourceId, { expiryType: 'permanent', customDate: null }); // 默认永久
      // 确保父课程被勾选
      if (!selectedCourseIds.has(courseId)) {
        const newSelectedCourses = new Set(selectedCourseIds);
        newSelectedCourses.add(courseId);
        setSelectedCourseIds(newSelectedCourses);
      }
    }
    setResourcePermissions(newResourcePerms);
  };

  const handleExpiryTypeChange = (resourceId, expiryType) => {
    const currentPerm = resourcePermissions.get(resourceId) || { customDate: null };
    let newCustomDate = currentPerm.customDate;
    if (expiryType === 'one_week') {
      newCustomDate = addWeeks(startOfDay(new Date()), 1);
    } else if (expiryType === 'permanent') {
      newCustomDate = null;
    }
    // 如果从 one_week/permanent 切换到 custom，但 customDate 为空，则默认选今天
    else if (expiryType === 'custom' && !newCustomDate) {
        newCustomDate = startOfDay(new Date());
    }
    setResourcePermissions(prev => new Map(prev).set(resourceId, { expiryType, customDate: newCustomDate }));
  };

  const handleCustomDateChange = (resourceId, date) => {
    // date-fns 返回的是 Date 对象，可以直接使用
    const currentPerm = resourcePermissions.get(resourceId) || { expiryType: 'custom' };
    setResourcePermissions(prev => new Map(prev).set(resourceId, { ...currentPerm, customDate: date ? startOfDay(date) : null }));
  };


  const handleSavePermissions = async () => {
    setSaving(true); setError('');
    try {
      const payloadResourcePermissions = Array.from(resourcePermissions.entries()).map(([resId, perm]) => ({
        resource_id: resId,
        expiry_type: perm.expiryType,
        custom_expiry_date: perm.customDate ? formatISO(perm.customDate, { representation: 'date' }) : null,
      }));

      await api.put(`/permissions/user/${userId}`, {
        granted_course_ids: Array.from(selectedCourseIds),
        resource_permissions: payloadResourcePermissions,
      });
      onClose(true);
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
    <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
      <Dialog open={open} onClose={() => onClose(false)} maxWidth="lg" fullWidth scroll="paper">
        <DialogTitle>
          设置用户 "{userName || userId?.substring(0,8) + '...'}" 的课程和资源访问权限
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
                        checked={selectedCourseIds.has(course.id)}
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
                      primaryTypographyProps={{ fontWeight: selectedCourseIds.has(course.id) ? 'bold' : 'normal' }}
                    />
                  </ListItem>
                  </Paper>
                  <Collapse in={expandedCourses[course.id]} timeout="auto" unmountOnExit>
                    <List component="div" disablePadding dense sx={{ pl: 2, borderLeft: '1px dashed #ccc', ml: 2, mb:1 }}>
                      {course.resources.map((resource) => {
                        const currentPermission = resourcePermissions.get(resource.id);
                        const isResourceSelected = !!currentPermission;

                        return (
                          <Paper key={resource.id} elevation={0} sx={{mb: 0.5, border: '1px solid #f5f5f5', borderRadius: 1, p:1}}>
                            <Grid container spacing={1} alignItems="center">
                              <Grid item xs={12} sm={5} md={4} sx={{display: 'flex', alignItems: 'center'}}>
                                <Checkbox
                                  edge="start"
                                  checked={isResourceSelected}
                                  onChange={() => handleResourceSelection(resource.id, course.id)}
                                  disabled={!selectedCourseIds.has(course.id)}
                                />
                                <ListItemIcon sx={{minWidth: 'auto', mr: 1}}>
                                  {getResourceIcon(resource.file_type)}
                                </ListItemIcon>
                                <ListItemText 
                                  primary={resource.name} 
                                  primaryTypographyProps={{ 
                                    variant: 'body2', 
                                    color: isResourceSelected ? 'text.primary' : 'text.disabled',
                                    fontWeight: isResourceSelected ? 'medium' : 'normal'
                                  }} 
                                />
                              </Grid>
                              <Grid item xs={12} sm={7} md={8}>
                                {isResourceSelected && ( // 只有选中资源时才显示有效期设置
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                                    <AccessTime sx={{fontSize: '1rem', color: 'action.active'}} />
                                    <FormControl size="small" sx={{ minWidth: 100, flexShrink: 0 }}>
                                      <InputLabel shrink={!!currentPermission?.expiryType} id={`expiry-type-label-${resource.id}`}>有效期</InputLabel>
                                      <Select
                                        labelId={`expiry-type-label-${resource.id}`}
                                        value={currentPermission?.expiryType || 'permanent'}
                                        label="有效期"
                                        onChange={(e) => handleExpiryTypeChange(resource.id, e.target.value)}
                                      >
                                        <MenuItem value="permanent">长期</MenuItem>
                                        <MenuItem value="one_week">一周</MenuItem>
                                        <MenuItem value="custom">自定义</MenuItem>
                                      </Select>
                                    </FormControl>
                                    {currentPermission?.expiryType === 'custom' && (
                                      <DatePicker
                                        label="截止日期"
                                        value={currentPermission?.customDate || null}
                                        onChange={(date) => handleCustomDateChange(resource.id, date)}
                                        minDate={startOfDay(new Date())} // 确保自定义日期不早于今天
                                        slots={{ textField: (params) => <TextField {...params} size="small" sx={{width: 150}} helperText={null} /> }}
                                        format="yyyy-MM-dd"
                                      />
                                    )}
                                    {currentPermission?.expiryType === 'one_week' && currentPermission?.customDate && (
                                        <Typography variant="caption" color="text.secondary">
                                            至 {formatISO(endOfDay(currentPermission.customDate), { representation: 'date' })} 23:59
                                        </Typography>
                                    )}
                                  </Box>
                                )}
                              </Grid>
                            </Grid>
                          </Paper>
                        );
                      })}
                    </List>
                  </Collapse>
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
    </LocalizationProvider>
  );
};

export default UserPermissionDialog;