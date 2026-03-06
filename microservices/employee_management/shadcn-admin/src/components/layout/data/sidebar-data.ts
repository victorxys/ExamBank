import { Users } from 'lucide-react'
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
      plan: '员工管理系统',
    },
  ],
  navGroups: [
    {
      title: '业务菜单',
      items: [
        {
          title: '员工管理',
          url: '/employees',
          icon: Users,
        },
      ],
    },
  ],
}
