import { useState, lazy, Suspense } from 'react'; // 添加 lazy 和 Suspense

// --- React Router ---
import { Routes, Route, Navigate, Outlet } from 'react-router-dom'; // 确保导入 Outlet
// --- Material UI ---
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { Box, CssBaseline, CircularProgress} from '@mui/material';
// --- Custom Components (假设这些都已正确导入) ---
import Sidebar from './components/Sidebar';
import Navbar from './components/Navbar';
import ErrorBoundary from './components/ErrorBoundary';
import PrivateRoute from './components/PrivateRoute';
import RouteWatcher from './components/RouteWatcher';

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
      contrastText: '#ffffff', // <<<--- 在这里添加这一行控制字体颜色
    },
    error: {
      main: '#f5365c',
      light: '#f76e8b',
      dark: '#ea0038',
      contrastText: '#ffffff', // <<<--- 在这里添加这一行
    },
    warning: {
      main: '#fb6340',
      light: '#fc8f73',
      dark: '#fa3a0e',
      contrastText: '#ffffff', // <<<--- 在这里添加这一行
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
      contrastText: '#ffffff', // <<<--- 在这里添加这一行
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
        <Navbar /> {/* Navbar (您的 AppBar) 在这里 */}
        <Box // <<<--- 这个 Box 包裹 <Outlet />
            sx={{
              flex: 1,
              // --- 在这里修改 padding 设置 ---
              // 旧: p: { xs: 2, sm: 3 }, 
              // 新示例 (移除顶部内边距):
              px: { xs: 2, sm: 1 }, // 左右内边距
              pb: { xs: 2, sm: 1 }, // 底部内边距
              pt: { xs: 2, sm: 1 }, // 顶部内边距 (sm 设为 0) <<<<----- 这里可能是 pt: 7 的来源
              // --- -------------------------- ---
              // mt: { xs: 2, sm: 0 }, // <<<<----- 这里也可能是 mt: 7 的来源
              width: '100%',
              height: '100vh', // 这一行可能有问题，见下方说明
              overflow: 'auto',
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

// --- 3. 定义加载状态组件 ---
const LoadingFallback = () => (
  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 'calc(100vh - 128px)' }}> 
    <CircularProgress />
  </Box>
);

// --- 4. 使用 React.lazy 动态导入页面组件 ---
const LoginPage = lazy(() => import('./components/LoginPage'));
const CourseList = lazy(() => import('./components/CourseList'));
const MyCoursesPage = lazy(() => import('./components/MyCoursesPage')); // <<<--- 新增导入 (假设放在 pages 目录)
const MediaPlayerPage = lazy(() => import('./components/MediaPlayerPage')); // <<<--- 新增导入
const KnowledgePoints = lazy(() => import('./components/KnowledgePoints'));
const Questions = lazy(() => import('./components/Questions'));
const ExamList = lazy(() => import('./components/ExamList'));
const ExamDetail = lazy(() => import('./components/ExamDetail'));
const ExamTake = lazy(() => import('./components/ExamTake'));
const ExamRecords = lazy(() => import('./components/ExamRecords'));
const ExamRecordDetail = lazy(() => import('./components/ExamRecordDetail'));
const UserManagement = lazy(() => import('./components/UserManagement'));
const UserEvaluation = lazy(() => import('./components/UserEvaluation'));
const UserEvaluationSummary = lazy(() => import('./components/UserEvaluationSummary'));
const EmployeeProfile = lazy(() => import('./components/EmployeeProfile'));
const EvaluationManagement = lazy(() => import('./components/EvaluationManagement'));
const ClientEvaluation = lazy(() => import('./components/ClientEvaluation'));
const ThankYouPage = lazy(() => import('./components/ThankYouPage'));
const PublicEmployeeSelfEvaluation = lazy(() => import('./components/PublicEmployeeSelfEvaluation'));
const EmployeeSelfEvaluationList = lazy(() => import('./components/EmployeeSelfEvaluationList'));
const EmployeeSelfEvaluationDetail = lazy(() => import('./components/EmployeeSelfEvaluationDetail'));
// LLM管理 相关内容
const LlmModelManagement = lazy(() => import('./components/LlmModelManagement')); // 新建
const LlmApiKeyManagement = lazy(() => import('./components/LlmApiKeyManagement')); // 新建
const LlmPromptManagement = lazy(() => import('./components/LlmPromptManagement')); // 新建
const LlmCallLogList = lazy(() => import('./components/LlmCallLogList')); // 修改为列表页
const LlmCallLogDetail = lazy(() => import('./components/LlmCallLogDetail')); // 新建日志详情页
// 课程TTS相关内容
const TrainingContentList = lazy(() => import('./components/TrainingContentList'));
const TrainingContentDetail = lazy(() => import('./components/TrainingContentDetail'));

// 合同与账单相关内容
const BillingDashboard = lazy(() => import('./components/BillingDashboard')); 
const ContractList = lazy(() => import('./components/ContractList')); 
const ContractDetail = lazy(() => import('./components/ContractDetail')); // 新建合同详情页


// --- 5. App 组件主体 ---
function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <RouteWatcher />
      {/* 唯一的 Routes 实例 */}
      <Routes>
        {/* 应用主布局的路由 */}
        <Route element={<MainLayoutInternal />}>
          {/* --- 5. 使用 Suspense 包裹懒加载组件 --- */}
          <Route path="/" element={<PrivateRoute element={<Navigate to="/users" />} />} />
          <Route path="/exams" element={<PrivateRoute element={<Suspense fallback={<LoadingFallback />}> <ExamList /> </Suspense>} />} />
          <Route path="/exams/:examId" element={<PrivateRoute element={<Suspense fallback={<LoadingFallback />}> <ExamDetail /> </Suspense>} />} />
          <Route path="/knowledge-points" element={<PrivateRoute element={<Suspense fallback={<LoadingFallback />}> <KnowledgePoints /> </Suspense>} />} />
          <Route path="/courses" element={<PrivateRoute element={<Suspense fallback={<LoadingFallback />}> <CourseList /> </Suspense>} />} />
          <Route path="/courses/:courseId/knowledge_points" element={<PrivateRoute element={<Suspense fallback={<LoadingFallback />}> <KnowledgePoints /> </Suspense>} />} />
          <Route path="/courses/:courseId/knowledge_points/:knowledgePointId/questions" element={<PrivateRoute element={<Suspense fallback={<LoadingFallback />}> <Questions /> </Suspense>} />} />
          <Route path="/questions" element={<PrivateRoute element={<Suspense fallback={<LoadingFallback />}> <Questions /> </Suspense>} />} />
          <Route path="/exam-records" element={<PrivateRoute element={<Suspense fallback={<LoadingFallback />}> <ExamRecords /> </Suspense>} />} />
          <Route path="/exam-records/:examId/:userId" element={<PrivateRoute element={<Suspense fallback={<LoadingFallback />}> <ExamRecordDetail /> </Suspense>} />} /> 
          <Route path="/users" element={<PrivateRoute element={<Suspense fallback={<LoadingFallback />}> <UserManagement /> </Suspense>} />} />
          <Route path="/user-evaluation/:userId" element={<PrivateRoute element={<Suspense fallback={<LoadingFallback />}> <UserEvaluation /> </Suspense>} />} />
          <Route path="/user-evaluation-summary/:userId" element={<PrivateRoute element={<Suspense fallback={<LoadingFallback />}> <UserEvaluationSummary /> </Suspense>} />} />
          <Route path="/employee-self-evaluations" element={<PrivateRoute element={<Suspense fallback={<LoadingFallback />}> <EmployeeSelfEvaluationList /> </Suspense>} />} />
          <Route path="/employee-self-evaluations/:evaluationId" element={<PrivateRoute element={<Suspense fallback={<LoadingFallback />}> <EmployeeSelfEvaluationDetail /> </Suspense>} />} />
          <Route path="/evaluation-management" element={<PrivateRoute element={<Suspense fallback={<LoadingFallback />}> <EvaluationManagement /> </Suspense>} />} />
          <Route path="/admin/llm/models" element={<PrivateRoute element={<Suspense fallback={<LoadingFallback />}> <LlmModelManagement /> </Suspense>} />} />
          <Route path="/admin/llm/api-keys" element={<PrivateRoute element={<Suspense fallback={<LoadingFallback />}> <LlmApiKeyManagement /> </Suspense>} />} />
          <Route path="/admin/llm/prompts" element={<PrivateRoute element={<Suspense fallback={<LoadingFallback />}> <LlmPromptManagement /> </Suspense>} />} />
          <Route path="/admin/llm/call-logs" element={<PrivateRoute element={<Suspense fallback={<LoadingFallback />}> <LlmCallLogList /> </Suspense>} />} />
          <Route path="/admin/llm/call-logs/:logId" element={<PrivateRoute element={<Suspense fallback={<LoadingFallback />}> <LlmCallLogDetail /> </Suspense>} />} />
          <Route path="/courses/:courseId/tts-contents" element={<PrivateRoute element={<Suspense fallback={<LoadingFallback />}><TrainingContentList /></Suspense>} />} />
          <Route path="/tts/content/:contentId" element={<PrivateRoute element={<Suspense fallback={<LoadingFallback />}><TrainingContentDetail /></Suspense>} />} />
          <Route path="/my-courses" element={<PrivateRoute element={<Suspense fallback={<LoadingFallback />}> <MyCoursesPage /> </Suspense>} />} />
          <Route path="/my-courses/:courseId/resource/:resourceId/play" element={<PrivateRoute element={<Suspense fallback={<LoadingFallback />}> <MediaPlayerPage /> </Suspense>} />} />
          <Route path="/contracts" element={<PrivateRoute element={<Suspense fallback={<LoadingFallback />}> <ContractList /> </Suspense>} />} />
          <Route path="/billing" element={<PrivateRoute element={<Suspense fallback={<LoadingFallback />}> <BillingDashboard /> </Suspense>} />} />
          <Route path="/contracts/:contractId" element={<ContractDetail />} />

        </Route>

        {/* 应用简单布局的路由 */}
        <Route element={<SimpleLayoutInternal />}>
          {/* --- 5. 使用 Suspense 包裹懒加载组件 --- */}
          <Route path="/login" element={<Suspense fallback={<LoadingFallback />}> <LoginPage /> </Suspense>} />
          <Route path="/client-evaluation/:userId" element={<Suspense fallback={<LoadingFallback />}> <ClientEvaluation /> </Suspense>} />
          <Route path="/public-employee-self-evaluation" element={<Suspense fallback={<LoadingFallback />}> <PublicEmployeeSelfEvaluation /> </Suspense>} />
          <Route path="/thank-you" element={<Suspense fallback={<LoadingFallback />}> <ThankYouPage /> </Suspense>} />
          <Route path="/exams/:examId/take" element={<Suspense fallback={<LoadingFallback />}> <ExamTake /> </Suspense>} /> 
          <Route path="/employee-profile/:userId" element={<PrivateRoute element={<Suspense fallback={<LoadingFallback />}> <EmployeeProfile /> </Suspense>} />} />
          <Route path="/employee-profile/:userId/exam-records" element={<PrivateRoute element={<Suspense fallback={<LoadingFallback />}> <ExamRecords /> </Suspense>} />} /> 
          <Route path="/employee-profile/:userId/exam-records/:examId" element={<PrivateRoute element={<Suspense fallback={<LoadingFallback />}> <ExamRecordDetail /> </Suspense>} />} /> 

          {/* EmployeeProfile 和其子路由已移到 MainLayout 下，这里不再需要 */}
        </Route>

         {/* ... 404 路由 ... */}
      </Routes>
    </ThemeProvider>
  );
}

export default App;