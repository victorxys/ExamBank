// frontend/src/components/EditContractModal.jsx

import React, { useState, useEffect, useRef } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions, Button, Grid, TextField,
    CircularProgress, Alert, Box, FormControlLabel, Switch, FormControl, InputLabel, MenuItem, Select,
    InputAdornment, Autocomplete, Typography
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers';
import api from '../api/axios';

const serviceContentOptions = [
    "婴幼儿养护",
    "家务服务",
    "产妇护理",
    "新生儿护理",
];

const serviceTypeOptions = [
    "全日住家型",
    "日间照料型",
    "夜间照料型",
];

const initialState = {
    template_id: '',
    contract_type: '',
    customer_id: null,
    service_personnel_id: null,
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
    service_content: '',
    service_type: '',
    is_auto_renew: false,
    attachment_content: '',
    customer_id_card: '',
    customer_address: '',
    employee_id_card: '',
    employee_address: '',
    // 只读字段，但需要从后端获取并显示
    customer_name: '',
    employee_name: '',
};

const EditContractModal = ({ open, onClose, onSuccess, contractId }) => {
    const [formData, setFormData] = useState(initialState);
    const [originalContract, setOriginalContract] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [templates, setTemplates] = useState([]);
    const [loadingTemplates, setLoadingTemplates] = useState(false);

    // Autocomplete states for customer/employee (read-only in edit mode)
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [selectedEmployee, setSelectedEmployee] = useState(null);
    const [customerInputValue, setCustomerInputValue] = useState('');
    const [employeeInputValue, setEmployeeInputValue] = useState('');

    const searchTimeout = useRef(null); // For debouncing search

    useEffect(() => {
        if (open && contractId) {
            const fetchAllData = async () => {
                setLoading(true);
                setLoadingTemplates(true);
                setError('');
                try {
                    const [contractRes, templatesRes] = await Promise.all([
                        api.get(`/contracts/${contractId}`),
                        api.get('/contract_templates?all=true')
                    ]);
                    
                    console.log('Fetched contract data:', contractRes.data);
                    console.log('Fetched templates data:', templatesRes.data);

                    const data = contractRes.data;
                    setOriginalContract(data);
                    setTemplates(templatesRes.data.templates || []);

                    const newFormData = {
                        ...initialState, // Start with a clean slate
                        ...data, // Populate with fetched data
                        start_date: data.start_date ? new Date(data.start_date) : null,
                        end_date: data.end_date ? new Date(data.end_date) : null,
                        provisional_start_date: data.provisional_start_date ? new Date(data.provisional_start_date) : null,
                        // Ensure numeric fields are treated as strings for TextField value prop
                        employee_level: data.employee_level || '',
                        daily_rate: data.daily_rate || '',
                        introduction_fee: data.introduction_fee || '',
                        deposit_amount: data.deposit_amount || '3000',
                        management_fee_amount: data.management_fee_amount || '',
                        deposit_rate: data.deposit_rate ? parseFloat(data.deposit_rate) : 0.25,
                        management_fee_rate: data.management_fee_rate !== undefined && data.management_fee_rate !== '' ? parseFloat(data.management_fee_rate) : 0,
                    };
                    setFormData(newFormData);
                    
                    // 初始化预产期 ref，防止编辑时立即覆盖结束日期
                    if (data.provisional_start_date) {
                        prevProvisionalDateRef.current = new Date(data.provisional_start_date).getTime();
                    }
                    
                    console.log('Initial formData after setting:', newFormData);

                    // Set selected customer/employee for display (they are read-only)
                    if (data.customer_id && data.customer_name) {
                        setSelectedCustomer({ id: data.customer_id, name: data.customer_name });
                        setCustomerInputValue(data.customer_name);
                    }
                    if (data.service_personnel_id && data.employee_name) {
                        setSelectedEmployee({ id: data.service_personnel_id, name: data.employee_name });
                        setEmployeeInputValue(data.employee_name);
                    }

                } catch (err) {
                    setError('无法加载初始数据。');
                } finally {
                    setLoading(false);
                    setLoadingTemplates(false);
                }
            };
            fetchAllData();
        }
    }, [open, contractId]);

    // 联动逻辑1: 合同类型变化时，自动选择模板
    useEffect(() => {
        console.log('Contract type changed or templates updated. formData.contract_type:', formData.contract_type, 'templates:', templates);
        if (formData.contract_type && templates.length > 0) {
            const matchedTemplate = templates.find(t => t.contract_type === formData.contract_type);
            console.log('Matched template:', matchedTemplate);
            if (matchedTemplate && matchedTemplate.id !== formData.template_id) {
                const newFormData = { ...formData, template_id: matchedTemplate.id };
                setFormData(newFormData);
                console.log('Updated formData with new template_id:', newFormData);
            }
        }
    }, [formData.contract_type, templates]);

    // 联动逻辑2: 薪酬、费率等变化时，自动计算相关金额
    // 联动逻辑2: 薪酬、费率等变化时，自动计算相关金额
    useEffect(() => {
        const level = parseFloat(formData.employee_level);
        const type = formData.contract_type;
        const updates = {};

        if (isNaN(level) || level <= 0) {
            // ...
            return;
        }

        if (type === 'nanny') {
            const rate = parseFloat(formData.management_fee_rate);
            if (rate >= 0) { 
                updates.management_fee_amount = (level * rate).toFixed(2);
            }
            // --- 新增：育儿嫂合同的保证金等于其月薪 ---
            updates.security_deposit_paid = level.toFixed(2);
        }
        else if (type === 'maternity_nurse') {
            const rate = parseFloat(formData.deposit_rate);
            if (rate > 0 && rate < 1) {
                const calculatedDeposit = level / (1 - rate);
                const calculatedMgmtFee = calculatedDeposit * rate;
                updates.security_deposit_paid = calculatedDeposit.toFixed(2);
                updates.management_fee_amount = calculatedMgmtFee.toFixed(2);
            }
        }
        else if (type === 'external_substitution') {
            const rate = parseFloat(formData.management_fee_rate);
            if (rate > 0) {
                const management_fee = level * rate;
                updates.management_fee_amount = management_fee.toFixed(2);
            } else {
                updates.management_fee_amount = '';
            }
        }

        if (Object.keys(updates).length > 0) {
            setFormData(prev => ({ ...prev, ...updates }));
        }

    }, [formData.employee_level, formData.contract_type, formData.deposit_rate, formData.management_fee_rate]);

    // 追踪预产期的上一个值，只在预产期变化时自动计算日期
    const prevProvisionalDateRef = useRef(null);

    // 月嫂合同预产期联动合同日期
    useEffect(() => {
        if (formData.contract_type === 'maternity_nurse' && formData.provisional_start_date) {
            const provisionalDate = new Date(formData.provisional_start_date);
            if (!isNaN(provisionalDate.getTime())) {
                const provisionalTime = provisionalDate.getTime();
                const prevTime = prevProvisionalDateRef.current;

                // 只在预产期首次设置或变化时自动计算日期
                if (prevTime !== provisionalTime) {
                    prevProvisionalDateRef.current = provisionalTime;
                    const newStartDate = provisionalDate;
                    const newEndDate = new Date(provisionalDate);
                    newEndDate.setDate(newEndDate.getDate() + 26); // 假设月嫂合同默认26天
                    setFormData(prev => ({ ...prev, start_date: newStartDate, end_date: newEndDate }));
                }
            }
        }
    }, [formData.provisional_start_date, formData.contract_type]);

    // 育儿嫂试工合同开始日期联动结束日期
    useEffect(() => {
        if (formData.contract_type === 'nanny_trial' && formData.start_date) {
            const startDate = new Date(formData.start_date);
            if (!isNaN(startDate.getTime())) {
                const newEndDate = new Date(startDate);
                newEndDate.setDate(newEndDate.getDate() + 7); // 试工合同默认7天
                const endTimeChanged = formData.end_date?.getTime() !== newEndDate.getTime();
                if (endTimeChanged) {
                    setFormData(prev => ({ ...prev, end_date: newEndDate }));
                }
            }
        }
    }, [formData.start_date, formData.contract_type, formData.end_date]);

    // 育儿嫂合同自动月签联动结束日期
    useEffect(() => {
        if (formData.contract_type === 'nanny' && formData.is_monthly_auto_renew && formData.start_date) {
            const startDate = new Date(formData.start_date);
            if (!isNaN(startDate.getTime())) {
                const year = startDate.getFullYear();
                const month = startDate.getMonth();
                const lastDayOfMonth = new Date(year, month + 1, 0);
                const currentEndDate = formData.end_date ? new Date(formData.end_date) : null;
                if (!currentEndDate || currentEndDate.getTime() !== lastDayOfMonth.getTime()) {
                    setFormData(prev => ({ ...prev, end_date: lastDayOfMonth }));
                }
            }
        }
    }, [formData.is_monthly_auto_renew, formData.start_date, formData.contract_type, formData.end_date]);

    // --- 新增：试工合同附件内容自动生成逻辑 (V2 - 管理费率不为0时始终显示) ---
    useEffect(() => {
        if (formData.contract_type === 'nanny_trial') {
            const dailyRate = parseFloat(formData.daily_rate);

            if (!isNaN(dailyRate) && dailyRate > 0) {
                const provisionalMonthlySalary = dailyRate * 26;
                const roundedMonthlySalary = Math.round(provisionalMonthlySalary / 100) * 100;

                const employeeName = formData.employee_name || '服务人员';
                const managementFeeRate = parseFloat(formData.management_fee_rate);
                const introductionFee = parseFloat(formData.introduction_fee);

                let managementFeeNotePart = '';
                let feeIntroducePart = '';
                
                // 判断是否需要显示管理费
                if (!isNaN(managementFeeRate) && managementFeeRate > 0) {
                    // 管理费率不为0时，显示管理费说明
                    managementFeeNotePart = `丙方管理费计算方法为：${roundedMonthlySalary}元 × ${(managementFeeRate * 100).toFixed(0)}% ÷ 30天 × 阿姨服务时间段。`;
                    feeIntroducePart = `甲方需支付阿姨实际出勤天数的劳务费和丙方管理费`;
                } else {
                    // 管理费率为0时，不显示管理费
                    managementFeeNotePart = '';
                    feeIntroducePart = `甲方只需支付阿姨实际出勤天数的劳务费`;
                }

                const attachmentContentTemplate =
                    `乙方${employeeName}阿姨上户，${feeIntroducePart}:
阿姨劳务费计算方法为：${roundedMonthlySalary}元 ÷ 26天 × 阿姨实际出勤天数；
${managementFeeNotePart}`;

                setFormData(prev => ({ ...prev, attachment_content: attachmentContentTemplate }));
            }
        }
    }, [formData.contract_type, formData.daily_rate, formData.management_fee_rate, formData.introduction_fee, formData.employee_name]);
    // --- 新增结束 ---


    const handleChange = (event) => {
        const { name, value, checked, type } = event.target;
        setFormData(prev => {
            const newFormData = { ...prev, [name]: type === 'checkbox' ? checked : value };

            // --- 新增：当合同类型改变时，设置默认值 ---
            if (name === 'contract_type') {
                if (value === 'nanny_trial') {
                    newFormData.management_fee_rate = 0;
                    newFormData.introduction_fee = '2000';
                }
            }
            // --- 新增结束 ---

            // 当月嫂合同的保证金或比例变化时，反向计算
            if (newFormData.contract_type === 'maternity_nurse' && name === 'security_deposit_paid') {
                const deposit = parseFloat(value);
                const level = parseFloat(newFormData.employee_level);
                if (level > 0 && deposit > level) {
                    const calculatedRate = 1 - (level / deposit);
                    const calculatedMgmtFee = deposit - level;
                    const predefinedRates = [0.15, 0.20, 0.25];
                    const closestRate = predefinedRates.find(r => Math.abs(r - calculatedRate) < 0.001);

                    newFormData.deposit_rate = closestRate || calculatedRate;
                    newFormData.management_fee_amount = calculatedMgmtFee.toFixed(2);
                }
            }

            return newFormData;
        });
    };

    const handleDateChange = (name, newValue) => {
        setFormData(prev => ({ ...prev, [name]: newValue }));
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        setLoading(true);
        setError('');

        // --- 核心修复：使用一个辅助函数来正确格式化日期，避免时区问题 ---
        const formatDateForBackend = (date) => {
            if (!date) return null;
            const d = new Date(date);
            // 通过减去时区偏移量来“欺骗” toISOString，使其输出我们想要的本地日期
            d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
            return d.toISOString().split('T')[0];
        };

        const payload = {
            ...formData,
            start_date: formatDateForBackend(formData.start_date),
            end_date: formatDateForBackend(formData.end_date),
            provisional_start_date: formatDateForBackend(formData.provisional_start_date),
            management_fee_rate: parseFloat(formData.management_fee_rate),
            deposit_rate: parseFloat(formData.deposit_rate),
        };

        try {
            await api.put(`/contracts/${contractId}`, payload);
            onSuccess();
        } catch (err) {
            setError(err.response?.data?.error || '更新失败，请重试。');
        } finally {
            setLoading(false);
        }
    };
    
    const isReadOnly = originalContract?.status !== 'pending';

    // Helper for conditional rendering of fields
    const isNanny = formData.contract_type === 'nanny';
    const isMaternityNurse = formData.contract_type === 'maternity_nurse';
    const isNannyTrial = formData.contract_type === 'nanny_trial';
    const isExternalSubstitution = formData.contract_type === 'external_substitution';

    // Mutual exclusivity for introduction_fee and management_fee_rate for nanny_trial
    // 注意：编辑模式下，允许两个字段都有值，不强制互斥
    const introFeeValue = parseFloat(formData.introduction_fee);
    const mgmtFeeRateValue = parseFloat(formData.management_fee_rate);

    // 编辑模式下不启用互斥逻辑，允许用户自由编辑
    const isIntroFeeDisabled = false;
    const isMgmtRateDisabled = false;


    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle>编辑合同</DialogTitle>
            <Box component="form" onSubmit={handleSubmit}>
                <DialogContent dividers>
                    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                    {loading && !originalContract ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}><CircularProgress /></Box>
                    ) : (
                        <Grid container spacing={3}>
                            {isReadOnly && (
                                <Grid item xs={12}>
                                    <Alert severity="info">当前合同状态为 '{originalContract?.status}'，只允许修改备注等非核心字段。</Alert>
                                </Grid>
                            )}

                            {/* 合同类型和模板 */}
                            <Grid item xs={12} sm={6}>
                                <FormControl fullWidth required disabled> {/* 合同类型始终只读 */}
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
                                <FormControl fullWidth required disabled={isReadOnly || loadingTemplates}>
                                    <InputLabel>合同模板</InputLabel>
                                    <Select name="template_id" value={formData.template_id} label="合同模板" onChange={handleChange}>
                                        {loadingTemplates ? (
                                            <MenuItem value="" disabled><em>加载中...</em></MenuItem>
                                        ) : (
                                            templates
                                                .filter(t => t.contract_type === formData.contract_type) // Filter by selected contract type
                                                .map(template => (
                                                    <MenuItem key={template.id} value={template.id}>
                                                        {template.template_name} (v{template.version})
                                                    </MenuItem>
                                                ))
                                        )}
                                    </Select>
                                </FormControl>
                            </Grid>

                            {/* 客户和员工信息 (只读) */}
                            <Grid item xs={12} sm={6}>
                                <TextField fullWidth label="客户姓名" value={formData.customer_name} disabled />
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <TextField fullWidth label="员工名称" value={formData.employee_name} disabled />
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <TextField fullWidth name="customer_id_card" label="客户身份证号" value={formData.customer_id_card} onChange={handleChange} disabled={isReadOnly} />
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <TextField fullWidth name="employee_id_card" label="员工身份证号" value={formData.employee_id_card} onChange={handleChange} disabled={isReadOnly} />
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <TextField fullWidth name="customer_address" label="客户地址" value={formData.customer_address} onChange={handleChange} disabled={isReadOnly} />
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <TextField fullWidth name="employee_address" label="员工地址" value={formData.employee_address} onChange={handleChange} disabled={isReadOnly} />
                            </Grid>

                            {/* 日期字段 */}
                            {isExternalSubstitution ? (
                                <>
                                    <Grid item xs={12} sm={6}><DatePicker label="服务开始时间 *" value={formData.start_date} onChange={(v) => handleDateChange('start_date', v)} sx={{ width: '100%' }} disabled={isReadOnly} /></Grid>
                                    <Grid item xs={12} sm={6}><DatePicker label="服务结束时间 *" value={formData.end_date} onChange={(v) => handleDateChange('end_date', v)} sx={{ width: '100%' }} disabled={isReadOnly} /></Grid>
                                </>
                            ) : isMaternityNurse ? (
                                <>
                                    <Grid item xs={12} sm={6}><DatePicker label="预产期 *" value={formData.provisional_start_date} onChange= {(v) => handleDateChange('provisional_start_date', v)} sx={{ width: '100%' }} disabled={isReadOnly} /></Grid>
                                    <Grid item xs={12} sm={6}><DatePicker label="合同结束日期 *" value={formData.end_date} onChange={(v) => handleDateChange('end_date', v)} sx={{ width: '100%' }} helperText="选择预产期后自动计算，可手动修改" disabled={isReadOnly} /></Grid>
                                </>
                            ) : (
                                <>
                                    <Grid item xs={12} sm={6}><DatePicker label="合同开始日期 *" value={formData.start_date} onChange={(v) => handleDateChange('start_date', v)} sx={{ width: '100%' }} disabled={isReadOnly} /></Grid>
                                    <Grid item xs={12} sm={6}><DatePicker label="合同结束日期 *" value={formData.end_date} onChange={(v) => handleDateChange('end_date', v)} sx={{ width: '100%' }} disabled={isReadOnly} /></Grid>
                                </>
                            )}

                            {/* 薪酬和费用字段 */}
                            {isMaternityNurse && (
                                <>
                                    <Grid item xs={12} sm={4}><TextField required fullWidth name="employee_level" label="级别 (月薪/元)" type ="number" value={formData.employee_level} onChange={handleChange} onWheel={(e) => e.target.blur()} disabled={isReadOnly} /></Grid>
                                    <Grid item xs={12} sm={4}><TextField fullWidth name="deposit_amount" label="定金 (元)" type="number" value={formData.deposit_amount} onChange={handleChange} helperText="默认为3000元" onWheel={(e) => e.target.blur()} disabled={isReadOnly} /></ Grid>
                                    <Grid item xs={12} sm={4}>
                                        <FormControl fullWidth disabled={isReadOnly}>
                                            <InputLabel>保证金比例</InputLabel>
                                            <Select name="deposit_rate" label="保证金比例" value={formData.deposit_rate} onChange={handleChange}>
                                                <MenuItem value={0.25}>25%</MenuItem>
                                                <MenuItem value={0.20}>20%</MenuItem>
                                                <MenuItem value={0.15}>15%</MenuItem>
                                                <MenuItem value={0.10}>10%</MenuItem>
                                                {![0.15, 0.20, 0.25, 0.10].includes(formData.deposit_rate) && <MenuItem value= {formData.deposit_rate}>自定义:{(formData.deposit_rate * 100).toFixed(2)}%</MenuItem>}
                                            </Select>
                                        </FormControl>
                                    </Grid>
                                    <Grid item xs={12} sm={6}><TextField fullWidth name="security_deposit_paid" label="客交保证金 (元)" type= "number" value={formData.security_deposit_paid} onChange={handleChange} onWheel={(e) => e.target.blur()} disabled={isReadOnly} /></Grid>
                                    <Grid item xs={12} sm={6}><TextField fullWidth disabled name="management_fee_amount" label="管理费 (自动计算)" type="number" value={formData.management_fee_amount} /></Grid>
                                </>
                            )}

                            {isNanny && (
                                <>
                                    <Grid item xs={12} sm={3}>
                                        <TextField required fullWidth name="employee_level" label="级别 (月薪/元)" type="number" value={formData.employee_level} onChange={handleChange} onWheel={(e) => e.target.blur()} disabled={isReadOnly}/>
                                    </Grid>
                                    <Grid item xs={12} sm={3}>
                                        <TextField fullWidth name="introduction_fee" label="介绍费 (元)" type="number" value={formData. introduction_fee} onChange={handleChange} onWheel={(e) => e.target.blur()} disabled={isReadOnly}/>
                                    </Grid>
                                    <Grid item xs={12} sm={3}>
                                        <TextField
                                            fullWidth
                                            name="management_fee_rate"
                                            label="管理费率 (%)"
                                            type="number"
                                            value={formData.management_fee_rate * 100}
                                            onChange={(e) => {
                                                const rate = parseFloat(e.target.value);
                                                setFormData(prev => ({ ...prev, management_fee_rate: isNaN(rate) ? 0 : rate / 100 }));
                                            }}
                                            onWheel={(e) => e.target.blur()}
                                            InputProps={{
                                                endAdornment: <InputAdornment position="end">%</InputAdornment>,
                                            }}
                                            disabled={isReadOnly}
                                        />
                                    </Grid>
                                    <Grid item xs={12} sm={3}>
                                        <TextField
                                            fullWidth
                                            disabled
                                            name="management_fee_amount"
                                            label="管理费 (自动计算)"
                                            type="number"
                                            value={formData.management_fee_amount}
                                        />
                                    </Grid>
                                </>
                            )}

                            {isNannyTrial && (
                                <>
                                    <Grid item xs={12} sm={6}>
                                        <TextField required fullWidth name="daily_rate" label="日薪(元)" type="number" value={formData. daily_rate} onChange={handleChange} helperText="级别/26，可手动修改" onWheel={(e) => e.target.blur()} disabled={isReadOnly} />
                                    </Grid>
                                    <Grid item xs={12} sm={6}>
                                        <TextField
                                            fullWidth name="introduction_fee" label="介绍费 (元)" type="number"
                                            value={formData.introduction_fee}
                                            onChange={handleChange}
                                            disabled={isReadOnly || isIntroFeeDisabled}
                                            error={isIntroFeeDisabled}
                                            helperText={isIntroFeeDisabled ? "不能与管理费率同时存在" : ""}
                                            onWheel={(e) => e.target.blur()}
                                        />
                                    </Grid>
                                    <Grid item xs={12} sm={6}>
                                        <TextField
                                            fullWidth
                                            name="management_fee_rate"
                                            label="管理费率 (%)"
                                            type="number"
                                            value={formData.management_fee_rate * 100}
                                            onChange={(e) => {
                                                const rate = parseFloat(e.target.value);
                                                setFormData(prev => ({ ...prev, management_fee_rate: isNaN(rate) ? 0 : rate / 100 }));
                                            }}
                                            disabled={isReadOnly || isMgmtRateDisabled}
                                            error={isMgmtRateDisabled}
                                            helperText={isMgmtRateDisabled ? "不能与介绍费同时存在" : ""}
                                            onWheel={(e) => e.target.blur()}
                                            InputProps={{
                                                endAdornment: <InputAdornment position="end">%</InputAdornment>,
                                            }}
                                        />
                                    </Grid>
                                </>
                            )}

                            {isExternalSubstitution && (
                                <>
                                    <Grid item xs={12} sm={6}>
                                        <TextField
                                            fullWidth
                                            name="management_fee_rate"
                                            label="管理费率 (%)"
                                            type="number"
                                            value={formData.management_fee_rate * 100}
                                            onChange={(e) => {
                                                const rate = parseFloat(e.target.value);
                                                setFormData(prev => ({ ...prev, management_fee_rate: isNaN(rate) ? 0 : rate / 100 }));
                                            }}
                                            helperText="默认20%"
                                            onWheel={(e) => e.target.blur()}
                                            disabled={isReadOnly}
                                        />
                                    </Grid>
                                    <Grid item xs={12} sm={6}>
                                        <TextField
                                            fullWidth
                                            disabled
                                            name="management_fee_amount"
                                            label="管理费 (自动计算)"
                                            value={formData.management_fee_amount}
                                            onWheel={(e) => e.target.blur()}
                                        />
                                    </Grid>
                                </>
                            )}

                            {isNanny && (
                                <Grid item xs={12}>
                                    <FormControlLabel control={<Switch checked={formData.is_monthly_auto_renew} onChange={handleChange} name= "is_monthly_auto_renew" disabled={isReadOnly} />} label="是否自动续签(月)" />
                                </Grid>
                            )}

                            {(isNanny || isNannyTrial) && (
                                <>
                                    <Grid item xs={12} sm={6}>
                                        <FormControl fullWidth disabled={isReadOnly}>
                                            <InputLabel>服务内容</InputLabel>
                                            <Select name="service_content" value={formData.service_content} label="服务内容" onChange={handleChange}>
                                                {serviceContentOptions.map((name) => (<MenuItem key={name} value={name}>{name}</MenuItem>))}
                                            </Select>
                                        </FormControl>
                                    </Grid>
                                    <Grid item xs={12} sm={6}>
                                        <FormControl fullWidth disabled={isReadOnly}>
                                            <InputLabel>服务方式</InputLabel>
                                            <Select name="service_type" value={formData.service_type} label="服务方式" onChange={handleChange}>
                                                {serviceTypeOptions.map((name) => (<MenuItem key={name} value={name}>{name}</MenuItem>))}
                                            </Select>
                                        </FormControl>
                                    </Grid>
                                </>
                            )}
                            
                            <Grid item xs={12}>
                                <TextField fullWidth name="notes" label="备注" multiline rows={4} value={formData.notes} onChange={handleChange} />
                            </Grid>
                            <Grid item xs={12}>
                                <TextField fullWidth name="attachment_content" label="附件内容" multiline rows={4} value={formData. attachment_content} onChange={handleChange} />
                            </Grid>
                        </Grid>
                    )}
                </DialogContent>
                <DialogActions sx={{ p: 3 }}>
                    <Button onClick={onClose}>取消</Button>
                    <Button type="submit" variant="contained" disabled={loading}>
                        {loading ? <CircularProgress size={24} /> : '保存更改'}
                    </Button>
                </DialogActions>
            </Box>
        </Dialog>
    );
};

export default EditContractModal;