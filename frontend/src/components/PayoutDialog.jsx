// frontend/src/components/PayoutDialog.jsx

import React, { useState, useEffect } from 'react';
import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle,
  TextField, Grid, Box, Typography, Divider,
  Radio, RadioGroup, FormControlLabel, FormControl, FormLabel, Chip
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import { format as formatDateFns } from 'date-fns';
import { useDropzone } from 'react-dropzone';
import api from '../api/axios';

const formatCurrency = (value) => {
    const num = parseFloat(value);
    if (isNaN(num)) {
        return '0.00';
    }
    return num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const PayoutDialog = ({ open, onClose, onSave, totalDue = 0, totalPaidOut = 0, recordType, recordId }) => {
    const [amount, setAmount] = useState('');
    const [payoutDate, setPayoutDate] = useState(new Date());
    const [method, setMethod] = useState('');
    const [notes, setNotes] = useState('');
    const [payer, setPayer] = useState('公司代付'); // 新增 state
    const [files, setFiles] = useState([]);

    // 【新增】常用支付方式
    const commonMethods = ['银行转账', '微信', '支付宝'];

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
        <div style={{ display: 'inline-flex', borderRadius: 2, border: '1px solid #eaeaea', marginBottom: 8, marginRight: 8,width: 100, height: 100, padding: 4, boxSizing: 'border-box' }} key={file.name}>
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

    const remainingAmount = (parseFloat(totalDue) - parseFloat(totalPaidOut));

    useEffect(() => {
        if (open) {
            setAmount(remainingAmount > 0 ? String(remainingAmount.toFixed(2)) : '');
            setPayoutDate(new Date());
            setMethod('');
            setNotes('');
            setPayer(''); // 重置为默认值
            setFiles([]);
        }
    }, [open, remainingAmount]);

    const handleSave = async () => {
        if (!amount || !payoutDate) {
            alert('发放金额和日期是必填项！');
            return;
        }

        const formData = new FormData();
        formData.append('amount', parseFloat(amount));
        formData.append('payout_date', formatDateFns(payoutDate, 'yyyy-MM-dd'));
        formData.append('method', method);
        formData.append('notes', notes);
        formData.append('payer', payer);

        if (files.length > 0) {
            formData.append('image', files[0]);
        }

        try {
            await api.post(`/billing/payrolls/${recordId}/payouts`, formData, {
                headers: {
                    'Content-Type': 'multipart/form-data'
                }
            });
            onSave(); // 这里现在只作为成功后的回调，通知父组件刷新
        } catch (error) {
            console.error('保存工资发放记录失败:', error);
            alert(`添加失败: ${error.response?.data?.error || error.message}`);
        }
    };

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
                <DialogTitle>记录工资发放</DialogTitle>
                <DialogContent>
                    <Box sx={{ p: 2, mb: 2, mt: 1, backgroundColor: 'grey.100', borderRadius: 1 }}>
                        <Grid container spacing={1} textAlign="center">
                            <Grid item xs={4}>
                                <Typography variant="body2" color="text.secondary">应发总额</Typography>
                                <Typography variant="h2">¥{formatCurrency(totalDue)}</Typography>
                            </Grid>
                            <Grid item xs={4}>
                                <Typography variant="body2" color="text.secondary">已发总额</Typography>
                                <Typography variant="h2" color="success.main">¥{formatCurrency(totalPaidOut)}</Typography>
                            </Grid>
                            <Grid item xs={4}>
                                <Typography variant="body2" color="text.secondary">剩余应发</Typography>
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
                                    label="发放金额"
                                    type="number"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    InputProps={{ startAdornment: '¥' }}
                                />
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <DatePicker
                                    required
                                    label="发放日期"
                                    value={payoutDate}
                                    onChange={(newValue) => setPayoutDate(newValue)}
                                />
                            </Grid>
                            <Grid item xs={12}>
                                <FormControl component="fieldset">
                                  <FormLabel component="legend">付款方</FormLabel>
                                  <RadioGroup
                                    row
                                    aria-label="payer"
                                    name="payer"
                                    value={payer}
                                    onChange={(e) => setPayer(e.target.value)}
                                  >
                                    <FormControlLabel value="客户支付" control={<Radio />} label="客户支付" />
                                    <FormControlLabel value="公司代付" control={<Radio />} label="公司代付" />
                                  </RadioGroup>
                                </FormControl>
                            </Grid>
                            <Grid item xs={12}>
                                <TextField
                                    fullWidth
                                    label="发放方式"
                                    value={method}
                                    onChange={(e) => setMethod(e.target.value)}
                                />
                                {/* 【新增】常用支付方式的快捷Chip */}
                                <Box sx={{ mt: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                    {commonMethods.map((m) => (
                                        <Chip
                                            key={m}
                                            label={m}
                                            onClick={() => setMethod(m)}
                                            variant="outlined"
                                            size="small"
                                            clickable
                                        />
                                    ))}
                                </Box>
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
                                <Box {...getRootProps({ className: 'dropzone' })} sx={{ border: '2px dashed grey', padding:'20px', textAlign: 'center' }}>
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

export default PayoutDialog;