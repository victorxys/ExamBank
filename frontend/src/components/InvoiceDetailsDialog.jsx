// frontend/src/components/InvoiceDetailsDialog.jsx (全新文件)

import React, { useState, useEffect } from 'react';
import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle,
  TextField, Grid
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';

const InvoiceDetailsDialog = ({ open, onClose, onSave, invoiceData = {}, defaultInvoiceAmount }) => {
    const [details, setDetails] = useState({
        number: '',
        amount: '',
        date: null,
    });

    // 当弹窗打开或传入的数据变化时，初始化表单
    useEffect(() => {
        if (open) {
            // 如果已有发票金额，则使用该金额；否则，使用传入的默认应付金额
            const initialAmount = invoiceData.amount || defaultInvoiceAmount || '';
            
            setDetails({
                number: invoiceData.number || '',
                amount: initialAmount,
                date: invoiceData.date ? new Date(invoiceData.date) : null,
            });
        }
    }, [invoiceData, open, defaultInvoiceAmount]);

    const handleChange = (event) => {
        const { name, value } = event.target;
        setDetails(prev => ({ ...prev, [name]: value }));
    };

    const handleDateChange = (newDate) => {
        setDetails(prev => ({ ...prev, date: newDate }));
    };

    const handleSave = () => {
        // 将日期对象转换为 YYYY-MM-DD 格式的字符串
        const finalDetails = {
            ...details,
            date: details.date ? details.date.toISOString().split('T')[0] : null,
        };
        onSave(finalDetails);
        onClose();
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>管理发票详情</DialogTitle>
            <DialogContent>
                <Grid container spacing={2} sx={{ pt: 2 }}>
                    <Grid item xs={12}>
                        <TextField
                            fullWidth
                            label="发票号码"
                            name="number"
                            value={details.number}
                            onChange={handleChange}
                        />
                    </Grid>
                    <Grid item xs={12}>
                        <TextField
                            fullWidth
                            label="发票金额"
                            name="amount"
                            type="number"
                            value={details.amount}
                            onChange={handleChange}
                            InputProps={{ startAdornment: '¥' }}
                        />
                    </Grid>
                    <Grid item xs={12}>
                        <DatePicker
                            label="开票日期"
                            value={details.date}
                            onChange={handleDateChange}
                            sx={{ width: '100%' }}
                        />
                    </Grid>
                </Grid>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>取消</Button>
                <Button onClick={handleSave} variant="contained">确认</Button>
            </DialogActions>
        </Dialog>
    );
};

export default InvoiceDetailsDialog;