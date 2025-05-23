import React from 'react';
import { Box, Typography, IconButton } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Person as PersonIcon } from '@mui/icons-material';

const PageHeader = ({ 
  title, 
  description,
  actions,
  showDefaultActions = true, // 是否显示默认的用户图标和通知图标
}) => {
  const theme = useTheme();

  return (
    <Box
      sx={{
        background: `linear-gradient(87deg, ${theme.palette.primary.main} 0, ${theme.palette.primary.dark} 100%)`,
        borderRadius: '0.375rem',
        p: { xs: 2, sm: 3 }, // 手机端 padding 减小
        mb: { xs: 2, sm: 3 }, // 手机端 margin-bottom 减小
        color: 'white',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <Box>
        <Typography          
        variant={theme.breakpoints.down('sm') ? 'h2' : 'h1'} // 响应式标题大小
        component="h1" 
        color="white" 
        gutterBottom>
          {title}
        </Typography>
        {description && (
          <Typography variant="body1" color="white" sx={{ opacity: 0.8 }}>
            {description}
          </Typography>
        )}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}> {/* 调整 gap 和 alignItems */}
        {/* 条件渲染 actions prop */}
        {actions ? actions : null} 
        
        {/* 条件渲染默认的图标按钮 */}
        {showDefaultActions && (
          <>
            {/* 这个 IconButton 之前在 UserManagement.jsx 中，现在移到这里作为默认操作之一 */}
            {/* 如果不需要，可以移除 */}
            {/* <IconButton color="inherit" title="通知 (示例)">
              <NotificationsIcon />
            </IconButton>
            <IconButton color="inherit" title="用户资料 (示例)">
              <PersonIcon />
            </IconButton> */}
          </>
        )}
      </Box>
    </Box>
  );
};

export default PageHeader;