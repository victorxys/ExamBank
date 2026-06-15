
// frontend/src/components/SigningMessageModal.jsx
import { useState, useEffect, useMemo } from 'react';
import PropTypes from 'prop-types';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, Box, Tooltip, IconButton, Alert, Stack, Typography, Chip
} from '@mui/material';
import { ContentCopy as ContentCopyIcon, Check as CheckIcon, Link as LinkIcon, Language as LanguageIcon } from '@mui/icons-material';
import { ScanEye } from 'lucide-react';

const SigningMessageModal = ({ open, onClose, title, initialMessage, linkInfo }) => {
  const [message, setMessage] = useState(initialMessage);
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState('');

  useEffect(() => {
    setMessage(initialMessage);
  }, [initialMessage]);

  // 从消息中提取签约链接
  const signingUrl = useMemo(() => {
    if (!message) return null;
    // 匹配 http:// 或 https:// 开头，包含 /sign/ 的链接
    const urlMatch = message.match(/https?:\/\/[^\s]+\/sign\/[^\s]+/);
    return urlMatch ? urlMatch[0] : null;
  }, [message]);

  const handleCopy = () => {
    navigator.clipboard.writeText(message).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000); // Reset after 2 seconds
    });
  };

  const handleCopyLink = (label, url) => {
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedLink(label);
      setTimeout(() => setCopiedLink(''), 2000);
    });
  };

  const handleOpenContract = () => {
    if (signingUrl) {
      window.open(signingUrl, '_blank');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>
        {title}
        <Box sx={{ position: 'absolute', right: 8, top: 8, display: 'flex', gap: 0.5 }}>
          {signingUrl && (
            <Tooltip title="查看合同">
              <IconButton onClick={handleOpenContract} color="primary">
                <ScanEye size={20} />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title={copied ? "已复制!" : "复制内容"}>
            <IconButton onClick={handleCopy}>
              {copied ? <CheckIcon color="success" /> : <ContentCopyIcon />}
            </IconButton>
          </Tooltip>
        </Box>
      </DialogTitle>
      <DialogContent>
        {linkInfo && (
          <Alert
            severity={linkInfo.primary_type === 'miniapp' ? 'success' : 'info'}
            icon={false}
            sx={{
              mb: 2,
              py: 1,
              '& .MuiAlert-message': { width: '100%', py: 0.25 },
            }}
          >
            <Stack spacing={0.75}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1.5}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
                  <CheckIcon color="success" fontSize="small" />
                  <Typography variant="body2" noWrap>
                    当前主链接：{linkInfo.primary_type === 'miniapp' ? '小程序 URL Link' : 'Web 签署链接'}
                  </Typography>
                  {linkInfo.primary_type === 'miniapp' && (
                    <Chip size="small" color="success" variant="outlined" label="微信内可拉起小程序" />
                  )}
                </Stack>
                <Stack direction="row" spacing={1} flexShrink={0}>
                  {linkInfo.miniapp_url && (
                    <Button
                      size="small"
                      variant={copiedLink === 'miniapp' ? 'contained' : 'outlined'}
                      startIcon={copiedLink === 'miniapp' ? <CheckIcon /> : <LinkIcon />}
                      onClick={() => handleCopyLink('miniapp', linkInfo.miniapp_url)}
                      sx={{
                        minWidth: 118,
                        bgcolor: copiedLink === 'miniapp' ? undefined : '#fff',
                        borderColor: 'rgba(15, 159, 143, 0.45)',
                        color: '#0f766e',
                        fontWeight: 700,
                        '&:hover': {
                          bgcolor: copiedLink === 'miniapp' ? undefined : '#f0fdfa',
                          borderColor: '#0f9f8f',
                        },
                      }}
                    >
                      {copiedLink === 'miniapp' ? '已复制' : '小程序链接'}
                    </Button>
                  )}
                  {linkInfo.web_url && (
                    <Button
                      size="small"
                      variant={copiedLink === 'web' ? 'contained' : 'outlined'}
                      startIcon={copiedLink === 'web' ? <CheckIcon /> : <LanguageIcon />}
                      onClick={() => handleCopyLink('web', linkInfo.web_url)}
                      sx={{
                        minWidth: 118,
                        bgcolor: copiedLink === 'web' ? '#64748b' : '#fff',
                        borderColor: 'rgba(100, 116, 139, 0.38)',
                        color: copiedLink === 'web' ? '#fff' : '#475569',
                        fontWeight: 700,
                        '&:hover': {
                          bgcolor: copiedLink === 'web' ? '#64748b' : '#f8fafc',
                          borderColor: '#64748b',
                        },
                      }}
                    >
                      {copiedLink === 'web' ? '已复制' : 'Web 备用'}
                    </Button>
                  )}
                </Stack>
              </Stack>
              {linkInfo.miniapp_error && (
                <Typography variant="caption" color="warning.main">
                  小程序链接生成失败，已使用 Web 备用链接：{linkInfo.miniapp_error}
                </Typography>
              )}
            </Stack>
          </Alert>
        )}
        <TextField
          fullWidth
          multiline
          minRows={12}
          maxRows={16}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          variant="outlined"
          sx={{
            mt: 1,
            '& .MuiInputBase-input': {
              fontSize: 14,
              lineHeight: 1.55,
            },
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  );
};

SigningMessageModal.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  title: PropTypes.string.isRequired,
  initialMessage: PropTypes.string,
  linkInfo: PropTypes.shape({
    primary_type: PropTypes.string,
    primary_url: PropTypes.string,
    miniapp_url: PropTypes.string,
    web_url: PropTypes.string,
    miniapp_error: PropTypes.string,
  }),
};

SigningMessageModal.defaultProps = {
  initialMessage: '',
  linkInfo: null,
};

export default SigningMessageModal;
