// frontend/src/components/Sidebar.jsx
import React, { useState, useEffect, useRef } from 'react';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import {
  Box, List, ListItemButton, ListItemIcon, ListItemText, Drawer, Typography,
  Divider, IconButton, useMediaQuery, Tooltip, Collapse
} from '@mui/material'; // ListItemButton 替换 ListItem
import { useTheme, alpha } from '@mui/material/styles'; // 确保 alpha 已导入
import {
  Home as HomeIcon, School as SchoolIcon, LibraryBooks as LibraryBooksIcon,
  QuestionAnswer as QuestionAnswerIcon, Dashboard as DashboardIcon,
  Assignment as AssignmentIcon, AssignmentTurnedIn as AssignmentTurnedInIcon,
  People as PeopleIcon, Menu as MenuIcon, ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon, Settings as SettingsIcon, Api as ApiIcon,
  Description as DescriptionIcon, History as HistoryIcon,
  ExpandLess, ExpandMore
} from '@mui/icons-material';
import logo from '../assets/logo.svg';
import UserInfo from './UserInfo';
import { hasToken } from '../api/auth-utils';

const expandedWidth = 260;
const collapsedWidth = 65;

const allMenuItems = [
  { text: '仪表盘', icon: <DashboardIcon />, path: '/', adminOnly: false },
  { text: '课程管理', icon: <SchoolIcon />, path: '/courses', adminOnly: true },
  { text: '知识点管理', icon: <LibraryBooksIcon />, path: '/knowledge-points', adminOnly: true },
  { text: '题库管理', icon: <QuestionAnswerIcon />, path: '/questions', adminOnly: true },
  { text: '考卷管理', icon: <AssignmentIcon />, path: '/exams', adminOnly: true },
  { text: '考试记录', icon: <AssignmentTurnedInIcon />, path: '/exam-records', adminOnly: false },
  { text: '用户管理', icon: <PeopleIcon />, path: '/users', adminOnly: true },
  { text: '员工自评列表', icon: <AssignmentTurnedInIcon />, path: '/employee-self-evaluations', adminOnly: true },
  { text: '评价体系管理', icon: <AssignmentIcon />, path: '/evaluation-management', adminOnly: true },
  {
    text: 'LLM 管理',
    icon: <SettingsIcon />,
    path: '/admin/llm', // 父级菜单，点击时不直接导航
    adminOnly: true,
    subItems: [
      { text: '模型管理', icon: <ApiIcon />, path: '/admin/llm/models', adminOnly: true }, // 子菜单图标不再需要 sx={{pl:2}}
      { text: 'API Keys', icon: <ApiIcon />, path: '/admin/llm/api-keys', adminOnly: true },
      { text: '提示词管理', icon: <DescriptionIcon />, path: '/admin/llm/prompts', adminOnly: true },
      { text: '调用日志', icon: <HistoryIcon />, path: '/admin/llm/call-logs', adminOnly: true },
    ]
  },
];

const studentMenuItems = [
  { text: '考试记录', icon: <AssignmentTurnedInIcon />, path: '/exam-records', adminOnly: false },
];


