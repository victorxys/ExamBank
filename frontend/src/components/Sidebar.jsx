// frontend/src/components/Sidebar.jsx (Refactored for recursive menus)
import React, { useState, useEffect, useCallback } from 'react';
import { Link as RouterLink, useLocation, useParams } from 'react-router-dom';
import {
  Box, List, ListItemButton, ListItemIcon, ListItemText, Drawer, Typography,
  Divider, IconButton, useMediaQuery, Tooltip, Collapse, AppBar, Toolbar
} from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import {
  Dashboard as DashboardIcon, School as SchoolIcon, LibraryBooks as LibraryBooksIcon,
  QuestionAnswer as QuestionAnswerIcon, Assignment as AssignmentIcon, AssignmentTurnedIn as AssignmentTurnedInIcon,
  People as PeopleIcon, Menu as MenuIcon, ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon, Settings as SettingsIcon, Api as ApiIcon, AccountBalanceWallet as AccountBalanceWalletIcon,
  Description as DescriptionIcon, History as HistoryIcon, ExpandLess, ExpandMore, Warning as WarningIcon,
  Payment as PaymentIcon, Payments as PaymentsIcon
} from '@mui/icons-material';
import logo from '../assets/logo.svg';
import UserInfo from './UserInfo';
import { hasToken } from '../api/auth-utils';

const expandedWidth = 260;
const collapsedWidth = 65;

// Data structure remains the same, supporting nested subItems
export const allMenuItems = [
  { text: '仪表盘', icon: <DashboardIcon />, path: '/dashboard', adminOnly: true },
  { text: '课程管理', icon: <SchoolIcon />, path: '/courses', adminOnly: true },
  {
    text: '合同与账单',
    icon: <DashboardIcon />,
    path: '/billing-management', 
    adminOnly: true,
    subItems: [
      {
        text: '合同管理',
        icon: <DescriptionIcon />,
        path: '/contracts',
        adminOnly: true,
        subItems: [
          { text: '育儿嫂合同', path: '/contracts/nanny', adminOnly: true },
          { text: '月嫂合同', path: '/contracts/maternity_nurse', adminOnly: true },
          { text: '试工合同', path: '/contracts/nanny_trial', adminOnly: true },
        ]
      },
      { text: '合同模板管理', icon: <DescriptionIcon />, path: '/contract-templates', adminOnly: true },
      { text: '账单管理', icon: <HistoryIcon />, path: '/billing', adminOnly: true },
      { text: '合同冲突检测', icon: <WarningIcon />, path: '/tools/conflict-checker', adminOnly: true },
    ]
  },
  {
    text: '银行对账中心',
    icon: <AccountBalanceWalletIcon />,
    path: '/billing/reconcile-group', // Placeholder path for the group
    adminOnly: true,
    subItems: [
      { text: '客户回款', icon: <PaymentIcon />, path: '/billing/reconcile', adminOnly: true, isFinancial: true },
      { text: '流水总览', icon: <DescriptionIcon />, path: '/finance/all-transactions', adminOnly: true, isFinancial: true },
      { text: '对外付款', icon: <PaymentsIcon />, path: '/billing/salary-payment', adminOnly: true, isFinancial: true },
    ]
  },
  { text: '我的课程', icon: <SchoolIcon />, path: '/my-courses', adminOnly: false },
  { text: '知识点管理', icon: <LibraryBooksIcon />, path: '/knowledge-points', adminOnly: true },
  { text: '题库管理', icon: <QuestionAnswerIcon />, path: '/questions', adminOnly: true },
  { text: '考卷管理', icon: <AssignmentIcon />, path: '/exams', adminOnly: true },
  { text: '考试记录', icon: <AssignmentTurnedInIcon />, path: '/exam-records', adminOnly: false },
  { text: '用户管理', icon: <PeopleIcon />, path: '/users', adminOnly: true },
  { text: '员工管理', icon: <PeopleIcon />, path: '/staff-management', adminOnly: true },
  { text: '员工自评列表', icon: <AssignmentTurnedInIcon />, path: '/employee-self-evaluations', adminOnly: true },
  { text: '评价体系管理', icon: <AssignmentIcon />, path: '/evaluation-management', adminOnly: true },
  {
    text: 'LLM 管理',
    icon: <SettingsIcon />,
    path: '/admin/llm',
    adminOnly: true,
    subItems: [
      { text: '模型管理', icon: <ApiIcon />, path: '/admin/llm/models', adminOnly: true },
      { text: 'API Keys', icon: <ApiIcon />, path: '/admin/llm/api-keys', adminOnly: true },
      { text: '提示词管理', icon: <DescriptionIcon />, path: '/admin/llm/prompts', adminOnly: true },
      { text: '调用日志', icon: <HistoryIcon />, path: '/admin/llm/call-logs', adminOnly: true },
    ]
  },
];

