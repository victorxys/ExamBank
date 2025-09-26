import React, { useState, useEffect } from 'react';
import {
  Box, Button, Typography, Modal, TextField, DialogActions,
  Select, MenuItem, FormControl, InputLabel, Grid
} from '@mui/material';
import api from '../api/axios';

const PaymentMessageModal = ({ open, onClose, initialMessage, onAlert }) => {
  const [companyMessage, setCompanyMessage] = useState('');
  const [employeeMessage, setEmployeeMessage] = useState('');
  const [bankAccounts, setBankAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');

  useEffect(() => {
    if (open) {
      // 当弹窗打开时，用传入的初始消息对象设置状态
      setCompanyMessage(initialMessage?.company_summary || '');
      setEmployeeMessage(initialMessage?.employee_summary || '');

      // 获取银行账户列表
      api.get('/billing/company_bank_accounts')
        .then(response => {
          setBankAccounts(response.data);
          const defaultAccount = response.data.find(acc => acc.is_default);
          if (defaultAccount) {
            setSelectedAccountId(defaultAccount.id);
          } else if (response.data.length > 0) {
            setSelectedAccountId(response.data[0].id);
          }
        })
        .catch(error => {
          console.error("获取银行账户列表失败:", error);
          onAlert('获取银行账户列表失败', 'error');
        });
    }
  }, [open, initialMessage]);

  const handleAccountChange = (event) => {
    const newAccountId = event.target.value;
    setSelectedAccountId(newAccountId);

    const newAccount = bankAccounts.find(acc => acc.id === newAccountId);
    if (!newAccount) return;

    const newBankInfo = `户名：${newAccount.payee_name}\n帐号：${newAccount.account_number}\n银行：${newAccount.bank_name}`;

    setCompanyMessage(prevMessage => {
        const bankInfoStartIndex = prevMessage.lastIndexOf('户名：');
        if (bankInfoStartIndex !== -1) {
            return prevMessage.substring(0, bankInfoStartIndex) + newBankInfo;
        } else {
            // 如果找不到，就在末尾追加
            return prevMessage + '\n\n' + newBankInfo;
        }
    });
  };

  const handleCopyMessage = () => {
    const combinedMessage = `【对公账户】\n${companyMessage}\n\n【对私账户】\n${employeeMessage}`;
    navigator.clipboard.writeText(combinedMessage).then(() => {
      onAlert('消息已复制到剪贴板', 'success');
    }, (err) => {
      console.error('复制失败: ', err);
      onAlert('复制失败', 'error');
    });
  };

  return (
    <Modal open={open} onClose={onClose}>
      <Box sx={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '90%',
        maxWidth: 1200, // 增加最大宽度
        bgcolor: 'background.paper',
        boxShadow: 24,
        p: 4,
        borderRadius: 2,
      }}>
        <Typography variant="h6" component="h2">
          催款信息
        </Typography>
        <FormControl fullWidth margin="normal" size="small" sx={{ maxWidth: 400 }}>
          <InputLabel>收款账户 (仅影响对公部分)</InputLabel>
          <Select
            value={selectedAccountId}
            label="收款账户 (仅影响对公部分)"
            onChange={handleAccountChange}
          >
            {bankAccounts.map((acc) => (
              <MenuItem key={acc.id} value={acc.id}>
                {acc.account_nickname} {acc.is_default ? '(默认)' : ''}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        
        <Grid container spacing={2} sx={{ mt: 1, mb: 2 }}>
          <Grid item xs={12} md={6}>
            <Typography variant="subtitle1" gutterBottom>对公部分</Typography>
            <TextField
              multiline
              fullWidth
              rows={15}
              value={companyMessage}
              onChange={(e) => setCompanyMessage(e.target.value)}
              variant="outlined"
              sx={{ whiteSpace: 'pre-wrap', bgcolor: 'grey.100' }}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <Typography variant="subtitle1" gutterBottom>对私部分</Typography>
            <TextField
              multiline
              fullWidth
              rows={15}
              value={employeeMessage}
              onChange={(e) => setEmployeeMessage(e.target.value)}
              variant="outlined"
              sx={{ whiteSpace: 'pre-wrap', bgcolor: 'grey.100' }}
            />
          </Grid>
        </Grid>

        <DialogActions>
          <Button onClick={onClose}>关闭</Button>
          <Button onClick={handleCopyMessage} variant="contained">
            复制完整内容
          </Button>
        </DialogActions>
      </Box>
    </Modal>
  );
};

export default PaymentMessageModal;