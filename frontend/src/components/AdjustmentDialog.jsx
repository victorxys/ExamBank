// frontend/src/components/AdjustmentDialog.jsx (最终完整版)

import React, { useState, useEffect } from 'react';
import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle,
  TextField, FormControl, InputLabel, Select, MenuItem, Grid,
  Divider, FormControlLabel, Switch
} from '@mui/material';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs from 'dayjs';


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

    // --- 新增 State 用于结算信息 ---
    const [isSettled, setIsSettled] = useState(false);
    const [settlementDate, setSettlementDate] = useState(null);
    const [settlementDetails, setSettlementDetails] = useState('');
    // --------------------------------

    useEffect(() => {
        if (open) { // 只有在弹窗打开时才设置
            if (adjustment) {
                setType(adjustment.adjustment_type);
                setAmount(String(adjustment.amount || ''));
                setDescription(adjustment.description || '');

                // --- 编辑时，填充结算信息 ---
                setIsSettled(adjustment.is_settled || false);
                setSettlementDate(adjustment.settlement_date ? dayjs(adjustment.settlement_date) : null);
                // 假设结算详情存储在 'notes' 字段中
                setSettlementDetails(adjustment.settlement_details?.notes || '');
                // -----------------------------

            } else {
                setType('');
                setAmount('');
                setDescription('');

                // --- 创建时，重置结算信息 ---
                setIsSettled(false);
                setSettlementDate(null);
                setSettlementDetails('');
                // ---------------------------
            }
        }
    }, [adjustment, open]);

    const handleSave = () => {
        if (!type || !amount || !description) {
            alert('请填写所有必填字段！');
            return;
        }
        onSave({
            id: adjustment?.id, // 传回ID
            adjustment_type: type,
            amount: parseFloat(amount),
            description: description,

            // --- 在保存时，加入结算信息 ---
            is_settled: isSettled,
            settlement_date: isSettled && settlementDate ? settlementDate.format('YYYY-MM-DD') : null,
            settlement_details: isSettled ? { notes: settlementDetails, method: 'manual' } : null,
            // ---------------------------------
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
                        <TextField
                            fullWidth
                            label="原因/备注"
                            multiline
                            rows={3}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            disabled={adjustment?.description === '[系统添加] 保证金'}
                            helperText={adjustment?.description === '[系统添加] 保证金' ? "系统生成的备注不能修改" : ""}
                        />
                    </Grid>

                    {/* --- 新增的结算表单部分 --- */}
                    <Grid item xs={12}>
                        <Divider sx={{ my: 1 }} />
                    </Grid>
                    <Grid item xs={12}>
                         <FormControlLabel
                            control={
                                <Switch
                                    checked={isSettled}
                                    onChange={(e) => setIsSettled(e.target.checked)}
                                    name="is_settled"
                                />
                            }
                            label="已结算"
                        />
                    </Grid>
                    {isSettled && (
                        <LocalizationProvider dateAdapter={AdapterDayjs}>
                            <Grid item xs={12} sm={6}>
                                <DatePicker
                                    label="结算日期"
                                    value={settlementDate}
                                    onChange={setSettlementDate}
                                />
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <TextField
                                    fullWidth
                                    label="结算渠道/备注"
                                    value={settlementDetails}
                                    onChange={(e) => setSettlementDetails(e.target.value)}
                                />
                            </Grid>
                        </LocalizationProvider>
                    )}
                    {/* ------------------------- */}

                </Grid>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>取消</Button>
                <Button onClick={handleSave} variant="contained\">保存</Button>
            </DialogActions>
        </Dialog>
    );
};

export default AdjustmentDialog;