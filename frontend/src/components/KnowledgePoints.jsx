import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Box,
  Card,
  CardContent,
  Typography,
  IconButton,
  Grid,
  useTheme,
  Chip,
  Button,
  CircularProgress,
} from '@mui/material'
import {
  LibraryBooks as LibraryBooksIcon,
  QuestionAnswer as QuestionAnswerIcon,
  ArrowBack as ArrowBackIcon,
} from '@mui/icons-material'

function KnowledgePoints() {
  const [knowledgePoints, setKnowledgePoints] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const { courseId } = useParams()
  const navigate = useNavigate()
  const theme = useTheme()

  useEffect(() => {
    setLoading(true)
    setError(null)
    console.log('Fetching knowledge points for course:', courseId)
    
    fetch(`http://localhost:5000/api/courses/${courseId}/knowledge_points`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        return response.json()
      })
      .then((data) => {
        console.log('Received knowledge points:', data)
        setKnowledgePoints(data)
        setLoading(false)
      })
      .catch((error) => {
        console.error('Error fetching knowledge points:', error)
        setError(error.message)
        setLoading(false)
      })
  }, [courseId])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    )
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="error" gutterBottom>
          Error loading knowledge points: {error}
        </Typography>
        <Button 
          variant="contained" 
          onClick={() => window.location.reload()}
          sx={{ mr: 2 }}
        >
          Retry
        </Button>
        <Button 
          variant="outlined" 
          onClick={() => navigate('/')}
        >
          Back to Courses
        </Button>
      </Box>
    )
  }

  if (!knowledgePoints.length) {
    return (
      <Box sx={{ p: 3 }}>
        <Box display="flex" width="100%" mb={3} alignItems="center" justifyContent="space-between">
          <Button
            variant="contained"
            color="primary"
            startIcon={<ArrowBackIcon />}
            onClick={() => navigate('/')}
          >
            返回课程列表
          </Button>

          <Typography 
            variant="h4" 
            component="h1" 
            color="inherit"
            sx={{
              margin: '0 20px',
              flex: 1,
              textAlign: 'center',
              fontSize: '1.8rem',
              fontWeight: 500
            }}
          >
            知识点列表
          </Typography>

          <Button
            variant="contained"
            color="primary"
            startIcon={<LibraryBooksIcon />}
            onClick={() => {/* TODO: 添加知识点的处理函数 */}}
          >
            添加知识点
          </Button>
        </Box>

        <Typography 
          variant="body1" 
          color="text.secondary" 
          sx={{ 
            mb: 3,
            textAlign: 'center',
            opacity: 0.8 
          }}
        >
          这里列出了该课程的所有知识点，点击知识点卡片可以查看相关题目。
        </Typography>

        <Typography variant="h6" color="text.secondary" align="center">
          该课程暂无知识点
        </Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ width: '100%', minHeight: '100%', p: 3 }}>
      {/* 顶部导航栏 */}
      <Box display="flex" width="100%" mb={3} alignItems="center" justifyContent="space-between">
        <Button
          variant="contained"
          color="primary"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/')}
        >
          返回课程列表
        </Button>

        <Typography 
          variant="h4" 
          component="h1" 
          color="inherit"
          sx={{
            margin: '0 20px',
            flex: 1,
            textAlign: 'center',
            fontSize: '1.8rem',
            fontWeight: 500
          }}
        >
          知识点列表
        </Typography>

        <Button
          variant="contained"
          color="primary"
          startIcon={<LibraryBooksIcon />}
          onClick={() => {/* TODO: 添加知识点的处理函数 */}}
        >
          添加知识点
        </Button>
      </Box>

      {/* 说明文字 */}
      <Typography 
        variant="body1" 
        color="text.secondary" 
        sx={{ 
          mb: 3,
          textAlign: 'center',
          opacity: 0.8 
        }}
      >
        这里列出了该课程的所有知识点，点击知识点卡片可以查看相关题目。
      </Typography>

      {/* 知识点卡片网格 */}
      <Grid container spacing={3}>
        {knowledgePoints.map((point) => (
          <Grid item key={point.id} xs={12} sm={6} lg={4}>
            <Card
              sx={{
                height: '100%',
                cursor: 'pointer',
                transition: 'transform 0.2s',
                '&:hover': {
                  transform: 'translateY(-5px)',
                },
              }}
              onClick={() =>
                navigate(
                  `/courses/${courseId}/knowledge_points/${point.id}/questions`
                )
              }
            >
              <CardContent>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    mb: 2,
                  }}
                >
                  <IconButton
                    sx={{
                      backgroundColor: theme.palette.info.main,
                      color: 'white',
                      '&:hover': {
                        backgroundColor: theme.palette.info.dark,
                      },
                      mr: 2,
                    }}
                  >
                    <LibraryBooksIcon />
                  </IconButton>
                  <Typography variant="h2">{point.point_name}</Typography>
                </Box>

                <Typography
                  variant="body1"
                  color="text.secondary"
                  sx={{ mb: 2, minHeight: '3em' }}
                >
                  {point.description || '暂无描述'}
                </Typography>

                <Box
                  sx={{
                    display: 'flex',
                    gap: 1,
                    flexWrap: 'wrap',
                    alignItems: 'center',
                  }}
                >
                  <Chip
                    icon={<QuestionAnswerIcon />}
                    label={`${point.total_questions || 0} 道题目`}
                    color="info"
                    variant="outlined"
                  />
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  )
}

export default KnowledgePoints
