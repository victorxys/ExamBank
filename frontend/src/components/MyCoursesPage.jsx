// frontend/src/components/MyCoursesPage.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Grid, Card, CardActionArea, CardContent,
  CircularProgress, Alert, Chip, Collapse, List, ListItem, ListItemIcon,
  ListItemText, IconButton, Divider // <<<--- 确保 Divider 已导入
} from '@mui/material';
import {
    School as SchoolIcon, ExpandMore, ExpandLess, PlayCircleOutline,
    Audiotrack, OndemandVideo, Article
} from '@mui/icons-material';
import api from '../api/axios'; // <<<--- 路径通常是 ../api/axios
import PageHeader from './PageHeader'; // <<<--- 路径修改为 ./PageHeader (如果在同一components目录)
import { useTheme } from '@mui/material/styles';

const MyCoursesPage = () => {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const theme = useTheme();

  const [expandedCourseResources, setExpandedCourseResources] = useState({});
  const [courseResourcesMap, setCourseResourcesMap] = useState({});
  const [loadingResourcesForCourse, setLoadingResourcesForCourse] = useState({});

  const fetchMyCourses = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/courses');
      setCourses(response.data || []);
    } catch (err) {
      console.error("获取我的课程失败:", err);
      setError(err.response?.data?.error || err.message || '获取课程列表失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMyCourses();
  }, [fetchMyCourses]);

  const toggleCourseResources = async (courseId) => {
    const isCurrentlyExpanded = expandedCourseResources[courseId];
    setExpandedCourseResources(prev => ({ ...prev, [courseId]: !isCurrentlyExpanded }));

    if (!isCurrentlyExpanded && !courseResourcesMap[courseId]) {
      setLoadingResourcesForCourse(prev => ({ ...prev, [courseId]: true }));
      try {
        const response = await api.get(`/courses/${courseId}/resources`);
        console.log(`获取课程 ${courseId} 的资源成功:`, response.data);
        setCourseResourcesMap(prev => ({
          ...prev,
          [courseId]: response.data || []
        }));
      } catch (err) {
        console.error(`获取课程 ${courseId} 的资源失败:`, err);
      } finally {
        setLoadingResourcesForCourse(prev => ({ ...prev, [courseId]: false }));
      }
    }
  };
  
  const getResourceIcon = (fileType) => {
     if (fileType === 'video') return <OndemandVideo color="primary" />;
     if (fileType === 'audio') return <Audiotrack color="secondary" />;
     if (fileType === 'document') return <Article color="action" />;
     return <Article color="disabled" />;
  };

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}><CircularProgress /></Box>;
  }

  return (
    <Box sx={{ p: { xs: 1, sm: 2, md: 3 } }}>
      <PageHeader title="我的课程" description="在这里查看您已授权访问的课程和学习资料。" />
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      
      {courses.length === 0 && !loading && (
        <Typography sx={{ textAlign: 'center', mt: 3 }} color="textSecondary">
          您目前没有被授权任何课程。
        </Typography>
      )}

      <Grid container spacing={3}>
        {courses.map((course) => (
          <Grid item xs={12} md={6} lg={4} key={course.id}>
            <Card elevation={2} sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <CardContent>
                <Box 
                  onClick={() => toggleCourseResources(course.id)} // 让这个 Box 整体可点击
                  sx={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    mb: 1.5, 
                    cursor: 'pointer', // 添加手型光标
                    '&:hover': { backgroundColor: 'action.hover', borderRadius: 1 } // 可选的悬停效果
                  }}
                >
                  <SchoolIcon color="primary" sx={{ mr: 1.5, fontSize: '2rem' }} />
                  <Typography variant="h5" component="div" sx={{ fontWeight: 'bold', flexGrow: 1 }}>
                    {course.course_name}
                  </Typography>
                  {/* IconButton 作为 Box 的子元素，不再与 CardActionArea 冲突 */}
                  <IconButton size="small" onClick={(e) => {
                      e.stopPropagation(); // 仍然需要阻止冒泡，否则会触发两次 toggle
                      toggleCourseResources(course.id);
                  }}>
                    {expandedCourseResources[course.id] ? <ExpandLess /> : <ExpandMore />}
                  </IconButton>
                </Box>
                <Box onClick={() => toggleCourseResources(course.id)} sx={{cursor: 'pointer'}}> {/* 让描述区域也可点击 */}
                  <Typography variant="body2" color="text.secondary" sx={{ minHeight: '40px', mb: 1 }}>
                    {course.description || '暂无课程描述。'}
                  </Typography>
                  <Chip label={`${course.knowledge_point_count || 0} 知识点`} size="small" sx={{ mr: 0.5 }} />
                  <Chip label={`${course.question_count || 0} 题目`} size="small" />
                </Box>
              </CardContent>

              <Collapse in={expandedCourseResources[course.id]} timeout="auto" unmountOnExit>
                <Divider />
                <Box sx={{ p: 2 }}>
                  {loadingResourcesForCourse[course.id] ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={24} /></Box>
                  ) : courseResourcesMap[course.id] && courseResourcesMap[course.id].length > 0 ? (
                    <List dense>
                      {courseResourcesMap[course.id].map(resource => (
                        <ListItem
                          key={resource.id}
                          secondaryAction={
                            <IconButton 
                              edge="end" 
                              aria-label="play"
                              onClick={(e) => {
                                e.stopPropagation(); // 阻止事件冒泡到 CardActionArea
                                navigate(`/my-courses/${course.id}/resource/${resource.id}/play`);
                              }}
                              title={`播放 ${resource.name}`}
                            >
                              <PlayCircleOutline color="primary" />
                            </IconButton>
                          }
                          sx={{ '&:hover': { backgroundColor: theme.palette.action.hover }, borderRadius: 1 }}
                        >
                          <ListItemIcon sx={{minWidth: 36}}>
                            {getResourceIcon(resource.file_type)}
                          </ListItemIcon>
                          <ListItemText 
                            primary={resource.name} 
                            secondary={`类型: ${resource.file_type} ${resource.duration_seconds ? `| 时长: ${Math.floor(resource.duration_seconds/60)}分${Math.round(resource.duration_seconds%60)}秒` : ''}`} 
                          />
                        </ListItem>
                      ))}
                    </List>
                  ) : (
                    <Typography variant="body2" color="textSecondary" sx={{textAlign: 'center', py:1}}>该课程下暂无授权资源。</Typography>
                  )}
                </Box>
              </Collapse>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};

export default MyCoursesPage;