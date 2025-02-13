import { useEffect, useState } from 'react'
import { 
  Container, 
  Typography, 
  Grid, 
  Card, 
  CardContent, 
  CardHeader,
  Box,
  ThemeProvider,
  createTheme,
  CssBaseline,
  useMediaQuery,
  Chip,
  IconButton,
  CardActions,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  List,
  ListItem,
  ListItemText,
  CircularProgress,
  ListItemButton,
  Collapse,
  Paper,
  RadioGroup,
  FormControlLabel,
  Radio,
  Checkbox,
  Rating,
  Divider
} from '@mui/material'
import { 
  Info as InfoIcon, 
  Close as CloseIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Check as CheckIcon,
  Clear as ClearIcon
} from '@mui/icons-material'
import { Routes, Route, useNavigate, useParams } from 'react-router-dom'
import KnowledgePoints from './components/KnowledgePoints'
import './App.css'

// 创建自定义主题
const theme = createTheme({
  palette: {
    primary: {
      main: '#56aea2',
      light: '#7bc4ba',
      dark: '#3d8b81',
    },
    secondary: {
      main: '#03c4eb',
      light: '#4dd4f4',
      dark: '#0297b4',
    },
    background: {
      default: '#f8f9fe',
      paper: '#ffffff',
    },
    text: {
      primary: '#2c3e50',
      secondary: '#34495e',
    },
  },
  typography: {
    fontFamily: '"Open Sans", "Helvetica", "Arial", sans-serif',
    h4: {
      fontWeight: 600,
      color: '#2c3e50',
    },
    h6: {
      fontWeight: 600,
      color: '#2c3e50',
    },
    body1: {
      color: '#34495e',
    },
    body2: {
      color: '#7f8c8d',
    },
  },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: '0.375rem',
          boxShadow: '0 1px 3px rgba(86,174,162,.15), 0 1px 0 rgba(0,0,0,.02)',
          transition: 'all .15s ease',
          '&:hover': {
            transform: 'translateY(-1px)',
            boxShadow: '0 4px 6px rgba(86,174,162,.1), 0 1px 3px rgba(0,0,0,.08)',
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: '0.375rem',
        },
        outlinedPrimary: {
          borderColor: '#56aea2',
          color: '#56aea2',
        },
      },
    },
  },
})

function CourseList() {
  const [courses, setCourses] = useState([])
  const navigate = useNavigate()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))

  useEffect(() => {
    fetch('http://localhost:5000/api/courses')
      .then(response => response.json())
      .then(data => setCourses(data))
      .catch(error => console.error('Error:', error))
  }, [])

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        课程列表
      </Typography>
      
      <Grid container spacing={3}>
        {courses.map((course) => (
          <Grid item key={course.id} xs={12} sm={6} md={4}>
            <Card 
              sx={{ 
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                cursor: 'pointer',
                '&:hover': {
                  boxShadow: 6
                }
              }}
              onClick={() => navigate(`/courses/${course.id}/knowledge-points`)}
            >
              <CardHeader
                title={
                  <Typography variant="h6">
                    {course.course_name}
                  </Typography>
                }
                action={
                  <IconButton size="small">
                    <InfoIcon />
                  </IconButton>
                }
              />
              <CardContent sx={{ flexGrow: 1 }}>
                <Typography variant="body2" color="text.secondary" paragraph>
                  {course.description || '暂无描述'}
                </Typography>
                <Box display="flex" gap={1} flexWrap="wrap">
                  <Chip 
                    label={`${course.total_points || 0} 个知识点`}
                    size="small"
                    color="primary"
                  />
                  <Chip 
                    label={`${course.total_questions || 0} 道题目`}
                    size="small"
                    color="secondary"
                  />
                </Box>
              </CardContent>
              <CardActions sx={{ justifyContent: 'flex-end', p: 2 }}>
                <Typography variant="caption" color="text.secondary">
                  创建时间：{new Date(course.created_at).toLocaleString('zh-CN', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </Typography>
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Container>
  )
}

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Routes>
        <Route path="/" element={<CourseList />} />
        <Route path="/courses/:courseId/knowledge-points" element={<KnowledgePoints />} />
      </Routes>
    </ThemeProvider>
  )
}

export default App
