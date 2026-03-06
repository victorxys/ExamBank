import { useState, useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Search, Plus, Loader2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AddEmployeeSheet } from './components/add-employee-sheet'

interface Employee {
  id: string
  name: string
  phone_number?: string
  id_card_number?: string
  address?: string
  is_active: boolean
  created_at: string
}

import { Main } from '@/components/layout/main'

export function EmployeeList() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [isAddSheetOpen, setIsAddSheetOpen] = useState(false)
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null)
  const { auth } = useAuthStore()
  const navigate = useNavigate()

  const fetchEmployees = async (query = '') => {
    setLoading(true)
    try {
      const token = auth.accessToken || localStorage.getItem('access_token')
      const apiUrl = `/api/v1/employees/?search=${encodeURIComponent(query)}`

      const response = await fetch(apiUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (response.status === 401 || response.status === 403) {
        toast.error('认证过期，请重新登录')
        auth.reset()
        navigate({ to: '/sign-in', replace: true })
        return
      }

      if (response.ok) {
        const data = await response.json()
        setEmployees(data)
      } else {
        toast.error('获取员工列表失败')
      }
    } catch (error) {
      console.error('Error fetching employees:', error)
      toast.error('网络请求出错')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`确定要删除员工 "${name}" 吗？`)) return
    try {
      const token = auth.accessToken || localStorage.getItem('access_token')
      const response = await fetch(`/api/v1/employees/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      if (response.ok) {
        toast.success('删除成功')
        fetchEmployees(search)
      } else {
        toast.error('删除失败')
      }
    } catch (e) {
      toast.error('网络请求出错')
    }
  }

  useEffect(() => {
    fetchEmployees()
  }, [])

  const handleSearch = () => {
    fetchEmployees(search)
  }

  return (
    <Main fluid>
      <div className='space-y-4 max-w-7xl mx-auto'>
        <div className='flex flex-col gap-4 mb-6 sm:flex-row sm:items-center sm:justify-between'>
          <div className='flex items-center gap-2'>
            <Users className='h-8 w-8 text-primary' />
            <h1 className='text-3xl font-bold tracking-tight'>员工管理</h1>
          </div>
          <Button onClick={() => {
            setSelectedEmployee(null)
            setIsAddSheetOpen(true)
          }}>
            <Plus className='mr-2 h-4 w-4' />
            新增员工
          </Button>
        </div>

        <div className='flex items-center space-x-2 rounded-lg border bg-card p-4 shadow-sm'>
          <div className='relative max-w-sm flex-1'>
            <Search className='absolute top-2.5 left-2.5 h-4 w-4 text-muted-foreground' />
            <Input
              type='search'
              placeholder='搜索姓名或手机号...'
              className='pl-8'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <Button variant='secondary' onClick={handleSearch} disabled={loading}>
            {loading ? <Loader2 className='h-4 w-4 animate-spin' /> : '查询'}
          </Button>
        </div>

        <div className='overflow-hidden rounded-lg border bg-card shadow-sm'>
          <Table>
            <TableHeader>
              <TableRow className='bg-muted/50'>
                <TableHead>姓名</TableHead>
                <TableHead>手机号</TableHead>
                <TableHead>身份证号</TableHead>
                <TableHead>住址</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead className='text-right'>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className='h-24 text-center'>
                    <Loader2 className='mx-auto h-6 w-6 animate-spin text-muted-foreground' />
                  </TableCell>
                </TableRow>
              ) : employees.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className='h-24 text-center text-muted-foreground'>
                    暂无员工数据
                  </TableCell>
                </TableRow>
              ) : (
                employees.map((employee) => (
                  <TableRow key={employee.id}>
                    <TableCell className='font-semibold'>{employee.name}</TableCell>
                    <TableCell>{employee.phone_number || '-'}</TableCell>
                    <TableCell>{employee.id_card_number || '-'}</TableCell>
                    <TableCell className='max-w-[200px] truncate'>{employee.address || '-'}</TableCell>
                    <TableCell>
                      <Badge variant={employee.is_active ? 'default' : 'secondary'}>
                        {employee.is_active ? '在职' : '离职'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {employee.created_at ? new Date(employee.created_at).toLocaleDateString() : '-'}
                    </TableCell>
                    <TableCell className='text-right'>
                      <Button
                        variant='ghost'
                        size='sm'
                        className='text-blue-600'
                        onClick={() => navigate({ to: `/employees/${employee.id}` })}
                      >
                        详情
                      </Button>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => {
                          setSelectedEmployee(employee)
                          setIsAddSheetOpen(true)
                        }}
                      >
                        编辑
                      </Button>
                      <Button
                        variant='ghost'
                        size='sm'
                        className='text-destructive'
                        onClick={() => handleDelete(employee.id, employee.name)}
                      >
                        删除
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <AddEmployeeSheet
          open={isAddSheetOpen}
          onOpenChange={(open) => {
            setIsAddSheetOpen(open)
            if (!open) setSelectedEmployee(null)
          }}
          onSuccess={() => fetchEmployees(search)}
          employeeData={selectedEmployee}
        />
      </div>
    </Main>
  )
}
