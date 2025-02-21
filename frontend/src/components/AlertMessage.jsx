import React from 'react';
import { Alert, Snackbar } from '@mui/material';

function AlertMessage({ open, message, severity, onClose }) {
  return (
    <Snackbar
      open={open}
      autoHideDuration={6000}
      onClose={onClose}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      TransitionProps={{
        style: {
          transition: 'transform 0.3s ease-in-out'
        }
      }}
      sx={{
        position: 'fixed',
        top: '32px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        width: '100%',
        maxWidth: '600px',
        '& .MuiSnackbarContent-root': {
          borderRadius: '0.375rem',
        }
      }}
    >
      <Alert
        onClose={onClose}
        severity={severity}
        variant="filled"
        sx={{
          width: '100%',
          borderRadius: '0.375rem',
          boxShadow: '0 7px 14px rgba(50,50,93,.1), 0 3px 6px rgba(0,0,0,.08)',
          '& .MuiAlert-icon': {
            opacity: 0.9,
            color: '#fff'
          },
          '& .MuiAlert-message': {
            fontSize: '0.875rem',
            fontWeight: 500,
            color: '#fff'
          },
          '& .MuiAlert-action': {
            alignItems: 'center',
            padding: '4px 0'
          },
          '& .MuiIconButton-root': {
            padding: '4px',
            color: 'inherit',
            opacity: 0.7,
            '&:hover': {
              opacity: 1
            }
          }
        }}
      >
        {message}
      </Alert>
    </Snackbar>
  );
}

export default AlertMessage;