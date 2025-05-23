// frontend/src/components/ExamRecords.jsx
import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom'
// import { useTheme } from '@mui/material' // 重复导入，下面已有
import { API_BASE_URL } from '../config';
import { getToken } from '../api/auth-utils';
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  InputAdornment,
  CircularProgress,
  Button,
  Dialog,
  DialogContent,
  useMediaQuery, // <<<--- 新增导入
  Tooltip         // <<<--- 新增导入 (如果查看概况按钮也需要 Tooltip)
} from '@mui/material'
import { useTheme,alpha } from '@mui/material/styles'; // <<<--- 确保 useTheme 在这里导入
import AlertMessage from './AlertMessage'
import {
  Search as SearchIcon,
  Visibility as VisibilityIcon,
  Assessment as AssessmentIcon // <<<--- 为“查看概况”添加图标（可选）
} from '@mui/icons-material'
import debounce from 'lodash/debounce'
import PageHeader from './PageHeader';

const KnowledgeReportDialog = lazy(() => import('./KnowledgeReportDialog'));

const LoadingFallback = () => (
  <Dialog open={true} PaperProps={{ style: { backgroundColor: 'transparent', boxShadow: 'none' } }}> 
    <DialogContent sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100px' }}>
      <CircularProgress />
    </DialogContent>
  </Dialog>
);

