import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  CircularProgress,
  Typography,
  Grid,
  Button,
  Divider,
  Avatar,
  Chip,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  IconButton,
  Container,
  useTheme
} from '@mui/material';
import {
  Person as PersonIcon,
  Phone as PhoneIcon,
  Badge as BadgeIcon,
  Home as HomeIcon,
  Event as EventIcon,
  School as SchoolIcon,
  Height as HeightIcon,
  MonitorWeight as WeightIcon,
  Edit as EditIcon,
  Description as DescriptionIcon,
  ExitToApp as ExitToAppIcon,
  TrendingUp as TrendingUpIcon,
  AttachMoney as AttachMoneyIcon,
  Star as StarIcon,
  CheckCircle as CheckCircleIcon,
  History as HistoryIcon,
  Work as WorkIcon,
  Flag as FlagIcon,
  ArrowBack as ArrowBackIcon
} from '@mui/icons-material';
import api from '../api';

// Custom styled components or sx presets
const cardStyle = {
  borderRadius: '12px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  border: '1px solid rgba(0,0,0,0.02)',
  transition: 'all 0.2s',
  '&:hover': {
    boxShadow: '0 4px 6px rgba(0,0,0,0.05)',
  },
};

const iconBoxStyle = (bgcolor, color) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 64,
  height: 64,
  borderRadius: '50%',
  bgcolor: bgcolor,
  color: color,
  mr: 2
});

