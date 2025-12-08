import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Dialog, DialogTitle, DialogContent, DialogActions, Button, Grid, TextField,
    Select, MenuItem, InputLabel, FormControl, FormControlLabel, Switch, Box,
    CircularProgress, Alert, Autocomplete, Chip, Typography, FormHelperText, Tooltip,
    InputAdornment, IconButton, RadioGroup, Radio
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import { DatePicker, DateTimePicker } from '@mui/x-date-pickers';
import { debounce } from 'lodash';
import api from '../api/axios';
import ReactMarkdown from 'react-markdown';
import DiffTemplateModal from './DiffTemplateModal';


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
    management_fee_rate: 0.10,
    service_content: "",
    service_type: '',
    is_auto_renew: false,
    attachment_content: '',
    customer_id_card: '',
    customer_address: '',
    employee_id_card: '',
    employee_address: '',
    requires_signature: null,  // 是否需要客户签署，默认为 null 强制用户选择
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
    // console.log('CreateFormalContractModal rendered with props:', { open });
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

    const [transferDialog, setTransferDialog] = useState({
        open: false,
        contracts: [],
        selectedOption: 'createNew', // 'createNew' or 'renewOrChange'
        selectedContractId: '',
    });

    const searchTimeout = useRef(null);

    const [previewOpen, setPreviewOpen] = useState(false);
    const [previewContent, setPreviewContent] = useState('');
    const [isPreviewLoading, setIsPreviewLoading] = useState(false);


    // State for Diff Modal
    const [comparisonTemplates, setComparisonTemplates] = useState({ t1: null, t2: null });
    const [isComparing, setIsComparing] = useState(false);
    const [isDiffModalOpen, setIsDiffModalOpen] = useState(false);


    useEffect(() => {
        // console.log('Modal open effect triggered. Open:', open);
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

    useEffect(() => {
        if (formData.contract_type && templates.length > 0) {
            // 1. 筛选出所有匹配的模板
            const matchingTemplates = templates.filter(t => t.contract_type === formData.contract_type);

            if (matchingTemplates.length > 0) {
                // 2. 排序：首先按版本号降序，然后按更新时间降序
                matchingTemplates.sort((a, b) => {
                    if (b.version !== a.version) {
                        return b.version - a.version;
                    }
                    return new Date(b.updated_at) - new Date(a.updated_at);
                });

                // 3. 选择最新的一个
                const latestTemplate = matchingTemplates[0];

                // 4. 如果选中的不是当前模板，则更新
                if (latestTemplate && latestTemplate.id !== formData.template_id) {
                    setFormData(prev => ({ ...prev, template_id: latestTemplate.id }));
                }
            } else {
                // 如果没有匹配的模板，清空选择
                setFormData(prev => ({ ...prev, template_id: '' }));
            }
        }
    }, [formData.contract_type, templates]);

    useEffect(() => {
        const level = parseFloat(formData.employee_level);
        const type = formData.contract_type;
        const updates = {};

        if (isNaN(level) || level <= 0) {
            return;
        }

        if (type === 'nanny') {
            // --- 核心修改：使用 management_fee_rate 来计算 ---
            const rate = parseFloat(formData.management_fee_rate);
            if (rate >= 0) { // 允许费率为0
                updates.management_fee_amount = (level * rate).toFixed(2);
            }
        }
        else if (type === 'nanny_trial') {
            updates.daily_rate = (level / 26).toFixed(2);
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
        // --- 新增逻辑开始 ---
        else if (type === 'external_substitution') {
            const rate = parseFloat(formData.management_fee_rate);
            if (rate > 0) {
                const management_fee = level * rate;
                updates.management_fee_amount = management_fee.toFixed(2);
            } else {
                updates.management_fee_amount = '';
            }
        }
        // --- 新增逻辑结束 ---

        if (Object.keys(updates).length > 0) {
            setFormData(prev => ({ ...prev, ...updates }));
        }

    }, [formData.employee_level, formData.contract_type, formData.deposit_rate, formData.management_fee_rate]); // <-- 依赖项增加了 management_fee_rate

    // --- 新增：自动生成试工合同备注的 useEffect ---
    // --- 自动生成试工合同备注的 useEffect (V2 - 处理介绍费互斥逻辑) ---
    // --- 自动生成试工合同附件内容的 useEffect (V3 - 修正为 attachment_content) ---
    useEffect(() => {
        if (formData.contract_type === 'nanny_trial') {
            const dailyRate = parseFloat(formData.daily_rate);

            if (!isNaN(dailyRate) && dailyRate > 0) {
                const provisionalMonthlySalary = dailyRate * 26;
                const roundedMonthlySalary = Math.round(provisionalMonthlySalary / 100) * 100;

                const employeeName = selectedEmployee ? selectedEmployee.name : '服务人员';
                const managementFeeRate = parseFloat(formData.management_fee_rate);
                const introductionFee = parseFloat(formData.introduction_fee);


                let managementFeeNotePart = '';
                let feeIntroducePart = '';
                if (!isNaN(introductionFee) && introductionFee > 0 || managementFeeRate == 0) {
                    managementFeeNotePart = '';
                    feeIntroducePart = `甲方只需支付阿姨实际出勤天数的劳务费`;
                } else {
                    managementFeeNotePart = `丙方管理费计算方法为：${roundedMonthlySalary}元✖️ ${(managementFeeRate * 100).toFixed(0)}%➗30天✖️阿姨实际出勤天数。`;
                    feeIntroducePart = `甲方需支付阿姨实际出勤天数的劳务费和丙方管理费`;
                }

                const attachmentContentTemplate =
                    `乙方${employeeName}阿姨上户，${feeIntroducePart}:
阿姨劳务费计算方法为：${roundedMonthlySalary}元➗26天✖️阿姨实际出勤天数；
${managementFeeNotePart}`;

                setFormData(prev => ({ ...prev, attachment_content: attachmentContentTemplate }));
            } else {
                setFormData(prev => ({ ...prev, attachment_content: '' }));
            }
        }
    }, [formData.contract_type, formData.daily_rate, formData.management_fee_rate, formData.introduction_fee, selectedEmployee]);

    useEffect(() => {
        const autoRenewText = "双方没有异议，合同自动延续一个月，延续无次数限制。";

        setFormData(prevFormData => {
            const newFormData = { ...prevFormData };
            if (newFormData.contract_type === 'nanny' && newFormData.is_monthly_auto_renew) {
                // 只有当附件内容为空或与自动填充文本一致时才进行填充，避免覆盖用户输入
                if (!newFormData.attachment_content || newFormData.attachment_content === autoRenewText) {
                    newFormData.attachment_content = autoRenewText;
                }
            } else {
                // 如果条件不满足，且当前内容是自动填充文本，则清空它
                if (newFormData.attachment_content === autoRenewText) {
                    newFormData.attachment_content = '';
                }
            }
            // 只有当 attachment_content 实际发生变化时才返回新的状态，避免不必要的 re-render
            if (newFormData.attachment_content !== prevFormData.attachment_content) {
                return newFormData;
            }
            return prevFormData;
        });
    }, [formData.contract_type, formData.is_monthly_auto_renew]); // 依赖于合同类型和自动月签状态

    const fetchTemplates = async () => {
        setLoadingTemplates(true);
        try {
            const response = await api.get('/contract_templates', { params: { all: true } });
            setTemplates(response.data.templates || []);
        } catch (err) {
            setError('无法加载合同模板');
        } finally {
            setLoadingTemplates(false);
        }
    };

    const searchParties = (query, role) => {
        // console.log(`searchParties called with query: "${query}", role: "${role}"`);
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
                // console.log(`Fetching data for query: "${query}", role: "${role}"`);
                const response = await api.get('/contract-parties/search', { params: { search: query, role: role } });
                // console.log('API response received:', response.data);
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
        const formatDateForBackend = (date) => {
            if (!date) return null;
            const d = new Date(date);
            // 通过减去时区偏移量来“欺骗” toISOString，使其输出我们想要的本地日期
            d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
            return d.toISOString().split('T')[0];
        };
        event.preventDefault();
        setLoading(true);
        setError('');

        if (!selectedEmployee) {
            setError("错误：必须选择一个服务人员。");
            setLoading(false);
            return;
        }

        const payload = { ...formData };

        // 修正后的客户信息处理逻辑
        if (typeof selectedCustomer === 'object' && selectedCustomer !== null) {
            // 场景1: 用户从下拉列表中选择了一个已存在的客户
            payload.customer_id = selectedCustomer.id;
            payload.customer_name = selectedCustomer.name;
        } else if (customerInputValue) {
            // 场景2: 用户在输入框中手动输入了文字 (新客户或未选择的老客户)
            payload.customer_name = customerInputValue;
            delete payload.customer_id;
        } else {
            // 场景3: 用户没有选择，输入框也是空的
            delete payload.customer_id;
            delete payload.customer_name;
        }

        payload.service_personnel_id = selectedEmployee.id;

        // 后续的验证逻辑保持不变...
        if (!payload.template_id) {
            setError("错误：必须选择一个合同模板。");
            setLoading(false);
            return;
        }
        if (!payload.start_date || !payload.end_date) {
            setError("错误：合同开始日期和结束日期是必填项。");
            setLoading(false);
            return;
        }
        if (payload.contract_type === 'maternity_nurse' && !payload.provisional_start_date) {
            setError("错误：月嫂合同需要填写预产期。");
            setLoading(false);
            return;
        }

        payload.start_date = formatDateForBackend(payload.start_date);
        payload.end_date = formatDateForBackend(payload.end_date);
        payload.provisional_start_date = formatDateForBackend(payload.provisional_start_date);

        try {
            const response = await api.post('/contracts/formal', payload);
            onSuccess(response.data.contract_id);
        } catch (err) {
            console.error("创建正式合同失败:", err);
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
                const startTimeChanged = formData.start_date?.getTime() !== newStartDate.getTime();
                const endTimeChanged = formData.end_date?.getTime() !== newEndDate.getTime();
                if (startTimeChanged || endTimeChanged) {
                    setFormData(prev => ({ ...prev, start_date: newStartDate, end_date: newEndDate }));
                }
            }
        } else if (formData.contract_type === 'nanny_trial' && formData.start_date) {
            const startDate = new Date(formData.start_date);
            if (!isNaN(startDate.getTime())) {
                const newEndDate = new Date(startDate);
                newEndDate.setDate(newEndDate.getDate() + 7);
                const endTimeChanged = formData.end_date?.getTime() !== newEndDate.getTime();
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
                setFormData(prev => ({ ...prev, management_fee_amount: management_fee.toFixed(2) }));
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
                const lastDayOfMonth = new Date(year, month + 1, 0);
                const currentEndDate = formData.end_date ? new Date(formData.end_date) : null;
                if (!currentEndDate || currentEndDate.getTime() !== lastDayOfMonth.getTime()) {
                    setFormData(prev => ({ ...prev, end_date: lastDayOfMonth }));
                }
            }
        }
    }, [formData.is_monthly_auto_renew, formData.start_date, formData.contract_type]);

    const handleChange = (event) => {
        const { name, value } = event.target;
        setFormData(prev => {
            const newFormData = { ...prev, [name]: value };

            // --- 逻辑合并：当合同类型改变时 ---
            if (name === 'contract_type') {
                if (value === 'external_substitution') {
                    const now = new Date();
                    const defaultStartDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 6, 30);
                    const defaultEndDate = new Date(defaultStartDate.getTime() + 60 * 60 * 1000);
                    newFormData.start_date = defaultStartDate;
                    newFormData.end_date = defaultEndDate;
                }
                // --- 新增：为试工合同设置默认值 ---
                else if (value === 'nanny_trial') {
                    newFormData.management_fee_rate = 0.1;  // 默认10%
                    newFormData.introduction_fee = '2000';
                }
                // --- 新增结束 ---
            }

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
    const handleInputChange = (event) => {
        const { name, value } = event.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleDateChange = (name, newValue) => {
        setFormData(prev => {
            const newFormData = { ...prev, [name]: newValue };
            if (name === 'start_date' && newValue) {
                const newStartDate = new Date(newValue);
                const currentEndDate = prev.end_date ? new Date(prev.end_date) : null;
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

    const handleCompare = async (template) => {
        setIsComparing(true);
        try {
            const diffInfoResponse = await api.get(`/contract_templates/${template.id}/diff`);
            const previousTemplateId = diffInfoResponse.data.previous_template_id;
            if (!previousTemplateId) {
                throw new Error("未找到可供对比的更早的模板");
            }
            const [prevTemplateRes, currentTemplateRes] = await Promise.all([
                api.get(`/contract_templates/${previousTemplateId}`),
                api.get(`/contract_templates/${template.id}`)
            ]);
            setComparisonTemplates({ t1: prevTemplateRes.data, t2: currentTemplateRes.data });
            setIsDiffModalOpen(true);
        } catch (err) {
            setError(err.response?.data?.error || '获取版本差异失败。');
        } finally {
            setIsComparing(false);
        }
    };

    const handlePreview = async (templateId) => {
        if (!templateId) return;
        setIsPreviewLoading(true);
        setPreviewContent('');
        setPreviewOpen(true);
        try {
            const response = await api.get(`/contract_templates/${templateId}`);
            setPreviewContent(response.data.content);
        } catch (err) {
            setPreviewContent("无法加载模板内容。");
            console.error("Failed to fetch template content for preview:", err);
        } finally {
            setIsPreviewLoading(false);
        }
    };

    const filteredTemplates = useMemo(() => {
        if (!Array.isArray(templates)) return [];
        return templates.filter(t => t.contract_type === formData.contract_type);
    }, [templates, formData.contract_type]);


    // --- 自动调整试工合同的管理费率 ---
    useEffect(() => {
        if (formData.contract_type === 'nanny_trial') {
            const introFeeValue = parseFloat(formData.introduction_fee);
            if (introFeeValue > 0) {
                // 有介绍费时，管理费率设为10%
                if (formData.management_fee_rate !== 0.1) {
                    setFormData(prev => ({ ...prev, management_fee_rate: 0.1 }));
                }
            } else {
                // 无介绍费时，管理费率设为20%
                if (formData.management_fee_rate !== 0.2) {
                    setFormData(prev => ({ ...prev, management_fee_rate: 0.2 }));
                }
            }
        }
    }, [formData.contract_type, formData.introduction_fee]);

    const isTrialContract = formData.contract_type === 'nanny_trial';
    const introFeeValue = parseFloat(formData.introduction_fee);
    
    // 试工合同的提示文本
    const introFeeHelperText = isTrialContract ? (introFeeValue > 0 ? "已填写介绍费，管理费率为10%" : "未填写介绍费，管理费率为20%") : "";
    const mgmtRateHelperText = isTrialContract ? (introFeeValue > 0 ? "有介绍费时按10%收取" : "无介绍费时按20%收取") : "";

    // console.log('State before render:', { customerOptions, employeeOptions });

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle>创建正式合同</DialogTitle>
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
                            <Autocomplete
                                fullWidth
                                options={filteredTemplates}
                                getOptionLabel={(option) => `${option.template_name} (v${option.version})`}
                                value={templates.find(t => t.id === formData.template_id) || null}
                                onChange={(event, newValue) => {
                                    setFormData(prev => ({ ...prev, template_id: newValue ? newValue.id : '' }));
                                }}
                                renderInput={(params) => <TextField {...params} label="合同模板" required />}
                                renderOption={(props, option) => (
                                    <Box component="li" {...props} key={option.id} sx={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                                        <Typography variant="body2">{`${option.template_name} (v${option.version})`}</Typography>
                                        <Box>
                                            <IconButton
                                                size="small"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handlePreview(option.id);
                                                }}
                                            >
                                                <VisibilityIcon fontSize="small" />
                                            </IconButton>
                                            {option.version > 1 && (
                                                <IconButton
                                                    size="small"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleCompare(option);
                                                    }}
                                                    disabled={isComparing}
                                                >
                                                    <CompareArrowsIcon fontSize="small" />
                                                </IconButton>
                                            )}
                                        </Box>
                                    </Box>
                                )}
                                disabled={loadingTemplates}
                            />
                        </Grid>


                        <Grid item xs={12} sm={6}>
                            <Autocomplete
                                fullWidth
                                freeSolo
                                open={openCustomer}
                                onOpen={() => setOpenCustomer(true)}
                                onClose={() => setOpenCustomer(false)}
                                filterOptions={(x) => x} // 禁用前端筛选，直接显示后端返回的结果
                                options={customerOptions}
                                getOptionLabel={(option) => (typeof option === 'string' ? option : option.name) || ""}
                                value={selectedCustomer}
                                inputValue={customerInputValue}
                                onChange={(event, newValue) => {
                                    setSelectedCustomer(newValue);
                                    if (typeof newValue === 'object' && newValue && newValue.id) {
                                        setFormData(prev => ({
                                            ...prev,
                                            customer_id_card: newValue.id_card_number || '',
                                            customer_address: newValue.address || '',
                                        }));

                                        // --- 新增逻辑：检查可转移的合同 ---
                                        const checkForTransferableContracts = async (customerId) => {
                                            try {
                                                const response = await api.get(`/contracts/customer/${customerId}/transferable-contracts`);
                                                if (response.data && response.data.length > 0) {
                                                    setTransferDialog({
                                                        open: true,
                                                        contracts: response.data,
                                                        selectedOption: 'createNew',
                                                        selectedContractId: '',
                                                    });
                                                }
                                            } catch (err) {
                                                console.error("查找可转移合同失败:", err);
                                                // 获取失败不应阻塞主流程，仅在控制台打印错误
                                            }
                                        };
                                        checkForTransferableContracts(newValue.id);
                                        // --- 新增结束 ---

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
                                    <TextField
                                        {...params}
                                        label="选择或输入客户姓名 (可留空)"
                                        placeholder="输入汉字或拼音搜索"
                                        InputProps={{
                                            ...params.InputProps,
                                            endAdornment: (
                                                <>
                                                    {loadingCustomers ? <CircularProgress color="inherit" size={20} /> : null}
                                                    {params.InputProps.endAdornment}
                                                </>
                                            ),
                                        }}
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
                                    <TextField {...params} required label="员工名称" placeholder="搜索员工"
                                        InputProps={{ ...params.InputProps, endAdornment: (<> {loadingEmployees ? <CircularProgress color="inherit" size={20} /> : null}{params.InputProps.endAdornment}</>), }}
                                    />
                                )}
                            />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth name="customer_id_card" label="客户身份证号" value={formData.customer_id_card} onChange={handleInputChange} InputLabelProps={{ shrink: true }} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth name="employee_id_card" label="员工身份证号" value={formData.employee_id_card} onChange={handleInputChange} InputLabelProps={{ shrink: true }} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth name="customer_address" label="客户地址" value={formData.customer_address} onChange={handleInputChange} InputLabelProps={{ shrink: true }} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth name="employee_address" label="员工地址" value={formData.employee_address} onChange={handleInputChange} InputLabelProps={{ shrink: true }} />
                        </Grid>
                        {/* ... other form fields remain unchanged ... */}
                        {formData.contract_type === 'nanny' && (
                            <Grid item xs={12}>
                                <FormControlLabel control={<Switch checked={formData.is_monthly_auto_renew} onChange={handleSwitchChange} name="is_monthly_auto_renew" />} label="是否自动续签(月)" />
                            </Grid>
                        )}
                        {formData.contract_type === 'external_substitution' ? (
                            <>
                                <Grid item xs={12} sm={6}><DateTimePicker label="服务开始时间 *" value={formData.start_date} onChange={(v) => handleDateChange('start_date', v)} sx={{ width: '100%' }} /></Grid>
                                <Grid item xs={12} sm={6}><DateTimePicker label="服务结束时间 *" value={formData.end_date} onChange={(v) => handleDateChange('end_date', v)} sx={{ width: '100%' }} /></Grid>
                            </>
                        ) : formData.contract_type === 'maternity_nurse' ? (
                            <>
                                <Grid item xs={12} sm={6}><DatePicker label="预产期 *" value={formData.provisional_start_date} onChange={(v) => handleDateChange('provisional_start_date', v)} sx={{ width: '100%' }} /></Grid>
                                <Grid item xs={12} sm={6}><DatePicker label="合同结束日期 *" value={formData.end_date} onChange={(v) => handleDateChange('end_date', v)} sx={{ width: '100%' }} helperText="选择预产期后自动计算，可手动修改" /></Grid>
                            </>
                        ) : (
                            <>
                                <Grid item xs={12} sm={6}><DatePicker label="合同开始日期 *" value={formData.start_date} onChange={(v) => handleDateChange('start_date', v)} sx={{ width: '100%' }} /></Grid>
                                <Grid item xs={12} sm={6}><DatePicker label="合同结束日期 *" value={formData.end_date} onChange={(v) => handleDateChange('end_date', v)} sx={{ width: '100%' }} /></Grid>
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
                                <Grid item xs={12} sm={4}><TextField required fullWidth name="employee_level" label="级别 (月薪/元)" type="number" value={formData.employee_level} onChange={handleChange} onWheel={(e) => e.target.blur()} /></Grid>
                                <Grid item xs={12} sm={4}><TextField fullWidth name="deposit_amount" label="定金 (元)" type="number" value={formData.deposit_amount} onChange={handleInputChange} helperText="默认为3000元" onWheel={(e) => e.target.blur()} /></Grid>
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
                                <Grid item xs={12} sm={6}><TextField fullWidth name="security_deposit_paid" label="客交保证金 (元)" type="number" value={formData.security_deposit_paid} onChange={handleChange} onWheel={(e) => e.target.blur()} /></Grid>
                                <Grid item xs={12} sm={6}><TextField fullWidth disabled name="management_fee_amount" label="管理费 (自动计算)" type="number" value={formData.management_fee_amount} /></Grid>

                            </>
                        )}

                        {formData.contract_type === 'nanny' && (
                            <>
                                <Grid item xs={12} sm={3}>
                                    <TextField required fullWidth name="employee_level" label="级别 (月薪/元)" type="number" value={formData.employee_level} onChange={handleChange} onWheel={(e) => e.target.blur()} />
                                </Grid>
                                <Grid item xs={12} sm={3}>
                                    <TextField fullWidth name="introduction_fee" label="介绍费 (元)" type="number" value={formData.introduction_fee} onChange={handleInputChange} onWheel={(e) => e.target.blur()} />
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
                                    // helperText="默认10%"
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

                        {formData.contract_type === 'nanny_trial' && (
                            <>
                                <Grid item xs={12} sm={6}>
                                    <TextField required fullWidth name="daily_rate" label="日薪(元)" type="number" value={formData.daily_rate} onChange={handleInputChange} helperText="级别/26，可手动修改" onWheel={(e) => e.target.blur()} />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <TextField
                                        fullWidth 
                                        name="introduction_fee" 
                                        label="介绍费 (元)" 
                                        type="number"
                                        value={formData.introduction_fee}
                                        onChange={handleInputChange}
                                        helperText={introFeeHelperText}
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
                                        helperText={mgmtRateHelperText}
                                        onWheel={(e) => e.target.blur()}
                                    />
                                </Grid>
                            </>
                        )}
                        {/* --- 新增：外部替班合同的专属字段 --- */}
                        {formData.contract_type === 'external_substitution' && (
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

                        {/* --- 新增：是否需要客户签署 --- */}
                        <Grid item xs={12} sm={6}>
                            <FormControl fullWidth required>
                                <InputLabel>是否需要客户签署</InputLabel>
                                <Select
                                    name="requires_signature"
                                    value={formData.requires_signature ?? ''}
                                    label="是否需要客户签署"
                                    onChange={(e) => setFormData(prev => ({ ...prev, requires_signature: e.target.value === 'true' }))}
                                >
                                    <MenuItem value="">
                                        <em>请选择</em>
                                    </MenuItem>
                                    <MenuItem value="true">是</MenuItem>
                                    <MenuItem value="false">否</MenuItem>
                                </Select>
                            </FormControl>
                        </Grid>
                        {/* --- 新增结束 --- */}

                        <Grid item xs={12}><TextField fullWidth name="notes" label="备注" multiline rows={3} value={formData.notes} onChange={handleInputChange} /></Grid>
                    </Grid>
                </DialogContent>
                <DialogActions sx={{ p: 3 }}>
                    <Button onClick={onClose}>取消</Button>
                    <Button type="submit" variant="contained" disabled={loading}>
                        {loading ? <CircularProgress size={24} /> : '创建合同'}
                    </Button>
                </DialogActions>
            </Box>
            <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} maxWidth="md" fullWidth>
                <DialogTitle>预览合同模板</DialogTitle>
                <DialogContent dividers>
                    <Box sx={{ p: 2, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
                        {isPreviewLoading ? (
                            <CircularProgress />
                        ) : (
                            <Box sx={{ '& p': { my: 1, lineHeight: 1.7 }, width: '100%' }}>
                                <ReactMarkdown>{previewContent}</ReactMarkdown>
                            </Box>
                        )}
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setPreviewOpen(false)}>关闭</Button>
                </DialogActions>
            </Dialog>
            {/* --- 新增：渲染并处理选择弹窗 --- */}
            <TransferOptionDialog
                open={transferDialog.open}
                contracts={transferDialog.contracts}
                value={{ selectedOption: transferDialog.selectedOption, selectedContractId: transferDialog.selectedContractId }}
                onChange={(newValue) => setTransferDialog(prev => ({ ...prev, ...newValue }))}
                onClose={() => setTransferDialog(prev => ({ ...prev, open: false }))}
                onConfirm={(result) => {
                    setTransferDialog(prev => ({ ...prev, open: false }));
                    if (result.selectedOption === 'renewOrChange' && result.selectedContractId) {
                        // 如果用户选择跳转，则关闭创建弹窗并执行跳转
                        onClose();
                        navigate(`/contract/detail/${result.selectedContractId}`);
                    }
                    // 如果用户选择创建新合同，则什么也不做，流程继续
                }}
            />
            <DiffTemplateModal
                open={isDiffModalOpen}
                onClose={() => setIsDiffModalOpen(false)}
                template1={comparisonTemplates.t1}
                template2={comparisonTemplates.t2}
            />
        </Dialog>
    );
};
// --- 新增的弹窗组件 ---

const TransferOptionDialog = ({ open, onClose, onConfirm, contracts, value, onChange }) => {
    const { selectedOption, selectedContractId } = value;

    const handleConfirm = () => {
        if (selectedOption === 'renewOrChange' && !selectedContractId) {
            alert('请选择一个要续约或变更的合同。');
            return;
        }
        onConfirm(value);
    };

    const formatDate = (isoString) => isoString ? new Date(isoString).toLocaleDateString() : 'N/A';

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle>发现可转移保证金的合同</DialogTitle>
            <DialogContent>
                <Typography sx={{ mb: 2 }}>
                    系统发现客户名下有以下合同的保证金可以被续约或变更，请选择您的操作：
                </Typography>
                <FormControl component="fieldset">
                    <RadioGroup
                        value={selectedOption}
                        onChange={(e) => onChange({ ...value, selectedOption: e.target.value })}
                    >
                        <FormControlLabel value="createNew" control={<Radio />} label="创建新合同，并重新交纳保证金" />
                        <FormControlLabel value="renewOrChange" control={<Radio />} label="从以下现有合同续约或变更，以转移保证金" />
                    </RadioGroup>
                </FormControl>

                {/* --- 核心修改：列表默认显示，通过 disabled 属性控制可选状态 --- */}
                <Box sx={{ mt: 2, pl: 4, border: '1px solid #eee', p: 2, borderRadius: 1 }}>
                    <Typography variant="subtitle2" gutterBottom>
                        可转移保证金的合同列表:
                    </Typography>
                    <FormControl component="fieldset" fullWidth disabled={selectedOption !== 'renewOrChange'}>
                        <RadioGroup
                            value={selectedContractId}
                            onChange={(e) => onChange({ ...value, selectedContractId: e.target.value })}
                        >
                            {contracts.map(c => (
                                <FormControlLabel
                                    key={c.contract_id}
                                    value={c.contract_id}
                                    control={<Radio />}
                                    label={
                                        `【${c.service_personnel_name}】月薪 ${c.employee_level} 的合同于 ${formatDate(c.effective_end_date)} 结束，有 ${c.transferable_deposit_amount} 元保证金可转移`
                                    }
                                />
                            ))}
                        </RadioGroup>
                    </FormControl>
                </Box>
                {/* --- 修改结束 --- */}

            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>取消</Button>
                <Button onClick={handleConfirm} variant="contained">确认</Button>
            </DialogActions>
        </Dialog>
    );
};
// --- 新增结束 ---
export default CreateFormalContractModal;