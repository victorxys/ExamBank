import { useState } from 'react'
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
} from '@mui/icons-material'
import logo from '../assets/logo.svg'
import UserInfo from './UserInfo'
import { hasToken } from '../api/auth-utils'
// Import Argon Dashboard styles
// 使用CDN方式引入Argon Dashboard样式
// @creative-tim-official/argon-dashboard-free/assets/css/argon-dashboard.min.css

const drawerWidth = 260

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
]

const studentMenuItems = [
  {
    text: '考试记录',
    icon: <AssignmentTurnedInIcon />,
    path: '/exam-records',
  },
]

function Sidebar() {
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const userInfo = hasToken()

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen)
  }

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
          mb:-5
        }}
      >
        <img src={logo} alt="萌姨萌嫂考试苑" style={{ width: '80%', marginBottom: '1rem' }} />
      </Box>
      <UserInfo />
      {/*<Divider />*/}
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
              px: 3,
              borderRadius: 1,
              mx: 2,
              mb: 0.5,
              textDecoration: 'none',
              transition: 'all 0.15s ease',
              '&.active': {
                background: 'linear-gradient(87deg, #56aea2 0%, #a0d4c3 100%)',
                boxShadow: '0 7px 14px rgba(50, 50, 93, 0.1), 0 3px 6px rgba(0, 0, 0, 0.08)',
                '& .MuiListItemIcon-root': {
                  color: 'white',
                },
                '& .MuiListItemText-root': {
                  color: 'white',
                },
                '&:hover': {
                  background: 'linear-gradient(87deg, #56aea2 0%, #a0d4c3 100%)',
                  boxShadow: '0 7px 14px rgba(50, 50, 93, 0.15), 0 3px 6px rgba(0, 0, 0, 0.1)',
                  transform: 'translateY(-1px)',
                },
              },
              '&:hover': {
                backgroundColor: 'rgba(94, 228, 188, 0.1)',
                transform: 'translateY(-1px)',
              },
            }}
          >
            <ListItemIcon
              sx={{
                minWidth: 40,
                color: location.pathname === item.path ? 'white' : 'inherit',
              }}
            >
              {item.icon}
            </ListItemIcon>
            <ListItemText
              primary={item.text}
              className={location.pathname === item.path ? 'text-white' : 'text-primary'}
            />
          </ListItem>
        ))}
      </List>
    </Box>
  )

  return (
    <Box
      component="nav"
      sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}
      className="sidenav-container"
    >
      <Drawer
        variant="permanent"
        className="sidenav shadow-sm"
        sx={{
          display: { xs: 'none', sm: 'block' },
          '& .MuiDrawer-paper': {
            boxSizing: 'border-box',
            width: drawerWidth,
            borderRight: 0,
            backgroundColor: 'white',
            backgroundImage: 'none',
            boxShadow: '0 0 2rem 0 rgba(136, 152, 170, .15)',
          },
        }}
        open
      >
        {drawer}
      </Drawer>
    </Box>
  )
}

export default Sidebar
