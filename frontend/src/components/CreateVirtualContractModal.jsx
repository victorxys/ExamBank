// frontend/src/components/CreateVirtualContractModal.jsx (v6 - with mutual exclusion)

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Dialog, DialogTitle, DialogContent, DialogActions, Button, Grid, TextField,
    Select, MenuItem, InputLabel, FormControl, FormControlLabel, Switch, Box,
    CircularProgress, Alert, Autocomplete, Chip, Typography, FormHelperText,Tooltip
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import { debounce } from 'lodash';
import api from '../api/axios';

const initialState = {
    contract_type: '',
    customer_name: '',
    contact_person: '',
    employee_name: '',
    employee_level: '',
    start_date: null,
    end_date: null,
    notes: '',
    provisional_start_date: null,
    security_deposit_paid: '',
    is_monthly_auto_renew: false,
    introduction_fee: '',
    deposit_amount: '3000',
    management_fee_amount: '',
    deposit_rate: 0.25,
    daily_rate: '',
    management_fee_rate: 0.20,
};

const CreateVirtualContractModal = ({ open, onClose, onSuccess }) => {
    const navigate = useNavigate();
    const [formData, setFormData] = useState(initialState);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [customerOptions, setCustomerOptions] = useState([]);
    const [employeeOptions, setEmployeeOptions] = useState([]);
    const [loadingCustomers, setLoadingCustomers] = useState(false);
    const [loadingEmployees, setLoadingEmployees] = useState(false);

    useEffect(() => {
        if (formData.contract_type === 'maternity_nurse' && formData.provisional_start_date) {
            const provisionalDate = new Date(formData.provisional_start_date);
            if (!isNaN(provisionalDate.getTime())) {
                const newStartDate = provisionalDate;
                const newEndDate = new Date(provisionalDate);
                newEndDate.setDate(newEndDate.getDate() + 26);
                const startTimeChanged = formData.start_date?.getTime() !==newStartDate.getTime();
                const endTimeChanged = formData.end_date?.getTime() !==newEndDate.getTime();
                if (startTimeChanged || endTimeChanged) {
                    setFormData(prev => ({ ...prev, start_date: newStartDate,end_date: newEndDate }));
                }
            }
        } else if (formData.contract_type === 'nanny_trial' && formData.start_date) {
            const startDate = new Date(formData.start_date);
            if (!isNaN(startDate.getTime())) {
                const newEndDate = new Date(startDate);
                newEndDate.setDate(newEndDate.getDate() + 6);
                const endTimeChanged = formData.end_date?.getTime() !==newEndDate.getTime();
                if (endTimeChanged) {
                    setFormData(prev => ({ ...prev, end_date: newEndDate }));
                }
            }
        }
    }, [formData.provisional_start_date, formData.start_date, formData.contract_type]);

    // Restored: Auto-calculate management fee for external substitution contracts
    useEffect(() => {
        if (formData.contract_type === 'external_substitution') {
            const level = parseFloat(formData.employee_level);
            const rate = parseFloat(formData.management_fee_rate);
            if (level > 0 && rate > 0) {
                const management_fee = level * rate;
                setFormData(prev => ({ ...prev, management_fee_amount:management_fee.toFixed(2) }));
            } else {
                setFormData(prev => ({ ...prev, management_fee_amount: '' }));
            }
        }
    }, [formData.contract_type, formData.employee_level, formData.management_fee_rate]);


    const handleChange = (event) => {
        const { name, value } = event.target;
        setFormData(prev => {
            const newFormData = { ...prev, [name]: value };
            if (name === 'contract_type' && value === 'external_substitution'){
                const now = new Date();
                const defaultStartDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 6, 30);
                const defaultEndDate = new Date(defaultStartDate.getTime() + 60 * 60 * 1000);
                newFormData.start_date = defaultStartDate;
                newFormData.end_date = defaultEndDate;
            }
            const level = parseFloat(newFormData.employee_level);
            const type = newFormData.contract_type;
            if (name === 'employee_level' && type === 'nanny') {
                newFormData.management_fee_amount = level > 0 ? (level * 0.10).toFixed(2) : '';
            }
            if (name === 'employee_level' && type === 'nanny_trial') {
                newFormData.daily_rate = level > 0 ? (level / 26).toFixed(2) :'';
            }
            if (type === 'maternity_nurse' && ['employee_level','deposit_rate', 'security_deposit_paid'].includes(name)) {
                const rate = parseFloat(newFormData.deposit_rate);
                const deposit = parseFloat(newFormData.security_deposit_paid);
                if ((name === 'employee_level' || name === 'deposit_rate') &&level > 0 && rate > 0 && rate < 1) {
                    const calculatedDeposit = level / (1 - rate);
                    const calculatedMgmtFee = calculatedDeposit * rate;
                    newFormData.security_deposit_paid = calculatedDeposit.toFixed(2);
                    newFormData.management_fee_amount = calculatedMgmtFee.toFixed(2);
                } else if (name === 'security_deposit_paid' && level > 0 &&deposit > level) {
                    const calculatedRate = 1 - (level / deposit);
                    const calculatedMgmtFee = deposit - level;
                    const predefinedRates = [0.15, 0.20, 0.25];
                    const closestRate = predefinedRates.find(r => Math.abs(r -calculatedRate) < 0.001);
                    newFormData.deposit_rate = closestRate || calculatedRate;
                    newFormData.management_fee_amount = calculatedMgmtFee.toFixed(2);
                }
            }
            return newFormData;
        });
    };

    const handleInputChange = (event) => {
        const { name, value } = event.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleDateChange = (name, newValue) => {
        setFormData(prev => {
            const newFormData = { ...prev, [name]: newValue };
            if (name === 'start_date' && newValue) {
                const newStartDate = new Date(newValue);
                const currentEndDate = prev.end_date ? new Date(prev.end_date): null;
                if (!currentEndDate || currentEndDate < newStartDate) {
                    newFormData.end_date = newStartDate;
                }
            }
            return newFormData;
        });
    };

    const handleSwitchChange = (event) => {
        const { name, checked } = event.target;
        setFormData(prev => ({ ...prev, [name]: checked }));
    };

    const searchCustomers = useCallback(debounce(async (query) => {
        if (query.length < 1) { setCustomerOptions([]); return; }
        setLoadingCustomers(true);
        try {
            const response = await api.get('/billing/customers/search', {params: { q: query } });
            const existing = response.data || [];
            if (!existing.includes(query)) {
                setCustomerOptions([`创建新客户: \"${query}\"`, ...existing]);
            } else {
                setCustomerOptions(existing);
            }
        } catch (err) { console.error("搜索客户失败:", err); }
        finally { setLoadingCustomers(false); }
    }, 300), []);

    const searchEmployees = useCallback(debounce(async (query) => {
        if (query.length < 1) { setEmployeeOptions([]); return; }
        setLoadingEmployees(true);
        try {
            const response = await api.get('/billing/personnel/search', {params: { q: query } });
            const existing = response.data || [];
            if (!existing.some(e => e.name === query)) {
                setEmployeeOptions([{ isNew: true, name: `创建新员工: \"${query}\"` }, ...existing]);
            } else {
                setEmployeeOptions(existing);
            }
        } catch (err) { console.error("搜索员工失败:", err); }
        finally { setLoadingEmployees(false); }
    }, 300), []);

    useEffect(() => {
        if (open) {
            setFormData(initialState);
            setError('');
            setLoading(false);
            setCustomerOptions([]);
            setEmployeeOptions([]);
        }
    }, [open]);

    const handleSubmit = async (event) => {
        event.preventDefault();
        setLoading(true);
        setError('');

        const payload = { ...formData };

        // --- START: 前端校验修复 ---
        // 1. 检查所有合同类型都需要的日期字段
        if (!payload.start_date || !payload.end_date) {
            setError("错误：合同开始日期和结束日期是必填项。");
            setLoading(false);
            return;
        }
        // 2. 专门检查月嫂合同需要的预产期
        if (payload.contract_type === 'maternity_nurse' && !payload.provisional_start_date) {
            setError("错误：月嫂合同需要填写预产期。");
            setLoading(false);
            return;
        }
        // --- END: 前端校验修复 ---

        if (payload.customer_name && payload.customer_name.startsWith('创建新客户:')) {
            payload.customer_name = payload.customer_name.match(/\"(.*?)\"/)[1];
        }
        if (payload.employee_name && payload.employee_name.startsWith('创建新员工:')) {
            payload.employee_name = payload.employee_name.match(/\"(.*?)\"/)[1];
        }
        if (payload.contract_type === 'nanny_trial') {
            payload.employee_level = payload.daily_rate;
        }

        if (payload.start_date) payload.start_date = new Date(payload.start_date).toISOString();
        if (payload.end_date) payload.end_date = new Date(payload.end_date).toISOString();
        if (payload.provisional_start_date) payload.provisional_start_date =new Date(payload.provisional_start_date).toISOString();

        try {
            const response = await api.post('/billing/contracts/virtual',payload);
            const newContractId = response.data.contract_id;
            alert('虚拟合同创建成功！即将跳转到合同详情页...');
            navigate(`/contract/detail/${newContractId}`);
            onClose();
        } catch (err) {
            console.error("创建虚拟合同失败:", err);
            setError(err.response?.data?.error ||'创建失败，请检查所有必填项。');
        } finally {
            setLoading(false);
        }
    };

    // --- START: Mutual Exclusion Logic for Nanny Trial Contracts ---
    const isTrialContract = formData.contract_type === 'nanny_trial';
    const introFeeValue = parseFloat(formData.introduction_fee);
    const mgmtFeeValue = parseFloat(formData.management_fee_amount);

    const isIntroFeeDisabled = isTrialContract && mgmtFeeValue > 0;
    const isMgmtFeeDisabled = isTrialContract && introFeeValue > 0;

    const introFeeHelperText = isIntroFeeDisabled ?"试工合同不能与管理费同时存在" : "";
    const mgmtFeeHelperText = isMgmtFeeDisabled ?"试工合同不能与介绍费同时存在" : "";
    // --- END: Mutual Exclusion Logic ---

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle>新增虚拟合同</DialogTitle>
            <Box component="form" onSubmit={handleSubmit}>
                <DialogContent dividers>
                    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                    <Grid container spacing={3}>
                        <Grid item xs={12} sm={6}>
                            <FormControl fullWidth required>
                                <InputLabel>合同类型</InputLabel>
                                <Select name="contract_type" value={formData.contract_type} label="合同类型" onChange={handleChange}>
                                    <MenuItem value="nanny">育儿嫂合同</MenuItem>
                                    <MenuItem value="maternity_nurse">月嫂合同</MenuItem>
                                    <MenuItem value="nanny_trial">育儿嫂试工合同</MenuItem>
                                    <MenuItem value="external_substitution">外部替班合同</MenuItem>
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField required fullWidth name="employee_level" label="级别 (月薪/元)" type="number" value={formData.employee_level} onChange={handleChange} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <Autocomplete freeSolo filterOptions={(x) => x}options={customerOptions} loading={loadingCustomers} value={formData.customer_name}
                                onInputChange={(event, newInputValue) => {
                                    setFormData(prev => ({ ...prev,customer_name: newInputValue }));
                                    searchCustomers(newInputValue);
                                }}
                                renderInput={(params) => (
                                    <TextField {...params} required label="客户名称" placeholder="搜索或输入新客户"
                                        InputProps={{ ...params.InputProps,endAdornment: (<>{loadingCustomers ? <CircularProgress color="inherit" size={20} /> : null}{params.InputProps.endAdornment}</>), }}
                                    />
                                )}
                            />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <Autocomplete freeSolo filterOptions={(x) => x}options={employeeOptions} loading={loadingEmployees} value={formData.employee_name} getOptionLabel={(option) => (typeof option === 'string' ?option : option.name)}
                                onInputChange={(event, newInputValue) => {
                                    setFormData(prev => ({ ...prev,employee_name: newInputValue }));
                                    searchEmployees(newInputValue);
                                }}
                                renderOption={(props, option) => (
                                    <li {...props} key={option.id || option.name}>
                                        {option.isNew ? <Chip icon={<AddIcon />} label={option.name} size="small" color="primary" variant="outlined" /> :option.name}
                                    </li>
                                )}
                                renderInput={(params) => (
                                    <TextField {...params} required label="员工名称" placeholder="搜索或输入新员工"
                                        InputProps={{ ...params.InputProps,endAdornment: (<>{loadingEmployees ? <CircularProgress color="inherit" size={20} /> : null}{params.InputProps.endAdornment}</>), }}
                                    />
                                )}
                            />
                        </Grid>

                        {formData.contract_type === 'external_substitution' ?(
                            <>
                                <Grid item xs={12} sm={6}><DateTimePicker label="服务开始时间 *" value={formData.start_date} onChange={(v) =>handleDateChange('start_date', v)} sx={{ width: '100%' }} /></Grid>
                                <Grid item xs={12} sm={6}><DateTimePicker label="服务结束时间 *" value={formData.end_date} onChange={(v) =>handleDateChange('end_date', v)} sx={{ width: '100%' }} /></Grid>
                            </>
                        ) : formData.contract_type === 'maternity_nurse' ? (
                            <>
                                <Grid item xs={12} sm={6}><DatePicker label="预产期 *" value={formData.provisional_start_date} onChange={(v) =>handleDateChange('provisional_start_date', v)} sx={{ width: '100%' }} /></Grid>
                                <Grid item xs={12} sm={6}><DatePicker label="合同结束日期 *" value={formData.end_date} onChange={(v) =>handleDateChange('end_date', v)} sx={{ width: '100%' }}helperText="选择预产期后自动计算，可手动修改" /></Grid>
                            </>
                        ) : (
                            <>
                                <Grid item xs={12} sm={6}><DatePicker label="合同开始日期 *" value={formData.start_date} onChange={(v) =>handleDateChange('start_date', v)} sx={{ width: '100%' }} /></Grid>
                                <Grid item xs={12} sm={6}><DatePicker label="合同结束日期 *" value={formData.end_date} onChange={(v) =>handleDateChange('end_date', v)} sx={{ width: '100%' }} /></Grid>
                            </>
                        )}

                        {formData.contract_type === 'maternity_nurse' && (
                            <>
                                <Grid item xs={12} sm={4}>
                                    <FormControl fullWidth>
                                        <InputLabel>保证金比例</InputLabel>
                                        <Select name="deposit_rate" label="保证金比例" value={formData.deposit_rate} onChange={handleChange}>
                                            <MenuItem value={0.25}>25%</MenuItem>
                                            <MenuItem value={0.20}>20%</MenuItem>
                                            <MenuItem value={0.15}>15%</MenuItem>
                                            {![0.15, 0.20, 0.25].includes(formData.deposit_rate) && <MenuItem value={formData.deposit_rate}>自定义:{(formData.deposit_rate * 100).toFixed(2)}%</MenuItem>}
                                        </Select>
                                    </FormControl>
                                </Grid>
                                <Grid item xs={12} sm={4}><TextField fullWidthname="security_deposit_paid" label="客交保证金 (元)" type="number" value={formData.security_deposit_paid} onChange={handleChange} /></Grid>
                                <Grid item xs={12} sm={4}><TextField fullWidthdisabled name="management_fee_amount" label="管理费 (自动计算)" type="number"value={formData.management_fee_amount} /></Grid>
                                <Grid item xs={12}><TextField fullWidth name="deposit_amount" label="定金 (元)" type="number" value={formData.deposit_amount} onChange={handleInputChange} helperText="默认为3000元" /></Grid>
                            </>
                        )}

                        {formData.contract_type === 'external_substitution' &&(
                            <>
                                <Grid item xs={12} sm={6}>
                                    <TextField fullWidth name="management_fee_rate" label="管理费率 (%)" type="number" value={formData.management_fee_rate * 100}
                                        onChange={(e) => setFormData(prev =>({ ...prev, management_fee_rate: e.target.value / 100 }))}
                                        helperText="默认20%"
                                    />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <TextField fullWidth disabled name="management_fee_amount" label="管理费 (自动计算)" value={formData.management_fee_amount} />
                                </Grid>
                            </>
                        )}

                        {formData.contract_type === 'nanny' && (
                            <>
                                <Grid item xs={12} sm={6}>
                                    <TextField fullWidth name="introduction_fee" label="介绍费 (元)" type="number" value={formData.introduction_fee} onChange={handleInputChange} />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <TextField fullWidth name="management_fee_amount" label="管理费 (元/月)" type="number" value={formData.management_fee_amount} onChange={handleInputChange} helperText="默认按级别10%计算，可修改" />
                                </Grid>
                                <Grid item xs={12}>
                                    <FormControlLabel control={<Switch checked={formData.is_monthly_auto_renew} onChange={handleSwitchChange} name="is_monthly_auto_renew" />} label="是否自动续签" />
                                </Grid>
                            </>
                        )}

                        {formData.contract_type === 'nanny_trial' && (
                            <>
                                <Grid item xs={12} sm={6}>
                                    <TextField required fullWidth name="daily_rate" label="日薪 (元)" type="number" value={formData.daily_rate}onChange={handleInputChange} helperText="级别/26，可手动修改" />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <Tooltip title={isIntroFeeDisabled ?"试工合同不能与管理费同时存在" : ""}>
                                        <TextField
                                            fullWidth name="introduction_fee"label="介绍费 (元)" type="number"
                                            value={formData.introduction_fee}
                                            onChange={handleInputChange}
                                            disabled={isIntroFeeDisabled}
                                            error={isIntroFeeDisabled}
                                            helperText={introFeeHelperText}
                                        />
                                    </Tooltip>
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <Tooltip title={isMgmtFeeDisabled ?"试工合同不能与介绍费同时存在" : ""}>
                                        <TextField
                                            fullWidth name="management_fee_amount" label="管理费 (元)" type="number"
                                            value={formData.management_fee_amount}
                                            onChange={handleInputChange}
                                            disabled={isMgmtFeeDisabled}
                                            error={isMgmtFeeDisabled}
                                            helperText={mgmtFeeHelperText}
                                        />
                                    </Tooltip>
                                </Grid>
                            </>
                        )}

                        <Grid item xs={12}><TextField fullWidth name="notes" label="备注" multiline rows={3} value={formData.notes} onChange={handleInputChange} /></Grid>
                    </Grid>
                </DialogContent>
                <DialogActions sx={{ p: 3 }}>
                    <Button onClick={onClose}>取消</Button>
                    <Button type="submit" variant="contained"disabled={loading}>
                        {loading ? <CircularProgress size={24} /> : '创建合同'}
                    </Button>
                </DialogActions>
            </Box>
        </Dialog>
    );
};

export default CreateVirtualContractModal;