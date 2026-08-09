import { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import {
  Box, Button, Typography, Modal, TextField, DialogActions,
  Select, MenuItem, FormControl, InputLabel, Grid
} from '@mui/material';
import { ContentCopy as ContentCopyIcon } from '@mui/icons-material';
import api from '../api/axios';

const PaymentMessageModal = ({ open, onClose, initialMessage, onAlert }) => {
  const [companyMessage, setCompanyMessage] = useState('');
  const [employeeMessage, setEmployeeMessage] = useState('');
  const [bankAccounts, setBankAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [isBeautified, setIsBeautified] = useState(false);
  const [isCompanyEditable, setIsCompanyEditable] = useState(true);
  const [isEmployeeEditable, setIsEmployeeEditable] = useState(true);


  useEffect(() => {
    if (open) {
      const isFormatted = Boolean(initialMessage?.is_formatted);
      setCompanyMessage(initialMessage?.company_summary || '');
      setEmployeeMessage(initialMessage?.employee_summary || '');
      setIsBeautified(isFormatted);
      setIsCompanyEditable(!isFormatted);
      setIsEmployeeEditable(!isFormatted);


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

  const handleCopyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      onAlert('已复制到剪贴板', 'success');
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
        <FormControl fullWidth margin="normal" size="small" sx={{ maxWidth: 400 }} disabled={isBeautified && !isCompanyEditable}>
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
            <Typography variant="subtitle1" gutterBottom>{isBeautified ? '规范格式（对公部分）' : '对公部分'}</Typography>
            <TextField
              multiline
              fullWidth
              rows={15}
              value={companyMessage}
              onChange={(e) => setCompanyMessage(e.target.value)}
              variant="outlined"
              InputProps={{
                readOnly: !isCompanyEditable,
              }}
              sx={{ whiteSpace: 'pre-wrap', bgcolor: isCompanyEditable ? 'white' : 'grey.100' }}
            />
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1 }}>
              {isBeautified && !isCompanyEditable && (
                <Button size="small" onClick={() => setIsCompanyEditable(true)}>
                  微调修改
                </Button>
              )}
              <Button size="small" startIcon={<ContentCopyIcon />} onClick={() => handleCopyToClipboard(companyMessage)}>
                复制
              </Button>
            </Box>
          </Grid>
          <Grid item xs={12} md={6}>
            <Typography variant="subtitle1" gutterBottom>{isBeautified ? '规范格式（对员工）' : '对员工'}</Typography>
            <TextField
              multiline
              fullWidth
              rows={15}
              value={employeeMessage}
              onChange={(e) => setEmployeeMessage(e.target.value)}
              variant="outlined"
              InputProps={{
                readOnly: !isEmployeeEditable,
              }}
              sx={{ whiteSpace: 'pre-wrap', bgcolor: isEmployeeEditable ? 'white' : 'grey.100' }}
            />
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1 }}>
              {isBeautified && !isEmployeeEditable && (
                <Button size="small" onClick={() => setIsEmployeeEditable(true)}>
                  微调修改
                </Button>
              )}
              <Button size="small" startIcon={<ContentCopyIcon />} onClick={() => handleCopyToClipboard(employeeMessage)}>
                复制
              </Button>
            </Box>
          </Grid>
        </Grid>

        <DialogActions>
          <Button onClick={onClose}>关闭</Button>
        </DialogActions>
      </Box>
    </Modal>
  );
};

PaymentMessageModal.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  initialMessage: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.shape({
      company_summary: PropTypes.string,
      employee_summary: PropTypes.string,
      bill_ids: PropTypes.arrayOf(
        PropTypes.oneOfType([PropTypes.string, PropTypes.number])
      ),
      is_formatted: PropTypes.bool,
    }),
  ]),
  onAlert: PropTypes.func.isRequired,
};

export default PaymentMessageModal;
