// frontend/src/components/PaymentDialog.jsx (V2增强版)

import React, { useState, useEffect } from 'react';
import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle,
  TextField, Grid, Box, Typography, Divider
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import { format as formatDateFns } from 'date-fns';
import { useDropzone } from 'react-dropzone';
import api from '../api/axios'; 

// 【新增】货币格式化辅助函数
const formatCurrency = (value) => {
    const num = parseFloat(value);
    if (isNaN(num)) {
        return '0.00';
    }
    return num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const PaymentDialog = ({ open, onClose, onSave, totalDue = 0, totalPaid = 0, recordType, recordId }) => {
    const [amount, setAmount] = useState('');
    const [paymentDate, setPaymentDate] = useState(new Date());
    const [method, setMethod] = useState('');
    const [notes, setNotes] = useState('');
    const [files, setFiles] = useState([]);

    const { getRootProps, getInputProps } = useDropzone({
        accept: {
            'image/jpeg': ['.jpeg', '.jpg'],
            'image/png': ['.png'],
            'image/gif': ['.gif']
        },
        onDrop: acceptedFiles => {
            setFiles(acceptedFiles.map(file => Object.assign(file, {
                preview: URL.createObjectURL(file)
            })));
        }
    });

    const thumbs = files.map(file => (
        <div style={{ display: 'inline-flex', borderRadius: 2, border: '1px solid #eaeaea', marginBottom: 8, marginRight: 8, width: 100, height: 100, padding: 4, boxSizing: 'border-box' }} key={file.name}>
            <div style={{ display: 'flex', minWidth: 0, overflow: 'hidden' }}>
                <img
                    src={file.preview}
                    style={{ display: 'block', width: 'auto', height: '100%' }}
                    // Revoke data uri after image is loaded
                    onLoad={() => { URL.revokeObjectURL(file.preview) }}
                />
            </div>
        </div>
    ));

    useEffect(() => {
        // Make sure to revoke the data uris to avoid memory leaks
        return () => files.forEach(file => URL.revokeObjectURL(file.preview));
    }, [files]);

    // 计算剩余待付金额
    const remainingAmount = (parseFloat(totalDue) - parseFloat(totalPaid)).toFixed(2);

    useEffect(() => {
        if (open) {
            // 【优化】当弹窗打开时，自动将支付金额设置为剩余待付金额
            setAmount(remainingAmount > 0 ? String(remainingAmount) : '');
            setPaymentDate(new Date());
            setMethod('');
            setNotes('');
            setFiles([]);
        }
    }, [open, remainingAmount]);

    const handleSave = async () => {
        if (!amount || !paymentDate) {
            alert('支付金额和支付日期是必填项！');
            return;
        }

        const formData = new FormData();
        formData.append('amount', parseFloat(amount));
        formData.append('payment_date', formatDateFns(paymentDate, 'yyyy-MM-dd'));
        formData.append('method', method);
        formData.append('notes', notes);

        if (files.length > 0) {
            formData.append('image', files[0]);
        }

        try {
            await api.post(`/billing/bills/${recordId}/payments`, formData, {
                headers: {
                    'Content-Type': 'multipart/form-data'
                }
            });
            onSave(); // 这里现在只作为成功后的回调，通知父组件刷新
        } catch (error) {
            console.error('保存支付记录失败:', error);
            alert(`添加失败: ${error.response?.data?.error || error.message}`);
        }
    };

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
                <DialogTitle>添加支付记录</DialogTitle>
                <DialogContent>
                    {/* 【优化】新增金额概览区域 */}
                    <Box sx={{ p: 2, mb: 2, mt: 1, backgroundColor: 'grey.100', borderRadius: 1 }}>
                        <Grid container spacing={1} textAlign="center">
                            <Grid item xs={4}>
                                <Typography variant="body2" color="text.secondary">应付总额</Typography>
                                {/* 【优化】使用格式化函数 */}
                                <Typography variant="h2">¥{formatCurrency(totalDue)}</Typography>
                            </Grid>
                            <Grid item xs={4}>
                                <Typography variant="body2" color="text.secondary">已付总额</Typography>
                                {/* 【优化】使用格式化函数 */}
                                <Typography variant="h2" color="success.main">¥{formatCurrency(totalPaid)}</Typography>
                            </Grid>
                            <Grid item xs={4}>
                                <Typography variant="body2" color="text.secondary">剩余待付</Typography>
                                {/* 【优化】使用格式化函数 */}
                                <Typography variant="h2" color={remainingAmount > 0 ? "error.main" : "inherit"}>
                                    ¥{formatCurrency(remainingAmount)}
                                </Typography>
                            </Grid>
                        </Grid>
                    </Box>

                    <Box component="form" noValidate autoComplete="off">
                        <Grid container spacing={2}>
                            <Grid item xs={12} sm={6}>
                                <TextField
                                    required
                                    fullWidth
                                    label="支付金额"
                                    type="number"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    InputProps={{ startAdornment: '¥' }}
                                />
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <DatePicker
                                    required
                                    label="支付日期"
                                    value={paymentDate}
                                    onChange={(newValue) => setPaymentDate(newValue)}
                                />
                            </Grid>
                            <Grid item xs={12}>
                                <TextField
                                    fullWidth
                                    label="支付方式 (如: 微信, 支付宝, 银行转账)"
                                    value={method}
                                    onChange={(e) => setMethod(e.target.value)}
                                />
                            </Grid>
                            <Grid item xs={12}>
                                <TextField
                                    fullWidth
                                    label="备注"
                                    multiline
                                    rows={3}
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                />
                            </Grid>
                            <Grid item xs={12}>
                                <Box {...getRootProps({ className: 'dropzone' })} sx={{ border: '2px dashed grey', padding: '20px', textAlign: 'center' }}>
                                    <input {...getInputProps()} />
                                    <p>将文件拖到此处，或点击选择文件</p>
                                </Box>
                                <aside style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', marginTop: 16 }}>
                                    {thumbs}
                                </aside>
                            </Grid>
                        </Grid>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={onClose}>取消</Button>
                    <Button onClick={handleSave} variant="contained">保存</Button>
                </DialogActions>
            </Dialog>
        </LocalizationProvider>
    );
};

export default PaymentDialog;