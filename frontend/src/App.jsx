import React, { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import { Box, CssBaseline } from '@mui/material'
import logoSvg from './assets/logo.svg'
import Questions from './components/Questions'
import KnowledgePoints from './components/KnowledgePoints'
import ExamList from './components/ExamList'
import ExamDetail from './components/ExamDetail'
import Sidebar from './components/Sidebar'
import Navbar from './components/Navbar'
import CourseList from './components/CourseList'
import ErrorBoundary from './components/ErrorBoundary'
// import ExamTaking from './components/ExamTaking'
import ExamRecords from './components/ExamRecords'
import ExamRecordDetail from './components/ExamRecordDetail'
import ExamTake from './components/ExamTake'
import UserManagement from './components/UserManagement'
import UserLoginDialog from './components/UserLoginDialog'
import UserEvaluation from './components/UserEvaluation'
import { hasToken } from './api/auth-utils'
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./styles/argon-theme.css";
import PrivateRoute from './components/PrivateRoute';
import LoginPage from './components/LoginPage';
import UserEvaluationSummary from './components/UserEvaluationSummary'
import EmployeeProfile from './components/EmployeeProfile'
import EvaluationManagement from './components/EvaluationManagement';
import ClientEvaluation from './components/ClientEvaluation';
import ThankYouPage from './components/ThankYouPage'
import RouteWatcher from './components/RouteWatcher'
import PublicEmployeeSelfEvaluation from './components/PublicEmployeeSelfEvaluation'
import EmployeeSelfEvaluationList from './components/EmployeeSelfEvaluationList'
import EmployeeSelfEvaluationDetail from './components/EmployeeSelfEvaluationDetail'

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#26A69A',
      light: '#7789e8',
      dark: '#408d86',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#f7fafc',
      light: '#ffffff',
      dark: '#d4e1f4',
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
      default: '#E0F2F1',
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
            background: 'linear-gradient(87deg, #26A69A 0, #56aea2 100%)',
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
  const location = useLocation();
  const isLoginRoute = location.pathname === '/login';
  const isExamRoute = location.pathname.includes('/exams/') && location.pathname.includes('/take');
  const isEmployeeProfileRoute = location.pathname.includes('/employee-profile/');
  const isPublicEmployeeProfile = isEmployeeProfileRoute && new URL(window.location.href).searchParams.get('public') === 'true';

  const [user, setUser] = useState(null);
  // 根据 isPublicEmployeeProfile 的值动态生成 publicUrl
  const publicUrl = isPublicEmployeeProfile ? '?public=true' : '';
  
  useEffect(() => {
    // 检查是否有有效的token
    const userInfo = hasToken();
    // 只在非员工介绍页面或非公开访问模式时检查登录状态
    // console.log('userInfo', userInfo);
    // console.log('isPublicEmployeeProfile', isPublicEmployeeProfile)
    // console.log('urlParams', urlParams)
    // console.log('url',url)
    
    if(isPublicEmployeeProfile){
      // console.log('isPublicEmployeeProfile',isPublicEmployeeProfile)
      // console.log('gongkaiyemian no loging')
    }
   
  
    if (userInfo) {
      setUser(userInfo);
    }
  }, [isEmployeeProfileRoute, isPublicEmployeeProfile]);



  // 员工介绍页面使用独立布局
  if (isEmployeeProfileRoute) {
    const userInfo = hasToken();
    if (!userInfo && !isPublicEmployeeProfile) {
      const currentUrl = new URL(window.location.href);
      currentUrl.searchParams.set('public', 'true');
      window.location.href = currentUrl.toString();
      return null;
    }
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <RouteWatcher />
        <Box
          sx={{
            display: 'flex',
            minHeight: '100vh',
            width: '100%',
            backgroundColor: 'background.default',
          }}
        >
          <Box
            component="main"
            sx={{
              flexGrow: 1,
              display: 'flex',
              flexDirection: 'column',
              minHeight: '100vh',
              width: '100%',
            }}
          >
            <ErrorBoundary>
              <Routes>
                <Route path="/employee-profile/:userId" element={isPublicEmployeeProfile ? <EmployeeProfile /> : <PrivateRoute element={<EmployeeProfile />}/>} />
                <Route path="/employee-profile/:userId/exam-records" element={isPublicEmployeeProfile ? <ExamRecords /> : <PrivateRoute element={<ExamRecords />}/>} />
                <Route path="/employee-profile/:userId/exam-records/:examId" element={isPublicEmployeeProfile ? <ExamRecordDetail /> : <PrivateRoute element={<ExamRecordDetail />}/>} />
              </Routes>
            </ErrorBoundary>
          </Box>
        </Box>
      </ThemeProvider>
    );
  }

  if (isExamRoute) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <RouteWatcher />
        <Box
          sx={{
            display: 'flex',
            minHeight: '100vh',
            width: '100%',
            backgroundColor: 'background.default',
          }}
        >
          <Box
            component="main"
            sx={{
              flexGrow: 1,
              display: 'flex',
              flexDirection: 'column',
              minHeight: '100vh',
              width: '100%',
              p: { xs: 1, sm: 3 }
            }}
          >
            <ErrorBoundary>
              <Routes>
                <Route path="/exams/:examId/take" element={<ExamTake />} />
              </Routes>
            </ErrorBoundary>
          </Box>
        </Box>
      </ThemeProvider>
    );
  }

  // 检查是否是登录页面或客户评价页面
  if (isLoginRoute || location.pathname.includes('/client-evaluation/') || location.pathname.includes('/public-employee-self-evaluation')) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <RouteWatcher />
        <Box sx={{ display: 'flex', minHeight: '100vh', width: '100%' }}>
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
            <ErrorBoundary>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/client-evaluation/:userId" element={<ClientEvaluation />} />
                <Route path="/public-employee-self-evaluation" element={<PublicEmployeeSelfEvaluation />} />
              </Routes>
            </ErrorBoundary>
          </Box>
        </Box>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <RouteWatcher />
      <Box sx={{ display: 'flex', minHeight: '100vh', width: '100%' }}>
        <Sidebar />
        <Box
          component="main"
          sx={{
            flexGrow: 1,
            display: 'flex',
            flexDirection: 'column',
            minHeight: '100vh',
            width: { xs: '100%', sm: 'calc(100% - 260px)' },
            marginLeft: { xs: 0, sm: '260px' },
            backgroundColor: 'background.default',
          }}
        >
          <Navbar />
          <Box
            sx={{
              flex: 1,
              p: { xs: 2, sm: 3 },
              mt: { xs: 7, sm: 0 },
              width: '100%',
              height: '100vh',
              overflow: 'auto',
              maxWidth: '100%'
            }}
          >
            <ErrorBoundary>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/" element={<PrivateRoute  element={<Navigate to="/users" />} />} />
                <Route path="/exams" element={<PrivateRoute element={<ExamList />} />} />
                <Route path="/exams/:examId" element={<PrivateRoute element={<ExamDetail />} />} />
                <Route path="/knowledge-points" element={<PrivateRoute element={<KnowledgePoints />} />} />
                <Route path="/courses" element={<PrivateRoute element={<CourseList />} />} />
                <Route path="/courses/:courseId/knowledge_points" element={<PrivateRoute element={<KnowledgePoints />} />} />
                <Route path="/courses/:courseId/knowledge_points/:knowledgePointId/questions" element={<PrivateRoute element={<Questions />} />} />
                <Route path="/questions" element={<PrivateRoute element={<Questions />} />} />
                <Route path="/exam-records" element={<PrivateRoute element={<ExamRecords />} />} />
                <Route path="/exam-records/:examId/:userId" element={<PrivateRoute element={<ExamRecordDetail />} />} />
                <Route path="/users" element={<PrivateRoute element={<UserManagement />} />} />
                <Route path="/user-evaluation/:userId" element={<PrivateRoute element={<UserEvaluation />} />} />
                <Route path="/user-evaluation-summary/:userId" element={<PrivateRoute element={<UserEvaluationSummary />} />} />
                <Route path="/employee-self-evaluations" element={<PrivateRoute element={<EmployeeSelfEvaluationList />} />} />
                <Route path="/employee-self-evaluations/:evaluationId" element={<PrivateRoute element={<EmployeeSelfEvaluationDetail />} />} />
                <Route path="/public-employee-self-evaluation" element={<PublicEmployeeSelfEvaluation />} />
                <Route path="/evaluation-management" element={<PrivateRoute element={<EvaluationManagement />} />} />
                <Route path="/client-evaluation/:userId" element={<ClientEvaluation />} />
                <Route path="/thank-you" element={<ThankYouPage />} />
              </Routes>
            </ErrorBoundary>
          </Box>
        </Box>
      </Box>

    </ThemeProvider>
  );
}

export default App
