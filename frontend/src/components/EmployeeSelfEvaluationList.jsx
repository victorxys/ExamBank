import React, { useState, useEffect } from 'react';
import { 
  Container, 
  Typography, 
  Table, 
  TableBody, 
  TableCell, 
  TableContainer, 
  TableHead, 
  TableRow,
  Button,
  Box,
  CircularProgress,
  useMediaQuery,
  useTheme,
  Card,
  CardContent,
  CardHeader,
  Divider,
  Paper,
  TextField,
  TablePagination,
  IconButton,
  Tooltip,
  Chip
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';
import PageHeader from './PageHeader';
import AlertMessage from './AlertMessage';
import { formatRelativeTime } from '../api/dateUtils';
import AddIcon from '@mui/icons-material/Add';
import VisibilityIcon from '@mui/icons-material/Visibility';

const EmployeeSelfEvaluationList = () => {
  const [evaluations, setEvaluations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');
  const [alertSeverity, setAlertSeverity] = useState('error');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('evaluation_time');
  const [sortOrder, setSortOrder] = useState('desc');
  const [totalEvaluations, setTotalEvaluations] = useState(0);
  
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  useEffect(() => {
    fetchEvaluations();
  }, [page, rowsPerPage, searchTerm, sortBy, sortOrder]);

  const fetchEvaluations = async () => {
    try {
      setLoading(true);
      const response = await api.get('/employee-self-evaluations', {
        params: {
          page: page + 1,
          per_page: rowsPerPage,
          search: searchTerm,
          sort_by: sortBy,
          sort_order: sortOrder
        }
      });
      
      setEvaluations(response.data.evaluations || []);
      setTotalEvaluations(response.data.total || 0);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching evaluations:', err);
      setError('Failed to load evaluations. Please try again later.');
      setAlertMessage('获取员工自评列表失败，请稍后重试');
      setAlertSeverity('error');
      setAlertOpen(true);
      setLoading(false);
    }
  };

  const handleViewDetails = (evaluationId) => {
    navigate(`/employee-self-evaluations/${evaluationId}`);
  };

  const handleCreateEvaluation = () => {
    navigate('/public-employee-self-evaluation');
  };

  const handleAlertClose = () => {
    setAlertOpen(false);
  };

  const handleChangePage = (event, newPage) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };
  
  const handleSort = (column) => {
    const isAsc = sortBy === column && sortOrder === 'asc';
    setSortOrder(isAsc ? 'desc' : 'asc');
    setSortBy(column);
  };

  // 过滤评估列表
  const filteredEvaluations = searchTerm.trim() === '' 
    ? evaluations 
    : evaluations.filter(evaluation => 
        evaluation.employee_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        evaluation.phone_number?.includes(searchTerm)
      );

  const getScoreColor = (score) => {
    if (!score) return 'default';
    if (score >= 80) return 'success';
    if (score >= 60) return 'primary';
    if (score >= 40) return 'warning';
    return 'error';
  };

  return (
    <Box sx={{ width: '100%', height: '100%' }}>
      <AlertMessage 
        open={alertOpen} 
        message={alertMessage} 
        severity={alertSeverity} 
        onClose={handleAlertClose} 
      />
      
      <PageHeader 
        title="员工自评列表" 
        description="查看所有员工提交的自我评价" 
      />
      
      <Card sx={{ 
        boxShadow: '0 0 2rem 0 rgba(136, 152, 170, .15)',
        backgroundColor: 'white',
        borderRadius: '0.375rem'
      }}>
        <CardHeader
          sx={{ p: 3 }}
          title={
            <Box display="flex" justifyContent="space-between" alignItems="center" gap={2}>
              <Box display="flex" gap={2} flex={1}>
                <TextField
                  size="small"
                  placeholder="搜索员工姓名或手机号"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  fullWidth
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: '0.375rem',
                      '&:hover fieldset': {
                        borderColor: theme.palette.primary.main,
                      },
                      '&.Mui-focused fieldset': {
                        borderColor: theme.palette.primary.main,
                      },
                    },
                  }}
                />
              </Box>
              <Button
                variant="contained"
                color="primary"
                startIcon={<AddIcon />}
                onClick={handleCreateEvaluation}
                sx={{
                  background: 'linear-gradient(87deg, #5e72e4 0, #825ee4 100%)',
                  '&:hover': {
                    background: 'linear-gradient(87deg, #4050e0 0, #6f4ed4 100%)',
                  },
                }}
              >
                创建自评
              </Button>
            </Box>
          }
        />
        <CardContent sx={{ p: 3 }}>
          <TableContainer
            component={Paper}
            sx={{
              boxShadow: 'none',
              border: '1px solid rgba(0, 0, 0, 0.1)',
              borderRadius: '0.375rem',
              overflow: 'auto',
              maxWidth: '100%'
            }}
          >
            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                <CircularProgress />
              </Box>
            ) : (
              <>
                <Table sx={{ minWidth: isMobile ? 300 : 650 }}>
                  <TableHead>
                    <TableRow sx={{ backgroundColor: theme.palette.primary.main }}>
                      <TableCell 
                        sx={{ 
                          color: 'white', 
                          fontWeight: 'bold',
                          whiteSpace: 'nowrap', 
                          padding: { xs: '8px', sm: '16px' },
                          cursor: 'pointer'
                        }}
                        onClick={() => handleSort('employee_name')}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          员工姓名
                          {sortBy === 'employee_name' && (
                            <Box component="span" sx={{ ml: 0.5 }}>
                              {sortOrder === 'asc' ? '↑' : '↓'}
                            </Box>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell 
                        sx={{ 
                          color: 'white', 
                          fontWeight: 'bold',
                          whiteSpace: 'nowrap', 
                          padding: { xs: '8px', sm: '16px' } 
                        }}
                      >
                        联系电话
                      </TableCell>
                      <TableCell 
                        sx={{ 
                          color: 'white', 
                          fontWeight: 'bold',
                          whiteSpace: 'nowrap', 
                          padding: { xs: '8px', sm: '16px' },
                          cursor: 'pointer'
                        }}
                        onClick={() => handleSort('evaluation_time')}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          评价时间
                          {sortBy === 'evaluation_time' && (
                            <Box component="span" sx={{ ml: 0.5 }}>
                              {sortOrder === 'asc' ? '↑' : '↓'}
                            </Box>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell 
                        sx={{ 
                          color: 'white', 
                          fontWeight: 'bold',
                          whiteSpace: 'nowrap', 
                          padding: { xs: '8px', sm: '16px' },
                          cursor: 'pointer'
                        }}
                        onClick={() => handleSort('avg_score')}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          总平均分
                          {sortBy === 'avg_score' && (
                            <Box component="span" sx={{ ml: 0.5 }}>
                              {sortOrder === 'asc' ? '↑' : '↓'}
                            </Box>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell 
                        sx={{ 
                          color: 'white', 
                          fontWeight: 'bold',
                          whiteSpace: 'nowrap', 
                          padding: { xs: '8px', sm: '16px' } 
                        }}
                      >
                        各方面评分
                      </TableCell>
                      <TableCell 
                        align="center"
                        sx={{ 
                          color: 'white', 
                          fontWeight: 'bold',
                          whiteSpace: 'nowrap', 
                          padding: { xs: '8px', sm: '16px' } 
                        }}
                      >
                        操作
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredEvaluations.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                          暂无员工自评记录
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredEvaluations.map((evaluation) => (
                        <TableRow 
                          key={evaluation.id} 
                          hover
                          sx={{
                            '&:hover': {
                              backgroundColor: 'rgba(94, 114, 228, 0.05)',
                            }
                          }}
                        >
                          <TableCell 
                            sx={{ 
                              color: '#525f7f', 
                              whiteSpace: 'nowrap', 
                              padding: { xs: '8px', sm: '16px' },
                              cursor: 'pointer',
                              '&:hover': {
                                color: 'primary.main',
                                textDecoration: 'underline'
                              }
                            }}
                            onClick={() => handleViewDetails(evaluation.id)}
                          >
                            {evaluation.employee_name}
                          </TableCell>
                          <TableCell sx={{ color: '#525f7f', whiteSpace: 'nowrap', padding: { xs: '8px', sm: '16px' } }}>
                            {evaluation.phone_number}
                          </TableCell>
                          <TableCell sx={{ color: '#525f7f', whiteSpace: 'nowrap', padding: { xs: '8px', sm: '16px' } }}>
                            {formatRelativeTime(evaluation.evaluation_time)}
                          </TableCell>
                          <TableCell 
                            sx={{ 
                              color: '#525f7f', 
                              whiteSpace: 'nowrap', 
                              padding: { xs: '8px', sm: '16px' },
                              fontWeight: 'bold'
                            }}
                          >
                            <Chip 
                              label={evaluation.avg_score || 'N/A'} 
                              color={getScoreColor(evaluation.avg_score)}
                              sx={{ fontWeight: 'bold' }}
                            />
                          </TableCell>
                          <TableCell sx={{ padding: { xs: '8px', sm: '16px' } }}>
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                              {Object.entries(evaluation.aspect_scores || {}).map(([aspect, score]) => (
                                <Tooltip key={aspect} title={`${aspect}: ${score}`} arrow>
                                  <Chip 
                                    size="small"
                                    label={`${aspect.substring(0, 4)}: ${score}`} 
                                    color={getScoreColor(score)}
                                    sx={{ 
                                      fontSize: '0.75rem',
                                      maxWidth: { xs: '80px', sm: '120px' }
                                    }}
                                  />
                                </Tooltip>
                              ))}
                              {!evaluation.aspect_scores || Object.keys(evaluation.aspect_scores).length === 0 && (
                                <Typography variant="body2" color="text.secondary">
                                  暂无数据
                                </Typography>
                              )}
                            </Box>
                          </TableCell>
                          <TableCell align="center" sx={{ whiteSpace: 'nowrap', padding: { xs: '4px', sm: '16px' } }}>
                            <IconButton
                              color="primary"
                              onClick={() => handleViewDetails(evaluation.id)}
                              size="small"
                              sx={{ 
                                padding: { xs: '4px', sm: '8px' },
                                boxShadow: '0 4px 6px rgba(50,50,93,.11), 0 1px 3px rgba(0,0,0,.08)',
                                transition: 'all .15s ease',
                                '&:hover': {
                                  transform: 'translateY(-1px)',
                                  boxShadow: '0 7px 14px rgba(50,50,93,.1), 0 3px 6px rgba(0,0,0,.08)'
                                }
                              }}
                            >
                              <VisibilityIcon fontSize={isMobile ? "small" : "medium"} />
                            </IconButton>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
                <TablePagination
                  component="div"
                  count={totalEvaluations}
                  page={page}
                  onPageChange={handleChangePage}
                  rowsPerPage={rowsPerPage}
                  onRowsPerPageChange={handleChangeRowsPerPage}
                  rowsPerPageOptions={[5, 10, 25, 50]}
                  labelRowsPerPage="每页行数:"
                  labelDisplayedRows={({ from, to, count }) => `${from}-${to} 共 ${count}`}
                />
              </>
            )}
          </TableContainer>
        </CardContent>
      </Card>
    </Box>
  );
};

export default EmployeeSelfEvaluationList;