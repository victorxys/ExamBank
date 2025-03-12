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
        p: 3,
        mb: 3,
        color: 'white',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <Box>
        <Typography variant="h1" component="h1" color="white" gutterBottom>
          {title}
        </Typography>
        {description && (
          <Typography variant="body1" color="white" sx={{ opacity: 0.8 }}>
            {description}
          </Typography>
        )}
      </Box>
      <Box sx={{ display: 'flex', gap: 2 }}>
        {actions}
        {showDefaultActions}
      </Box>
    </Box>
  );
};

export default PageHeader;