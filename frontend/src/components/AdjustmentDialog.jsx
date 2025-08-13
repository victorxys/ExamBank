// frontend/src/components/AdjustmentDialog.jsx (最终完整版)

import React, { useState, useEffect } from 'react';
import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle,
  TextField, FormControl, InputLabel, Select, MenuItem, Grid
} from '@mui/material';

// **核心修正**: 定义与后端完全一致的类型
export const AdjustmentTypes = {
    customer_increase: { label: '客增加款', type: 'customer', effect: 1 },
    customer_decrease: { label: '退客户款', type: 'customer', effect: -1 },
    customer_discount: { label: '优惠', type: 'customer', effect: -1 },
    employee_increase: { label: '萌嫂增款', type: 'employee', effect: 1 },
    employee_decrease: { label: '减萌嫂款', type: 'employee', effect: -1 },
    deferred_fee: { label: '上期顺延费用', type: 'customer', effect: 1 },
};

const AdjustmentDialog = ({ open, onClose, onSave, adjustment = null, typeFilter = 'all' }) => {
    const [type, setType] = useState('');
    const [amount, setAmount] = useState('');
    const [description, setDescription] = useState('');

    useEffect(() => {
        if (open) { // 只有在弹窗打开时才设置
            if (adjustment) {
                setType(adjustment.adjustment_type);
                setAmount(String(adjustment.amount || ''));
                setDescription(adjustment.description || '');
            } else {
                setType('');
                setAmount('');
                setDescription('');
            }
        }
    }, [adjustment, open]);

    const handleSave = () => {
        if (!type || !amount || !description) {
            alert('请填写所有字段！');
            return;
        }
        onSave({
            id: adjustment?.id || `temp_${Date.now()}`,
            adjustment_type: type,
            amount: parseFloat(amount),
            description: description,
        });
        onClose();
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>{adjustment ? '编辑' : '添加'}财务调整项</DialogTitle>
            <DialogContent>
                <Grid container spacing={2} sx={{ pt: 2 }}>
                    <Grid item xs={12}>
                        <FormControl fullWidth>
                            <InputLabel>调整类型</InputLabel>
                            <Select value={type} label="调整类型" onChange={(e) => setType(e.target.value)}>
                                {/* **核心修正**: 根据 filter 动态渲染选项 */}
                                {Object.entries(AdjustmentTypes)
                                    .filter(([key, config]) => typeFilter === 'all' || config.type === typeFilter)
                                    .map(([key, config]) => (
                                        <MenuItem key={key} value={key}>{config.label}</MenuItem>
                                    ))}
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12}>
                        <TextField fullWidth label="调整金额" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} InputProps={{ startAdornment: '¥' }} />
                    </Grid>
                    <Grid item xs={12}>
                        <TextField fullWidth label="原因/备注" multiline rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
                    </Grid>
                </Grid>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>取消</Button>
                <Button onClick={handleSave} variant="contained">保存</Button>
            </DialogActions>
        </Dialog>
    );
};

export default AdjustmentDialog;