import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Avatar,
  Typography,
  TextField,
  Paper,
  Grid,
  Chip,
  Rating,
  Divider,
  Card,
  CardContent,
  IconButton,
  BottomNavigation,
  BottomNavigationAction,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  CircularProgress,
  Alert,
  Menu,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow
} from '@mui/material';
import { Add as AddIcon, Share as ShareIcon, Edit as EditIcon, Delete as DeleteIcon, Visibility as VisibilityIcon } from '@mui/icons-material';
import html2canvas from 'html2canvas';
import { useTheme } from '@mui/material/styles';
import { useMediaQuery } from '@mui/material';
import api from '../api/axios';
import logoSvg from '../assets/logo.svg';
import WechatShare from './WechatShare';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts';
import KnowledgeReportDialog from './KnowledgeReportDialog';


const EmployeeProfile = () => {
  const theme = useTheme();
  const knowledge_point_summary_array = '';

  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { userId } = useParams();
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogContent, setDialogContent] = useState({ title: '', content: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [anchorEl, setAnchorEl] = useState(null);
  const [shareData, setShareData] = useState(null);
  const [employeeData, setEmployeeData] = useState(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [records, setRecords] = useState([]);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [recordsError, setRecordsError] = useState(null);
  const [examDetailDialogOpen, setExamDetailDialogOpen] = useState(false);
  const [examDetail, setExamDetail] = useState(null);
  const [loadingExamDetail, setLoadingExamDetail] = useState(false);
  const [knowledgeReport, setKnowledgeReport] = useState(false);
  const [editFormData, setEditFormData] = useState({
    name: '',
    title: '',
    experience: '',
    introduction: {
      description: '',
      more: ''
    },
    advantages: [],
    skills: [],
    qualities: []
  });
  const [isPublic] = useState(() => {
    const publicParams = new URL(window.location.href).searchParams.get('public')
    return publicParams;
  });

  useEffect(() => {
    console.log('Fetching profile data, userId:', userId); 
    const fetchEmployeeData = async () => {
      try {
        setLoading(true);
        setError(null);
        const publicParam = new URL(window.location.href).searchParams.get('public');
        const response = await api.get(`/users/${userId}/profile${publicParam ? `?public=${publicParam}` : ''}`);
        setEmployeeData(response.data);
        // console.log("开始获取考试记录")
        // 获取考试记录
        const recordsResponse = await api.get(`/user-exams/employee-profile/${userId}`);
        // console.log("获取考试记录完毕")
        setRecords(recordsResponse.data || []);
      } catch (error) {
        console.error('获取员工信息失败:', error);
        setError(error.response?.data?.error || '获取员工信息失败');
      } finally {
        setLoading(false);
      }
    };

    if (userId) {
      fetchEmployeeData();
    }
  }, [userId]);

  // 监听分享数据变化
  useEffect(() => {
    if (shareData) {
      console.log('WechatShare组件已激活');
    }
  }, [shareData]);
  // 在 EmployeeProfile.jsx 组件内部，和其他 useState, useEffect 并列

  useEffect(() => {
    // 这个 effect 只在组件挂载时运行一次
    console.log('>>>>>>>>>> EmployeeProfile Component Mounted <<<<<<<<<<');

    // 这个 cleanup 函数只在组件卸载时运行一次
    return () => {
      console.log('<<<<<<<<<< EmployeeProfile Component Unmounted >>>>>>>>>>');
    };
  }, []); // 空依赖数组确保只在挂载和卸载时运行
  // 页面加载时自动配置微信分享
  useEffect(() => {
    console.log('Fetching profile data, userId:', userId, 'loading:', loading,'employeeData',employeeData); 
    if (employeeData && !loading) {
      try {
        // 构建分享数据，包括完整的图片URL
        const host = window.location.origin;
        const imgUrl = `${host}/avatar/${userId}-avatar.jpg`;
        const shareUrl = `${window.location.origin}/employee-profile/${userId}?public=true`;
        
        const newShareData = {
          shareTitle: `${employeeData?.name || '员工介绍'}阿姨 - 萌姨萌嫂`,
          shareDesc: employeeData?.introduction?.description || '查看员工的详细介绍、技能和评价。',
          shareImgUrl: imgUrl,
          shareLink: shareUrl
        };
        
        console.log('自动设置微信分享数据');
        setShareData(newShareData);
      } catch (error) {
        console.error('自动配置微信分享失败:', error);
      }
    }
  }, [employeeData, loading, userId]);

  
  
  
  

 

  const handleCloseDialog = () => {
    setDialogOpen(false);
  };

  const handleViewReportButtonClick = (examId, isPublic) => {
    // 在点击按钮时设置 examDetail 的值
    setExamDetail({ exam_id: examId, isPublic: isPublic });
    // 打开 KnowledgeReportDialog
    setExamDetailDialogOpen(true);
  };

  const handleOpenDialog = (title, content) => {
    setDialogContent({ title, content });
    setDialogOpen(true);
  };

  const handleEditClick = () => {
    setEditFormData({
      name: employeeData.name,
      title: employeeData.title,
      experience: employeeData.experience,
      introduction: {
        description: employeeData.introduction.description,
        more: employeeData.introduction.more
      },
      advantages: employeeData.advantages,
      skills: employeeData.skills,
      qualities: employeeData.qualities,
      reviews: employeeData.reviews
    });
    setEditDialogOpen(true);
  };

  const handleEditClose = () => {
    setEditDialogOpen(false);
  };

  const handleEditSave = async () => {
    try {
      const response = await api.put(`/users/${userId}/profile`, editFormData);
      setEmployeeData(response.data);
      setEditDialogOpen(false);
      alert('保存成功');
    } catch (error) {
      console.error('保存失败:', error);
      alert('保存失败，请重试');
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  if (!employeeData || !employeeData.introduction) {
    
    return (
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <Alert severity="info" sx={{ width: '100%' }}>尚未通过AI生成员工评价，请点击“AI员工介绍”按钮</Alert>
        <Button
          variant="contained"
          color="primary"
          onClick={() => navigate(`/user-evaluation-summary/${userId}`)}
          
        >
          前往“员工评价汇总”页面
        </Button>
      </Box>
    );
  }
  const handleViewExamDetail = async (examId) => {
    try {
      setLoadingExamDetail(true);
      const response = await api.get(`/user-exams/knowledge-point-summary/${examId}`);
      if (response.data && response.data.length > 0 && response.data[0].knowledge_point_summary) {
        let knowledge_point_summary_array = null;
        try {
          knowledge_point_summary_array = JSON.parse(response.data[0].knowledge_point_summary);
          setKnowledgeReport(knowledge_point_summary_array);
          setExamDetail(response.data[0]);
        } catch (error) {
          console.error("解析知识点总结JSON失败:", error);
          setKnowledgeReport([]);
          setExamDetail(null);
        }
      } else {
        setKnowledgeReport([]);
        setExamDetail(null);
      }
      setExamDetailDialogOpen(true);
    } catch (error) {
      console.error('获取考试详情失败:', error);
      alert('获取考试详情失败，请稍后重试');
      setKnowledgeReport([]);
      setExamDetail(null);
    } finally {
      setLoadingExamDetail(false);
    }
  };



  const handleExamDetailClose = () => {
    setExamDetailDialogOpen(false);
    setExamDetail(null);
  };

      
      
  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #FFFFFF 0%, #E0F2F1 100%)',
        position: 'relative',
        pb: 8,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        // paddingTop: { xs: '2vh', sm: '15vh' },
        // paddingX: { xs: '16px', sm: '24px' }
        padding: '0px'
      }}
    >

      {/* 装饰性元素 */}
      <Box
        sx={{
          position: 'absolute',
          top: 30,
          left: 30,
          display: 'flex',
          gap: 2
        }}
      >
        <Box
          sx={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            bgcolor: 'primary.main',
            opacity: 0.1
          }}
        />
        <Box
          sx={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            bgcolor: 'primary.main',
            opacity: 0.1
          }}
        />
      </Box>

      <Box
        sx={{
          position: 'absolute',
          bottom: 30,
          right: 30,
          display: 'flex',
          gap: 2
        }}
      >
        <Box
          sx={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            bgcolor: 'primary.main',
            opacity: 0.1
          }}
        />
        <Box
          sx={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            bgcolor: 'primary.main',
            opacity: 0.1
          }}
        />
      </Box>
      
      <Container maxWidth="lg" sx={{ py: 3, position: 'relative' }}>        
        {!isPublic && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, position: 'absolute', top: 88, right: 34, zIndex: 1000, pointerEvents: 'auto' }}>
            <IconButton
              size="small"
              onClick={handleEditClick}
              sx={{
                background: 'linear-gradient(87deg, #26A69A 0, #56aea2 100%)',
                color: '#fff',
                padding: 1,
                '&:hover': {
                  background: 'linear-gradient(87deg, #1a8c82 0, #408d86 100%)'
                }
              }}
            >
              <EditIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              onClick={(event) => setAnchorEl(event.currentTarget)}
              sx={{
                background: 'linear-gradient(87deg, #26A69A 0, #56aea2 100%)',
                color: '#fff',
                padding: 1,
                '&:hover': {
                  background: 'linear-gradient(87deg, #1a8c82 0, #408d86 100%)'
                }
              }}
            >
              <ShareIcon fontSize="small" />
            </IconButton>
            <Menu
              anchorEl={anchorEl}
              open={Boolean(anchorEl)}
              onClose={() => setAnchorEl(null)}
            >
              
              <MenuItem onClick={async () => {
                try {
                  const element = document.getElementById('employee-profile-content');
                  if (!element) return;

                  const canvas = await html2canvas(element, {
                    scale: window.devicePixelRatio,
                    useCORS: true,
                    allowTaint: true,
                    logging: false,
                    backgroundColor: '#E0F2F1',
                    x: -24, // 添加左边距
                    width: element.offsetWidth + 48, // 增加总宽度以包含边距
                    onclone: function(clonedDoc) {
                      const clonedElement = clonedDoc.getElementById('employee-profile-content');
                      if (clonedElement) {
                        const boxes = clonedElement.getElementsByClassName('logo-box');
                        for (let box of boxes) {
                          box.style.backgroundImage = `url(${logoSvg})`;
                          box.style.backgroundSize = 'contain';
                          box.style.backgroundRepeat = 'no-repeat';
                          box.style.backgroundPosition = 'left center';
                          box.style.opacity = '0.9';
                        }
                      }
                    }
                  });

                  // 将canvas转换为Blob
                  canvas.toBlob(async (blob) => {
                    try {
                      // 使用新的ClipboardAPI复制图片
                      await navigator.clipboard.write([
                        new ClipboardItem({
                          'image/png': blob
                        })
                      ]);
                      alert('图片已复制到剪贴板');
                    } catch (error) {
                      console.error('复制图片失败:', error);
                      alert('复制图片失败，请稍后重试');
                    }
                  }, 'image/png');
                } catch (error) {
                  console.error('生成图片失败:', error);
                  alert('生成图片失败，请稍后重试');
                }
                setAnchorEl(null);
              }}>
                复制图片
              </MenuItem>
              <MenuItem onClick={async () => {
                try {
                  const element = document.getElementById('employee-profile-content');
                  if (!element) return;

                  const canvas = await html2canvas(element, {
                    scale: window.devicePixelRatio,
                    useCORS: true,
                    allowTaint: true,
                    logging: false,
                    backgroundColor: '#E0F2F1',
                    x: -24, // 添加左边距
                    width: element.offsetWidth + 48, // 增加总宽度以包含边距
                    onclone: function(clonedDoc) {
                      const clonedElement = clonedDoc.getElementById('employee-profile-content');
                      if (clonedElement) {
                        const boxes = clonedElement.getElementsByClassName('logo-box');
                        for (let box of boxes) {
                          box.style.backgroundImage = `url(${logoSvg})`;
                          // box.style.backgroundSize = 'contain';
                          box.style.backgroundRepeat = 'no-repeat';
                          box.style.backgroundPosition = 'left center';
                          box.style.opacity = '0.9';
                          box.style.backgroundSize = 'auto 150%'; // 设置宽度为 100px，高度自动调整

                        }
                      }
                    }
                  });

                  const image = canvas.toDataURL('image/png', 1.0);
                  const link = document.createElement('a');
                  link.download = `${employeeData.name}-档案.png`;
                  link.href = image;
                  link.click();
                } catch (error) {
                  console.error('下载图片失败:', error);
                  alert('下载图片失败，请稍后重试');
                }
                setAnchorEl(null);
              }}>
                下载图片
              </MenuItem>
              <MenuItem onClick={async () => {
                try {
                  const shareUrl = `${window.location.origin}/employee-profile/${userId}?public=true`;
                  await navigator.clipboard.writeText(shareUrl);
                  alert('链接已复制到剪贴板');
                } catch (error) {
                  console.error('复制链接失败:', error);
                  alert('复制链接失败，请稍后重试');
                }
                setAnchorEl(null);
              }}>
                复制链接
              </MenuItem>
            </Menu>
          </Box>
          )}
      <Box id="employee-profile-content" >
      {/* 基本信息部分 */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start', // 修改为靠左对齐
          mb: 4,
          position: 'relative'
        }}
      >
        <Box
          sx={{
            width: '100%',
            height: 4,
            background: 'linear-gradient(90deg, #26A69A 0%, #80CBC4 100%)',
            mb: 2,
            borderRadius: 2,
            opacity: 0.3
          }}
        />
        <Box sx={{ 
          width: '100%',
          display: 'flex', 
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center', 
          position: 'relative',
          mb: 2,
          mt: 2,
          '&::before': {
            content: '""',
            position: 'absolute',
            top: '50%',
            left: '0',
            transform: 'translateY(-50%)',
            width: '100px',
            height: '100px',
            className: 'logo-box',
            backgroundImage: `url(${logoSvg})`,
            backgroundSize: 'contain',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'left center',
            opacity: 0.9,
            zIndex: 0
          }
        }}>
          <Avatar
            sx={{
              width: 100,
              height: 100,
              border: '4px solid white',
              boxShadow: '0 8px 16px rgba(38, 166, 154, 0.1)',
              bgcolor: '#F5F5F5',
              color: theme.palette.primary.main
            }}
            alt={employeeData?.name}
            src={`/avatar/${userId}-avatar.jpg`}
          >
            {employeeData?.name?.[0]}
          </Avatar>

        </Box>

        <Box
          sx={{
            mt: 2,
            textAlign: 'center',
            width: '100%'
          }}
        >
          <Typography
            variant="h4"
            sx={{
              color: '#263339',
              fontWeight: 600,
              mb: 1,
              textAlign: 'center',
              width: '100%'
            }}
          >
            {employeeData.name}
          </Typography>
          <Typography
            variant="h6"
            sx={{
              color: '#728f9e',
              mb: 1
            }}
          >
            {employeeData.title}
          </Typography>
          <Typography
            variant="body1"
            sx={{
              color: '#728f9e',
              opacity: 0.8
            }}
          >
            {employeeData.experience}
          </Typography>
        </Box>

        <Box
          sx={{
            width: '100%',
            height: 4,
            background: 'linear-gradient(90deg, #26A69A 0%, #80CBC4 100%)',
            mt: 2,
            borderRadius: 2,
            opacity: 0.3
          }}
        />
      </Box>

      {/* 考试记录部分 */}
      <Paper
        elevation={0}
        sx={{
          p: 2,
          borderRadius: '20px',
          bgcolor: 'white',
          boxShadow: '0 8px 16px rgba(38, 166, 154, 0.1)',
          mb: 4
        }}
      >
        <Box sx={{ mb: 3 }}>
          <Box
            sx={{
              width: 80,
              height: 4,
              background: 'linear-gradient(90deg, #26A69A 0%, #80CBC4 100%)',
              mb: 1,
              borderRadius: 2
            }}
          />
          <Typography
            variant="h4"
            sx={{
              color: '#263339',
              fontWeight: 600
            }}
          >
            个人介绍
          </Typography>
        </Box>

        <Box
          sx={{
            p: 1.5,
            bgcolor: '#F5F5F5',
            borderRadius: '10px',
            mb: 3
          }}
        >
          <Box>
            <Box sx={{ position: 'relative', pb: 2 }}>
              <Typography variant="body1" color="#728f9e">
                {employeeData.introduction.description}
              </Typography>
              <Typography
                variant="body2"
                color="primary"
                onClick={() => handleOpenDialog('个人介绍', employeeData.introduction.more)}
                sx={{ 
                  cursor: 'pointer',
                  '&:hover': {
                    textDecoration: 'underline'
                  },
                  position: 'absolute',
                  bottom: 0,
                  right: 0
                }}
              >
                详细
              </Typography>
            </Box>
          </Box>
        </Box>

        <Box sx={{ mb: 3 }}>
          <Box
            sx={{
              width: 80,
              height: 4,
              background: 'linear-gradient(90deg, #26A69A 0%, #80CBC4 100%)',
              mb: 1,
              borderRadius: 2
            }}
          />
          <Typography
            variant="h4"
            sx={{
              color: '#263339',
              fontWeight: 600,
              mb: 2
            }}
          >
            服务优势
          </Typography>
          {employeeData.advantages.map((advantage, index) => (
            <Box
              key={index}
              sx={{
                p: 1.5,
                bgcolor: '#F5F5F5',
                borderRadius: '10px',
                mb: 2
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  mb: 1
                }}
              >
                <Box
                  sx={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    bgcolor: 'primary.main',
                    mr: 2
                  }}
                />
                <Typography
                  variant="h5"
                  sx={{
                    color: '#263339',
                    fontWeight: 600
                  }}
                >
                  {advantage.name}
                </Typography>
              </Box>
              <Box sx={{ ml: 4, position: 'relative', pb: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  {advantage.description}
                </Typography>
                <Typography
                  variant="body2"
                  color="primary"
                  onClick={() => handleOpenDialog(advantage.name, advantage.more)}
                  sx={{ 
                    cursor: 'pointer',
                    '&:hover': {
                      textDecoration: 'underline'
                    },
                    position: 'absolute',
                    bottom: 0,
                    right: 0
                  }}
                >
                  详细
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>

        {employeeData.skills && employeeData.skills.length > 0 && employeeData.skills.some(skill => skill.level > 1) && (
            <Box sx={{ mb: 3 }}>
              <Box
                sx={{
                  width: 80,
                height: 4,
                  background: 'linear-gradient(90deg, #26A69A 0%, #80CBC4 100%)',
                  mb: 1,
                  borderRadius: 2
                }}
              />
              <Typography
                variant="h4"
                sx={{
                  color: '#263339',
                  fontWeight: 600,
                  mb: 2
                }}
              >
                专业技能
              </Typography>
            
              {employeeData.skills.map((skill, index) => (
                skill.level >1 && (
                <Box
                  key={index}
                  sx={{
                    p: 1.5,
                    bgcolor: '#F5F5F5',
                    borderRadius: '10px',
                    mb: 2
                  }}
                >
                  <Box
                    sx={{
                      display: 'flex',
                      flexDirection: { xs: 'column', sm: 'row' },
                      alignItems: { xs: 'flex-start', sm: 'center' },
                      justifyContent: 'space-between',
                      mb: 1,
                      gap: { xs: 1, sm: 0 }
                    }}
                  >
                    <Typography variant="body1" color="#263339">
                      {skill.name}
                    </Typography>
                    <Rating
                      value={skill.level}
                      readOnly
                      sx={{
                        '& .MuiRating-iconFilled': {
                          color: theme.palette.primary.main
                        }
                      }}
                    />
                  </Box>
                </Box>
                )
              ))}
            </Box>
        )}

        {records && records.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Box
            sx={{
              width: 80,
              height: 4,
              background: 'linear-gradient(90deg, #26A69A 0%, #80CBC4 100%)',
              mb: 1.5,
              borderRadius: 2
            }}
          />
          <Typography
            variant="h4"
            sx={{
              color: '#263339',
              fontWeight: 600,
              mb: 2
            }}
          >
            考试记录
          </Typography>
          <TableContainer
          component={Paper}
          sx={{
            boxShadow: 'none',
            border: '1px solid rgba(0, 0, 0, 0.1)',
            borderRadius: '0.375rem',
            overflow: 'auto',
            whiteSpace: 'nowrap'
          }}
        >
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>课程名称</TableCell>
                {!isMobile && <TableCell>考试时间</TableCell>}
                <TableCell>分数</TableCell>
                {!isMobile && <TableCell>正确率</TableCell>}
                <TableCell>查看知识点</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {records.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isMobile ? 3 : 5} align="center">
                    <Typography variant="body1" sx={{ py: 2, color: '#8898aa' }}>
                      暂无考试记录
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                records.map((record) => (
                  <TableRow
                    key={`${record.exam_paper_id}-${record.exam_time}`}
                    sx={{
                      '&:hover': {
                        backgroundColor: '#f6f9fc'
                      }
                    }}
                  >
                    <TableCell>
                      <Box>
                        <Typography variant="subtitle1" sx={{ color: '#32325d', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {record.course_names.join(', ')}
                        </Typography>
                        {record.exam_description && (
                          <Typography variant="body2" sx={{ color: '#8898aa', whiteSpace: 'nowrap' }}>
                            {record.exam_description}
                          </Typography>
                        )}
                      </Box>
                    </TableCell>
                    {!isMobile && (
                      <TableCell sx={{ color: '#525f7f' }}>
                        {record.exam_time
                          ? new Date(record.exam_time).toLocaleString('zh-CN', {
                              year: 'numeric',
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit'
                            })
                          : '无效日期'}
                      </TableCell>
                    )}
                    <TableCell>
                      <Typography
                        variant="body1"
                        sx={{
                          color: record.total_score >= 60 ? '#2dce89' : '#f5365c',
                          fontWeight: 600,
                          backgroundColor: record.total_score >= 60 ? 'rgba(45, 206, 137, 0.1)' : 'rgba(245, 54, 92, 0.1)',
                          borderRadius: '0.25rem',
                          px: 1,
                          py: 0.5,
                          display: 'inline-block',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {(typeof record.total_score === 'number' ? record.total_score.toFixed(1) : '0.0')}分
                      </Typography>
                    </TableCell>
                    {!isMobile && (
                      <TableCell>
                        <Typography
                          variant="body1"
                          sx={{
                            color: record.accuracy_rate >= 0.6 ? '#2dce89' : '#f5365c',
                            fontWeight: 600,
                            backgroundColor: record.accuracy_rate >= 0.6 ? 'rgba(45, 206, 137, 0.1)' : 'rgba(245, 54, 92, 0.1)',
                            borderRadius: '0.25rem',
                            px: 1,
                            py: 0.5,
                            display: 'inline-block',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {(record.accuracy_rate * 100).toFixed(1)}%
                        </Typography>
                      </TableCell>
                    )}
                    <TableCell>
                      <IconButton
                        size="small"
                        sx={{
                          color: '#5e72e4',
                          '&:hover': {
                            backgroundColor: 'rgba(94, 114, 228, 0.1)'
                          }
                        }}
                        onClick={() => handleViewReportButtonClick(record.exam_id, true)} // 替换 123 和 true 为你实际的 exam_id 和 ispublic 值
                      >
                        <VisibilityIcon fontSize="small" />
                      </IconButton>
                      
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          </TableContainer>
        </Box>
        )}

        <Box sx={{ mb: 3 }}>
          <Box
            sx={{
              width: 80,
              height: 4,
              background: 'linear-gradient(90deg, #26A69A 0%, #80CBC4 100%)',
              mb: 1,
              borderRadius: 2
            }}
          />
          <Typography
            variant="h4"
            sx={{
              color: '#263339',
              fontWeight: 600,
              mb: 2
            }}
          >
            职业素养
          </Typography>

          {employeeData.qualities.map((quality, index) => (
            <Box
              key={index}
              sx={{
                p: 1.5,
                bgcolor: '#F5F5F5',
                borderRadius: '10px',
                mb: 2
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  mb: 1
                }}
              >
                <Box
                  sx={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    bgcolor: 'primary.main',
                    mr: 2
                  }}
                />
                <Typography
                  variant="h5"
                  sx={{
                    color: '#263339',
                    fontWeight: 600
                  }}
                >
                  {quality.name}
                </Typography>
              </Box>
              <Box sx={{ ml: 4, position: 'relative', pb: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  {quality.description}
                </Typography>
                <Typography
                  variant="body2"
                  color="primary"
                  onClick={() => handleOpenDialog(quality.name, quality.more)}
                  sx={{ 
                    cursor: 'pointer',
                    '&:hover': {
                      textDecoration: 'underline'
                    },
                    position: 'absolute',
                    bottom: 0,
                    right: 0
                  }}
                >
                  详细
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>
        {/* 客户评价 */}
        {employeeData.reviews && employeeData.reviews.length > 0 && (
          
          <Box sx={{ mb: 3 }}>
            <Box
              sx={{
                width: 80,
                height: 4,
                background: 'linear-gradient(90deg, #26A69A 0%, #80CBC4 100%)',
                mb: 1,
                borderRadius: 2
              }}
            />
            <Typography
              variant="h4"
              sx={{
                color: '#263339',
                fontWeight: 600,
                mb: 2
              }}
            >
              客户评价
            </Typography>

            <Grid container spacing={2}>
              {employeeData.reviews.map((review, index) => (
                <Grid item xs={12} sm={6} key={index}>
                  <Paper
                    elevation={0}
                    sx={{
                      p: 1.5,
                      height: '100%',
                      backgroundColor: 'rgba(0, 0, 0, 0.02)',
                      borderRadius: '8px'
                    }}
                  >
                    <Rating value={review.rating} readOnly sx={{ mb: 2 }} />
                    <Typography variant="body1" gutterBottom>
                      {review.content}
                    </Typography>
                    <Typography variant="subtitle2" color="text.secondary">
                      — {review.author}
                    </Typography>
                  </Paper>
                </Grid>
              ))}
            </Grid>
          </Box>
          )}
        {employeeData.employee_show_url && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3, mb: 4 }}>
          <Button
            variant="contained"
            size="large"
            href={employeeData.employee_show_url}
            target="_blank"
            rel="noopener noreferrer"
            sx={{
              background: 'linear-gradient(87deg, #26A69A 0, #56aea2 100%)',
              '&:hover': {
                background: 'linear-gradient(87deg, #1a8c82 0, #408d86 100%)'
              },
              px: 4,
              py: 1.5,
              borderRadius: '0.5rem',
              boxShadow: '0 4px 6px rgba(50, 50, 93, 0.11), 0 1px 3px rgba(0, 0, 0, 0.08)'
            }}
          >
            查看详细信息
          </Button>
        </Box>
      )}
      </Paper>
      </Box>
      </Container>
      {/* 使用WechatShare组件进行微信分享 */}
      {shareData && (
        <WechatShare
          shareTitle={shareData.shareTitle}
          shareDesc={shareData.shareDesc}
          shareImgUrl={shareData.shareImgUrl}
          shareLink={shareData.shareLink}
        />
      )}

      {/* 编辑对话框 */}
      <Dialog
        open={editDialogOpen}
        onClose={handleEditClose}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: '20px',
            bgcolor: 'white',
            boxShadow: '0 8px 16px rgba(38, 166, 154, 0.1)'
          }
        }}
      >
        <DialogTitle sx={{ color: '#263339', fontWeight: 600 , fontSize: theme.typography.h3.fontSize}}>
          编辑个人信息
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 , fontSize: theme.typography.h3.fontSize}}>
            <Typography variant="h4" sx={{ mb: 1 }}>基本信息</Typography>
            <TextField
              label="姓名"
              fullWidth
              value={editFormData.name}
              onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
            />
            <TextField
              label="职位"
              fullWidth
              value={editFormData.title}
              onChange={(e) => setEditFormData({ ...editFormData, title: e.target.value })}
            />
            <TextField
              label="工作经验"
              fullWidth
              value={editFormData.experience}
              onChange={(e) => setEditFormData({ ...editFormData, experience: e.target.value })}
            />
            
            <Typography variant="h4" sx={{ mt: 2, mb: 1 }}>个人介绍</Typography>
            <TextField
              label="个人介绍"
              fullWidth
              multiline
              rows={4}
              value={editFormData.introduction.description}
              onChange={(e) => setEditFormData({
                ...editFormData,
                introduction: {
                  ...editFormData.introduction,
                  description: e.target.value
                }
              })}
            />
            <TextField
              label="详细介绍"
              fullWidth
              multiline
              rows={4}
              value={editFormData.introduction.more}
              onChange={(e) => setEditFormData({
                ...editFormData,
                introduction: {
                  ...editFormData.introduction,
                  more: e.target.value
                }
              })}
            />

            <Typography variant="h4" sx={{ mt: 2, mb: 1 }}>服务优势</Typography>
            {editFormData.advantages.map((advantage, index) => (
              <Box key={index} sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 2 }}>
                <TextField
                  label="优势名称"
                  fullWidth
                  value={advantage.name}
                  onChange={(e) => {
                    const newAdvantages = [...editFormData.advantages];
                    newAdvantages[index] = { ...advantage, name: e.target.value };
                    setEditFormData({ ...editFormData, advantages: newAdvantages });
                  }}
                />
                <TextField
                  label="优势描述"
                  fullWidth
                  multiline
                  rows={2}
                  value={advantage.description}
                  onChange={(e) => {
                    const newAdvantages = [...editFormData.advantages];
                    newAdvantages[index] = { ...advantage, description: e.target.value };
                    setEditFormData({ ...editFormData, advantages: newAdvantages });
                  }}
                />
                <TextField
                  label="详细说明"
                  fullWidth
                  multiline
                  rows={3}
                  value={advantage.more}
                  onChange={(e) => {
                    const newAdvantages = [...editFormData.advantages];
                    newAdvantages[index] = { ...advantage, more: e.target.value };
                    setEditFormData({ ...editFormData, advantages: newAdvantages });
                  }}
                />
              </Box>
            ))}

            <Typography variant="h4" sx={{ mt: 2, mb: 1 }}>专业技能</Typography>
            {editFormData.skills.map((skill, index) => (
              
              <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                <TextField
                  label="技能名称"
                  fullWidth
                  value={skill.name}
                  onChange={(e) => {
                    const newSkills = [...editFormData.skills];
                    newSkills[index] = { ...skill, name: e.target.value };
                    setEditFormData({ ...editFormData, skills: newSkills });
                  }}
                />
                <Rating
                  value={skill.level}
                  onChange={(e, newValue) => {
                    const newSkills = [...editFormData.skills];
                    newSkills[index] = { ...skill, level: newValue };
                    setEditFormData({ ...editFormData, skills: newSkills });
                  }}
                  sx={{ mt: { xs: 1, sm: 0 } }}  // 手机端增加上边距
                />
              </Box>

            ))}

            <Typography variant="h4" sx={{ mt: 2, mb: 1 }}>职业素养</Typography>
            {editFormData.qualities.map((quality, index) => (
              <Box key={index} sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 2 }}>
                <TextField
                  label="素养名称"
                  fullWidth
                  value={quality.name}
                  onChange={(e) => {
                    const newQualities = [...editFormData.qualities];
                    newQualities[index] = { ...quality, name: e.target.value };
                    setEditFormData({ ...editFormData, qualities: newQualities });
                  }}
                />
                <TextField
                  label="素养描述"
                  fullWidth
                  multiline
                  rows={2}
                  value={quality.description}
                  onChange={(e) => {
                    const newQualities = [...editFormData.qualities];
                    newQualities[index] = { ...quality, description: e.target.value };
                    setEditFormData({ ...editFormData, qualities: newQualities });
                  }}
                />
                <TextField
                  label="详细说明"
                  fullWidth
                  multiline
                  rows={3}
                  value={quality.more}
                  onChange={(e) => {
                    const newQualities = [...editFormData.qualities];
                    newQualities[index] = { ...quality, more: e.target.value };
                    setEditFormData({ ...editFormData, qualities: newQualities });
                  }}
                />
              </Box>
            ))}

            <Typography variant="h4" sx={{ mt: 2, mb: 1 }}>客户评价</Typography>
            {editFormData.reviews && editFormData.reviews.map((review, index) => (
              <Box key={index} sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <IconButton
                    onClick={() => {
                      const newReviews = editFormData.reviews.filter((_, i) => i !== index);
                      setEditFormData({ ...editFormData, reviews: newReviews });
                    }}
                    size="small"
                    color="error"
                  >
                    <DeleteIcon />
                  </IconButton>
                </Box>
                <Rating
                  value={review.rating}
                  onChange={(e, newValue) => {
                    const newReviews = [...editFormData.reviews];
                    newReviews[index] = { ...review, rating: newValue };
                    setEditFormData({ ...editFormData, reviews: newReviews });
                  }}
                />
                <TextField
                  label="评价内容"
                  fullWidth
                  multiline
                  rows={3}
                  value={review.content}
                  onChange={(e) => {
                    const newReviews = [...editFormData.reviews];
                    newReviews[index] = { ...review, content: e.target.value };
                    setEditFormData({ ...editFormData, reviews: newReviews });
                  }}
                />
                <TextField
                  label="评价人"
                  fullWidth
                  value={review.author}
                  onChange={(e) => {
                    const newReviews = [...editFormData.reviews];
                    newReviews[index] = { ...review, author: e.target.value };
                    setEditFormData({ ...editFormData, reviews: newReviews });
                  }}
                />
              </Box>
            ))}
            
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleEditClose}>取消</Button>
          <Button onClick={handleEditSave} variant="contained" color="primary">
            保存
          </Button>
        </DialogActions>
      </Dialog>

      {/* 知识点报告对话框 */}
      <KnowledgeReportDialog
        open={examDetailDialogOpen}
        onClose={handleExamDetailClose}
        examId={examDetail?.exam_id}
        isPublic={examDetail?.ispublic} // 修改为 isPublic

      />

      {/* 详情对话框 */}
      <Dialog
        open={dialogOpen}
        onClose={handleCloseDialog}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: '20px',
            bgcolor: 'white',
            boxShadow: '0 8px 16px rgba(38, 166, 154, 0.1)'
          }
        }}
      >
        <DialogTitle sx={{ color: '#263339', fontWeight: 600, fontSize:15}}>
          {dialogContent.title}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1">{dialogContent.content}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog} color="primary">
            关闭
          </Button>
        </DialogActions>
      </Dialog>


    </Box>
  );
};

export default EmployeeProfile;
