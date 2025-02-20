import {
  AppBar,
  Box,
  IconButton,
  Toolbar,
  Typography,
  useTheme,
} from '@mui/material'
import {
  Menu as MenuIcon,
  Notifications as NotificationsIcon,
  Person as PersonIcon,
} from '@mui/icons-material'
import { useLocation } from 'react-router-dom'

const drawerWidth = 260

function Navbar() {
  const theme = useTheme()
  const location = useLocation()

  // 根据当前路径获取页面标题
  const getPageTitle = () => {
    const path = location.pathname
    if (path === '/') return '仪表盘'
    if (path.includes('/courses')) return '课程管理'
    if (path.includes('/knowledge-points')) return '知识点'
    if (path.includes('/questions')) return '题库管理'
    if (path.includes('/exams')) return '考试管理'
    if (path.includes('/exam-records')) return '考试记录'
    if (path.includes('/users')) return '用户管理'
    return ''
  }

  return null
}

export default Navbar
