// frontend/src/components/LazyImage.jsx
import React, { useState, useEffect } from 'react';
import { useInView } from 'react-intersection-observer';
import { Box, CircularProgress, Typography } from '@mui/material';
import api from '../api/axios';

const LazyImage = ({ endpoint, alt }) => {
  const [status, setStatus] = useState('idle'); // idle, loading, loaded, error
  const [src, setSrc] = useState(null);

  const { ref, inView } = useInView({
    triggerOnce: true,
    rootMargin: '200px 0px',
  });

  useEffect(() => {
    // 确保组件在视图内且处于初始状态
    if (inView && status === 'idle') {
      setStatus('loading');
      
      api.get(endpoint)
        .then(response => {
          if (response.data && response.data.signature) {
            setSrc(response.data.signature);
            setStatus('loaded');
          } else {
            // API成功返回，但signature为空
            setStatus('error');
          }
        })
        .catch(() => {
          // API请求失败 (例如 404)
          setStatus('error');
        });
    }
  }, [inView, status, endpoint]);

  let content;
  switch (status) {
    case 'loading':
      content = <CircularProgress size={20} />;
      break;
    case 'loaded':
      content = <img src={src} alt={alt} style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} />;
      break;
    case 'error':
      // 对于签名，加载失败和“未签”在视觉上可以统一，避免显示刺眼的“加载失败”
      content = <Typography variant="caption" color="text.secondary">未签</Typography>;
      break;
    case 'idle':
    default:
      // 在图片加载前，也显示“未签”作为占位符
      content = <Typography variant="caption" color="text.secondary">未签</Typography>;
      break;
  }

  return (
    <Box
      ref={ref}
      sx={{
        width: '100px',
        height: '40px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f5f5f5',
        borderRadius: 1,
        overflow: 'hidden',
      }}
    >
      {content}
    </Box>
  );
};

export default LazyImage;