function ExamRecords() {
  const navigate = useNavigate()
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm')); // <<<--- 判断是否为手机端

  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('')
  const [examDetailDialogOpen, setExamDetailDialogOpen] = useState(false);
  const [examDetail, setExamDetail] = useState(null);


  const debouncedSetSearch = useCallback(
    debounce((value) => {
      setDebouncedSearchTerm(value)
    }, 300),
    []
  )

  const handleSearchChange = (event) => {
    const value = event.target.value
    setSearchTerm(value)
    debouncedSetSearch(value)
  }

  useEffect(() => {
    fetchRecords()
  }, [debouncedSearchTerm])


  const handleViewReportButtonClick = (examId, isPublic) => {
    if (examId) {
      setExamDetail({ exam_id: examId, isPublic: isPublic });
      setExamDetailDialogOpen(true);  
    }
  };

  const handleExamDetailClose = () => {
    setExamDetailDialogOpen(false);
    setExamDetail(null);
  };

  const fetchRecords = async () => {
    try {
      setLoading(true);
      let apiUrl = `${API_BASE_URL}/exam-records`; 
      if (debouncedSearchTerm) {
        apiUrl += `?search=${encodeURIComponent(debouncedSearchTerm)}`;
      }
      const token = getToken();
      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`获取考试记录失败 (status: ${response.status}): ${errorText}`);
      }
      const data = await response.json();
      setRecords(data);
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <AlertMessage
          open={true}
          message={error}
          severity="error"
          onClose={() => setError(null)}
        />
      </Box>
    )
  }

  // 根据屏幕尺寸计算 colSpan
  // 手机端列数: 考试名称, 分数, 题目数量, 操作 (4 列)
  // 桌面端列数: 考试名称, 考生, 考试时间, 分数, 正确率, 课程, 题目数量, 操作 (8 列)
  const tableColSpan = isMobile ? 3 : 8;


  return (
    <Box sx={{ width: '100%', minHeight: '100vh' }}> {/* 确保最小高度 */}
      <PageHeader
        title="考试记录"
        description="这里列出了所有的考试记录，您可以查看所有考试记录。"
      />
      
      <Card > 
        <CardContent>
          <Box sx={{ mb: 3 }}>
            <TextField 
              fullWidth
              variant="outlined"
              placeholder="搜索考生姓名或手机号..."
              value={searchTerm}
              onChange={handleSearchChange}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: '0.375rem',
                  '&:hover fieldset': {
                    borderColor: theme.palette.primary.main, // 使用 theme
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: theme.palette.primary.main, // 使用 theme
                  },
                },
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: theme.palette.text.secondary }} /> {/* 使用 theme */}
                  </InputAdornment>
                ),
              }}
            />
          </Box>

          <TableContainer
            component={Paper}
            sx={{
              boxShadow: 'none',
              border: `1px solid ${theme.palette.divider}`, 
              borderRadius: '0.375rem',
              overflow: 'hidden' 
            }}
          >
            <Table stickyHeader aria-label="考试记录表格">
              <TableHead>
                <TableRow>
                  <TableCell sx={{fontWeight: 'bold'}}>考试名称</TableCell>
                  {!isMobile && <TableCell sx={{fontWeight: 'bold'}}>考生</TableCell>}
                  {!isMobile && <TableCell sx={{fontWeight: 'bold'}}>考试时间</TableCell>}
                  <TableCell sx={{fontWeight: 'bold'}} align="right">分数</TableCell>
                  {!isMobile && <TableCell sx={{fontWeight: 'bold'}} align="right">正确率</TableCell>}
                  {!isMobile && <TableCell sx={{fontWeight: 'bold'}}>课程</TableCell>}
                  {!isMobile && <TableCell sx={{fontWeight: 'bold', minWidth: isMobile ? 'auto' : 150 }} align={isMobile ? 'right' : 'left'}>
                    题目数量
                  </TableCell>}
                  
                  <TableCell sx={{fontWeight: 'bold'}} align="center">操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loading && records.length === 0 ? ( // 初始加载时显示
                  <TableRow>
                    <TableCell colSpan={tableColSpan} align="center" sx={{py: 5}}>
                      <CircularProgress />
                    </TableCell>
                  </TableRow>
                ) : !loading && records.length === 0 ? ( // 加载完成但无数据
                  <TableRow>
                    <TableCell colSpan={tableColSpan} align="center">
                      <Typography variant="body1" sx={{ py: 5, color: theme.palette.text.secondary }}>
                        {debouncedSearchTerm ? `没有找到与 "${debouncedSearchTerm}" 相关的考试记录` : "暂无考试记录"}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  records.map((record) => (
                    <TableRow
                      key={`${record.exam_paper_id}-${record.user_id}-${record.exam_time}`}
                      hover // 增加 hover 效果
                      sx={{
                        '&:last-child td, &:last-child th': { border: 0 }
                      }}
                    >
                      <TableCell>
                        <Box>
                          <Typography variant="subtitle2" sx={{ color: theme.palette.text.primary, fontWeight: 600 }}>
                            {record.exam_title}
                          </Typography>
                          {record.exam_description && !isMobile && ( 
                            <Typography variant="caption" sx={{ color: theme.palette.text.secondary, display: 'block' }}>
                              {record.exam_description}
                            </Typography>
                          )}
                        </Box>
                      </TableCell>
                      {!isMobile && <TableCell sx={{ color: theme.palette.text.secondary }}>{record.user_name || '未知'}</TableCell>}
                      {!isMobile && (
                        <TableCell sx={{ color: theme.palette.text.secondary, minWidth: 140 }}>
                          {record.exam_time
                            ? new Date(record.exam_time).toLocaleString('zh-CN', {
                                year: 'numeric', month: '2-digit', day: '2-digit',
                                hour: '2-digit', minute: '2-digit'
                              })
                            : 'N/A'}
                        </TableCell>
                      )}
                      <TableCell align="right">
                        <Typography
                          variant="body2"
                          sx={{
                            color: record.total_score >= 60 ? theme.palette.success.main : theme.palette.error.main,
                            fontWeight: 600,
                            backgroundColor: record.total_score >= 60 ? alpha(theme.palette.success.main, 0.1) : alpha(theme.palette.error.main, 0.1),
                            borderRadius: '0.25rem',
                            px: 1, py: 0.5, display: 'inline-block'
                          }}
                        >
                          {record.total_score !== null && record.total_score !== undefined ? record.total_score.toFixed(1) : '- '}
                        </Typography>
                      </TableCell>
                      {!isMobile && (
                        <TableCell align="right">
                          <Typography variant="body2" 
                          sx={{
                            color: record.total_score >= 60 ? theme.palette.success.main : theme.palette.error.main,
                            fontWeight: 600,
                            backgroundColor: record.total_score >= 60 ? alpha(theme.palette.success.main, 0.1) : alpha(theme.palette.error.main, 0.1),
                            borderRadius: '0.25rem',
                            px: 1, py: 0.5, display: 'inline-block'
                          }}
                          >
                            {record.accuracy_rate !== null && record.accuracy_rate !== undefined ? (record.accuracy_rate * 100).toFixed(1) : '- '}%
                          </Typography>
                        </TableCell>
                      )}
                      {!isMobile && (
                        <TableCell>
                          <Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>
                            {record.courses && record.courses.length > 0 ? record.courses.join(', ') : 'N/A'}
                          </Typography>
                        </TableCell>
                      )}
                      {!isMobile && (
                      <TableCell align={isMobile ? 'right' : 'left'}> 
                        <Box sx={{fontSize: '0.75rem', color: theme.palette.text.secondary}}>
                            {isMobile ? "单/" : "单选题: "}
                            <Box component="span" sx={{ color: theme.palette.success.dark, fontWeight: 'bold' }}>{record.single_choice_correct || 0}</Box>/
                            <Box component="span" sx={{ color: theme.palette.error.dark, fontWeight: 'bold' }}>{record.single_choice_incorrect || 0}</Box>/
                            {record.single_choice_total || 0}
                        </Box>
                        <Box sx={{fontSize: '0.75rem', color: theme.palette.text.secondary, mt: isMobile ? 0.2 : 0}}>
                           {isMobile ? "多/" : "多选题: "}
                           <Box component="span" sx={{ color: theme.palette.success.dark, fontWeight: 'bold' }}>{record.multi_choice_correct || 0}</Box>/
                           <Box component="span" sx={{ color: theme.palette.error.dark, fontWeight: 'bold' }}>{record.multi_choice_incorrect || 0}</Box>/
                           {record.multi_choice_total || 0}
                        </Box>
                      </TableCell>
                      )}
                      <TableCell align="center">
                        <Box sx={{display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: 'center', justifyContent: 'center', gap: isMobile ? 0.5 : 1}}>
                            <Tooltip title="查看答题详情">
                                <Button
                                    variant={isMobile ? "text" : "contained"}
                                    size="small"
                                    startIcon={<VisibilityIcon />}
                                    onClick={() => navigate(`/exam-records/${record.exam_paper_id}/${record.user_id}?exam_time=${encodeURIComponent(record.exam_time.toString())}`, { state: record })}
                                    sx={{minWidth: isMobile? 'auto': undefined, p: isMobile ? 0.5 : undefined}}
                                >
                                    {!isMobile && "详情"}
                                </Button>
                            </Tooltip>
                            <Tooltip title="查看知识点概况">
                                <Button
                                    variant={isMobile ? "text" : "outlined"} // 手机端用文本按钮
                                    color="primary"
                                    size="small"
                                    startIcon={<AssessmentIcon />} // 添加图标
                                    onClick={() => handleViewReportButtonClick(record.exam_id, true)}
                                    sx={{minWidth: isMobile? 'auto': undefined, p: isMobile ? 0.5 : undefined }}
                                >
                                    {!isMobile && "概况"}
                                </Button>
                            </Tooltip>
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {examDetailDialogOpen && (
        <Suspense fallback={<LoadingFallback />}>
          <KnowledgeReportDialog
            open={examDetailDialogOpen}
            onClose={handleExamDetailClose}
            examId={examDetail?.exam_id}
          />
        </Suspense>
      )}
    </Box>
  )
}

export default ExamRecords