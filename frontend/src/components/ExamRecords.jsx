import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTheme } from '@mui/material'
import { API_BASE_URL } from '../config';
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
  Button
} from '@mui/material'
import AlertMessage from './AlertMessage'
import {
  Search as SearchIcon,
  Visibility as VisibilityIcon,
  School as SchoolIcon,
  Lightbulb as LightbulbIcon,
  Person as PersonIcon,
  Notifications as NotificationsIcon
} from '@mui/icons-material'
import debounce from 'lodash/debounce'
// console.log('API_BASE_URL:', API_BASE_URL); // 输出 API_BASE_URL 的值
// console.log('url:', url); // 输出 url 的值
// console.log('url.toString():', url.toString()); // 输出 url 的字符串形式

function ExamRecords() {
  const navigate = useNavigate()
  const theme = useTheme()
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('')

  // 创建一个防抖的搜索函数
  const debouncedSetSearch = useCallback(
    debounce((value) => {
      setDebouncedSearchTerm(value)
    }, 300),
    []
  )

  // 处理搜索输入
  const handleSearchChange = (event) => {
    const value = event.target.value
    setSearchTerm(value)
    debouncedSetSearch(value)
  }

  // 使用防抖后的搜索词进行搜索
  useEffect(() => {
    // console.log('useEffect 被触发了');
    fetchRecords()
  }, [debouncedSearchTerm])


  const fetchRecords = async () => {
    // console.log('fetchRecords 被调用');
    try {
      setLoading(true);
      let apiUrl = `${API_BASE_URL}/exam-records`; // 基础 URL
  
      if (debouncedSearchTerm) {
        // 添加查询参数 (使用 encodeURIComponent 编码)
        apiUrl += `?search=${encodeURIComponent(debouncedSearchTerm)}`;
      }
      // console.log('API URL:', apiUrl);
  
      const response = await fetch(apiUrl);
  
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`获取考试记录失败 (status: ${response.status}): ${errorText}`);
      }
  
      const data = await response.json();
      // console.log('获取到的考试记录：', data);
      setRecords(data);
    } catch (error) {
      // console.error('获取考试记录出错：', error);
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

  return (
    <Box sx={{ width: '100%', height: '100%' }}>
      <Box
        sx={{
          background: `linear-gradient(87deg, ${theme.palette.primary.main} 0, ${theme.palette.primary.dark} 100%)`,
          borderRadius: '0.375rem',
          p: 3,
          mb: 3,
          color: 'white',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Box>
          <Typography variant="h1" component="h1" color="white" gutterBottom>
            考试记录
          </Typography>
          <Typography variant="body1" color="white" sx={{ opacity: 0.8 }}>
            这里列出了所有的考试记录，您可以查看所有考试记录。
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <IconButton sx={{ color: 'white' }}>
            <PersonIcon />
          </IconButton>
          <IconButton sx={{ color: 'white' }}>
            <NotificationsIcon />
          </IconButton>
        </Box>
      </Box>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          {/* 搜索框 */}
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
                  borderColor: '#5e72e4',
                },
                '&.Mui-focused fieldset': {
                  borderColor: '#5e72e4',
                },
              },
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ color: '#8898aa' }} />
                </InputAdornment>
              ),
            }}
          />
        </Box>

          <TableContainer
            component={Paper}
            sx={{
              boxShadow: 'none',
              border: '1px solid rgba(0, 0, 0, 0.1)',
              borderRadius: '0.375rem',
              overflow: 'hidden'
            }}
          >
            <Table>
              <TableHead>
                <TableRow
                  sx={{
                    backgroundColor: '#f6f9fc',
                    '& th': {
                      color: '#8898aa',
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '1px',
                      borderBottom: 'none'
                    }
                  }}
                >
                  <TableCell>考试名称</TableCell>
                  <TableCell>考生</TableCell>
                  <TableCell>考试时间</TableCell>
                  <TableCell>分数</TableCell>
                  <TableCell>正确率</TableCell>
                  <TableCell>题目数量</TableCell>
                  <TableCell>操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {records.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} align="center">
                      <Typography variant="body1" sx={{ py: 2, color: '#8898aa' }}>
                        暂无考试记录
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  records.map((record) => (
                    <TableRow
                      key={`${record.exam_paper_id}-${record.exam_time}`}
                      sx={{
                        '&:hover': {
                          backgroundColor: '#f6f9fc'
                        }
                      }}
                    >
                      <TableCell>
                        <Box>
                          <Typography variant="subtitle1" sx={{ color: '#32325d', fontWeight: 600 }}>
                            {record.exam_title}
                          </Typography>
                          {record.exam_description && (
                            <Typography variant="body2" sx={{ color: '#8898aa' }}>
                              {record.exam_description}
                            </Typography>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell sx={{ color: '#525f7f' }}>{record.user_name || '未知'}</TableCell>
                      <TableCell sx={{ color: '#525f7f' }}>
                        {record.exam_time
                          ? new Date(record.exam_time).toLocaleString('zh-CN', {
                              year: 'numeric',
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit'
                            })
                          : '无效日期'}
                      </TableCell>
                      <TableCell>
                        <Typography
                          variant="body1"
                          sx={{
                            color: record.total_score >= 60 ? '#2dce89' : '#f5365c',
                            fontWeight: 600,
                            backgroundColor: record.total_score >= 60 ? 'rgba(45, 206, 137, 0.1)' : 'rgba(245, 54, 92, 0.1)',
                            borderRadius: '0.25rem',
                            px: 1,
                            py: 0.5,
                            display: 'inline-block'
                          }}
                        >
                          {record.total_score?.toFixed(2) || '0.00'}分
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography
                          variant="body1"
                          sx={{
                            
                            color: record.accuracy_rate >= 0.6 ? '#2dce89' : '#f5365c',
                            fontWeight: 600,
                            backgroundColor: record.accuracy_rate >= 0.6 ? 'rgba(45, 206, 137, 0.1)' : 'rgba(245, 54, 92, 0.1)',
                            borderRadius: '0.25rem',
                            px: 1,
                            py: 0.5,
                            display: 'inline-block'
                          }}
                        >
                          {(record.accuracy_rate * 100).toFixed(1)}%
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" component="div" sx={{ mb: 1 }}>
                          单选题：
                          <Box component="span" sx={{ color: '#2dce89', fontWeight: 600 }}>
                            {record.single_choice_correct || 0}
                          </Box>
                          <Box component="span" sx={{ mx: 0.5 }}>/</Box>
                          <Box component="span" sx={{ color: '#f5365c', fontWeight: 600 }}>
                            {record.single_choice_incorrect || 0}
                          </Box>
                          <Box component="span" sx={{ mx: 0.5 }}>/</Box>
                          <Box component="span" sx={{ color: '#525f7f' }}>
                            {record.single_choice_total || 0}题
                          </Box>
                        </Typography>
                        <Typography variant="body2" component="div">
                          多选题：
                          <Box component="span" sx={{ color: '#2dce89', fontWeight: 600 }}>
                            {record.multi_choice_correct || 0}
                          </Box>
                          <Box component="span" sx={{ mx: 0.5 }}>/</Box>
                          <Box component="span" sx={{ color: '#f5365c', fontWeight: 600 }}>
                            {record.multi_choice_incorrect || 0}
                          </Box>
                          <Box component="span" sx={{ mx: 0.5 }}>/</Box>
                          <Box component="span" sx={{ color: '#525f7f' }}>
                            {record.multi_choice_total || 0}题
                          </Box>
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="contained"
                          size="small"
                          startIcon={<VisibilityIcon />}
                          onClick={() => navigate(`/exam-records/${record.exam_paper_id}/${record.user_id}?exam_time=${encodeURIComponent(record.exam_time.toString())}`)}                        
                          sx={{
                            background: 'linear-gradient(87deg, #5e72e4 0%, #825ee4 100%)',
                            boxShadow: '0 4px 6px rgba(50, 50, 93, 0.11), 0 1px 3px rgba(0, 0, 0, 0.08)',
                            '&:hover': {
                              background: 'linear-gradient(87deg, #5e72e4 0%, #825ee4 100%)',
                              boxShadow: '0 7px 14px rgba(50, 50, 93, 0.1), 0 3px 6px rgba(0, 0, 0, 0.08)',
                              transform: 'translateY(-1px)'
                            }
                          }}
                        >
                          查看详情
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {loading && (
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)'
          }}
        >
          <CircularProgress sx={{ color: '#5e72e4' }} />
        </Box>
      )}
    </Box>
  )
}

export default ExamRecords
