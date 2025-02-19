import React from 'react';
import { Box, Typography, Button } from '@mui/material';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({
      error: error,
      errorInfo: errorInfo
    });
    // 这里可以添加错误日志上报逻辑
  }

  render() {
    if (this.state.hasError) {
      return (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '400px',
            p: 3,
            textAlign: 'center'
          }}
        >
          <Typography variant="h4" color="error" gutterBottom>
            抱歉，出现了一些问题
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
            组件加载过程中发生错误，请尝试刷新页面
          </Typography>
          <Button
            variant="contained"
            color="primary"
            onClick={() => window.location.reload()}
          >
            刷新页面
          </Button>
        </Box>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;