import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Avatar,
  Typography,
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
  Alert
} from '@mui/material';
import { Add as AddIcon, Share as ShareIcon } from '@mui/icons-material';
import html2canvas from 'html2canvas';
import { useTheme } from '@mui/material/styles';
import api from '../api/axios';

const EmployeeProfile = () => {
  const theme = useTheme();
  const { userId } = useParams();
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogContent, setDialogContent] = useState({ title: '', content: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [employeeData, setEmployeeData] = useState(null);

  useEffect(() => {
    const fetchEmployeeData = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await api.get(`/users/${userId}/profile`);
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

  const handleOpenDialog = (title, content) => {
    setDialogContent({ title, content });
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
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
        <Alert severity="info" sx={{ width: '100%' }}>暂无员工介绍，请先评价员工，然后由AI生成相应评价</Alert>
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

      <Container maxWidth="lg" sx={{ py: 4, position: 'relative' }}>
        <Button
          variant="contained"
          color="primary"
          startIcon={<ShareIcon />}
          onClick={async () => {
            try {
              const element = document.getElementById('employee-profile-content');
              if (!element) return;

              const canvas = await html2canvas(element, {
                scale: window.devicePixelRatio, // 使用设备像素比来保持清晰度
                useCORS: true, // 允许加载跨域图片
                logging: false,
                backgroundColor: '#E0F2F1'
              });

              // 将canvas转换为图片
              const image = canvas.toDataURL('image/jpeg', 1.0);
              
              // 创建下载链接
              const link = document.createElement('a');
              link.download = `${employeeData.name}-档案.jpg`;
              link.href = image;
              link.click();
            } catch (error) {
              console.error('生成图片失败:', error);
              alert('生成图片失败，请稍后重试');
            }
          }}
          sx={{
            position: 'absolute',
            top: 16,
            right: 24,
            background: 'linear-gradient(87deg, #26A69A 0, #56aea2 100%)',
            '&:hover': {
              background: 'linear-gradient(87deg, #1a8c82 0, #408d86 100%)'
            }
          }}
        >
          生成图片
        </Button>
      <Box id="employee-profile-content">
      {/* 基本信息部分 */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
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
        <Avatar
          sx={{
            width: 80,
            height: 80,
            border: '4px solid white',
            boxShadow: '0 8px 16px rgba(38, 166, 154, 0.1)',
            bgcolor: '#F5F5F5',
            color: theme.palette.primary.main
          }}
          alt={employeeData?.name}
          src={employeeData?.avatar}
        >
          {employeeData?.name?.[0]}
        </Avatar>

        <Box
          sx={{
            mt: 2,
            textAlign: 'center'
          }}
        >
          <Typography
            variant="h4"
            sx={{
              color: '#263339',
              fontWeight: 600,
              mb: 1
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
      </Paper>
      </Box>
      </Container>

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
    </Box>
  );
};

export default EmployeeProfile;