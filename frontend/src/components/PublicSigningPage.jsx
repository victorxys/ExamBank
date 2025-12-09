import React, { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
    Container, Box, Typography, Paper, Grid, Button, CircularProgress,
    Alert, Divider, Card, CardContent, CardHeader, Chip, TextField
} from '@mui/material';
import api from '../api/axios';
import ReactMarkdown from 'react-markdown';
import SignatureCanvas from 'react-signature-canvas';
import logoSvg from '../assets/logo.svg'; // 假设你的Logo文件路径是这个
import { useTheme } from '@mui/material/styles';

const partyInfoDefault = {
    name: '',
    phone_number: '',
    id_card_number: '',
    address: ''
};

const PublicSigningPage = () => {
    const { token } = useParams();
    const theme = useTheme();
    const [contract, setContract] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [isResigning, setIsResigning] = useState(false);
    const [sigCanvasWidth, setSigCanvasWidth] = useState(0);

    // Refactored State: One state for form values
    const [formValues, setFormValues] = useState({
        customer: partyInfoDefault,
        employee: partyInfoDefault,
    });

    const customerSigCanvas = useRef(null);
    const employeeSigCanvas = useRef(null);
    const sigContainerRef = useRef(null);

    // Effect 1: Fetch contract data from server
    useEffect(() => {
        const fetchContract = async () => {
            setLoading(true);
            try {
                const response = await api.get(`/contracts/sign/${token}`);
                setContract(response.data);
                setError('');
            } catch (err) {
                setError(err.response?.data?.error || '加载合同失败，链接可能已失效。');
            } finally {
                setLoading(false);
            }
        };
        fetchContract();
    }, [token]);

    // Effect 2: Populate form and document title when contract data is available
    useEffect(() => {
        if (contract) {
            if (contract.type === 'maternity_nurse') {
                document.title = '萌姨萌嫂合同管理系统';
            } else {
                document.title = '家福安合同管理系统';
            }

            const initialCustomerInfo = (contract.customer_info && contract.customer_info.id)
                ? contract.customer_info
                : { ...partyInfoDefault, name: contract.customer_name === '新客户' ? '' : contract.customer_name };

            const initialEmployeeInfo = (contract.employee_info && contract.employee_info.id)
                ? contract.employee_info
                : partyInfoDefault;

            // console.log('Populating form with:', { initialCustomerInfo, initialEmployeeInfo });

            setFormValues({
                customer: initialCustomerInfo,
                employee: initialEmployeeInfo
            });
        }
    }, [contract]);

    useLayoutEffect(() => {
        const setWidth = () => {
            if (sigContainerRef.current) {
                setSigCanvasWidth(sigContainerRef.current.offsetWidth);
            }
        };
        setWidth();
        window.addEventListener('resize', setWidth);
        return () => window.removeEventListener('resize', setWidth);
    }, [contract, isResigning]);

    const isPartyInfoValid = (info) => {
        return info.name && info.phone_number && info.id_card_number && info.address;
    };

    const handleSign = async () => {
        const role = contract.role;
        const sigCanvas = role === 'customer' ? customerSigCanvas.current : employeeSigCanvas.current;

        if (sigCanvas.isEmpty()) {
            setError(`请在签名区域写下您的签名。`);
            return;
        }

        const signature = sigCanvas.toDataURL('image/png');
        setSubmitting(true);
        setError('');

        let payload = { signature };

        if (role === 'customer') {
            if (!isPartyInfoValid(formValues.customer)) {
                setError('请将您的个人信息填写完整后再签署。');
                setSubmitting(false);
                return;
            }
            payload.customer_info = formValues.customer;
        } else if (role === 'employee') {
            if (!isPartyInfoValid(formValues.employee)) {
                setError('请将您的个人信息填写完整后再签署。');
                setSubmitting(false);
                return;
            }
            payload.employee_info = formValues.employee;
        }

        try {
            await api.post(`/contracts/sign/${token}`, payload);
            setIsResigning(false);
            // Re-fetch contract data to show the new state
            const response = await api.get(`/contracts/sign/${token}`);
            setContract(response.data);
        } catch (err) {
            setError(err.response?.data?.error || '签名提交失败，请重试。');
        } finally {
            setSubmitting(false);
        }
    };

    const handleInfoChange = (role, e) => {
        const { name, value } = e.target;
        setFormValues(prev => ({
            ...prev,
            [role]: {
                ...prev[role],
                [name]: value
            }
        }));
    };


    const renderEditablePartyInfo = (role) => {
        const title = role === 'customer' ? '甲方 (客户) 信息' : '乙方 (服务人员) 信息';
        const isCurrentUser = contract.role === role;
        const info = formValues[role];

        const hasSigned = (role === 'customer' && contract.customer_signature) ||
                        (role === 'employee' && contract.employee_signature);

        // 核心修改：如果用户正在“重新签署”，则不禁用表单
        const isFieldDisabled = !isCurrentUser || (hasSigned && !isResigning);

        return (
            <Card variant="outlined">
                <CardHeader title={title} action={hasSigned ? <Chip label="已签署" color= "success" size="small" /> : null} />
                <CardContent component="form" noValidate autoComplete="off">
                    <Grid container spacing={2}>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth required name="name" label="姓名" value={info. name || ''} onChange={(e) => handleInfoChange(role, e)} disabled={isFieldDisabled} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth required name="phone_number" label="联系电话" value={info.phone_number || ''} onChange={(e) => handleInfoChange(role, e)} disabled={isFieldDisabled} />
                        </Grid>
                        <Grid item xs={12}>
                            <TextField fullWidth required name="id_card_number" label="身份证号" value={info.id_card_number || ''} onChange={(e) => handleInfoChange(role, e)} disabled={isFieldDisabled} />
                        </Grid>
                        <Grid item xs={12}>
                            <TextField fullWidth required name="address" label="联系地址" value={info.address || ''} onChange={(e) => handleInfoChange(role, e)} disabled={isFieldDisabled} />
                        </Grid>
                    </Grid>
                </CardContent>
            </Card>
        );
    };

    const renderCoreDetails = () => (
        <Paper sx={{ p: 4, mb: 3 }}>
            
            <Grid container spacing={2} sx={{ mt: 1 }}>
                {contract.service_content && (
                <Grid item xs={12}>
                    <Typography><strong>服务内容:</strong> {contract.service_content || '未指定'}</ Typography>
                </Grid>
                )}
                {contract.service_type && (
                <Grid item xs={12}>
                    <Typography><strong>服务方式:</strong> {contract.service_type || '未指定'}</ Typography>
                </Grid>
                )}
                <Grid item xs={12}>
                    <Typography>
                        <strong>乙方劳务报酬:</strong> {contract.employee_level?.toFixed(2)}
                        {/* --- 核心修改：根据合同类型显示不同单位 --- */}
                        {contract.type === 'nanny_trial' ? ' 元/日' : ' 元/月'}
                    </Typography>
                </Grid>
                {contract.security_deposit_paid >0 && (
                <Grid item xs={12}>
                    <Typography><strong>保证金:</strong> {contract.security_deposit_paid?.toFixed(2 )} 元</Typography>
                </Grid>
                )}
                {contract.management_fee_amount >0 && (
                <Grid item xs={12}>
                    <Typography><strong>丙方管理费:</strong> {contract.management_fee_amount?. toFixed(2)} 元/月</Typography>
                </Grid>
                )}
                {contract.contract_type_value === 'nanny_trial' ? (
                    <Grid item xs={12}>
                        <Typography><strong>介绍费:</strong> {(contract.introduction_fee || 0)?.toFixed(2)} 元</Typography>
                    </Grid>
                ) : (
                    contract.introduction_fee > 0 && (
                        <Grid item xs={12}>
                            <Typography><strong>介绍费:</strong> {contract.introduction_fee?.toFixed(2)} 元</Typography>
                        </Grid>
                    )
                )}
                <Grid item xs={12}>
                     <Typography sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
                        <strong>合同开始时间:</strong>&nbsp;{new Date(contract.start_date). toLocaleDateString()}
                        {/* --- 核心修改：只在月嫂合同显示注解 --- */}
                        {contract.type === 'maternity_nurse' && (
                            <Box component="span" sx={{ ml: 1, color: 'text.secondary', fontSize: '0.8rem' }}>
                                (此处为用人时间，或预产期)
                            </Box>
                        )}
                    </Typography>
                </Grid>
                <Grid item xs={12}>
                    <Typography><strong>合同结束时间:</strong> {new Date(contract.end_date). toLocaleDateString()}</Typography>
                </Grid>
            </Grid>
            
        </Paper>
    );

        const renderSigningArea = () => {
        const role = contract.role;
        const title = role === 'customer' ? '甲方 (客户) 签名区' : '乙方 (服务人员) 签名区';
        const existingSignature = role === 'customer' ? contract.customer_signature : contract. employee_signature;
        const signed = !!existingSignature;
        const sigCanvasRef = role === 'customer' ? customerSigCanvas : employeeSigCanvas;

        const showCanvas = !signed || isResigning;
        const canSign = isPartyInfoValid(formValues[role]);

        return (
            <Paper sx={{ p: 3, mt: 3, border: 1, borderColor: signed ? 'success.main' : 'grey.300' }}>
                <Typography variant="h6" gutterBottom>{title}</Typography>
                {!showCanvas ? (
                    <Box>
                        <img src={existingSignature} alt="signature" style={{ maxWidth: '100%', maxHeight: '150px', borderBottom: '1px solid #ccc' }} />
                        <Typography variant="caption" display="block" sx={{mt: 1}}>您已签署</ Typography>
                        {/* 恢复“重新签署”按钮，并添加条件：只有在合同未完全签署时才显示 */}
                        {contract.signing_status !== 'signed' && (
                             <Button variant="text" size="small" sx={{mt: 1}} onClick={() => setIsResigning(true)}>
                                重新签署
                            </Button>
                        )}
                    </Box>
                ) : (
                    <>
                        <Box ref={sigContainerRef} sx={{ border: '1px dashed grey', borderRadius: 1, mb: 2, touchAction : 'none' }}>
                            {sigCanvasWidth > 0 &&
                                <SignatureCanvas ref={sigCanvasRef} penColor='black' canvasProps={{ width: sigCanvasWidth, height: 200, className: 'sigCanvas', style: { width: '100%' } }} />
                            }
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', mt: 2 }}>
                            <Button variant="outlined" onClick={() => sigCanvasRef.current.clear ()} disabled={submitting} sx={{ mr: 2 }}>
                                清除
                            </Button>
                            <Button variant="contained" color="primary" size="large" onClick={handleSign} disabled={submitting || !canSign}>
                                {submitting ? <CircularProgress size={24} color="inherit" /> : '确认签署'}
                            </Button>
                        </Box>

                        {!canSign && (
                            <Alert severity="warning" sx={{ mt: 2, justifyContent: 'center' }}>
 请完整填写您的个人信息（姓名、电话、身份证号、地址），然后才可完成签署。
                            </Alert>
                        )}
                    </>
                )}
            </Paper>
        );
    };

    if (loading) return <Container sx={{ py: 5, textAlign: 'center' }}><CircularProgress /></ Container>;
    if (error && !contract) return <Container sx={{ py: 5 }}><Alert severity="error">{error}</ Alert></Container>;
    if (!contract) return null;

    const getStatusChip = () => {
        switch (contract.signing_status) {
            case 'UNSIGNED': return <Chip label="待签署" color="warning" />;
            case 'CUSTOMER_SIGNED': return <Chip label="客户已签 / 待员工签署" color="info" />;
            case 'EMPLOYEE_SIGNED': return <Chip label="员工已签 / 待客户签署" color="info" />;
            case 'SIGNED': return <Chip label="双方已签署，合同已生效" color="success" />;
            default: return <Chip label={contract.signing_status} />;
        }
    };
    const pageTitle = contract?.type === 'maternity_nurse' 
        ? "萌姨萌嫂合同管理系统" 
        : "家福安合同管理系统";

     return (
        <Container maxWidth="md" sx={{ py: 4, position: 'relative' }}> {/* 为绝对定位的Chip设置相对定位 */}

            {/* --- 1. Logo 和 状态芯片 区域 (Logo居中，芯片在右上角) --- */}
            <Box sx={{ mb: { xs: 2, sm: 3 }, display: 'flex', justifyContent: 'center' }}>
                <Box
                    component="img"
                    src={logoSvg} // 使用导入的 logoSvg
                    alt="Logo"
                    sx={{
                        width: { xs: 80, sm: 100 },
                        height: 'auto',
                        display: 'block',
                        // 因为Box已经居中，这里不需要 margin: '0 auto'
                    }}
                />
                {/* 状态芯片通过绝对定位，放在Container的右上角 */}
                <Box sx={{ position: 'absolute', top: { xs: 8, sm: 16 }, right: { xs: 8, sm: 16 } }}>
                    {getStatusChip()}
                </Box>
            </Box>

            {/* --- 2. 头部渐变Banner (模仿 ClientEvaluation) --- */}
            <Box
                sx={{
                    background: `linear-gradient(87deg, ${theme.palette.primary.main} 0, ${theme.palette.primary.dark} 100%)`,
                    borderRadius: '0.375rem',
                    p: { xs: 2, sm: 3 },
                    mb: { xs: 2, sm: 3 }, // 底部外边距
                    color: 'white',
                    textAlign: 'center', // 文本居中
                    minHeight: { xs: 100, sm: 120 } // 确保最小高度
                }}
            >
                <Typography variant="h1" component="h1" color="white" gutterBottom sx={{ mt: { xs : 2, sm: 0 } }}>
                    {pageTitle}
                </Typography>
                <Typography variant="body1" color="white" sx={{ opacity: 0.8 }}>
                    请仔细阅读以下合同条款，并完成签署。
                </Typography>
            </Box>
            
            {/* --- 3. 主要内容区 (甲乙方信息、错误提示等) --- */}
            {/* Paper 组件现在包含甲乙方信息和错误提示，不再包含 Logo 和 Banner */}
            <Paper sx={{ p: 4, mb: 3 }}>
                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>} {/* 错误提示 */ }
                <Grid container spacing={3}>
                    <Grid item xs={12} md={6}>{renderEditablePartyInfo('customer')}</Grid>
                    <Grid item xs={12} md={6}>{renderEditablePartyInfo('employee')}</Grid>
                </Grid>
            </Paper>
            
            {/* ... 接下来是 renderCoreDetails(), 合同条款, 签名区等 ... */}
             {contract && renderCoreDetails()}
            
            <Paper sx={{ p: 4, mb: 3 }}>
                <Box sx={{ 
                    // p: 2, removed, already in parent Box.
                    
                    borderRadius: 1, 
                    '& p': { my: 1, lineHeight: 1.7 },
                    '& img': {
                        maxWidth: '100%',     
                        height: 'auto',        
                        display: 'block',      
                        margin: '0 auto',      
                        objectFit: 'contain'   
                    }
                }}>
                    <ReactMarkdown>
                        {contract.template_content
                            ? contract.template_content.replace(/(?<=[^\s])\*\*(?=[^\s])/g, '** ' )
                            : '合同条款内容加载中...'}
                    </ReactMarkdown>
                </Box>
                {contract.attachment_content && (
                    <Box sx={{ mt: 3 }}>
                        <Typography variant="h3" gutterBottom>补充协议</Typography>
                        <Box sx={{ whiteSpace: 'pre-wrap', p: 2}}>
                            {contract.attachment_content}
                        </Box>
                    </Box>
                )}
            </Paper>

            {/* Only show the signing area for the current user */}
            {contract.role && renderSigningArea()}

            {/* 只在当前用户已签署后显示关闭按钮 */}
            {(() => {
                const role = contract.role;
                const hasSigned = (role === 'customer' && contract.customer_signature) ||
                                 (role === 'employee' && contract.employee_signature);
                
                return hasSigned && (
                    <Box sx={{ mt: 4, textAlign: 'center' }}>
                        <Button 
                            variant="outlined" 
                            onClick={() => {
                                // 检测是否在微信浏览器中
                                const isWechat = /micromessenger/i.test(navigator.userAgent);
                                
                                if (isWechat) {
                                    // 微信浏览器中，显示友好提示
                                    alert('签署完成！请点击左上角关闭页面。');
                                } else {
                                    // 非微信浏览器
                                    // 1. 尝试关闭窗口（仅对脚本打开的窗口有效）
                                    const closed = window.close();
                                    
                                    // 2. 延迟检查是否关闭成功，如果没有则返回上一页
                                    setTimeout(() => {
                                        // 如果有历史记录，返回上一页
                                        if (window.history.length > 1) {
                                            window.history.back();
                                        } else {
                                            // 没有历史记录，显示提示
                                            alert('签署完成！您可以关闭此页面了。');
                                        }
                                    }, 100);
                                }
                            }}
                        >
                            关闭页面
                        </Button>
                    </Box>
                );
            })()}
        </Container>
    );
};

export default PublicSigningPage;