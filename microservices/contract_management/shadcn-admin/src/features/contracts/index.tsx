import { useState, useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Search, Plus, Loader2, FileText } from 'lucide-react'
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
import { AddContractSheet } from './components/add-contract-sheet'
import { NameResolver } from './components/name-resolver'

interface Contract {
  id: string
  customer_id: string
  customer_name?: string
  employee_id?: string
  employee_name?: string
  contract_number: string
  type: string
  status: string
  start_date: string
  end_date: string
  total_amount: number
  is_monthly_auto_renew?: boolean
  deposit_status?: string
  created_at: string
}

interface ContractListProps {
  targetType?: string
}

export function ContractList({ targetType }: ContractListProps) {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [isAddSheetOpen, setIsAddSheetOpen] = useState(false)
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null)
  const { auth } = useAuthStore()
  const navigate = useNavigate()

  const fetchContracts = async (query = '') => {
    setLoading(true)
    try {
      const token = auth.accessToken || localStorage.getItem('access_token')

      let apiUrl = `/api/v1/contracts/?search=${encodeURIComponent(query)}`
      if (targetType) {
        if (targetType === 'trial') {
          // Special case for trial contracts: they contain '试工' in the type
          apiUrl += `&search=${encodeURIComponent('试工')}`
        } else {
          apiUrl += `&contract_type=${encodeURIComponent(targetType)}`
        }
      }

      const response = await fetch(apiUrl, {
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
        setContracts(data)
      } else {
        toast.error('获取合同列表失败')
      }
    } catch (error) {
      console.error('Error fetching contracts:', error)
      toast.error('网络请求出错')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string, number: string) => {
    if (!confirm(`确定要删除合同号 "${number}" 吗？`)) return
    try {
      const token = auth.accessToken || localStorage.getItem('access_token')
      const response = await fetch(`/api/v1/contracts/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      if (response.ok) {
        toast.success('删除成功')
        fetchContracts(search)
      } else {
        toast.error('删除失败')
      }
    } catch (e) {
      toast.error('网络请求出错')
    }
  }

  useEffect(() => {
    fetchContracts()
  }, [])

  const handleSearch = () => {
    fetchContracts(search)
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case '有效':
        return <Badge className='bg-emerald-500 hover:bg-emerald-600'>有效</Badge>
      case '已失效':
        return <Badge variant='destructive'>已失效</Badge>
      case '草稿':
        return <Badge variant='outline'>草稿</Badge>
      default:
        return <Badge variant='secondary'>{status}</Badge>
    }
  }

  return (
    <div className='container mx-auto space-y-6 py-10'>
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-2'>
          <FileText className='h-8 w-8 text-primary' />
          <h1 className='text-3xl font-bold tracking-tight'>合同管理</h1>
        </div>
        <Button onClick={() => {
          setSelectedContract(null)
          setIsAddSheetOpen(true)
        }}>
          <Plus className='mr-2 h-4 w-4' />
          新建合同
        </Button>
      </div>

      <div className='flex items-center space-x-2 rounded-lg border bg-card p-4 shadow-sm'>
        <div className='relative max-w-sm flex-1'>
          <Search className='absolute top-2.5 left-2.5 h-4 w-4 text-muted-foreground' />
          <Input
            type='search'
            placeholder='搜索合同号或类型...'
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
              <TableHead className='w-[150px]'>合同编号</TableHead>
              <TableHead>客户</TableHead>
              <TableHead>人员</TableHead>
              {!targetType && <TableHead>合同类型</TableHead>}
              <TableHead>状态</TableHead>
              {targetType === '月嫂服务合同' && <TableHead>定金状态</TableHead>}
              {targetType === '育儿嫂正式合同' && <TableHead>合约周期</TableHead>}
              <TableHead>总额</TableHead>
              <TableHead>开始日期</TableHead>
              <TableHead className='text-right'>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={targetType ? 8 : 9} className='h-24 text-center'>
                  <Loader2 className='mx-auto h-6 w-6 animate-spin text-muted-foreground' />
                </TableCell>
              </TableRow>
            ) : contracts.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={targetType ? 8 : 9}
                  className='h-24 text-center text-muted-foreground'
                >
                  暂无合同数据
                </TableCell>
              </TableRow>
            ) : (
              contracts.map((contract) => (
                <TableRow key={contract.id}>
                  <TableCell className='font-mono font-medium'>{contract.contract_number}</TableCell>
                  <TableCell className='font-semibold'>
                    <NameResolver id={contract.customer_id} type='customer' fallback='未知客户' />
                  </TableCell>
                  <TableCell>
                    <NameResolver id={contract.employee_id} type='employee' fallback='未指派' />
                  </TableCell>
                  {!targetType && <TableCell>{contract.type}</TableCell>}
                  <TableCell>{getStatusBadge(contract.status)}</TableCell>
                  {targetType === '月嫂服务合同' && (
                    <TableCell>
                      <Badge variant={contract.deposit_status === 'paid' ? 'default' : 'outline'}>
                        {contract.deposit_status === 'paid' ? '已收定金' : '待收定金'}
                      </Badge>
                    </TableCell>
                  )}
                  {targetType === '育儿嫂正式合同' && (
                    <TableCell>
                      {contract.is_monthly_auto_renew ? (
                        <Badge variant="secondary" className="bg-blue-100 text-blue-700 hover:bg-blue-200">月签</Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">统签</span>
                      )}
                    </TableCell>
                  )}
                  <TableCell>¥ {Number(contract.total_amount).toFixed(2)}</TableCell>
                  <TableCell>
                    {contract.start_date ? new Date(contract.start_date).toLocaleDateString() : '-'}
                  </TableCell>
                  <TableCell className='text-right'>
                    <Button
                      variant='ghost'
                      size='sm'
                      className='text-blue-600'
                      onClick={() => navigate({ to: `/contracts/${contract.id}` })}
                    >
                      详情
                    </Button>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => {
                        setSelectedContract(contract)
                        setIsAddSheetOpen(true)
                      }}
                    >
                      编辑
                    </Button>
                    <Button
                      variant='ghost'
                      size='sm'
                      className='text-destructive'
                      onClick={() => handleDelete(contract.id, contract.contract_number)}
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

      <AddContractSheet
        open={isAddSheetOpen}
        onOpenChange={(open) => {
          setIsAddSheetOpen(open)
          if (!open) setSelectedContract(null)
        }}
        onSuccess={() => fetchContracts(search)}
        contractData={selectedContract}
        defaultType={targetType}
      />
    </div>
  )
}
