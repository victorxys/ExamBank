import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import { Box, CssBaseline } from '@mui/material'
import Questions from './components/Questions'
import KnowledgePoints from './components/KnowledgePoints'
import ExamList from './components/ExamList'
import ExamDetail from './components/ExamDetail'
import Sidebar from './components/Sidebar'
import Navbar from './components/Navbar'
import CourseList from './components/CourseList'
import ExamTaking from './components/ExamTaking'
import ExamRecords from './components/ExamRecords'
import ExamRecordDetail from './components/ExamRecordDetail'
import ExamTake from './components/ExamTake'
import "@fortawesome/fontawesome-free/css/all.min.css";

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1976d2',
    },
    secondary: {
      main: '#dc004e',
    },
    error: {
      main: '#f5365c',
      light: '#f76e8b',
      dark: '#ea0038',
    },
    warning: {
      main: '#fb6340',
      light: '#fc8f73',
      dark: '#fa3a0e',
    },
    info: {
      main: '#11cdef',
      light: '#41d7f2',
      dark: '#0da5c2',
    },
    success: {
      main: '#2dce89',
      light: '#54d8a1',
      dark: '#24a46d',
    },
    grey: {
      50: '#f8f9fa',
      100: '#f6f9fc',
      200: '#e9ecef',
      300: '#dee2e6',
      400: '#ced4da',
      500: '#adb5bd',
      600: '#8898aa',
      700: '#525f7f',
      800: '#32325d',
      900: '#212529',
    },
    background: {
      default: '#f8f9fe',
      paper: '#ffffff',
    },
    text: {
      primary: '#525f7f',
      secondary: '#8898aa',
    },
  },
  typography: {
    fontFamily: '"Open Sans", "Helvetica", "Arial", sans-serif',
    h1: {
      fontSize: '1.625rem',
      fontWeight: 600,
      lineHeight: 1.5,
    },
    h2: {
      fontSize: '1.25rem',
      fontWeight: 600,
      lineHeight: 1.5,
    },
    h3: {
      fontSize: '1.0625rem',
      fontWeight: 600,
      lineHeight: 1.5,
    },
    h4: {
      fontSize: '0.9375rem',
      fontWeight: 600,
      lineHeight: 1.5,
    },
    h5: {
      fontSize: '0.8125rem',
      fontWeight: 600,
      lineHeight: 1.5,
    },
    h6: {
      fontSize: '0.625rem',
      fontWeight: 600,
      lineHeight: 1.5,
    },
    body1: {
      fontSize: '0.875rem',
      lineHeight: 1.5,
    },
    body2: {
      fontSize: '0.875rem',
      lineHeight: 1.5,
    },
    button: {
      textTransform: 'none',
      fontWeight: 600,
    },
  },
  shape: {
    borderRadius: 4,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: '0.375rem',
          padding: '0.625rem 1.25rem',
          fontSize: '0.875rem',
          fontWeight: 600,
          boxShadow: '0 4px 6px rgba(50,50,93,.11), 0 1px 3px rgba(0,0,0,.08)',
          transition: 'all .15s ease',
          '&:hover': {
            transform: 'translateY(-1px)',
            boxShadow: '0 7px 14px rgba(50,50,93,.1), 0 3px 6px rgba(0,0,0,.08)',
          },
        },
        contained: {
          '&.MuiButton-containedPrimary': {
            background: 'linear-gradient(87deg, #5e72e4 0, #825ee4 100%)',
          },
          '&.MuiButton-containedSecondary': {
            background: 'linear-gradient(87deg, #f5365c 0, #f56036 100%)',
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: '0.375rem',
          boxShadow: '0 0 2rem 0 rgba(136,168,170,.15)',
          border: '1px solid rgba(0,0,0,.05)',
        },
      },
    },
    MuiCardHeader: {
      styleOverrides: {
        root: {
          padding: '1.25rem 1.5rem',
          marginBottom: '0',
          backgroundColor: 'transparent',
          borderBottom: '1px solid rgba(0,0,0,.05)',
        },
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: {
          padding: '1.5rem',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          boxShadow: 'none',
          borderBottom: '1px solid rgba(0,0,0,.05)',
          backgroundColor: '#fff',
        },
      },
    },
  },
})

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', minHeight: '100vh', width: '100%' }}>
        <Sidebar />
        <Box
          component="main"
          sx={{
            flexGrow: 1,
            display: 'flex',
            flexDirection: 'column',
            minHeight: '100vh',
            width: '100%',
            backgroundColor: 'background.default',
          }}
        >
          <Navbar />
          <Box
            sx={{
              flex: 1,
              p: { xs: 2, sm: 3 },
              mt: '64px',
              width: '100%',
              height: 'calc(100vh - 64px)',
              overflow: 'auto',
              maxWidth: '100%'
            }}
          >
            <Routes>
              <Route path="/" element={<Navigate to="/exams" />} />
              <Route path="/exams" element={<ExamList />} />
              <Route path="/exams/:examId" element={<ExamDetail />} />
              <Route path="/take-exam/:examId" element={<ExamTake />} />
              <Route path="/courses/:courseId/knowledge_points" element={<KnowledgePoints />} />
              <Route path="/courses/:courseId/knowledge_points/:knowledgePointId/questions" element={<Questions />} />
              <Route path="/exam-records" element={<ExamRecords />} />
              <Route path="/exam-records/:examId/:userId" element={<ExamRecordDetail />} />
            </Routes>
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  )
}

export default App
