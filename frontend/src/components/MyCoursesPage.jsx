// frontend/src/components/MyCoursesPage.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Grid, Card, CardContent, // CardActionArea 似乎没再直接使用，可以移除
  CircularProgress, Alert, Chip, Collapse, List, ListItem, ListItemIcon,
  ListItemText, IconButton, Divider
} from '@mui/material';
import {
    School as SchoolIcon, ExpandMore, ExpandLess, PlayCircleOutline,
    Audiotrack, OndemandVideo, Article
} from '@mui/icons-material';
import api from '../api/axios';
import PageHeader from './PageHeader';
import { useTheme } from '@mui/material/styles';

const MyCoursesPage = () => {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true); // 主loading状态
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const theme = useTheme();

  const [expandedCourseResources, setExpandedCourseResources] = useState({});
  const [courseResourcesMap, setCourseResourcesMap] = useState({});
  const [loadingResourcesForCourse, setLoadingResourcesForCourse] = useState({});

  const fetchResourcesForCourse = async (courseId, isInitialLoad = false) => {
    // 避免重复加载（除非是初次强制加载）
    if (!isInitialLoad && (courseResourcesMap[courseId] || loadingResourcesForCourse[courseId])) {
        if (!isInitialLoad) { // 如果不是初始加载，且资源已存在或正在加载，则只切换展开状态
            setExpandedCourseResources(prev => ({ ...prev, [courseId]: !prev[courseId] }));
        }
        return;
    }

    setLoadingResourcesForCourse(prev => ({ ...prev, [courseId]: true }));
    try {
      const response = await api.get(`/courses/${courseId}/resources`);
      setCourseResourcesMap(prev => ({
        ...prev,
        [courseId]: response.data || []
      }));
      // 如果是初始加载，则确保资源加载后课程是展开的
      // 否则（用户手动点击），切换展开状态
      setExpandedCourseResources(prev => ({ 
        ...prev, 
        [courseId]: isInitialLoad ? true : !prev[courseId] 
      }));
    } catch (err) {
      console.error(`获取课程 ${courseId} 的资源失败:`, err);
      // 可以在这里为特定课程设置错误状态，如果需要
      setExpandedCourseResources(prev => ({ ...prev, [courseId]: false })); // 加载失败则不展开
    } finally {
      setLoadingResourcesForCourse(prev => ({ ...prev, [courseId]: false }));
    }
  };


  const fetchMyCourses = useCallback(async () => {
    setLoading(true);
    setError('');
    setExpandedCourseResources({}); // 重置展开状态
    setCourseResourcesMap({});    // 重置资源映射
    setLoadingResourcesForCourse({}); // 重置资源加载状态

    try {
      const response = await api.get('/courses'); // 假设这个API返回用户有权访问的课程
      const fetchedCourses = response.data || [];
      setCourses(fetchedCourses);

      // --- 自动为所有获取到的课程加载资源并设置展开 ---
      if (fetchedCourses.length > 0) {
        const initialExpandedState = {};
        // 使用 Promise.all 来并行加载所有课程的资源
        // 注意：如果课程很多，并行加载可能给服务器带来压力，可考虑分批或仅加载首个
        const resourcePromises = fetchedCourses.map(course => {
          initialExpandedState[course.id] = true; // 先假设都要展开
          return fetchResourcesForCourse(course.id, true); // 传入 true 表示是初始加载
        });
        
        setExpandedCourseResources(initialExpandedState); // 立即设置展开状态，UI上会先显示展开图标
        await Promise.all(resourcePromises); // 等待所有资源加载完成
      }
      // --- 自动展开逻辑结束 ---

    } catch (err) {
      console.error("获取我的课程失败:", err);
      setError(err.response?.data?.error || err.message || '获取课程列表失败。');
    } finally {
      setLoading(false); // 主loading结束
    }
  }, []); // 移除了 fetchResourcesForCourse 从依赖数组，因为它现在在 useCallback 外部定义或内部调用

  useEffect(() => {
    fetchMyCourses();
  }, [fetchMyCourses]);

  // 用户手动点击课程卡片或展开按钮时的处理函数
  const handleToggleCourseExpansionByUser = (courseId) => {
    // 直接调用 fetchResourcesForCourse，它会处理是否已加载和切换展开状态
    fetchResourcesForCourse(courseId, false); // 传入 false 表示是用户手动触发
  };
  
  const getResourceIcon = (fileType) => {
     if (fileType === 'video') return <OndemandVideo color="primary" />;
     if (fileType === 'audio') return <Audiotrack color="primary" />;
     if (fileType === 'document') return <Article color="action" />;
     return <Article color="disabled" />;
  };

  if (loading && courses.length === 0) { // 只有在首次加载课程列表时显示主加载动画
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
              <CardContent sx={{ flexGrow: 1 }}> {/* 让 CardContent 占据剩余空间 */}
                <Box 
                  onClick={() => handleToggleCourseExpansionByUser(course.id)}
                  sx={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    mb: 1.5, 
                    cursor: 'pointer',
                    p: 1, // 增加一点内边距使点击区域更大
                    mx: -1, // 抵消内边距带来的额外空间
                    '&:hover': { backgroundColor: 'action.hover', borderRadius: 1 }
                  }}
                >
                  <SchoolIcon color="primary" sx={{ mr: 1.5, fontSize: '2rem' }} />
                  <Typography variant="h5" component="div" sx={{ fontWeight: 'bold', flexGrow: 1 }}>
                    {course.course_name}
                  </Typography>
                  <IconButton 
                    size="small" 
                    onClick={(e) => {
                      e.stopPropagation(); 
                      handleToggleCourseExpansionByUser(course.id);
                    }}
                    aria-expanded={expandedCourseResources[course.id]}
                    aria-label={expandedCourseResources[course.id] ? "收起资源" : "展开资源"}
                  >
                    {expandedCourseResources[course.id] ? <ExpandLess /> : <ExpandMore />}
                  </IconButton>
                </Box>
                {/* 描述和Chips部分，也允许点击触发展开 */}
                <Box onClick={() => handleToggleCourseExpansionByUser(course.id)} sx={{cursor: 'pointer'}}>
                    <Typography variant="body2" color="text.secondary" sx={{ minHeight: '40px', mb: 1 }}>
                        {course.description || '暂无课程描述。'}
                    </Typography>
                    <Chip label={`${course.knowledge_point_count || 0} 知识点`} size="small" sx={{ mr: 0.5 }} />
                    <Chip label={`${course.question_count || 0} 题目`} size="small" />
                </Box>
              </CardContent>

              <Collapse in={expandedCourseResources[course.id]} timeout="auto" unmountOnExit>
                <Divider />
                <Box sx={{ p: 2, maxHeight: 300, overflowY: 'auto' }}> {/* 限制高度并允许滚动 */}
                  {loadingResourcesForCourse[course.id] && ( // 只有当特定课程的资源在加载时显示
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={24} /></Box>
                  )}
                  {!loadingResourcesForCourse[course.id] && courseResourcesMap[course.id] && courseResourcesMap[course.id].length > 0 ? (
                    <List dense>
                      {courseResourcesMap[course.id].map(resource => (
                        <ListItem
                          key={resource.id}
                          secondaryAction={
                            <IconButton 
                              edge="end" 
                              aria-label="play"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/my-courses/${course.id}/resource/${resource.id}/play`);
                              }}
                              title={`播放 ${resource.name}`}
                            >
                              <PlayCircleOutline color="primary" />
                            </IconButton>
                          }
                          sx={{ '&:hover': { backgroundColor: theme.palette.action.hover }, borderRadius: 1, mb: 0.5 }} // 增加一点间距
                        >
                          <ListItemIcon sx={{minWidth: 36}}>
                            {getResourceIcon(resource.file_type)}
                          </ListItemIcon>
                          <ListItemText 
                            primary={resource.name} 
                            secondary={`类型: ${resource.file_type} ${resource.duration_seconds ? `| 时长: ${Math.floor(resource.duration_seconds/60)}分${Math.round(resource.duration_seconds%60)}秒` : ''}`} 
                            primaryTypographyProps={{variant: 'body2'}} // 可以让资源名称小一点
                            secondaryTypographyProps={{variant: 'caption'}}
                          />
                        </ListItem>
                      ))}
                    </List>
                  ) : (
                    !loadingResourcesForCourse[course.id] && // 仅在非加载状态下显示无资源
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