
// frontend/src/components/SigningMessageModal.jsx
import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, Box, Tooltip, IconButton
} from '@mui/material';
import { ContentCopy as ContentCopyIcon, Check as CheckIcon } from '@mui/icons-material';

const SigningMessageModal = ({ open, onClose, title, initialMessage }) => {
  const [message, setMessage] = useState(initialMessage);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setMessage(initialMessage);
  }, [initialMessage]);

  const handleCopy = () => {
    navigator.clipboard.writeText(message).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000); // Reset after 2 seconds
    });
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>
        {title}
        <Tooltip title={copied ? "已复制!" : "复制内容"}>
          <IconButton
            onClick={handleCopy}
            sx={{ position: 'absolute', right: 8, top: 8 }}
          >
            {copied ? <CheckIcon color="success" /> : <ContentCopyIcon />}
          </IconButton>
        </Tooltip>
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
