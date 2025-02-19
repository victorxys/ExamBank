import React from 'react';
import { Alert, Snackbar } from '@mui/material';

function AlertMessage({ open, message, severity, onClose }) {
  return (
    <Snackbar
      open={open}
      autoHideDuration={6000}
      onClose={onClose}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      sx={{
        position: 'fixed',
        top: '64px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        width: '100%',
        maxWidth: '600px',
      }}
    >
      <Alert
        onClose={onClose}
        severity={severity}
        variant="filled"
        sx={{
          width: '100%',
          boxShadow: '0 4px 6px rgba(50,50,93,.11), 0 1px 3px rgba(0,0,0,.08)',
        }}
      >
        {message}
      </Alert>
    </Snackbar>
  );
}

export default AlertMessage;