function Sidebar({ isCollapsed, setIsCollapsed }) {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const userInfo = hasToken();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [openMenus, setOpenMenus] = useState({});
  const parentMenuRefs = useRef({});

  const menuItemsToRender = userInfo?.role === 'admin' ? allMenuItems : studentMenuItems;

  useEffect(() => {
    const currentPath = location.pathname;
    let parentMenuPathToOpen = null;
    let shouldUpdateOpenMenus = false;

    for (const item of menuItemsToRender) {
      if (item.subItems && item.path) {
        if (item.subItems.some(subItem => subItem.path && (currentPath === subItem.path || currentPath.startsWith(subItem.path + '/')))) {
          parentMenuPathToOpen = item.path;
          if (!openMenus[item.path]) { // 只有当它当前是关闭的时候，我们才标记需要更新
            shouldUpdateOpenMenus = true;
          }
          break;
        }
      }
    }
    if (shouldUpdateOpenMenus && parentMenuPathToOpen) {
      setOpenMenus(prevOpenMenus => ({
        ...prevOpenMenus,
        [parentMenuPathToOpen]: true
      }));
    }
  }, [location.pathname, menuItemsToRender]); // 移除 openMenus 作为依赖，避免潜在的循环


  const handleDrawerToggle = () => setMobileOpen(!mobileOpen);
  const handleCollapseToggle = () => setIsCollapsed(!isCollapsed);

  const handleParentMenuClick = (e, itemPath) => {
    e.stopPropagation();
    e.preventDefault();
    if (!isCollapsed && itemPath) { // 确保 itemPath 有效
      const newOpenState = !openMenus[itemPath];
      setOpenMenus(prevOpenMenus => ({
        ...prevOpenMenus,
        [itemPath]: newOpenState
      }));

      if (newOpenState && parentMenuRefs.current[itemPath]) {
        setTimeout(() => {
          parentMenuRefs.current[itemPath]?.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest'
          });
        }, 250);
      }
    }
  };

  const drawerContent = (
    <Box className="sidenav bg-white" sx={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      <Box
        className="sidenav-header"
        sx={{ 
          p: 2, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          flexDirection: 'column', 
          mb: isCollapsed ? 0 : 0.5 
        }}
      >
        <img 
          src={logo} 
          alt="Logo" 
          style={{ 
            width: isCollapsed ? '40px' : '120px',
            height: isCollapsed ? '40px' : 'auto', // 确保折叠时logo不变形
            objectFit: 'contain', // 确保logo内容完整显示
            marginBottom: isCollapsed ? 0 : '0.2rem',
            transition: 'width 0.3s ease, height 0.3s ease, margin-bottom 0.3s ease'
          }} 
        />
      </Box>
      
      {!isCollapsed && <UserInfo sx={{ mt: 0, mb: 1 }} />} {/* UserInfo后通常不需要Divider，UserInfo内部处理 */}
      
      <List 
        className="navbar-nav" 
        sx={{ 
          flexGrow: 1, 
          overflowY: 'auto', 
          overflowX: 'hidden', 
          p: isCollapsed ? 0.5 : 1,
          pt: isCollapsed && userInfo ? 1 : (isCollapsed ? 0.5 : 1) // 如果折叠且有用户信息，稍微增加上边距
        }}
      >
        {menuItemsToRender
          .filter(item => userInfo?.role === 'admin' || !item.adminOnly)
          .map((item) => (
          <React.Fragment key={item.path || item.text}> {/* 使用 item.path 作为更稳定的key */}
            <ListItemButton
              ref={el => { 
                if (item.subItems && item.path) {
                  parentMenuRefs.current[item.path] = el;
                }
              }}
              component={item.subItems ? 'div' : RouterLink}
              to={item.subItems ? undefined : item.path}
              selected={!item.subItems && (location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path + '/')))}
              onClick={item.subItems ? (e) => handleParentMenuClick(e, item.path) : undefined}
              sx={{
                py: isCollapsed ? 1.5 : 1.2, // 折叠时垂直内边距可以大一些
                px: isCollapsed ? 'auto' : 2, // 折叠时图标会自动居中，展开时用px
                justifyContent: isCollapsed ? 'center' : 'flex-start',
                borderRadius: 1, 
                mx: isCollapsed ? 0.5 : 1, 
                mb: 0.5,
                textDecoration: 'none', 
                transition: 'all 0.15s ease',
                color: theme.palette.text.primary, // 默认文字颜色
                '& .MuiListItemIcon-root': { // 统一图标颜色
                  color: theme.palette.grey[700],
                  minWidth: 0, // 移除默认的最小宽度
                  mr: isCollapsed ? 0 : 1.5,
                  justifyContent: 'center',
                },
                '&.Mui-selected': {
                  background: `linear-gradient(87deg, ${theme.palette.primary.main} 0%, ${alpha(theme.palette.primary.dark, 0.85)} 100%)`,
                  boxShadow: theme.shadows[3],
                  '& .MuiListItemIcon-root, & .MuiListItemText-primary': { color: 'white' },
                  '&:hover': {
                     background: `linear-gradient(87deg, ${theme.palette.primary.dark} 0%, ${alpha(theme.palette.primary.main, 0.9)} 100%)`,
                  }
                },
                '&:hover': {
                  backgroundColor: alpha(theme.palette.primary.main, 0.08),
                },
              }}
            >
              <Tooltip title={isCollapsed ? item.text : ""} placement="right">
                <ListItemIcon>
                  {item.icon}
                </ListItemIcon>
              </Tooltip>
              {!isCollapsed && <ListItemText primary={item.text} primaryTypographyProps={{ fontWeight: 500,  whiteSpace: 'nowrap' }} />}
              {!isCollapsed && item.subItems && (openMenus[item.path] ? <ExpandLess /> : <ExpandMore />)}
            </ListItemButton>
            
            {!isCollapsed && item.subItems && (
              <Collapse 
                in={openMenus[item.path] || false} // 确保 in 属性总是一个布尔值
                timeout="auto" 
                unmountOnExit
              >
                <List component="div" disablePadding sx={{ pl: 2.5, pr:1 }}> {/* 调整子菜单缩进 */}
                  {item.subItems
                    .filter(subItem => userInfo?.role === 'admin' || !subItem.adminOnly)
                    .map((subItem) => (
                    <ListItemButton
                      key={subItem.path || subItem.text} // 使用 subItem.path
                      component={RouterLink}
                      to={subItem.path}
                      selected={location.pathname === subItem.path || location.pathname.startsWith(subItem.path + '/')}
                       sx={{
                        py: 1, 
                        px: 1.5, 
                        borderRadius: 1, 
                        mb: 0.5,
                        color: theme.palette.text.secondary,
                        '& .MuiListItemIcon-root': {
                          color: theme.palette.grey[600],
                           minWidth: 0,
                           mr: 1.5,
                           justifyContent: 'center',
                        },
                        '&.Mui-selected': {
                            background: alpha(theme.palette.primary.main, 0.15),
                            color: theme.palette.primary.main,
                            fontWeight: 'bold',
                            '& .MuiListItemIcon-root': { color: theme.palette.primary.main },
                            '&:hover': {
                                background: alpha(theme.palette.primary.main, 0.25),
                            }
                        },
                        '&:hover': { backgroundColor: alpha(theme.palette.action.hover, 0.04) },
                      }}
                    >
                       <Tooltip title={isCollapsed ? subItem.text : ""} placement="right">
                         <ListItemIcon>
                           {subItem.icon}
                         </ListItemIcon>
                       </Tooltip>
                       {!isCollapsed && <ListItemText primary={subItem.text} primaryTypographyProps={{ fontSize: '0.875rem', whiteSpace: 'nowrap' }} />}
                    </ListItemButton>
                  ))}
                </List>
              </Collapse>
            )}
          </React.Fragment>
        ))}
      </List>

      {!isMobile && (
        <Box
          sx={{
            position: 'absolute',
            bottom: '20px',
            right: 0, 
            transform: 'translateX(0)', // 先让按钮完全在侧边栏内部，以便观察图标
            right: '-16px', // 尝试将按钮稍微向右移出一点，但其主体仍在侧边栏内
                           // 这个值需要根据按钮的实际大小和图标大小调整
            zIndex: theme.zIndex.drawer + 20, 
          }}
        >
          <IconButton
            onClick={handleCollapseToggle}
            size="small" 
            aria-label={isCollapsed ? "展开侧边栏" : "收起侧边栏"}
            sx={{
              // backgroundColor: alpha(theme.palette.background.paper, 0.95),
              backgroundColor: '#e0f3f1',
              color: theme.palette.text.secondary,
              // border: `1px solid ${alpha(theme.palette.divider, 0.7)}`,
              borderRight: 'none', // 右边框无，与侧边栏融合
              borderRadius: '30px 0 0 30px', // 左侧半圆，右侧直角 (半径可以调整)
              
              // 关键调整：通过 padding 来控制图标的实际显示位置
              // 我们需要增加左内边距，减少右内边距（因为右边被“隐藏”了）
              // 同时要确保按钮的整体可点击区域和视觉大小合适
              width: '32px', // 给按钮一个固定宽度，便于计算
              height: '32px', // 给按钮一个固定高度
              padding: 0, // 先重置 padding
              display: 'flex', // 使用 flex 居中图标
              alignItems: 'center',
              justifyContent: 'center', // 图标会在按钮的物理中心

              // 为了让图标在“可见的左半部分”居中，我们需要将图标向左推
              // 这可以通过给图标本身添加负的右边距，或者调整按钮的 padding 实现
              // 更简单的方法是调整 IconButton 的 padding-left 和 padding-right

              // 尝试这种 padding 组合：
              paddingLeft: '1px', // 左边多一点 padding
              paddingRight: '10px', // 右边少一点，因为按钮右侧视觉上被裁切

              // 或者更精确地控制图标的位置，如果图标大小固定为 small (通常20px)
              // 假设按钮宽度32px，我们希望图标在左侧16px的区域内居中
              // 这可能需要对图标组件本身应用样式，或者用一个额外的 Box 包裹图标

              boxShadow: `-1px 1px 3px rgba(0,0,0,0.07)`,
              '&:hover': {
                backgroundColor: theme.palette.background.paper,
                boxShadow: `-2px 2px 6px rgba(0,0,0,0.1)`,
              },
              transition: theme.transitions.create(['background-color', 'box-shadow'], {
                duration: theme.transitions.duration.short,
              }),
            }}
          >

            <Tooltip title={isCollapsed ? "展开" : "收起"} placement="top">
              {isCollapsed ? <ChevronRightIcon fontSize="small"/> : <ChevronLeftIcon fontSize="small"/>}
            </Tooltip>
          </IconButton>
        </Box>
      )}
    </Box>
  );

  return (
    <>
      {isMobile && (
        <AppBar position="fixed" sx={{ top: 'auto', bottom: 0, backgroundColor: 'white', boxShadow: '0 -2px 10px rgba(0,0,0,0.1)' }}>
          <Toolbar sx={{ justifyContent: 'center' }}>
            <IconButton color="primary" aria-label="open drawer" onClick={handleDrawerToggle} sx={{ p: 1.5 }}>
              <MenuIcon />
            </IconButton>
          </Toolbar>
        </AppBar>
      )}
      <Drawer
        variant={isMobile ? "temporary" : "permanent"}
        open={isMobile ? mobileOpen : true}
        onClose={isMobile ? handleDrawerToggle : undefined}
        ModalProps={isMobile ? { keepMounted: true } : {}}
        sx={{
          display: { xs: isMobile ? 'block' : 'none', sm: 'block' },
          '& .MuiDrawer-paper': {
            boxSizing: 'border-box',
            width: isCollapsed && !isMobile ? collapsedWidth : expandedWidth,
            borderRight: 'none', // 通常去掉Drawer本身的右边框
            backgroundColor: 'white', 
            backgroundImage: 'none',
            boxShadow: '0 0 2rem 0 rgba(136, 152, 170, .15)',
            transition: theme.transitions.create('width', {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.enteringScreen,
            }),
            overflowX: 'hidden', 
          }
        }}
      >
        {drawerContent}
      </Drawer>
    </>
  );
}

export default Sidebar;