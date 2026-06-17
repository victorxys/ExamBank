import React from 'react';
import { Box, Typography, Button } from '@mui/material';

const AUTO_RELOAD_KEY = 'examdb:auto-reload-after-chunk-error';
const AUTO_RELOAD_COOLDOWN_MS = 30 * 1000;

const CHUNK_LOAD_ERROR_PATTERNS = [
  'Failed to fetch dynamically imported module',
  'Importing a module script failed',
  'error loading dynamically imported module',
  'Failed to load module script',
  'Expected a JavaScript-or-Wasm module script',
  'MIME type of "text/html"',
  'Strict MIME type checking',
  'ChunkLoadError',
  'Loading chunk',
  'CSS_CHUNK_LOAD_FAILED'
];

function errorToText(error) {
  if (!error) return '';
  const parts = [
    error.name,
    error.message,
    error.stack,
    error.cause?.message,
    String(error)
  ];
  return parts.filter(Boolean).join('\n');
}

function isChunkLoadError(error) {
  const text = errorToText(error);
  return CHUNK_LOAD_ERROR_PATTERNS.some((pattern) => text.includes(pattern));
}

function shouldAutoReloadForChunkError(error) {
  if (!isChunkLoadError(error)) return false;

  const lastReloadAt = Number(sessionStorage.getItem(AUTO_RELOAD_KEY) || 0);
  const now = Date.now();
  if (lastReloadAt && now - lastReloadAt < AUTO_RELOAD_COOLDOWN_MS) {
    return false;
  }

  sessionStorage.setItem(AUTO_RELOAD_KEY, String(now));
  return true;
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, autoReloading: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({
      error: error,
      errorInfo: errorInfo
    });
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    if (shouldAutoReloadForChunkError(error)) {
      this.setState({ autoReloading: true });
      window.setTimeout(() => {
        window.location.reload();
      }, 300);
    }
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
            {this.state.autoReloading
              ? '检测到页面资源已更新，正在为您刷新页面'
              : '组件加载过程中发生错误，请尝试刷新页面'}
          </Typography>
          {import.meta.env.DEV && this.state.error && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mb: 3, maxWidth: 720, whiteSpace: 'pre-wrap', textAlign: 'left' }}
            >
              {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
            </Typography>
          )}
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
