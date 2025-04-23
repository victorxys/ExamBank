import React, { useState, useEffect } from 'react';
// --- React Router ---
import { Routes, Route, Navigate, useLocation, Outlet } from 'react-router-dom'; // 确保导入 Outlet
// --- Material UI ---
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { Box, CssBaseline, CircularProgress, Alert } from '@mui/material';
// --- Custom Components (假设这些都已正确导入) ---
import Sidebar from './components/Sidebar';
import Navbar from './components/Navbar';
import ErrorBoundary from './components/ErrorBoundary';
import PrivateRoute from './components/PrivateRoute';
import RouteWatcher from './components/RouteWatcher';
// --- Page Components ---
import LoginPage from './components/LoginPage';
import CourseList from './components/CourseList';
import KnowledgePoints from './components/KnowledgePoints';
import Questions from './components/Questions';
import ExamList from './components/ExamList';
import ExamDetail from './components/ExamDetail';
import ExamTake from './components/ExamTake';
import ExamRecords from './components/ExamRecords';
import ExamRecordDetail from './components/ExamRecordDetail';
import UserManagement from './components/UserManagement';
// import UserLoginDialog from './components/UserLoginDialog'; // 对话框通常不由路由直接渲染
import UserEvaluation from './components/UserEvaluation';
import UserEvaluationSummary from './components/UserEvaluationSummary';
import EmployeeProfile from './components/EmployeeProfile';
import EvaluationManagement from './components/EvaluationManagement';
import ClientEvaluation from './components/ClientEvaluation';
import ThankYouPage from './components/ThankYouPage';
import PublicEmployeeSelfEvaluation from './components/PublicEmployeeSelfEvaluation';
import EmployeeSelfEvaluationList from './components/EmployeeSelfEvaluationList';
import EmployeeSelfEvaluationDetail from './components/EmployeeSelfEvaluationDetail';
// --- Auth Utils ---
import { hasToken } from './api/auth-utils';
// --- Global Styles ---
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./styles/argon-theme.css";

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

// --- 2. 在 App.jsx 内部定义布局组件 ---

// 主布局 (带侧边栏和导航栏)
const MainLayoutInternal = () => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  // 注意：如果 Navbar 也需要 isCollapsed，需要调整状态管理或 props 传递
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', width: '100%' }}>
      <Sidebar isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} />
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: '100vh',
          width: `calc(100% - ${isCollapsed ? '65px' : '260px'})`,
          marginLeft: { xs: 0, sm: isCollapsed ? '65px' : '260px' },
          transition: 'margin-left 0.3s ease, width 0.3s ease',
          backgroundColor: 'background.default',
        }}
      >
        <Navbar />
        <Box
          sx={{
            flex: 1,
            p: { xs: 2, sm: 3 },
            mt: { xs: '56px', sm: '64px' }, // Adjust based on Navbar height
            overflowY: 'auto',
            width: '100%',
            maxWidth: '100%'
          }}
        >
          <ErrorBoundary>
            <Outlet /> {/* 子路由会渲染在这里 */}
          </ErrorBoundary>
        </Box>
      </Box>
    </Box>
  );
};

// 简单布局 (无侧边栏/导航栏)
const SimpleLayoutInternal = () => (
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
        p: { xs: 1, sm: 3 } // 示例 padding
      }}
    >
      <ErrorBoundary>
        <Outlet /> {/* 子路由会渲染在这里 */}
      </ErrorBoundary>
    </Box>
  </Box>
);

// --- 3. App 组件主体 ---
function App() {
  // 移除了 App 级别的 user 状态，因为它不直接影响布局选择
  // 认证状态由 PrivateRoute 或页面组件内部处理

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <RouteWatcher />
      {/* 唯一的 Routes 实例 */}
      <Routes>
        {/* 应用主布局的路由 */}
        <Route element={<MainLayoutInternal />}> {/* 使用内部定义的布局 */}
          <Route path="/" element={<PrivateRoute element={<Navigate to="/users" />} />} />
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
          <Route path="/evaluation-management" element={<PrivateRoute element={<EvaluationManagement />} />} />
          
        </Route>

        {/* 应用简单布局的路由 */}
        <Route element={<SimpleLayoutInternal />}> {/* 使用内部定义的布局 */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/client-evaluation/:userId" element={<ClientEvaluation />} />
          <Route path="/public-employee-self-evaluation" element={<PublicEmployeeSelfEvaluation />} />
          <Route path="/thank-you" element={<ThankYouPage />} />
          <Route path="/exams/:examId/take" element={<ExamTake />} />
          <Route path="/employee-profile/:userId" element={<PrivateRoute element={<EmployeeProfile />} />} />
          <Route path="/employee-profile/:userId/exam-records" element={<PrivateRoute element={<ExamRecords />} />} /> 
          <Route path="/employee-profile/:userId/exam-records/:examId" element={<PrivateRoute element={<ExamRecordDetail />} />} />
          {/* EmployeeProfile 和其子路由使用 SimpleLayout */}
          {/* 注意：EmployeeProfile 及其子路由已移到 MainLayout 下由 PrivateRoute 处理 */}
        </Route>

         {/* 404 路由可以放在这里 */}
         {/* <Route path="*" element={<NotFound />} /> */}
      </Routes>
    </ThemeProvider>
  );
}

export default App;