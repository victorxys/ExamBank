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
} from '@mui/icons-material'

const drawerWidth = 260

const menuItems = [
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
]

function Sidebar() {
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen)
  }

  const drawer = (
    <Box>
      <Box
        sx={{
          p: 3,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Typography variant="h6" component="div" color="primary">
          考试题库系统
        </Typography>
      </Box>
      <Divider />
      <List>
        {menuItems.map((item) => (
          <ListItem
            button
            key={item.text}
            component={RouterLink}
            to={item.path}
            selected={location.pathname === item.path}
            sx={{
              py: 1.5,
              px: 3,
              borderRadius: 1,
              mx: 2,
              mb: 0.5,
              '&.Mui-selected': {
                backgroundColor: 'primary.main',
                color: 'white',
                '& .MuiListItemIcon-root': {
                  color: 'white',
                },
                '&:hover': {
                  backgroundColor: 'primary.dark',
                },
              },
              '&:hover': {
                backgroundColor: 'rgba(94, 114, 228, 0.1)',
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
            <ListItemText primary={item.text} />
          </ListItem>
        ))}
      </List>
    </Box>
  )

  return (
    <Box
      component="nav"
      sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}
    >
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: 'none', sm: 'block' },
          '& .MuiDrawer-paper': {
            boxSizing: 'border-box',
            width: drawerWidth,
            borderRight: 0,
            backgroundColor: 'background.paper',
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
