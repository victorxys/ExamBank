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
    return ''
  }

  return (
    <AppBar
      position="fixed"
      sx={{
        width: { sm: `calc(100% - ${drawerWidth}px)` },
        ml: { sm: `${drawerWidth}px` },
        boxShadow: 'none',
        borderBottom: `1px solid ${theme.palette.divider}`,
        backgroundColor: theme.palette.background.paper,
      }}
    >
      <Toolbar
        sx={{
          pr: '24px',
        }}
      >
        <IconButton
          edge="start"
          color="inherit"
          aria-label="open drawer"
          sx={{
            marginRight: '36px',
            display: { sm: 'none' },
          }}
        >
          <MenuIcon />
        </IconButton>
        <Typography
          component="h1"
          variant="h6"
          color="primary"
          noWrap
          sx={{ flexGrow: 1 }}
        >
          {getPageTitle()}
        </Typography>
        <IconButton color="primary">
          <NotificationsIcon />
        </IconButton>
        <IconButton color="primary">
          <PersonIcon />
        </IconButton>
      </Toolbar>
    </AppBar>
  )
}

export default Navbar
