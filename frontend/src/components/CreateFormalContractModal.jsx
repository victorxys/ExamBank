import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Dialog, DialogTitle, DialogContent, DialogActions, Button, Grid, TextField,
    Select, MenuItem, InputLabel, FormControl, FormControlLabel, Switch, Box,
    CircularProgress, Alert, Autocomplete, Chip, Typography, FormHelperText, Tooltip
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { DatePicker, DateTimePicker } from '@mui/x-date-pickers';
import { debounce } from 'lodash';
import api from '../api/axios';

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
    service_content: [],
    service_type: '',
    is_auto_renew: false,
    attachment_content: '',
    customer_id_card: '',
    customer_address: '',
    employee_id_card: '',
    employee_address: '',
    attachment_content: '',
};

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

const CreateFormalContractModal = ({ open, onClose, onSuccess }) => {
    console.log('CreateFormalContractModal rendered with props:', { open });
    const navigate = useNavigate();
    const [formData, setFormData] = useState(initialState);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [templates, setTemplates] = useState([]);
    const [loadingTemplates, setLoadingTemplates] = useState(false);
    
    const [customerOptions, setCustomerOptions] = useState([]);
    const [employeeOptions, setEmployeeOptions] = useState([]);
    const [loadingCustomers, setLoadingCustomers] = useState(false);
    const [loadingEmployees, setLoadingEmployees] = useState(false);
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [selectedEmployee, setSelectedEmployee] = useState(null);

    const [customerInputValue, setCustomerInputValue] = useState('');
    const [employeeInputValue, setEmployeeInputValue] = useState('');

    const [openCustomer, setOpenCustomer] = useState(false);
    const [openEmployee, setOpenEmployee] = useState(false);

    const searchTimeout = useRef(null);

    useEffect(() => {
        console.log('Modal open effect triggered. Open:', open);
        if (open) {
            fetchTemplates();
            setFormData(initialState);
            setSelectedCustomer(null);
            setSelectedEmployee(null);
            setError('');
            setLoading(false);
            setCustomerOptions([]);
            setEmployeeOptions([]);
        }
    }, [open]);

    const fetchTemplates = async () => {
        setLoadingTemplates(true);
        try {
            const response = await api.get('/contract_templates');
            setTemplates(response.data);
        } catch (err) {
            setError('无法加载合同模板');
        } finally {
            setLoadingTemplates(false);
        }
    };

    const searchParties = (query, role) => {
        console.log(`searchParties called with query: \"${query}\", role: \"${role}\"`);
        if (searchTimeout.current) {
            clearTimeout(searchTimeout.current);
        }

        if (query.length < 1) {
            if (role === 'customer') {
                setCustomerOptions([]);
                setOpenCustomer(false);
            } else {
                setEmployeeOptions([]);
                setOpenEmployee(false);
            }
            return;
        }

        if (role === 'customer') {
            setLoadingCustomers(true);
        } else {
            setLoadingEmployees(true);
        }

        searchTimeout.current = setTimeout(async () => {
            let options = [];
            try {
                console.log(`Fetching data for query: \"${query}\", role: \"${role}\"`);
                const response = await api.get('/contract-parties/search', { params: { search: query, role: role } });
                console.log('API response received:', response.data);
                options = response.data || [];
                if (role === 'customer') {
                    setCustomerOptions(options);
                } else {
                    setEmployeeOptions(options);
                }
            } catch (err) {
                console.error(`搜索 ${role} 失败:`, err);
            } finally {
                if (role === 'customer') {
                    setLoadingCustomers(false);
                    if (options.length > 0) {
                        setOpenCustomer(true);
                    }
                } else {
                    setLoadingEmployees(false);
                    if (options.length > 0) {
                        setOpenEmployee(true);
                    }
                }
            }
        }, 300);
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        console.log("1. handleSubmit triggered."); // <-- 添加

        setLoading(true);
        setError('');

        if (!selectedCustomer || !selectedEmployee) {
            console.log("Exit reason: Customer or Employee not selected."); // <-- 添加
            setError("错误：必须选择一个客户和服务人员。");
            setLoading(false);
            return;
        }

        const payload = {
            ...formData,
            customer_id: selectedCustomer.id,
            service_personnel_id: selectedEmployee.id,
        };
        console.log("2. Payload created:", payload); // <-- 添加

        if (!payload.template_id) {
            console.log("Exit reason: Template ID missing."); // <-- 添加
            setError("错误：必须选择一个合同模板。");
            setLoading(false);
            return;
        }
        if (!payload.start_date || !payload.end_date) {
            console.log("Exit reason: Start or End date missing."); // <-- 添加
            setError("错误：合同开始日期和结束日期是必填项。");
            setLoading(false);
            return;
        }
        if (payload.contract_type === 'maternity_nurse' && !payload.provisional_start_date) {
            console.log("Exit reason: Provisional start date missing for maternity nurse."); // <-- 添加
            setError("错误：月嫂合同需要填写预产期。");
            setLoading(false);
            return;
        }

        console.log("3. All validations passed. Preparing to send API request."); // <-- 添加

        if (payload.start_date) payload.start_date = new Date(payload.start_date).toISOString();
        if (payload.end_date) payload.end_date = new Date(payload.end_date).toISOString();
        if (payload.provisional_start_date) payload.provisional_start_date = new Date(payload. provisional_start_date).toISOString();

        try {
            console.log("4. Sending API request to /contracts/formal with payload:", payload); // <-- 添加
            const response = await api.post('/contracts/formal', payload);
            console.log("5. API request successful.", response); // <-- 添加
            onSuccess();
        } catch (err) {
            console.error("API Error:", err); // <-- 修改
            setError(err.response?.data?.error || '创建失败，请检查所有必填项。');
        } finally {
            setLoading(false);
        }
    };

    // All other useEffects and handlers remain the same...
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
                newEndDate.setDate(newEndDate.getDate() + 7);
                const endTimeChanged = formData.end_date?.getTime() !==newEndDate.getTime();
                if (endTimeChanged) {
                    setFormData(prev => ({ ...prev, end_date: newEndDate }));
                }
            }
        }
    }, [formData.provisional_start_date, formData.start_date, formData.contract_type]);

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
    
    useEffect(() => {
        if (formData.contract_type === 'nanny' && formData.is_monthly_auto_renew && formData.start_date) {
            const startDate = new Date(formData.start_date);
            if (!isNaN(startDate.getTime())) {
                const year = startDate.getFullYear();
                const month = startDate.getMonth();
                const lastDayOfMonth = new Date(year, month+ 1, 0);
                const currentEndDate = formData.end_date ?new Date(formData.end_date) : null;
                if (!currentEndDate || currentEndDate.getTime() !== lastDayOfMonth.getTime()) {
                    setFormData(prev => ({ ...prev,end_date: lastDayOfMonth }));
                }
            }
        }
    }, [formData.is_monthly_auto_renew, formData.start_date, formData.contract_type]);

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

    const isTrialContract = formData.contract_type === 'nanny_trial';
    const introFeeValue = parseFloat(formData.introduction_fee);
    const mgmtFeeRateValue = parseFloat(formData.management_fee_rate);

    const isIntroFeeDisabled = isTrialContract && mgmtFeeRateValue > 0;
    const isMgmtRateDisabled = isTrialContract && introFeeValue > 0;

    const introFeeHelperText = isIntroFeeDisabled ? "不能与管理费率同时存在" : "";
    const mgmtRateHelperText = isMgmtRateDisabled ? "不能与介绍费同时存在": "";

    console.log('State before render:', { customerOptions, employeeOptions });

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle>创建正式合同</DialogTitle>
            <Box component="form" onSubmit={handleSubmit}>
                <DialogContent dividers>
                    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                    <Grid container spacing={3}>
                        <Grid item xs={12}>
                            <FormControl fullWidth required>
                                <InputLabel>合同模板</InputLabel>
                                <Select
                                    name="template_id"
                                    value={formData.template_id}
                                    label="合同模板"
                                    onChange={handleChange}
                                    disabled={loadingTemplates}
                                >
                                    {loadingTemplates ? (
                                        <MenuItem value="" disabled><em>加载中...</em></MenuItem>
                                    ) : (
                                        templates.map(template => (
                                            <MenuItem key={template.id} value={template.id}>
                                                {template.template_name} (v{template.version})
                                            </MenuItem>
                                        ))
                                    )}
                                </Select>
                            </FormControl>
                        </Grid>

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
                        <Grid item xs={12} sm={6}><TextField required fullWidth name="employee_level" label="级别 (月薪/元)" type="number" value={formData.employee_level} onChange={handleChange} /></Grid>
                        
                        <Grid item xs={12} sm={6}>
                            <Autocomplete
                                open={openCustomer}
                                onOpen={() => setOpenCustomer(true)}
                                onClose={() => setOpenCustomer(false)}
                                filterOptions={(x) => x}
                                options={customerOptions}
                                getOptionLabel={(option) => (option && option.name) || ''}
                                value={selectedCustomer}
                                inputValue={customerInputValue}
                                isOptionEqualToValue={(option, value) => option && value && option.id === value.id}
                                onChange={(event, newValue) => {
                                    setSelectedCustomer(newValue);
                                    if (newValue) {
                                        setFormData(prev => ({
                                            ...prev,
                                            customer_id_card: newValue.id_card_number || '',
                                            customer_address: newValue.address || '',
                                        }));
                                    }
                                }}
                                onInputChange={(event, newInputValue, reason) => {
                                    setCustomerInputValue(newInputValue);
                                    if (reason === 'input') {
                                        searchParties(newInputValue, 'customer');
                                    }
                                }}
                                loading={loadingCustomers}
                                renderInput={(params) => (
                                    <TextField {...params} required label="客户名称" placeholder= "搜索客户"
                                        InputProps={{ ...params.InputProps, endAdornment: (<> {loadingCustomers ? <CircularProgress color="inherit" size={20} /> : null}{params.InputProps.endAdornment}</>), }}
                                    />
                                )}
                            />
                            
                        </Grid>

                        <Grid item xs={12} sm={6}>
                            <Autocomplete
                                open={openEmployee}
                                onOpen={() => setOpenEmployee(true)}
                                onClose={() => setOpenEmployee(false)}
                                filterOptions={(x) => x}
                                options={employeeOptions}
                                getOptionLabel={(option) => (option && option.name) || ''}
                                value={selectedEmployee}
                                inputValue={employeeInputValue}
                                isOptionEqualToValue={(option, value) => option && value && option.id === value.id}
                                onChange={(event, newValue) => {
                                    setSelectedEmployee(newValue);
                                    if (newValue) {
                                        setFormData(prev => ({
                                            ...prev,
                                            employee_level: newValue.latest_salary || '',
                                            employee_id_card: newValue.id_card_number || '',
                                            employee_address: newValue.address || '',
                                        }));
                                    }
                                }}
                                onInputChange={(event, newInputValue, reason) => {
                                    setEmployeeInputValue(newInputValue);
                                    if (reason === 'input') {
                                        searchParties(newInputValue, 'service_personnel');
                                    }
                                }}
                                loading={loadingEmployees}
                                renderInput={(params) => (
                                    <TextField {...params} required label="员工名称" placeholder= "搜索员工"
                                        InputProps={{ ...params.InputProps, endAdornment: (<> {loadingEmployees ? <CircularProgress color="inherit" size={20} /> : null}{params.InputProps.endAdornment}</>), }}
                                    />
                                )}
                            />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth name="customer_id_card" label="客户身份证号" value={formData.customer_id_card} onChange={handleInputChange} InputLabelProps={{ shrink: true }} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth name="employee_id_card" label="员工身份证号" value={formData. employee_id_card} onChange={handleInputChange} InputLabelProps={{ shrink: true }} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth name="customer_address" label="客户地址" value={formData. customer_address} onChange={handleInputChange} InputLabelProps={{ shrink: true }} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth name="employee_address" label="员工地址" value={formData. employee_address} onChange={handleInputChange} InputLabelProps={{ shrink: true }} />
                        </Grid>
                        {/* ... other form fields remain unchanged ... */}
                        {formData.contract_type === 'nanny' && (
                            <Grid item xs={12}>
                                <FormControlLabel control={<Switch checked={formData.is_monthly_auto_renew} onChange={handleSwitchChange} name="is_monthly_auto_renew" />}label="是否自动续签(月)" />
                            </Grid>
                        )}
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

                        {/* New fields for FormalContract */}
                        <Grid item xs={12} sm={6}>
                            <FormControl fullWidth>
                                <InputLabel id="service-content-label">服务内容</InputLabel>
                                <Select
                                    labelId="service-content-label"
                                    id="service-content-select"
                                    name="service_content"
                                    value={formData.service_content}
                                    label="服务内容"
                                    onChange={handleChange}
                                >
                                    {serviceContentOptions.map((name) => (
                                        <MenuItem key={name} value={name}>
                                            {name}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <FormControl fullWidth>
                                <InputLabel>服务方式</InputLabel>
                                <Select
                                    name="service_type"
                                    value={formData.service_type}
                                    label="服务方式"
                                    onChange={handleChange}
                                >
                                    {serviceTypeOptions.map((name) => (
                                        <MenuItem key={name} value={name}>
                                            {name}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Grid>

                        <Grid item xs={12}>
                            <TextField
                                fullWidth
                                name="attachment_content"
                                label="附件内容"
                                multiline
                                rows={4}
                                value={formData.attachment_content}
                                onChange={handleInputChange}
                            />
                        </Grid>

                        {formData.contract_type === 'maternity_nurse' && (
                            <>
                                <Grid item xs={12} sm={4}>
                                    <FormControl fullWidth>
                                        <InputLabel>保证金比例</InputLabel>
                                        <Select name="deposit_rate" label="保证金比例" value={formData.deposit_rate} onChange={handleChange}>
                                            <MenuItem value={0.25}>25%</MenuItem>
                                            <MenuItem value={0.20}>20%</MenuItem>
                                            <MenuItem value={0.15}>15%</MenuItem>
                                            <MenuItem value={0.10}>10%</MenuItem>
                                            {![0.15, 0.20, 0.25, 0.10].includes(formData.deposit_rate) && <MenuItem value={formData.deposit_rate}>自定义:{(formData.deposit_rate * 100).toFixed(2)}%</MenuItem>}
                                        </Select>
                                    </FormControl>
                                </Grid>
                                <Grid item xs={12} sm={4}><TextField fullWidth name="security_deposit_paid" label="客交保证金 (元)" type="number" value={formData.security_deposit_paid} onChange={handleChange} /></Grid>
                                <Grid item xs={12} sm={4}><TextField fullWidth disabled name="management_fee_amount" label="管理费 (自动计算)" type="number" value={formData.management_fee_amount} /></Grid>
                                <Grid item xs={12}><TextField fullWidth name="deposit_amount" label="定金 (元)" type="number" value={formData.deposit_amount} onChange={handleInputChange} helperText="默认为3000元" /></Grid>
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
                            </>
                        )}

                        {formData.contract_type === 'nanny_trial' && (
                            <>
                                <Grid item xs={12} sm={6}>
                                    <TextField required fullWidth name="daily_rate" label="日薪(元)" type="number" value={formData.daily_rate} onChange={handleInputChange} helperText="级别/26，可手动修改" />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <Tooltip title={isIntroFeeDisabled ?"不能与管理费率同时存在" : ""}>
                                        <TextField
                                            fullWidth name="introduction_fee" label="介绍费 (元)" type="number"
                                            value={formData.introduction_fee}
                                            onChange={handleInputChange}
                                            disabled={isIntroFeeDisabled}
                                            error={isIntroFeeDisabled}
                                            helperText={introFeeHelperText}
                                        />
                                    </Tooltip>
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <Tooltip title={isMgmtRateDisabled ? "不能与介绍费同时存在": ""}>
                                        <TextField
                                            fullWidth
                                            name="management_fee_rate"
                                            label="管理费率 (%)"
                                            type="number"
                                            value={formData.management_fee_rate * 100}
                                            onChange={(e) => {
                                                const rate = parseFloat(e.target.value);
                                                setFormData(prev => ({ ...prev,management_fee_rate: isNaN(rate) ? 0 : rate / 100 }));
                                            }}
                                            disabled={isMgmtRateDisabled}
                                            error={isMgmtRateDisabled}
                                            helperText={mgmtRateHelperText}
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

export default CreateFormalContractModal;