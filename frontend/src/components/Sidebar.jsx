import { useState, useEffect } from 'react'
import { Link as RouterLink, useLocation } from 'react-router-dom'
import {
  Box,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Drawer,
  Typography,
  Divider,
  IconButton,
  useMediaQuery,
  useTheme,
  AppBar,
  Toolbar,
  Tooltip,
} from '@mui/material'
import {
  Home as HomeIcon,
  School as SchoolIcon,
  LibraryBooks as LibraryBooksIcon,
  QuestionAnswer as QuestionAnswerIcon,
  QuestionMark as QuestionMarkIcon,
  Dashboard as DashboardIcon,
  Assignment as AssignmentIcon,
  AssignmentTurnedIn as AssignmentTurnedInIcon,
  People as PeopleIcon,
  Menu as MenuIcon,
  Close as CloseIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
} from '@mui/icons-material'
import logo from '../assets/logo.svg'
import UserInfo from './UserInfo'
import { hasToken } from '../api/auth-utils'
// Import Argon Dashboard styles
// 使用CDN方式引入Argon Dashboard样式
// @creative-tim-official/argon-dashboard-free/assets/css/argon-dashboard.min.css

const expandedWidth = 260
const collapsedWidth = 65

const allMenuItems = [
  {
    text: '仪表盘',
    icon: <DashboardIcon />,
    path: '/',
  },
  {
    text: '课程管理',
    icon: <SchoolIcon />,
    path: '/courses',
  },
  {
    text: '知识点',
    icon: <LibraryBooksIcon />,
    path: '/knowledge-points',
  },
  {
    text: '题库管理',
    icon: <QuestionAnswerIcon />,
    path: '/questions',
  },
  {
    text: '考试管理',
    icon: <AssignmentIcon />,
    path: '/exams',
  },
  {
    text: '考试记录',
    icon: <AssignmentTurnedInIcon />,
    path: '/exam-records',
  },
  {
    text: '用户管理',
    icon: <PeopleIcon />,
    path: '/users',
  },
  {
    text: '员工自评',
    icon: <AssignmentTurnedInIcon />,
    path: '/employee-self-evaluations',
  },
  {
    text: '评价管理',
    icon: <AssignmentIcon />,
    path: '/evaluation-management',
  },
]

const studentMenuItems = [
  {
    text: '考试记录',
    icon: <AssignmentTurnedInIcon />,
    path: '/exam-records',
  },
]

