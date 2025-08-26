import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Checkbox, TextField, IconButton,
  Box, Typography
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { Save as SaveIcon, Close as CloseIcon } from '@mui/icons-material';
import api from '../api/axios';

const BatchSettlementModal = ({ open, onClose, bills, onSaveSuccess }) => {
  const [billData, setBillData] = useState([]);

  useEffect(() => {
    if (bills) {
      // 初始化组件内部状态，为每个账单对象构建完整的数据结构
      const initialData = bills.map(bill => ({
        ...bill,
        customer_is_paid: bill.customer_is_paid || false,
        customer_payment_date: bill.payment_details?.payment_date ? new Date(bill.payment_details.payment_date) : null,
        customer_payment_channel: bill.payment_details?.payment_channel || '',
        employee_is_paid: bill.employee_is_paid || false,
        employee_payout_date: bill.payout_details?.date ? new Date(bill.payout_details.date) : null,
        employee_payout_channel: bill.payout_details?.channel || '',
      }));
      setBillData(initialData);
    }
  }, [bills]);

  // 处理输入框和日期选择器的值变化
  const handleFieldChange = (id, field, value) => {
    setBillData(prevData =>
      prevData.map(row => (row.id === id ? { ...row, [field]: value } : row))
    );
  };

  // 处理复选框的勾选/取消
  const handleCheckboxChange = (id, field, checked) => {
    setBillData(prevData =>
      prevData.map(row => {
        if (row.id === id) {
          const updatedRow = { ...row, [field]: checked };
          // 如果勾选“已支付”，则自动填充当天日期
          if (checked) {
            if (field === 'customer_is_paid' && !updatedRow.customer_payment_date) {
              updatedRow.customer_payment_date = new Date();
            }
            if (field === 'employee_is_paid' && !updatedRow.employee_payout_date) {
              updatedRow.employee_payout_date = new Date();
            }
          }
          return updatedRow;
        }
        return row;
      })
    );
  };

  // 处理“同上”按钮的逻辑
  const handleCopyToAll = (field) => {
    if (billData.length > 1) {
      const firstValue = billData[0][field];
      setBillData(prevData =>
        prevData.map((row, index) => (index > 0 ? { ...row, [field]: firstValue } : row))
      );
    }
  };

  const handleSelectAll = (field, checked) => {
    setBillData(prevData =>
      prevData.map(row => {
        const updatedRow = { ...row, [field]: checked };
        // 如果勾选“已支付”，则自动填充当天日期
        if (checked) {
          if (field === 'customer_is_paid' && !updatedRow.customer_payment_date) {
            updatedRow.customer_payment_date = new Date();
          }
          if (field === 'employee_is_paid' && !updatedRow.employee_payout_date) {
            updatedRow.employee_payout_date = new Date();
          }
        }
        return updatedRow;
      })
    );
  };

  // 保存所有更改
  const handleSave = async () => {
    const payload = {
      updates: billData.map(bill => ({
        bill_id: bill.id,
        customer_is_paid: bill.customer_is_paid,
        customer_payment_date: bill.customer_payment_date ? new Date(bill.customer_payment_date).toISOString().split('T')[0] : null,
        customer_payment_channel: bill.customer_payment_channel,
        employee_is_paid: bill.employee_is_paid,
        employee_payout_date: bill.employee_payout_date ? new Date(bill.employee_payout_date).toISOString().split('T')[0] : null,
        employee_payout_channel: bill.employee_payout_channel,
      })),
    };
    try {
      await api.post('/billing/batch-settle', payload);
      onSaveSuccess(); // 调用父组件的回调函数
    } catch (error) {
      console.error("批量结算保存失败:", error);
      // 可以在此调用父组件的错误处理函数来显示Alert
    }
  };

  const numBills = billData.length;
  const numCustomerPaid = billData.filter(b => b.customer_is_paid).length;
  const numEmployeePaid = billData.filter(b => b.employee_is_paid).length;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth>
      <DialogTitle>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography variant="h6">批量结算</Typography>
          <IconButton onClick={onClose}><CloseIcon /></IconButton>
        </Box>
      </DialogTitle>
      <DialogContent dividers>
        <TableContainer sx={{ maxHeight: '60vh' }}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{minWidth: 150}}>客户 / 员工</TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems:'center' }}>
                    <Checkbox
                      indeterminate={numCustomerPaid > 0 &&numCustomerPaid < numBills}
                      checked={numBills > 0 && numCustomerPaid=== numBills}
                      onChange={(e) => handleSelectAll('customer_is_paid', e.target.checked)}
                    />
                    <Typography variant="body2" sx={{fontWeight: 'bold' }}>客户已打款</Typography>
                  </Box>
                </TableCell>
                <TableCell sx={{minWidth: 220}}>
                  打款日期
                  <Button size="small" onClick={() =>handleCopyToAll('customer_payment_date')}>同上</Button>
                </TableCell>
                <TableCell sx={{minWidth: 180}}>
                  打款渠道/备注
                  <Button size="small" onClick={() =>handleCopyToAll('customer_payment_channel')}>同上</Button>
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems:'center' }}>
                    <Checkbox
                      indeterminate={numEmployeePaid > 0 &&numEmployeePaid < numBills}
                      checked={numBills > 0 && numEmployeePaid=== numBills}
                      onChange={(e) => handleSelectAll('employee_is_paid', e.target.checked)}
                    />
                    <Typography variant="body2" sx={{fontWeight: 'bold' }}>员工已领款</Typography>
                  </Box>
                </TableCell>
                <TableCell sx={{minWidth: 220}}>
                  领款日期
                  <Button size="small" onClick={() =>handleCopyToAll('employee_payout_date')}>同上</Button>
                </TableCell>
                <TableCell sx={{minWidth: 180}}>
                  领款渠道/备注
                  <Button size="small" onClick={() =>handleCopyToAll('employee_payout_channel')}>同上</Button>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {billData.map((bill) => (
                <TableRow key={bill.id} hover>
                  <TableCell>
                    <Typography variant="body2" sx={{fontWeight: 500}}>{bill.customer_name}</Typography>
                    <Typography variant="caption" color="textSecondary">{bill.employee_name}</Typography>
                  </TableCell>
                  <TableCell align="center">
                    <Checkbox
                      checked={bill.customer_is_paid}
                      onChange={(e) => handleCheckboxChange(bill.id, 'customer_is_paid', e.target.checked)}
                    />
                  </TableCell>
                  <TableCell>
                    <DatePicker
                      value={bill.customer_payment_date}
                      onChange={(date) => handleFieldChange(bill.id, 'customer_payment_date', date)}
                      disabled={!bill.customer_is_paid}
                      slots={{ textField: (params) => <TextField {...params} size="small" fullWidth /> }}
                      format="yyyy-MM-dd"
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      size="small"
                      fullWidth
                      value={bill.customer_payment_channel}
                      onChange={(e) => handleFieldChange(bill.id, 'customer_payment_channel', e.target.value)}
                      disabled={!bill.customer_is_paid}
                    />
                  </TableCell>
                  <TableCell align="center">
                    <Checkbox
                      checked={bill.employee_is_paid}
                      onChange={(e) => handleCheckboxChange(bill.id, 'employee_is_paid', e.target.checked)}
                    />
                  </TableCell>
                  <TableCell>
                    <DatePicker
                      value={bill.employee_payout_date}
                      onChange={(date) => handleFieldChange(bill.id, 'employee_payout_date', date)}
                      disabled={!bill.employee_is_paid}
                      slots={{ textField: (params) => <TextField {...params} size="small" fullWidth /> }}
                      format="yyyy-MM-dd"
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      size="small"
                      fullWidth
                      value={bill.employee_payout_channel}
                      onChange={(e) => handleFieldChange(bill.id, 'employee_payout_channel', e.target.value)}
                      disabled={!bill.employee_is_paid}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </DialogContent>
      <DialogActions sx={{p: 2}}>
        <Button onClick={onClose}>取消</Button>
        <Button onClick={handleSave} variant="contained" startIcon={<SaveIcon />}>
          保存
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default BatchSettlementModal;