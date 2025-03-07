import React from 'react';
import { Box, Typography, Container } from '@mui/material';
import { useLocation } from 'react-router-dom';
import logoSvg from '../assets/logo.svg';

const ThankYouPage = () => {
  const location = useLocation();
  const username = location.state?.username || '';

  return (
    <Container maxWidth="100%">
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          py: 4
        }}
      >
        <Box
          component="img"
          src={logoSvg}
          alt="Logo"
          sx={{
            width: 180,
            height: 'auto',
            mb: 4
          }}
        />
        <Typography
          variant="h4"
          component="h1"
          gutterBottom
          sx={{
            fontWeight: 600,
            mb: 2
          }}
        >
          感谢您的评价
        </Typography>
        <Typography
          variant="h6"
          sx={{
            maxWidth: 600,
            mx: 'auto',
            color: 'text.secondary',
            fontSize: '0.8rem',
          }}
        >
          非常感谢您对{username}的评价，我们会根据您的评价持续优化我们的服务！
        </Typography>
      </Box>
    </Container>
  );
};

export default ThankYouPage;