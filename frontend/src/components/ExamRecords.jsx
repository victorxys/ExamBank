import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box,
  Container,
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
import {
  Search as SearchIcon,
  Visibility as VisibilityIcon,
  School as SchoolIcon,
  Lightbulb as LightbulbIcon
} from '@mui/icons-material'
import debounce from 'lodash/debounce'

function ExamRecords() {
  const navigate = useNavigate()
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
    fetchRecords()
  }, [debouncedSearchTerm])

  const fetchRecords = async () => {
    try {
      setLoading(true)
      const url = new URL('http://localhost:5000/api/exam-records')
      if (debouncedSearchTerm) {
        url.searchParams.append('search', debouncedSearchTerm)
      }
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error('Failed to fetch exam records')
      }
      const data = await response.json()
      console.log('Fetched records:', data) // 添加日志输出
      setRecords(data)
    } catch (error) {
      console.error('Error fetching exam records:', error)
      setError(error.message)
    } finally {
      setLoading(false)
    }
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="error">
          Error: {error}
        </Typography>
      </Box>
    )
  }

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" gutterBottom>
        考试记录
      </Typography>

      {/* 搜索框 */}
      <Box sx={{ mb: 3 }}>
        <TextField
          fullWidth
          variant="outlined"
          placeholder="搜索考生姓名或手机号..."
          value={searchTerm}
          onChange={handleSearchChange}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          }}
        />
      </Box>

      {/* 记录列表 */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>考试名称</TableCell>
              <TableCell>考生</TableCell>
              <TableCell>考试时间</TableCell>
              <TableCell>分数</TableCell>
              <TableCell>题目数量</TableCell>
              <TableCell>操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <Typography variant="body1" sx={{ py: 2 }}>
                    暂无考试记录
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              records.map((record) => (
                <TableRow key={`${record.exam_paper_id}-${record.exam_time}`}>
                  <TableCell>
                    <Box>
                      <Typography variant="subtitle1">{record.exam_title}</Typography>
                      {record.exam_description && (
                        <Typography variant="body2" color="text.secondary">
                          {record.exam_description}
                        </Typography>
                      )}
                    </Box>
                  </TableCell>
                  <TableCell>{record.user_name || '未知'}</TableCell>
                  <TableCell>
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
                        color: record.total_score >= 60 ? 'success.main' : 'error.main',
                        fontWeight: 'bold'
                      }}
                    >
                      {record.total_score?.toFixed(2) || '0.00'}分
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" component="div">
                      单选题：{record.single_choice_count || 0}题
                    </Typography>
                    <Typography variant="body2" component="div">
                      多选题：{record.multiple_choice_count || 0}题
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={<VisibilityIcon />}
                      onClick={() => navigate(`/exam-records/${record.exam_paper_id}/${record.user_id}?exam_time=${encodeURIComponent(record.exam_time.toString())}`)}
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

      {/* 加载指示器 */}
      {loading && (
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)'
          }}
        >
          <CircularProgress />
        </Box>
      )}
    </Container>
  )
}

export default ExamRecords
