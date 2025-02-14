import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box,
  Card,
  CardContent,
  Grid,
  Typography,
  IconButton,
  Chip,
  useTheme,
} from '@mui/material'
import {
  School as SchoolIcon,
  LibraryBooks as LibraryBooksIcon,
  QuestionAnswer as QuestionAnswerIcon,
} from '@mui/icons-material'

function CourseList() {
  const [courses, setCourses] = useState([])
  const navigate = useNavigate()
  const theme = useTheme()

  useEffect(() => {
    fetch('http://localhost:5000/api/courses')
      .then((response) => response.json())
      .then((data) => setCourses(data))
      .catch((error) => console.error('Error:', error))
  }, [])

  return (
    <Box sx={{ width: '100%', height: '100%' }}>
      {/* 页面标题 */}
      <Box
        sx={{
          background: `linear-gradient(87deg, ${theme.palette.primary.main} 0, ${theme.palette.primary.dark} 100%)`,
          borderRadius: '0.375rem',
          p: 3,
          mb: 3,
          color: 'white',
        }}
      >
        <Typography variant="h1" component="h1" color="white" gutterBottom>
          课程列表
        </Typography>
        <Typography variant="body1" color="white" sx={{ opacity: 0.8 }}>
          这里列出了所有可用的课程，点击课程卡片可以查看该课程的知识点和题目。
        </Typography>
      </Box>

      {/* 课程卡片网格 */}
      <Grid container spacing={3} sx={{ width: '100%', m: 0 }}>
        {courses.map((course) => (
          <Grid item key={course.id} xs={12} sm={6} lg={4} sx={{ p: 1.5 }}>
            <Card
              sx={{
                height: '100%',
                cursor: 'pointer',
                transition: 'transform 0.2s',
                '&:hover': {
                  transform: 'translateY(-5px)',
                },
              }}
              onClick={() => navigate(`/courses/${course.id}/knowledge_points`)}
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
                      backgroundColor: theme.palette.primary.main,
                      color: 'white',
                      '&:hover': {
                        backgroundColor: theme.palette.primary.dark,
                      },
                      mr: 2,
                    }}
                  >
                    <SchoolIcon />
                  </IconButton>
                  <Typography variant="h2">{course.course_name}</Typography>
                </Box>

                <Typography
                  variant="body1"
                  color="text.secondary"
                  sx={{ mb: 2, minHeight: '3em' }}
                >
                  {course.description || '暂无描述'}
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
                    icon={<LibraryBooksIcon />}
                    label={`${course.total_points || 0} 个知识点`}
                    color="primary"
                    variant="outlined"
                  />
                  <Chip
                    icon={<QuestionAnswerIcon />}
                    label={`${course.total_questions || 0} 道题目`}
                    color="primary"
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

export default CourseList
