import { useState, useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Search, Plus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AddCustomerSheet } from './components/add-customer-sheet'

interface Customer {
  id: string
  name: string
  phone_number: string
  id_card_number: string
  created_at: string
}

export function CustomerList() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [isAddSheetOpen, setIsAddSheetOpen] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const { auth } = useAuthStore()
  const navigate = useNavigate()

  const fetchCustomers = async (searchQuery = '') => {
    setLoading(true)
    try {
      const token = auth.accessToken || localStorage.getItem('access_token')
      const response = await fetch(
        `/api/v1/customers/?search=${encodeURIComponent(searchQuery)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      )

      if (response.status === 401 || response.status === 403) {
        toast.error('认证过期，请重新登录')
        auth.reset()
        navigate({ to: '/sign-in', replace: true })
        return
      }

      if (response.ok) {
        const data = await response.json()
        setCustomers(data)
      } else {
        toast.error('获取客户列表失败')
      }
    } catch (error) {
      console.error('Error fetching customers:', error)
      toast.error('网络请求出错')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`确定要删除客户 "${name}" 吗？`)) return
    try {
      const token = auth.accessToken || localStorage.getItem('access_token')
      const response = await fetch(`/api/v1/customers/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      if (response.ok) {
        toast.success('删除成功')
        fetchCustomers(search)
      } else {
        toast.error('删除失败')
      }
    } catch (e) {
      toast.error('网络请求出错')
    }
  }

  useEffect(() => {
    fetchCustomers()
  }, [])

  const handleSearch = () => {
    fetchCustomers(search)
  }

  return (
    <div className='container mx-auto space-y-6 py-10'>
      <div className='flex items-center justify-between'>
        <h1 className='text-3xl font-bold tracking-tight'>客户管理</h1>
        <Button onClick={() => {
          setSelectedCustomer(null)
          setIsAddSheetOpen(true)
        }}>
          <Plus className='mr-2 h-4 w-4' />
          新增客户
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
              <TableHead className='w-[100px]'>姓名</TableHead>
              <TableHead>手机号</TableHead>
              <TableHead>身份证号</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead className='text-right'>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className='h-24 text-center'>
                  <Loader2 className='mx-auto h-6 w-6 animate-spin text-muted-foreground' />
                </TableCell>
              </TableRow>
            ) : customers.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className='h-24 text-center text-muted-foreground'
                >
                  暂无数据
                </TableCell>
              </TableRow>
            ) : (
              customers.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell className='font-medium'>{customer.name}</TableCell>
                  <TableCell>{customer.phone_number}</TableCell>
                  <TableCell>{customer.id_card_number}</TableCell>
                  <TableCell>
                    {new Date(customer.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className='text-right'>
                    <Button
                      variant='ghost'
                      size='sm'
                      className='text-blue-600'
                      onClick={() => navigate({ to: `/customers/${customer.id}` })}
                    >
                      详情
                    </Button>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => {
                        setSelectedCustomer(customer)
                        setIsAddSheetOpen(true)
                      }}
                    >
                      编辑
                    </Button>
                    <Button
                      variant='ghost'
                      size='sm'
                      className='text-destructive'
                      onClick={() => handleDelete(customer.id, customer.name)}
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

      <AddCustomerSheet
        open={isAddSheetOpen}
        onOpenChange={(open) => {
          setIsAddSheetOpen(open)
          if (!open) setSelectedCustomer(null)
        }}
        onSuccess={() => fetchCustomers(search)}
        customerData={selectedCustomer}
      />
    </div>
  )
}