function StaffDetailPage() {
  const { employeeId } = useParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const [employee, setEmployee] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchDetails = async () => {
      try {
        setLoading(true);
        const response = await api.staff.getEmployeeDetails(employeeId);
        setEmployee(response.data);
      } catch (err) {
        setError('获取员工详细信息失败。');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchDetails();
  }, [employeeId]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh' }}>
        <CircularProgress size={60} thickness={4} sx={{ color: theme.palette.primary.main }} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography color="error" variant="h6">{error}</Typography>
        <Button variant="outlined" sx={{ mt: 2 }} onClick={() => navigate(-1)}>返回</Button>
      </Box>
    );
  }

  if (!employee) {
    return <Typography sx={{ p: 4 }}>未找到员工信息。</Typography>;
  }

  const entryData = employee.entry_form_data || {};
  const exitData = employee.exit_summary_data || {};

  // Handle Photo URL (might be a list or string)
  let photoUrl = entryData.photo;
  if (Array.isArray(photoUrl) && photoUrl.length > 0) {
    photoUrl = photoUrl[0];
  }

  const handleViewForm = (token, dataId) => {
    if (token && dataId) {
      navigate(`/forms/${token}/${dataId}`);
    }
  };

  // Contract type translation
  const getContractTypeName = (type) => {
    const typeMap = {
      'nanny': '育儿嫂合同',
      'maternity_nurse': '月嫂合同',
      'nanny_trial': '育儿嫂试工合同',
      'external_substitution': '外部代班合同'
    };
    return typeMap[type] || type;
  };

  // Helper for Stats Cards
  const StatCard = ({ title, value, subtext, icon, bgcolor, color }) => (
    <Card sx={cardStyle}>
      <CardContent sx={{ display: 'flex', alignItems: 'center', p: 3, '&:last-child': { pb: 3 } }}>
        <Box sx={iconBoxStyle(bgcolor, color)}>
          {icon}
        </Box>
        <Box>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500, fontSize: '0.75rem' }}>
            {title}
          </Typography>
          <Typography variant="h4" sx={{ fontWeight: 700, color: 'text.primary', my: 0.5 }}>
            {value}
          </Typography>
          {subtext && (
            <Typography variant="caption" sx={{ color: color, fontWeight: 500, fontSize: '0.75rem' }}>
              {subtext}
            </Typography>
          )}
        </Box>
      </CardContent>
    </Card>
  );

  // Helper for Info Item
  const InfoItem = ({ label, value, icon }) => (
    <Box>
      <Typography variant="caption" sx={{ display: 'block', mb: 0.5, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.75rem' }}>
        {label}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        {icon && <Box component="span" sx={{ mr: 1, color: 'text.secondary', display: 'flex', fontSize: '1rem' }}>{icon}</Box>}
        <Typography variant="body2" sx={{ fontWeight: 500, color: '#111827' }}>
          {value || <span style={{ color: '#ccc' }}>-</span>}
        </Typography>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ bgcolor: '#f0f2f5', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Container maxWidth="lg" sx={{ py: 4, flex: 1 }}>

        {/* Main Profile Header Card */}
        <Card sx={{ ...cardStyle, mb: 4, overflow: 'visible', position: 'relative' }}>
          <IconButton
            onClick={() => navigate(-1)}
            sx={{
              position: 'absolute',
              top: 24,
              right: 24,
              bgcolor: 'rgba(0,0,0,0.05)',
              '&:hover': { bgcolor: 'rgba(0,0,0,0.1)' }
            }}
          >
            <ArrowBackIcon />
          </IconButton>
          <CardContent sx={{ p: 4 }}>
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, alignItems: 'center' }}>
              <Avatar
                src={photoUrl}
                alt={employee.name}
                sx={{
                  width: 120,
                  height: 120,
                  border: '4px solid white',
                  boxShadow: '0 8px 20px rgba(0,0,0,0.15)',
                  mr: { md: 4 },
                  mb: { xs: 2, md: 0 },
                  bgcolor: 'primary.light',
                  fontSize: '3rem'
                }}
              >
                {employee.name[0]}
              </Avatar>
              <Box sx={{ flex: 1, textAlign: { xs: 'center', md: 'left' } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: { xs: 'center', md: 'flex-start' }, mb: 1 }}>
                  <Typography variant="h4" fontWeight="800" sx={{ color: 'text.primary', mr: 2 }}>
                    {employee.name}
                  </Typography>
                  <Chip
                    icon={employee.is_active ? <CheckCircleIcon /> : <PersonIcon />}
                    label={employee.is_active ? "在职员工" : "已离职"}
                    color={employee.is_active ? "success" : "default"}
                    sx={{ fontWeight: 'bold' }}
                  />
                </Box>
                <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
                  <PhoneIcon sx={{ fontSize: 16, mr: 0.5, verticalAlign: 'text-bottom' }} /> {employee.phone_number}
                  <span style={{ margin: '0 12px', color: '#ddd' }}>|</span>
                  <BadgeIcon sx={{ fontSize: 16, mr: 0.5, verticalAlign: 'text-bottom' }} /> {employee.id_card_number || '未录入身份证'}
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, justifyContent: { xs: 'center', md: 'flex-start' } }}>
                  <Button variant="contained" startIcon={<EditIcon />} sx={{ borderRadius: '8px', textTransform: 'none', fontWeight: 'bold', boxShadow: 'none' }}>
                    编辑资料
                  </Button>
                  <Button variant="outlined" startIcon={<DescriptionIcon />} sx={{ borderRadius: '8px', textTransform: 'none', fontWeight: 'bold' }}>
                    查看合同
                  </Button>
                </Box>
              </Box>
            </Box>
          </CardContent>
        </Card>

        {/* Stats Grid */}
        <Grid container spacing={3} sx={{ mb: 4 }}>
          <Grid item xs={12} sm={6} md={3}>
            <StatCard
              title="当前薪资"
              value={employee.salary_history?.[0]?.new_salary ? `¥${employee.salary_history[0].new_salary}` : "N/A"}
              subtext="最新标准"
              icon={<AttachMoneyIcon fontSize="large" />}
              bgcolor="#d1fae5"
              color="#10b981"
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <StatCard
              title="入职日期"
              value={entryData.join_date || "N/A"}
              subtext="加入公司"
              icon={<EventIcon fontSize="large" />}
              bgcolor="#dbeafe"
              color="#3b82f6"
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <StatCard
              title="综合评分"
              value="5.0"
              subtext="客户满意度"
              icon={<StarIcon fontSize="large" />}
              bgcolor="#fef3c7"
              color="#eab308"
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <StatCard
              title="服务状态"
              value="待岗"
              subtext="当前空闲"
              icon={<WorkIcon fontSize="large" />}
              bgcolor="#e0e7ff"
              color="#6366f1"
            />
          </Grid>
        </Grid>

        <Grid container spacing={4}>
          {/* Left Column: Details & History */}
          <Grid item xs={12} lg={8}>

            {/* Basic & Onboarding Info */}
            <Card sx={{ ...cardStyle, mb: 4 }}>
              <CardHeader
                title="基础与入职信息"
                titleTypographyProps={{ variant: 'h6', fontWeight: '700' }}
                avatar={<BadgeIcon sx={{ color: '#3b82f6', fontSize: 28 }} />}
                action={<Button size="small" sx={{ fontWeight: 'bold', color: '#3b82f6' }}>编辑</Button>}
                sx={{ borderBottom: '1px solid #f0f0f0', p: 3, pb: 2 }}
              />
              <CardContent sx={{ p: 3, pb: 2 }}>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <InfoItem label="现居住地址" value={employee.address} icon={<HomeIcon fontSize="small" />} />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <InfoItem label="加入公司时间" value={entryData.join_date} icon={<EventIcon fontSize="small" />} />
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <InfoItem label="生肖" value={entryData.zodiac} />
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <InfoItem label="学历" value={entryData.education} />
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <InfoItem label="身高" value={entryData.height ? `${entryData.height}cm` : null} />
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <InfoItem label="体重" value={entryData.weight ? `${entryData.weight}kg` : null} />
                  </Grid>
                </Grid>

                {entryData.id && (
                  <Box sx={{ mt: 2, pt: 2, borderTop: '1px dashed #e0e0e0' }}>
                    <Button
                      variant="text"
                      color="primary"
                      endIcon={<ExitToAppIcon />}
                      onClick={() => handleViewForm(entryData.form_token, entryData.id)}
                      sx={{ fontWeight: 'bold' }}
                    >
                      查看完整“萌嫂入职登记表”
                    </Button>
                  </Box>
                )}
              </CardContent>
            </Card>

            {/* Work History & Summary */}
            <Card sx={cardStyle}>
              <CardHeader
                title="工作履历 & 总结"
                titleTypographyProps={{ variant: 'h6', fontWeight: '700' }}
                avatar={<HistoryIcon sx={{ color: '#a855f7', fontSize: 28 }} />}
                sx={{ borderBottom: '1px solid #f0f0f0', p: 3, pb: 2 }}
              />
              <CardContent sx={{ p: 3 }}>
                {/* Timeline-like structure */}
                <Box sx={{ position: 'relative', pl: 3, borderLeft: '2px solid #f0f0f0', ml: 1 }}>

                  {/* Exit Summary Item */}
                  {exitData.id && (
                    <Box sx={{ mb: 3, position: 'relative' }}>
                      <Box sx={{
                        position: 'absolute',
                        left: '-33px',
                        top: 0,
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        bgcolor: '#f3e8ff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: '8px solid white',
                        boxShadow: '0 0 0 1px #e9d5ff'
                      }}>
                        <FlagIcon sx={{ fontSize: 12, color: '#a855f7' }} />
                      </Box>
                      <Typography variant="subtitle1" fontWeight="700" sx={{ color: '#111827', fontSize: '1.125rem' }}>下户总结 (最近)</Typography>
                      <Box sx={{ mt: 2, p: 3, bgcolor: '#fff', borderRadius: '12px', border: '1px solid #eee', boxShadow: '0 2px 10px rgba(0,0,0,0.03)' }}>
                        <Typography variant="body2" color="text.secondary" paragraph sx={{ lineHeight: 1.6 }}>
                          {exitData.summary ? (exitData.summary.length > 120 ? exitData.summary.substring(0, 120) + '...' : exitData.summary) : "暂无摘要"}
                        </Typography>
                        <Button
                          size="small"
                          endIcon={<TrendingUpIcon />}
                          onClick={() => handleViewForm(exitData.form_token, exitData.id)}
                          sx={{ fontWeight: 'bold', mt: 1 }}
                        >
                          查看完整总结
                        </Button>
                      </Box>
                    </Box>
                  )}

                  {/* Salary History Items as Timeline */}
                  {employee.salary_history && employee.salary_history.map((record, index) => (
                    <Box key={index} sx={{ mb: 3, position: 'relative' }}>
                      <Box sx={{
                        position: 'absolute',
                        left: '-33px',
                        top: 0,
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        bgcolor: '#dbeafe',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: '8px solid white',
                        boxShadow: '0 0 0 1px #bfdbfe'
                      }}>
                        <WorkIcon sx={{ fontSize: 12, color: '#3b82f6' }} />
                      </Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                        <Typography variant="subtitle1" fontWeight="700" sx={{ color: '#111827', fontSize: '1.125rem' }}>
                          {record.contract_type ? `合同: ${getContractTypeName(record.contract_type)}` : '薪资变更'}
                        </Typography>
                        <Chip label={record.effective_date} size="small" sx={{ height: 24, fontSize: '0.75rem', fontWeight: 'bold' }} />
                      </Box>

                      <Box sx={{ p: 2.5, bgcolor: '#f8f9fa', borderRadius: '12px', border: '1px solid #eee' }}>
                        <Grid container spacing={2}>
                          <Grid item xs={12} sm={6}>
                            <Typography variant="caption" color="text.secondary" fontWeight="bold">客户</Typography>
                            <Typography variant="body2" fontWeight="500">{record.customer_name || 'N/A'}</Typography>
                          </Grid>
                          <Grid item xs={12} sm={6}>
                            <Typography variant="caption" color="text.secondary" fontWeight="bold">薪资</Typography>
                            <Typography variant="body2" fontWeight="bold" color="success.main">¥{record.new_salary}</Typography>
                          </Grid>
                          <Grid item xs={12} sm={6}>
                            <Typography variant="caption" color="text.secondary" fontWeight="bold">合同开始日期</Typography>
                            <Typography variant="body2" fontWeight="500">{record.contract_start_date || 'N/A'}</Typography>
                          </Grid>
                          <Grid item xs={12} sm={6}>
                            <Typography variant="caption" color="text.secondary" fontWeight="bold">合同结束日期</Typography>
                            <Typography variant="body2" fontWeight="500">{record.contract_end_date || 'N/A'}</Typography>
                          </Grid>
                          {record.contract_notes && (
                            <Grid item xs={12}>
                              <Typography variant="caption" color="text.secondary" fontWeight="bold">备注</Typography>
                              <Typography variant="body2" color="text.secondary">{record.contract_notes}</Typography>
                            </Grid>
                          )}
                          {record.exit_summary && (
                            <Grid item xs={12}>
                              <Typography variant="caption" color="text.secondary" fontWeight="bold">下户总结</Typography>
                              {record.exit_summary.learned && (
                                <Box sx={{ mt: 1 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>学到了什么:</Typography>
                                  <Typography variant="body2" color="text.primary">{record.exit_summary.learned}</Typography>
                                </Box>
                              )}
                              {record.exit_summary.improved && (
                                <Box sx={{ mt: 1 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>需要改进:</Typography>
                                  <Typography variant="body2" color="text.primary">{record.exit_summary.improved}</Typography>
                                </Box>
                              )}
                              <Button
                                size="small"
                                onClick={() => handleViewForm(record.exit_summary.form_token, record.exit_summary.id)}
                                sx={{ mt: 1, fontSize: '0.75rem' }}
                              >
                                查看完整总结 →
                              </Button>
                            </Grid>
                          )}
                        </Grid>
                      </Box>
                    </Box>
                  ))}

                  {/* Join Item */}
                  <Box sx={{ position: 'relative' }}>
                    <Box sx={{
                      position: 'absolute',
                      left: '-33px',
                      top: 0,
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      bgcolor: '#f3f4f6',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '8px solid white',
                      boxShadow: '0 0 0 1px #e5e7eb'
                    }}>
                      <WorkIcon sx={{ fontSize: 12, color: '#6b7280' }} />
                    </Box>
                    <Typography variant="subtitle1" fontWeight="700" sx={{ color: '#111827', fontSize: '1.125rem' }}>入职</Typography>
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1, fontWeight: 'bold' }}>
                      {entryData.join_date || employee.created_at?.split('T')[0]}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      正式加入公司，开启职业生涯。
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>

          </Grid>

          {/* Right Column: Actions & Salary Summary */}
          <Grid item xs={12} lg={4}>

            {/* Salary Summary List */}
            <Card sx={cardStyle}>
              <CardHeader
                title="薪资变动概览"
                titleTypographyProps={{ variant: 'h6', fontWeight: '700' }}
                avatar={<AttachMoneyIcon sx={{ color: '#10b981', fontSize: 28 }} />}
                sx={{ borderBottom: '1px solid #f0f0f0', p: 3, pb: 2 }}
              />
              <List sx={{ p: 0 }}>
                {employee.salary_history && employee.salary_history.slice(0, 5).map((record, index) => (
                  <ListItem key={index} divider={index !== employee.salary_history.length - 1} sx={{ px: 3, py: 2 }}>
                    <ListItemIcon sx={{ minWidth: 40 }}>
                      {!record.previous_salary ? (
                        <Box sx={{ width: 32, height: 32, borderRadius: '50%', bgcolor: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <StarIcon sx={{ color: '#3b82f6', fontSize: 18 }} />
                        </Box>
                      ) : parseFloat(record.new_salary) > parseFloat(record.previous_salary) ? (
                        <Box sx={{ width: 32, height: 32, borderRadius: '50%', bgcolor: 'success.50', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <TrendingUpIcon color="success" fontSize="small" />
                        </Box>
                      ) : (
                        <Box sx={{ width: 32, height: 32, borderRadius: '50%', bgcolor: 'grey.100', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'grey.400' }} />
                        </Box>
                      )}
                    </ListItemIcon>
                    <ListItemText
                      primary={`¥${record.new_salary}`}
                      secondary={
                        <>
                          <Box component="span" sx={{ display: 'block', fontSize: '0.75rem' }}>{record.customer_name || 'N/A'}</Box>
                          <Box component="span" sx={{ display: 'block', fontSize: '0.7rem', color: 'text.disabled' }}>{record.effective_date}</Box>
                        </>
                      }
                      primaryTypographyProps={{ fontWeight: '800', color: 'text.primary' }}
                    />
                    <Chip label={getContractTypeName(record.contract_type) || '变更'} size="small" variant="outlined" sx={{ borderRadius: '6px', fontWeight: 'bold', fontSize: '0.7rem' }} />
                  </ListItem>
                ))}
                {(!employee.salary_history || employee.salary_history.length === 0) && (
                  <ListItem sx={{ p: 3 }}>
                    <ListItemText primary="暂无薪资记录" sx={{ textAlign: 'center', color: 'text.secondary' }} />
                  </ListItem>
                )}
              </List>
            </Card>

          </Grid>
        </Grid>
      </Container>
    </Box>
  );
}

export default StaffDetailPage;