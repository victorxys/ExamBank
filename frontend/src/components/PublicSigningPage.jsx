import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import {
    Container, Box, Typography, Paper, Grid, Button, CircularProgress,
    Alert, Divider, Card, CardContent, CardHeader, Chip, TextField
} from '@mui/material';
import api from '../api/axios';
import ReactMarkdown from 'react-markdown';
import SignatureCanvas from 'react-signature-canvas';

const partyInfoDefault = {
    name: '',
    phone_number: '',
    id_card_number: '',
    address: ''
};

const PublicSigningPage = () => {
    const { token } = useParams();
    const [contract, setContract] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [isResigning, setIsResigning] = useState(false);

    // Refactored State: One state for form values
    const [formValues, setFormValues] = useState({
        customer: partyInfoDefault,
        employee: partyInfoDefault,
    });

    const customerSigCanvas = useRef(null);
    const employeeSigCanvas = useRef(null);

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

    // Effect 2: Populate form when contract data is available
    useEffect(() => {
        if (contract) {
            const initialCustomerInfo = (contract.customer_info && contract.customer_info.id)
                ? contract.customer_info
                : { ...partyInfoDefault, name: contract.customer_name === '待认领' ? '' : contract.customer_name };

            const initialEmployeeInfo = (contract.employee_info && contract.employee_info.id)
                ? contract.employee_info
                : partyInfoDefault;

            console.log('Populating form with:', { initialCustomerInfo, initialEmployeeInfo });

            setFormValues({
                customer: initialCustomerInfo,
                employee: initialEmployeeInfo
            });
        }
    }, [contract]);

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
                <Grid item xs={12}>
                    <Typography><strong>服务内容:</strong> {contract.service_content || '未指定'}</ Typography>
                </Grid>
                <Grid item xs={12}>
                    <Typography><strong>服务方式:</strong> {contract.service_type || '未指定'}</ Typography>
                </Grid>
                <Grid item xs={12}>
                    <Typography><strong>乙方劳务报酬:</strong> {contract.employee_level?.toFixed( 2)} 元/月</Typography>
                </Grid>
                <Grid item xs={12}>
                    <Typography><strong>保证金:</strong> {contract.security_deposit_paid?.toFixed(2 )} 元</Typography>
                </Grid>
                <Grid item xs={12}>
                    <Typography><strong>丙方管理费:</strong> {contract.management_fee_amount?. toFixed(2)} 元/月</Typography>
                </Grid>
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
                        <Box sx={{ border: '1px dashed grey', borderRadius: 1, mb: 2, touchAction : 'none' }}>
                            <SignatureCanvas ref={sigCanvasRef} penColor='black' canvasProps={{ width: 500, height: 200, className: 'sigCanvas', style: { width: '100%' } }} />
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
            case 'unsigned': return <Chip label="待签署" color="warning" />;
            case 'customer_signed': return <Chip label="客户已签 / 待员工签署" color="info" />;
            case 'employee_signed': return <Chip label="员工已签 / 待客户签署" color="info" />;
            case 'signed': return <Chip label="双方已签署，合同已生效" color="success" />;
            default: return <Chip label={contract.signing_status} />;
        }
    };
    const pageTitle = contract?.type === 'maternity_nurse' 
        ? "月嫂合同签署" 
        : "家政服务合同签署";

    return (
        <Container maxWidth="md" sx={{ py: 4 }}>
            <Paper sx={{ p: 4, mb: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <Typography variant="h3" align="center" gutterBottom>
                        {pageTitle}
                    </Typography>
                    {getStatusChip()}
                </Box>
                <Divider sx={{ my: 2 }} />
                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                <Grid container spacing={3}>
                    <Grid item xs={12} md={6}>{renderEditablePartyInfo('customer')}</Grid>
                    <Grid item xs={12} md={6}>{renderEditablePartyInfo('employee')}</Grid>
                </Grid>
            </Paper>
             {contract && renderCoreDetails()}
            <Paper sx={{ p: 4, mb: 3 }}>
                <Box sx={{ mt: 2, p: 2, border: '1px solid #e0e0e0', borderRadius: 1, '& p': { my: 1, lineHeight: 1.7 } }}>
                    <ReactMarkdown>
                        {contract.template_content
                            ? contract.template_content.replace(/(?<=[^\s])\*\*(?=[^\s])/g, '** ')
                            : '合同条款内容加载中...'}
                    </ReactMarkdown>
                </Box>
                {contract.attachment_content && (
                    <Box sx={{ mt: 3 }}>
                        <Typography variant="h6" gutterBottom>补充协议</Typography>
                        <Box sx={{ whiteSpace: 'pre-wrap', p: 2, border: '1px solid #e0e0e0', borderRadius: 1 }}>
                            {contract.attachment_content}
                        </Box>
                    </Box>
                )}
            </Paper>

            {/* Only show the signing area for the current user */}
            {contract.role && renderSigningArea()}

            <Box sx={{ mt: 4, textAlign: 'center' }}>
                <Button variant="outlined" onClick={() => window.close()}>关闭页面</Button>
            </Box>
        </Container>
    );
};

export default PublicSigningPage;