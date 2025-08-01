// frontend/src/components/InvoiceDetailsDialog.jsx (修正默认值逻辑)

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

    useEffect(() => {
        if (open) {
            // --- 核心修正：更严谨的默认值填充逻辑 ---
            // 1. 如果 invoiceData 中已有金额，则优先使用它。
            // 2. 否则，如果 defaultInvoiceAmount 存在，则使用它。
            // 3. 否则，为空字符串。
            const initialAmount = invoiceData.amount ? invoiceData.amount : (defaultInvoiceAmount || '');

            setDetails({
                number: invoiceData.number || '',
                amount: String(initialAmount), // 确保是字符串类型
                date: invoiceData.date ? new Date(invoiceData.date) : new Date(), // 如果没有日期，默认为今天
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