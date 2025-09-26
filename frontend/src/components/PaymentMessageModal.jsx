import React, { useState, useEffect } from 'react';
import {
  Box, Button, Typography, Modal, TextField, DialogActions,
  Select, MenuItem, FormControl, InputLabel, Grid, CircularProgress
} from '@mui/material';
import api from '../api/axios';

const PaymentMessageModal = ({ open, onClose, initialMessage, onAlert }) => {
  const [companyMessage, setCompanyMessage] = useState('');
  const [employeeMessage, setEmployeeMessage] = useState('');
  const [bankAccounts, setBankAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [isBeautified, setIsBeautified] = useState(false);
  const [isBeautifying, setIsBeautifying] = useState(false);

  useEffect(() => {
    if (open) {
      // 每次打开弹窗时重置状态
      setCompanyMessage(initialMessage?.company_summary || '');
      setEmployeeMessage(initialMessage?.employee_summary || '');
      setIsBeautified(false);
      setIsBeautifying(false);

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
            return prevMessage + '\n\n' + newBankInfo;
        }
    });
  };

  const handleBeautify = async () => {
    const dataToSend = {
      company_summary: companyMessage,
      employee_summary: employeeMessage,
    };
    console.log("发送给AI美化的内容:", dataToSend);

    setIsBeautifying(true);
    try {
      const response = await api.post('/billing/beautify-message', dataToSend);
      // 移除Markdown代码块标记，但保留换行和emoji
      const cleanedMessage = response.data.beautified_message.replace(/```/g, '');
      setCompanyMessage(cleanedMessage);
      setEmployeeMessage(''); // 清空右侧
      setIsBeautified(true); // 标记为已美化
      onAlert('AI美化成功！', 'success');
    } catch (error) {
      console.error("AI美化失败:", error);
      onAlert(error.response?.data?.error || 'AI美化失败，请稍后重试', 'error');
    } finally {
      setIsBeautifying(false);
    }
  };

  const handleCopyMessage = () => {
    const messageToCopy = isBeautified 
      ? companyMessage 
      : `【对公账户】\n${companyMessage}\n\n【对私账户】\n${employeeMessage}`;
      
    navigator.clipboard.writeText(messageToCopy).then(() => {
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
        maxWidth: 1200,
        bgcolor: 'background.paper',
        boxShadow: 24,
        p: 4,
        borderRadius: 2,
      }}>
        <Typography variant="h6" component="h2">
          催款信息
        </Typography>
        <FormControl fullWidth margin="normal" size="small" sx={{ maxWidth: 400 }} disabled={isBeautified}>
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
          <Grid item xs={12} md={isBeautified ? 12 : 6}>
            <Typography variant="subtitle1" gutterBottom>{isBeautified ? 'AI美化后' : '对公部分'}</Typography>
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
          {!isBeautified && (
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
          )}
        </Grid>

        <DialogActions>
          <Button onClick={onClose}>关闭</Button>
          <Button onClick={handleBeautify} variant="outlined" disabled={isBeautifying || isBeautified}>
            {isBeautifying ? <CircularProgress size={24} /> : 'AI美化信息'}
          </Button>
          <Button onClick={handleCopyMessage} variant="contained">
            复制内容
          </Button>
        </DialogActions>
      </Box>
    </Modal>
  );
};

export default PaymentMessageModal;