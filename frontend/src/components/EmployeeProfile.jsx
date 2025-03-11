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
  MenuItem
} from '@mui/material';
import { Add as AddIcon, Share as ShareIcon, Edit as EditIcon, Delete as DeleteIcon} from '@mui/icons-material';
import html2canvas from 'html2canvas';
import { useTheme } from '@mui/material/styles';
import api from '../api/axios';
import logoSvg from '../assets/logo.svg';
import WechatShare from './WechatShare';


const EmployeeProfile = () => {
  const theme = useTheme();
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
  // const searchParams = new URLSearchParams(window.location.search);
  const publicParams = new URL(window.location.href).searchParams.get('public')
  return publicParams; // 使用 return 返回 publicParams
  });

  useEffect(() => {
    const fetchEmployeeData = async () => {
      try {
        setLoading(true);
        setError(null);
        const publicParam = new URL(window.location.href).searchParams.get('public');
        const response = await api.get(`/users/${userId}/profile${publicParam ? `?public=${publicParam}` : ''}`);
        setEmployeeData(response.data);
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
  // console.log('isPublic',isPublic)
  const handleOpenDialog = (title, content) => {
    setDialogContent({ title, content });
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
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
  // console.log('employee_show_url',employeeData.employee_show_url)
  if (!employeeData || !employeeData.introduction) {
    
    return (
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <Alert severity="info" sx={{ width: '100%' }}>暂无员工介绍，请先评价员工，然后再生成相应评价</Alert>
        <Button
          variant="contained"
          color="primary"
          onClick={() => navigate(`/user-evaluation/${userId}`)}
          
        >
          去评价
        </Button>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #FFFFFF 0%, #E0F2F1 100%)',
        position: 'relative',
        pb: 8
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
          <Box sx={{ display: 'flex', gap: 2, position: 'absolute', top: 88, right: 24, zIndex: 1000, pointerEvents: 'auto' }}>
            <Button
              variant="contained"
              color="primary"
              startIcon={<EditIcon />}
              onClick={handleEditClick}
              sx={{
                background: 'linear-gradient(87deg, #26A69A 0, #56aea2 100%)',
                '&:hover': {
                  background: 'linear-gradient(87deg, #1a8c82 0, #408d86 100%)'
                }
              }}
            >
              编辑
            </Button>
            <Button
              variant="contained"
              color="primary"
              startIcon={<ShareIcon />}
              onClick={(event) => setAnchorEl(event.currentTarget)}
              sx={{
                background: 'linear-gradient(87deg, #26A69A 0, #56aea2 100%)',
                '&:hover': {
                  background: 'linear-gradient(87deg, #1a8c82 0, #408d86 100%)'
                }
              }}
            >
              分享
            </Button>
            <Menu
              anchorEl={anchorEl}
              open={Boolean(anchorEl)}
              onClose={() => setAnchorEl(null)}
            >
              <MenuItem onClick={() => {
                const newShareData = {
                  shareTitle: `${employeeData?.name || '员工介绍'} - 萌姨萌嫂`,
                  shareDesc: employeeData?.introduction?.description || '查看员工的详细介绍、技能和评价。',
                  shareImgUrl: employeeData?.employee_show_url || logoSvg,
                  shareLink: window.location.href
                };
                setShareData(newShareData);
                // 直接调用微信分享
                if (window.wx) {
                  window.wx.updateAppMessageShareData({
                    title: newShareData.shareTitle,
                    desc: newShareData.shareDesc,
                    link: newShareData.shareLink,
                    imgUrl: newShareData.shareImgUrl,
                    success: () => {
                      console.log('分享设置成功');
                    },
                    fail: (err) => {
                      console.error('分享设置失败:', err);
                    }
                  });
                }
                setAnchorEl(null);
              }}>
                分享到微信
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
      <Box id="employee-profile-content" sx={{ px: 3 }}>
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

      <Paper
        elevation={0}
        sx={{
          p: 4,
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
            variant="h5"
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
            p: 3,
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
            variant="h5"
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
                p: 3,
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

        {employeeData.skills && employeeData.skills.length > 0 && (
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
                variant="h5"
                sx={{
                  color: '#263339',
                  fontWeight: 600,
                  mb: 2
                }}
              >
                专业技能
              </Typography>
            
              {employeeData.skills.map((skill, index) => (
                <Box
                  key={index}
                  sx={{
                    p: 3,
                    bgcolor: '#F5F5F5',
                    borderRadius: '10px',
                    mb: 2
                  }}
                >
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      mb: 1
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
              ))}
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
            variant="h5"
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
                p: 3,
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
              variant="h5"
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
                      p: 3,
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
      </Paper>
      </Box>
      </Container>
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

      {/* 详情弹窗 */}
      <Dialog
        open={dialogOpen}
        onClose={handleCloseDialog}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: '20px',
            bgcolor: 'white',
            boxShadow: '0 8px 16px rgba(38, 166, 154, 0.1)'
          }
        }}
      >
        <DialogTitle sx={{ color: '#263339', fontWeight: 600, fontSize: theme.typography.h3.fontSize }}>
          {dialogContent.title}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1" color="#728f9e">
            {dialogContent.content}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog} color="primary">
            关闭
          </Button>
        </DialogActions>
      </Dialog>
      
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

    
    </Box>
  );
};

export default EmployeeProfile;