import { useEffect, useState } from 'react'
import { 
  Container, 
  Typography, 
  List, 
  ListItem, 
  ListItemText,
  ListItemButton,
  Paper,
  Box,
  Pagination,
  CircularProgress,
  Divider,
  Button,
  Chip
} from '@mui/material'
import { useParams, useNavigate } from 'react-router-dom'
import Questions from './Questions'

function KnowledgePoints() {
  const { courseId } = useParams()
  const navigate = useNavigate()
  const [course, setCourse] = useState(null)
  const [knowledgePoints, setKnowledgePoints] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedPoint, setSelectedPoint] = useState(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        // 获取课程信息
        const courseResponse = await fetch(`http://localhost:5000/api/courses/${courseId}`)
        const courseData = await courseResponse.json()
        setCourse(courseData)

        // 获取知识点列表
        const pointsResponse = await fetch(`http://localhost:5000/api/courses/${courseId}/knowledge_points`)
        const pointsData = await pointsResponse.json()
        setKnowledgePoints(pointsData)
      } catch (error) {
        console.error('Error:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [courseId])

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
        <CircularProgress />
      </Box>
    )
  }

  if (selectedPoint) {
    return <Questions knowledgePoint={selectedPoint} onBack={() => setSelectedPoint(null)} courseId={courseId} />
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box display="flex" alignItems="center" mb={4}>
        <Button onClick={() => navigate('/')} color="primary">
          返回课程列表
        </Button>
        <Typography variant="h4" component="h1" sx={{ ml: 2 }}>
          {course?.course_name} - 知识点列表
        </Typography>
      </Box>

      <Box mb={3}>
        <Typography variant="h6" color="text.secondary" gutterBottom>
          课程信息
        </Typography>
        <Paper elevation={1} sx={{ p: 2 }}>
          <Typography component="div" sx={{ mb: 2 }}>
            {course?.description || '暂无描述'}
          </Typography>
          <Box display="flex" gap={1}>
            <Chip 
              label={`${course?.total_points || 0} 个知识点`}
              color="primary"
            />
            <Chip 
              label={`${course?.total_questions || 0} 道题目`}
              color="secondary"
            />
          </Box>
        </Paper>
      </Box>
      
      <Paper elevation={1}>
        <List>
          {knowledgePoints.map((point, index) => (
            <div key={point.id}>
              {index > 0 && <Divider />}
              <ListItemButton onClick={() => setSelectedPoint(point)}>
                <ListItemText
                  primary={
                    <Box display="flex" alignItems="center" gap={2}>
                      <Typography component="span" variant="h6" color="primary">
                        {point.point_name}
                      </Typography>
                      <Chip 
                        label={`${point.total_questions || 0} 道题目`}
                        size="small"
                        color="secondary"
                      />
                    </Box>
                  }
                  secondary={
                    <Box component="div">
                      <Typography component="div" variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        {point.description || '暂无描述'}
                      </Typography>
                      <Typography component="div" variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                        创建时间：{new Date(point.created_at).toLocaleString('zh-CN', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </Typography>
                    </Box>
                  }
                />
              </ListItemButton>
            </div>
          ))}
          {knowledgePoints.length === 0 && (
            <ListItem>
              <ListItemText
                primary={
                  <Typography component="div" color="text.secondary" align="center">
                    暂无知识点
                  </Typography>
                }
              />
            </ListItem>
          )}
        </List>
      </Paper>
    </Container>
  )
}

export default KnowledgePoints