const studentMenuItems = [
  { text: '考试记录', icon: <AssignmentTurnedInIcon />, path: '/exam-records', adminOnly: false },
  { text: '我的课程', icon: <SchoolIcon />, path: '/my-courses', adminOnly: false },
];

// Helper function to find all parent paths of the current active path
const findParentPaths = (items, currentPath) => {
  const paths = [];
  const search = (subItems, parentPath) => {
    for (const item of subItems) {
      const fullPath = item.path;
      if (currentPath.startsWith(fullPath) && item.subItems) {
        paths.push(parentPath);
        search(item.subItems, fullPath);
        return true;
      }
      if (item.subItems && search(item.subItems, fullPath)) {
        paths.push(parentPath);
        return true;
      }
    }
    return false;
  };
  search(items, null);
  return paths.filter(p => p);
};

function Sidebar({ isCollapsed, setIsCollapsed }) {
  const location = useLocation();
  const { year: yearParam, month: monthParam } = useParams();
  const [mobileOpen, setMobileOpen] = useState(false);
  const userInfo = hasToken();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [openMenus, setOpenMenus] = useState({});

  const menuItemsToRender = userInfo?.role === 'admin' ? allMenuItems : studentMenuItems;

  useEffect(() => {
    const currentPath = location.pathname;
    const parentPaths = findParentPaths(menuItemsToRender, currentPath);
    const newOpenMenus = {};
    let needsUpdate = false;
    for (const path of parentPaths) {
      if (!openMenus[path]) needsUpdate = true;
      newOpenMenus[path] = true;
    }
    if (needsUpdate) {
      setOpenMenus(prev => ({ ...prev, ...newOpenMenus }));
    }
  }, [location.pathname, menuItemsToRender]);

  const handleDrawerToggle = () => setMobileOpen(!mobileOpen);
  const handleCollapseToggle = () => setIsCollapsed(!isCollapsed);

  const handleMenuToggle = (path) => {
    if (isCollapsed) return; // 如果是折叠状态，不处理点击展开

    // 计算出当前点击菜单的新展开状态 (true 或 false)
    const isOpening = !openMenus[path];

    // 【新增逻辑开始】
    // 如果我们正在展开“合同与账单”...
    if (path === '/billing-management' && isOpening) {
        // ...那么就一次性地把它自己和它的子菜单“合同管理”都设置为展开
        setOpenMenus(prev => ({
            ...prev,
            '/billing-management': true, // 展开“合同与账单”
            '/contracts': true,          // 同时展开“合同管理”
        }));
    }
    // 【新增逻辑结束】
    else {
        // 对于所有其他菜单项，保持原来的逻辑不变
        setOpenMenus(prev => ({ ...prev, [path]: !prev[path] }));
    }
};

  const renderMenuItemsRecursive = (items, level = 0) => {
    const year = yearParam || new Date().getFullYear();
    const month = monthParam || new Date().getMonth() + 1;

    return items
      .filter(item => userInfo?.role === 'admin' || !item.adminOnly)
      .map((item) => {
        let finalPath = item.path;
        if (item.isFinancial) {
            finalPath = `${item.path}/${year}/${month}`;
        }

        // const isSelected = !item.subItems && location.pathname.startsWith(item.path);
        const isSelected = !item.subItems && location.pathname === finalPath;
        const hasSubItems = item.subItems && item.subItems.length > 0;
        const isOpen = hasSubItems && openMenus[item.path];

        const handleItemClick = () => {
          if (hasSubItems) {
            handleMenuToggle(item.path);
          } else if (isMobile) {
            handleDrawerToggle();
          }
        };

        return (
          <React.Fragment key={item.path || item.text}>
            <ListItemButton
              component={hasSubItems ? 'div' : RouterLink}
              to={hasSubItems ? undefined : finalPath}
              selected={isSelected}
              onClick={handleItemClick}
              sx={{
                py: isCollapsed && !isMobile ? 1.5 : 1.2,
                px: isCollapsed && !isMobile ? 'auto' : 2 + level * 2,
                justifyContent: isCollapsed && !isMobile ? 'center' : 'flex-start',
                borderRadius: 1,
                mx: isCollapsed && !isMobile ? 0.5 : 1,
                mb: 0.5,
                color: 'text.primary',
                '& .MuiListItemIcon-root': {
                  color: 'grey.700',
                  minWidth: 0,
                  mr: isCollapsed && !isMobile ? 0 : 1.5,
                  justifyContent: 'center',
                },
                '&.Mui-selected': {
                  background: `linear-gradient(87deg, ${theme.palette.primary.main} 0%, ${alpha(theme.palette.primary.dark, 0.85)} 100%)`,
                  boxShadow: theme.shadows[3],
                  '& .MuiListItemIcon-root, & .MuiListItemText-primary': { color: 'white' },
                },
              }}
            >
              <Tooltip title={isCollapsed && !isMobile ? item.text : ""} placement="right">
                <ListItemIcon>{item.icon || (level > 0 && <Box sx={{ width: 24, height: 24 }} />)}</ListItemIcon>
              </Tooltip>
              {!(isCollapsed && !isMobile) && <ListItemText primary={item.text} primaryTypographyProps={{ fontWeight: 500, fontSize: '0.875rem' }} />}
              {!(isCollapsed && !isMobile) && hasSubItems && (isOpen ? <ExpandLess /> : <ExpandMore />)}
            </ListItemButton>
            {!(isCollapsed && !isMobile) && hasSubItems && (
              <Collapse in={isOpen} timeout="auto" unmountOnExit>
                <List component="div" disablePadding>
                  {renderMenuItemsRecursive(item.subItems, level + 1)}
                </List>
              </Collapse>
            )}
          </React.Fragment>
        );
      });
  };

  const drawerContent = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
       <Box sx={{ p: 2, display: 'flex', justifyContent: 'center' }}>
         <img src={logo} alt="Logo" style={{ width: isCollapsed ? '40px' : '120px', transition: 'width 0.3s ease' }} />
       </Box>
      {!isCollapsed && <UserInfo sx={{ mt: 0, mb: 1 }} />}
      <List sx={{ flexGrow: 1, overflowY: 'auto', p: isCollapsed && !isMobile ? 0.5 : 1 }}>
        {renderMenuItemsRecursive(menuItemsToRender)}
      </List>
      {!isMobile && (
        <Box sx={{ position: 'absolute', bottom: 20, right: -16, zIndex: (theme) => theme.zIndex.drawer + 1 }}>
          <IconButton onClick={handleCollapseToggle} size="small" sx={{ backgroundColor: 'background.paper', '&:hover': { backgroundColor: 'background.default' }, border: '1px solid', borderColor: 'divider', boxShadow: 1 }}>
            {isCollapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
          </IconButton>
        </Box>
      )}
    </Box>
  );

  return (
    <>
      {isMobile && (
         <AppBar position="fixed" sx={{ top: 'auto', bottom: 0, backgroundColor: 'white' }}>
           <Toolbar sx={{ justifyContent: 'center' }}>
             <IconButton color="primary" aria-label="open drawer" onClick={handleDrawerToggle}>
               <MenuIcon />
             </IconButton>
           </Toolbar>
         </AppBar>
      )}
      <Drawer
        variant={isMobile ? "temporary" : "permanent"}
        open={isMobile ? mobileOpen : true}
        onClose={isMobile ? handleDrawerToggle : undefined}
        sx={{
          display: { xs: isMobile ? 'block' : 'none', sm: 'block' },
          '& .MuiDrawer-paper': {
            boxSizing: 'border-box',
            width: isMobile ? expandedWidth : (isCollapsed ? collapsedWidth : expandedWidth),
            borderRight: 'none',
            boxShadow: '0 0 2rem 0 rgba(136, 152, 170, .15)',
            transition: theme.transitions.create('width', { easing: theme.transitions.easing.sharp, duration: theme.transitions.duration.enteringScreen }),
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
