import { ListTodo, Package, Users } from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: {
    name: 'satnaing',
    email: 'satnaingdev@gmail.com',
    avatar: '/avatars/shadcn.jpg',
  },
  teams: [
    {
      name: '萌姨萌嫂',
      logo: '/logo.svg',
      plan: '合同管理系统',
    },
  ],
  navGroups: [
    {
      title: '业务菜单',
      items: [
        {
          title: '合同管理',
          icon: ListTodo,
          items: [
            {
              title: '月嫂合同',
              url: '/contracts/maternity-nurse',
            },
            {
              title: '育儿嫂合同',
              url: '/contracts/nanny',
            },
            {
              title: '试工合同',
              url: '/contracts/trial',
            },
            {
              title: '全部合同',
              url: '/contracts',
            },
          ],
        },
        {
          title: '客户管理',
          url: '/customers',
          icon: Users,
        },
        {
          title: '账单管理 (开发中)',
          url: '/billing',
          icon: Package,
        },
      ],
    },
  ],
}
