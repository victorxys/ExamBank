import React, { useState } from 'react';
import { Card, CardContent, Typography, Box, IconButton, Chip, Dialog, DialogTitle, DialogContent, DialogActions, Button } from '@mui/material';
import { Link } from 'react-router-dom';
import DescriptionIcon from '@mui/icons-material/Description';
import QuizIcon from '@mui/icons-material/Quiz';
import VisibilityIcon from '@mui/icons-material/Visibility';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import ModeEditOutlineIcon from '@mui/icons-material/ModeEditOutline';
import { QRCodeSVG } from 'qrcode.react';

const FormCard = ({ form, isDragging }) => {
    const isExam = form.form_type === 'EXAM';
    const [qrDialogOpen, setQrDialogOpen] = useState(false);

    // Generate full URL for QR code
    const formUrl = `${window.location.origin}/forms/${form.form_token}`;

    // Get data count (you'll need to pass this from parent or fetch it)
    const dataCount = form.submission_count || 0;

    return (
        <Card
            sx={{
                cursor: 'grab',
                '&:hover': {
                    boxShadow: 6,
                    transform: 'translateY(-2px)',
                    transition: 'all 0.3s ease'
                },
                opacity: isDragging ? 0.5 : 1,
                width: '168px',
                height: '200px',
                position: 'relative',
                overflow: 'hidden'
            }}
        >
            <CardContent sx={{
                padding: '12px !important',
                display: 'flex',
                flexDirection: 'column',
                height: '100%'
            }}>
                <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={1}>
                    {isExam ? (
                        <QuizIcon sx={{ fontSize: 40, color: '#fb6340' }} />
                    ) : (
                        <DescriptionIcon sx={{ fontSize: 40, color: '#11cdef' }} />
                    )}
                    <Chip
                        label={isExam ? '考试' : '问卷'}
                        size="small"
                        sx={{
                            backgroundColor: isExam ? '#fb6340' : '#11cdef',
                            color: 'white',
                            fontWeight: 'bold'
                        }}
                    />
                </Box>

                <Typography variant="subtitle1" gutterBottom sx={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    minHeight: '2.5em',
                    fontSize: '0.95rem'
                }}>
                    {form.name}
                </Typography>

                {/* Data Count */}
                <Typography variant="caption" color="text.secondary" sx={{ mb: 1 }}>
                    {dataCount} 条数据
                </Typography>

                <Box display="flex" gap={1} mt="auto">
                    <IconButton
                        size="small"
                        onClick={(e) => {
                            e.stopPropagation();
                            setQrDialogOpen(true);
                        }}
                        title="分享二维码"
                        sx={{
                            backgroundColor: '#f6f9fc',
                            '&:hover': { backgroundColor: '#e9ecef' }
                        }}
                    >
                        <QrCode2Icon fontSize="small" />
                    </IconButton>
                    <IconButton
                        size="small"
                        component={Link}
                        to={isExam ? `/exams/${form.form_token}/results` : `/forms/${form.form_token}/data`}
                        title="查看数据"
                        sx={{
                            backgroundColor: '#f6f9fc',
                            '&:hover': { backgroundColor: '#e9ecef' }
                        }}
                    >
                        <VisibilityIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                        size="small"
                        component="a"
                        href={`/forms/edit/${form.form_token}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="编辑表单"
                        sx={{
                            backgroundColor: '#f6f9fc',
                            '&:hover': { backgroundColor: '#e9ecef' }
                        }}
                    >
                        <ModeEditOutlineIcon fontSize="small" />
                    </IconButton>
                </Box>
            </CardContent>

            {/* QR Code Dialog */}
            <Dialog
                open={qrDialogOpen}
                onClose={(e) => {
                    e.stopPropagation();
                    setQrDialogOpen(false);
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <DialogTitle>扫码填写表单</DialogTitle>
                <DialogContent sx={{ textAlign: 'center', pt: 3 }}>
                    <QRCodeSVG
                        value={formUrl}
                        size={256}
                        level="H"
                        includeMargin={true}
                    />
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                        {form.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                        使用微信或其他扫码工具扫描二维码
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={(e) => {
                        e.stopPropagation();
                        setQrDialogOpen(false);
                    }}>关闭</Button>
                </DialogActions>
            </Dialog>
        </Card>
    );
};

export default FormCard;
