import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import {
    Container, Box, Typography, Paper, Grid, Button, CircularProgress,
    Alert, Divider, Card, CardContent, CardHeader, Chip
} from '@mui/material';
import api from '../api/axios';
import ReactMarkdown from 'react-markdown';
import SignatureCanvas from 'react-signature-canvas';

const PublicSigningPage = () => {
    const { token } = useParams();
    const [contract, setContract] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState({ customer: false, employee: false });
    const [isResigning, setIsResigning] = useState({ customer: false, employee: false });
    const customerSigCanvas = useRef(null);
    const employeeSigCanvas = useRef(null);

    const fetchContract = useCallback(async () => {
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
    }, [token]);

    useEffect(() => {
        fetchContract();
    }, [fetchContract]);

    const handleSign = async (role) => {
        const sigCanvas = role === 'customer' ? customerSigCanvas.current : employeeSigCanvas. current;
        if (sigCanvas.isEmpty()) {
            setError(`请在签名区域写下您的签名。`);
            return;
        }

        const signature = sigCanvas.toDataURL('image/png');
        setSubmitting(prev => ({ ...prev, [role]: true }));
        setError('');

        try {
            await api.post(`/contracts/sign/${token}`, { signature });
            // After signing, clear the resigning state and refresh the contract data
            setIsResigning(prev => ({ ...prev, [role]: false }));
            fetchContract();
        } catch (err)
{
            setError(err.response?.data?.error || '签名提交失败，请重试。');
        } finally {
            setSubmitting(prev => ({ ...prev, [role]: false }));
        }
    };

    const renderPartyInfo = (title, party) => (
        <Card variant="outlined">
            <CardHeader title={title} />
            <CardContent>
                {party ? (
                    <Grid container spacing={1}>
                        <Grid item xs={4}><Typography variant="body2" color="text.secondary"> 姓名:</Typography></Grid>
                        <Grid item xs={8}><Typography>{party.name}</Typography></Grid>
                        <Grid item xs={4}><Typography variant="body2" color="text.secondary"> 身份证号:</Typography></Grid>
                        <Grid item xs={8}><Typography>{party.id_card_number}</Typography></Grid>
                        <Grid item xs={4}><Typography variant="body2" color="text.secondary"> 联系电话:</Typography></Grid>
                        <Grid item xs={8}><Typography>{party.phone_number}</Typography></Grid>
                        <Grid item xs={4}><Typography variant="body2" color="text.secondary"> 地址:</Typography></Grid>
                        <Grid item xs={8}><Typography>{party.address}</Typography></Grid>
                    </Grid>
                ) : <Typography>信息不可用</Typography>}
            </CardContent>
        </Card>
    );

    const renderSigningArea = (role, existingSignature) => {
        const title = role === 'customer' ? '甲方 (客户) 签名区' : '乙方 (服务人员) 签名区';
        const isCurrentUser = contract.role === role;
        const signed = !!existingSignature;
        const sigCanvasRef = role === 'customer' ? customerSigCanvas : employeeSigCanvas;
        const isCurrentUserResigning = isResigning[role];

        const showCanvas = isCurrentUser && (!signed || isCurrentUserResigning);

        return (
            <Paper sx={{ p: 3, mt: 3, border: 1, borderColor: signed ? 'success.main' : 'grey.300' }}>
                <Typography variant="h6" gutterBottom>{title}</Typography>

                {!showCanvas ? (
                    // 场景1: 显示签名状态 (非签名模式)
                    <Box>
                        {signed ? (
                            // 如果已签名
                            <>
                                {isCurrentUser ? (
                                    // A. 如果是当前用户, 显示自己的签名图片和重签按钮
                                    <>
                                        <img src={existingSignature} alt="signature" style={{ maxWidth: '100%', maxHeight: '150px', borderBottom: '1px solid #ccc' }} />
                                        <Typography variant="caption" display="block" sx={{mt: 1 }}>您已签署</Typography>
                                        {contract.signing_status !== 'signed' && (
                                            <Button
                                                variant="text"
                                                size="small"
                                                sx={{mt: 1}}
                                                onClick={() => setIsResigning(prev => ({...prev, [role]: true}))}
                                            >
                                                重新签署
                                            </Button>
                                        )}
                                    </>
                                ) : (
                                    // B. 如果是对方, 只显示状态,不显示图片
                                    <Typography variant="body1" color="success.main">
                                        对方已签署
                                    </Typography>
                                )}
                            </>
                        ) : (
                            // 如果未签名
                            <Typography sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
                                (待签署)
                            </Typography>
                        )}
                    </Box>
                ) : (
                    // 场景2: 当前用户进行签名或重签
                    <>
                        <Box sx={{ border: '1px dashed grey', borderRadius: 1, mb: 2, touchAction : 'none' }}>
                            <SignatureCanvas
                                ref={sigCanvasRef}
                                penColor='black'
                                canvasProps={{ width: 500, height: 200, className: 'sigCanvas', style: { width: '100%' } }}
                            />
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', mt: 2 }}>
                            <Button
                                variant="outlined"
                                onClick={() => sigCanvasRef.current.clear()}
                                disabled={submitting[role]}
                                sx={{ mr: 2 }}
                            >
                                清除
                            </Button>
                            <Button
                                variant="contained"
                                color="primary"
                                size="large"
                                onClick={() => handleSign(role)}
                                disabled={submitting[role]}
                            >
                                {submitting[role] ? <CircularProgress size={24} color="inherit" /> : '确认签署'}
                            </Button>
                        </Box>
                    </>
                )}
            </Paper>
        );
    };

    if (loading) {
        return <Container sx={{ py: 5, textAlign: 'center' }}><CircularProgress /></Container>;
    }

    if (error && !contract) {
        return <Container sx={{ py: 5 }}><Alert severity="error">{error}</Alert></Container>;
    }

    if (!contract) {
        return null;
    }

    const getStatusChip = () => {
        switch (contract.signing_status) {
            case 'unsigned': return <Chip label="待签署" color="warning" />;
            case 'customer_signed': return <Chip label="客户已签 / 待员工签署" color="info" />;
            case 'employee_signed': return <Chip label="员工已签 / 待客户签署" color="info" />;
            case 'signed': return <Chip label="双方已签署，合同已生效" color="success" />;
            default: return <Chip label={contract.signing_status} />;
        }
    };

    return (
        <Container maxWidth="md" sx={{ py: 4 }}>
            <Paper sx={{ p: 4, mb: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <Typography variant="h4" gutterBottom>合同签署</Typography>
                    {getStatusChip()}
                </Box>
                <Typography variant="body2" color="text.secondary">合同ID: {contract.contract_id }</Typography>
                <Divider sx={{ my: 2 }} />
                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                <Grid container spacing={3}>
                    <Grid item xs={12} md={6}>{renderPartyInfo('甲方 (客户)', contract. customer_info)}</Grid>
                    <Grid item xs={12} md={6}>{renderPartyInfo('乙方 (服务人员)', contract. employee_info)}</Grid>
                </Grid>
            </Paper>

            <Paper sx={{ p: 4, mb: 3 }}>
                <Typography variant="h5" gutterBottom>合同条款</Typography>
                <Box sx={{
                    mt: 2, p: 2, border: '1px solid #e0e0e0', borderRadius: 1,
                    '& h1, & h2, & h3, & h4': { mt: 2.5, mb: 1.5 },
                    '& p': { my: 1, lineHeight: 1.7 },
                    '& ul, & ol': { pl: 3 },
                    '& li': { mb: 0.5 }
                }}>
                    <ReactMarkdown>
                        {contract.service_content || '合同条款内容加载中...'}
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

            {/* 最终渲染逻辑 */}
            {renderSigningArea('customer', contract.customer_signature)}
            {renderSigningArea('employee', contract.employee_signature)}

            <Box sx={{ mt: 4, textAlign: 'center' }}>
                <Button variant="outlined" onClick={() => window.close()}>关闭页面</Button>
            </Box>
        </Container>
    );
};

export default PublicSigningPage;