function Sidebar({ isCollapsed, setIsCollapsed }) {
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const userInfo = hasToken()
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen)
  }

  const handleCollapseToggle = () => {
    setIsCollapsed(!isCollapsed)
  }

  // 监听窗口大小变化，在大屏幕时自动关闭移动菜单
  useEffect(() => {
    if (!isMobile && mobileOpen) {
      setMobileOpen(false)
    }
  }, [isMobile])

  const drawer = (
    <Box className="sidenav bg-white">
      <Box
        className="sidenav-header"
        sx={{
          p: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          mb: 2,
          position: 'relative',
        }}
      >
        <img 
          src={logo} 
          alt="萌姨萌嫂考试苑" 
          style={{ 
            width: isCollapsed ? '40px' : '80%', 
            marginBottom: '1rem',
            transition: 'width 0.3s ease'
          }} 
        />
      </Box>
      {!isCollapsed && <UserInfo collapsed={isCollapsed} />}
      <List className="navbar-nav">
        {(userInfo?.role === 'student' ? studentMenuItems : allMenuItems).map((item) => (
          <ListItem
            key={item.text}
            component={RouterLink}
            to={item.path}
            selected={location.pathname === item.path}
            className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
            sx={{
              py: 1.5,
              px: isCollapsed ? 1 : 3,
              borderRadius: 1,
              mx: isCollapsed ? 0.5 : 2,
              mb: 0.5,
              textDecoration: 'none',
              transition: 'all 0.15s ease',
              justifyContent: isCollapsed ? 'center' : 'flex-start',
              '&.active': {
                background: 'linear-gradient(87deg, #26A69A 0%, #56aea2 100%)',
                boxShadow: '0 7px 14px rgba(50, 50, 93, 0.1), 0 3px 6px rgba(0, 0, 0, 0.08)',
                '& .MuiListItemIcon-root': {
                  color: 'white',
                },
                '& .MuiListItemText-root': {
                  color: 'white',
                },
                '&:hover': {
                  background: 'linear-gradient(87deg, #26A69A 0%, #56aea2 100%)',
                  boxShadow: '0 7px 14px rgba(50, 50, 93, 0.15), 0 3px 6px rgba(0, 0, 0, 0.1)',
                  transform: 'translateY(-1px)',
                },
              },
              '&:hover': {
                backgroundColor: '#D0EBEA',
                transform: 'translateY(-1px)',
              },
            }}
          >
            <Tooltip title={isCollapsed ? item.text : ""}>
              <ListItemIcon
                sx={{
                  minWidth: isCollapsed ? 0 : 40,
                  mr: isCollapsed ? 0 : 2,
                  color: location.pathname === item.path ? 'white' : 'inherit',
                }}
              >
                {item.icon}
              </ListItemIcon>
            </Tooltip>
            {!isCollapsed && (
              <ListItemText
                primary={item.text}
                className={location.pathname === item.path ? 'text-white' : 'text-primary'}
              />
            )}
          </ListItem>
        ))}
      </List>
      {!isMobile && (
        <Box sx={{
          position: 'absolute',
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: theme.zIndex.drawer + 1,
        }}>
          <IconButton
            onClick={handleCollapseToggle}
            sx={{
              backgroundColor: theme.palette.background.paper,
              '&:hover': {
                backgroundColor: theme.palette.background.paper,
              },
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: '50%',
              boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
            }}
          >
            <Tooltip title={isCollapsed ? "展开" : "收起"}>
              {isCollapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
            </Tooltip>
          </IconButton>
        </Box>
      )}
    </Box>
  )

  return (
    <>
      {/* 移动端顶部菜单按钮 */}
      {isMobile && (
        <Box
          sx={{
            position: 'fixed',
            bottom: 16,
            left: 16,
            zIndex: (theme) => theme.zIndex.drawer + 2,
          }}
        >
          <IconButton
            color="primary"
            aria-label="open drawer"
            onClick={handleDrawerToggle}
            sx={{
              backgroundColor: 'white',
              boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
              '&:hover': {
                backgroundColor: 'white',
              },
            }}
          >
            <MenuIcon />
          </IconButton>
        </Box>
      )}

      {/* 移动端抽屉 */}
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={handleDrawerToggle}
        ModalProps={{
          keepMounted: true,
        }}
        sx={{
          display: { xs: 'block', sm: 'none' },
          '& .MuiDrawer-paper': {
            boxSizing: 'border-box',
            width: expandedWidth,
            borderRight: 0,
            backgroundColor: 'white',
            backgroundImage: 'none',
            boxShadow: '0 0 2rem 0 rgba(136, 152, 170, .15)',
            '& .sidenav-header': {
              display: { xs: 'none', sm: 'flex' } // 在移动端隐藏logo
            }
          }
        }}
      >
        {drawer}
      </Drawer>

      {/* 桌面端永久抽屉 */}
      <Drawer
        variant="permanent"
        className="sidenav shadow-sm"
        sx={{
          display: { xs: 'none', sm: 'block' },
          '& .MuiDrawer-paper': {
            boxSizing: 'border-box',
            width: isCollapsed ? collapsedWidth : expandedWidth,
            borderRight: 0,
            backgroundColor: 'white',
            backgroundImage: 'none',
            boxShadow: '0 0 2rem 0 rgba(136, 152, 170, .15)',
            transition: 'width 0.3s ease',
            overflowX: 'hidden',
          },
        }}
        open
      >
        {drawer}
      </Drawer>
    </>
  )
}

export default Sidebar
