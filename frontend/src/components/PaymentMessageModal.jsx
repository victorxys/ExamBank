import React, { useState, useEffect } from 'react';
import {
  Box, Button, Typography, Modal, TextField, DialogActions,
  Select, MenuItem, FormControl, InputLabel
} from '@mui/material';
import api from '../api/axios';

const PaymentMessageModal = ({ open, onClose, initialMessage, onAlert }) => {
  const [message, setMessage] = useState('');
  const [bankAccounts, setBankAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [originalMessage, setOriginalMessage] = useState('');

  useEffect(() => {
    if (open) {
      // 当弹窗打开时，用传入的初始消息设置状态
      setMessage(initialMessage);
      setOriginalMessage(initialMessage); // 保存一份原始消息用于后续替换

      // 获取银行账户列表
      api.get('/billing/company_bank_accounts')
        .then(response => {
          setBankAccounts(response.data);
          // 找到默认账户并设置为当前选中
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

    const oldAccount = bankAccounts.find(acc => message.includes(acc.payee_name) && message.includes(acc.account_number));
    const newAccount = bankAccounts.find(acc => acc.id === newAccountId);

    if (newAccount) {
      // 最终修正：在模板字符串中直接使用 \n 来表示换行
      const newBankInfo = `户名：${newAccount.payee_name}\n帐号：${newAccount.account_number}\n银行：${newAccount.bank_name}`;

      let messageUpdated = false;

      if (oldAccount) {
        // 最终修正：这里也使用 \n
        const oldBankInfo = `户名：${oldAccount.payee_name}\n帐号：${oldAccount.account_number}\n银行：${oldAccount.bank_name}`;
        
        // 注意：JS的 .includes() 对于多行字符串可能行为不一致，但 replace 可以正常工作
        // 为了保险起见，我们直接尝试替换
        const newMessage = message.replace(oldBankInfo, newBankInfo);
        
        if (newMessage !== message) {
            setMessage(newMessage);
            messageUpdated = true;
        }
      }

      // 如果精确替换失败（例如用户手动修改过），则使用后备方案
      if (!messageUpdated) {
        const bankInfoStartIndex = message.lastIndexOf('户名：');
        if (bankInfoStartIndex !== -1) {
          setMessage(message.substring(0, bankInfoStartIndex) + newBankInfo);
        } else {
          // 如果连“户名：”都找不到了，就追加到末尾
          setMessage(prevMessage => prevMessage + '\\n\\n' + newBankInfo);
        }
      }
    }
  };

  const handleCopyMessage = () => {
    navigator.clipboard.writeText(message).then(() => {
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
        width: 800,
        bgcolor: 'background.paper',
        boxShadow: 24,
        p: 4,
        borderRadius: 2,
      }}>
        <Typography variant="h6" component="h2">
          催款信息
        </Typography>
        <FormControl fullWidth margin="normal" size="small">
          <InputLabel>收款账户</InputLabel>
          <Select
            value={selectedAccountId}
            label="收款账户"
            onChange={handleAccountChange}
          >
            {bankAccounts.map((acc) => (
              <MenuItem key={acc.id} value={acc.id}>
                {acc.account_nickname} {acc.is_default ? '(默认)' : ''}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          multiline
          fullWidth
          rows={15}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          variant="outlined"
          sx={{ mt: 1, mb: 2, whiteSpace: 'pre-wrap', bgcolor: 'grey.100' }}
        />
        <DialogActions>
          <Button onClick={onClose}>关闭</Button>
          <Button onClick={handleCopyMessage} variant="contained">
            复制内容
          </Button>
        </DialogActions>
      </Box>
    </Modal>
  );
};

export default PaymentMessageModal;