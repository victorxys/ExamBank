
// frontend/src/components/SigningMessageModal.jsx
import { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, Box, Tooltip, IconButton
} from '@mui/material';
import { ContentCopy as ContentCopyIcon, Check as CheckIcon } from '@mui/icons-material';
import { ScanEye } from 'lucide-react';

const SigningMessageModal = ({ open, onClose, title, initialMessage }) => {
  const [message, setMessage] = useState(initialMessage);
  const [copied, setCopied] = useState(false);

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
        <TextField
          fullWidth
          multiline
          rows={15}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          variant="outlined"
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  );
};

export default SigningMessageModal;
