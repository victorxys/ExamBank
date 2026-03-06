import { useState, useEffect } from 'react'
import { useParams, useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { ArrowLeft, Edit, FileText, Calendar, Wallet, ShieldCheck, Clock, User } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { AddContractSheet } from './add-contract-sheet'
import { NameResolver } from './name-resolver'

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
    created_at: string
}

export function ContractDetails() {
    const { contractId } = useParams({ from: '/_authenticated/contracts/$contractId' })
    const navigate = useNavigate()
    const [contract, setContract] = useState<Contract | null>(null)
    const [loading, setLoading] = useState(true)
    const [isEditSheetOpen, setIsEditSheetOpen] = useState(false)
    const { auth } = useAuthStore()

    const fetchContractDetails = async () => {
        setLoading(true)
        try {
            const token = auth.accessToken || localStorage.getItem('access_token')
            const response = await fetch(`/api/v1/contracts/${contractId}`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            })

            if (response.ok) {
                const data = await response.json()
                setContract(data)
            } else {
                toast.error('获取合同详情失败')
                navigate({ to: '/contracts' })
            }
        } catch (error) {
            toast.error('网络请求错误')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchContractDetails()
    }, [contractId])

    if (loading) {
        return <div className='p-8'>正在加载中...</div>
    }

    if (!contract) {
        return <div className='p-8'>未找到合同信息</div>
    }

    const getStatusBadge = (status: string) => {
        switch (status) {
            case '有效':
                return <Badge className='bg-emerald-500 hover:bg-emerald-600 px-3 py-1 text-sm'>有效执行中</Badge>
            case '已失效':
                return <Badge variant='destructive' className='px-3 py-1 text-sm'>已失效</Badge>
            case '草稿':
                return <Badge variant='outline' className='px-3 py-1 text-sm'>草案阶段</Badge>
            default:
                return <Badge variant='secondary' className='px-3 py-1 text-sm'>{status}</Badge>
        }
    }

    return (
        <div className='container mx-auto space-y-6 py-10'>
            <div className='flex items-center justify-between'>
                <Button variant='ghost' onClick={() => navigate({ to: '/contracts' })}>
                    <ArrowLeft className='mr-2 h-4 w-4' />
                    返回列表
                </Button>
                <div className='flex gap-2'>
                    <Button variant='outline' onClick={() => setIsEditSheetOpen(true)}>
                        <Edit className='mr-2 h-4 w-4' />
                        编辑合同
                    </Button>
                    <Button variant='default'>
                        <ShieldCheck className='mr-2 h-4 w-4' />
                        签署确认
                    </Button>
                </div>
            </div>

            <div className='grid grid-cols-1 md:grid-cols-3 gap-6'>
                {/* Contract Summary Card */}
                <Card className='md:col-span-1 border-none shadow-md overflow-hidden bg-card'>
                    <div className='h-2 bg-primary w-full' />
                    <CardHeader className='pb-4'>
                        <div className='flex items-center justify-between mb-2'>
                            <Badge variant='outline' className='font-mono'>{contract.contract_number}</Badge>
                            {getStatusBadge(contract.status)}
                        </div>
                        <CardTitle className='text-2xl font-bold'>{contract.type}</CardTitle>
                        <CardDescription>创建于 {new Date(contract.created_at).toLocaleDateString()}</CardDescription>
                    </CardHeader>
                    <CardContent className='space-y-4 text-sm'>
                        <div className='flex items-center gap-3 p-3 bg-muted/40 rounded-lg'>
                            <User className='h-5 w-5 text-muted-foreground' />
                            <div className='flex-1'>
                                <p className='text-xs text-muted-foreground'>关联客户</p>
                                <p className='font-semibold'>
                                    <NameResolver id={contract.customer_id} type='customer' fallback='未知客户' />
                                </p>
                                <p className='text-[10px] text-muted-foreground font-mono truncate w-[180px]'>{contract.customer_id}</p>
                            </div>
                            <Button variant='ghost' size='icon' className='ml-auto h-8 w-8' onClick={() => window.open(`/customers/${contract.customer_id}`, '_blank')}>
                                <ArrowLeft className='h-4 w-4 rotate-180' />
                            </Button>
                        </div>

                        <div className='space-y-3 pt-2'>
                            <div className='flex justify-between items-center'>
                                <span className='text-muted-foreground flex items-center gap-2'>
                                    <Calendar className='h-4 w-4' /> 开始日期
                                </span>
                                <span className='font-medium'>{contract.start_date || '未设置'}</span>
                            </div>
                            <div className='flex justify-between items-center'>
                                <span className='text-muted-foreground flex items-center gap-2'>
                                    <Clock className='h-4 w-4' /> 截止日期
                                </span>
                                <span className='font-medium'>{contract.end_date || '长期有效'}</span>
                            </div>
                            <div className='flex justify-between items-center pt-2 border-t'>
                                <span className='text-lg font-semibold'>合同总额</span>
                                <span className='text-2xl font-bold text-primary'>¥ {Number(contract.total_amount || 0).toFixed(2)}</span>
                            </div>
                        </div>

                        <Separator className='my-4' />

                        <div className='space-y-4'>
                            <h4 className='text-sm font-semibold'>服务人员</h4>
                            <div className='flex items-center gap-3 p-3 bg-primary/5 rounded-lg border border-primary/10'>
                                <ShieldCheck className='h-5 w-5 text-primary' />
                                <div>
                                    <p className='font-medium'>
                                        <NameResolver id={contract.employee_id} type='employee' fallback='未指派' />
                                    </p>
                                    <p className='text-[10px] text-muted-foreground font-mono'>{contract.employee_id || 'N/A'}</p>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Detailed Modules */}
                <div className='md:col-span-2 space-y-6'>
                    <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
                        <Card className='border-none shadow-sm hover:shadow-md transition-all cursor-pointer group'>
                            <CardHeader className='flex flex-row items-center justify-between pb-2'>
                                <CardTitle className='text-base font-medium'>条款内容</CardTitle>
                                <FileText className='h-4 w-4 text-muted-foreground group-hover:text-primary' />
                            </CardHeader>
                            <CardContent>
                                <p className='text-xs text-muted-foreground'>查看合同正文、违约条款及服务标准。</p>
                            </CardContent>
                        </Card>

                        <Card className='border-none shadow-sm hover:shadow-md transition-all cursor-pointer group'>
                            <CardHeader className='flex flex-row items-center justify-between pb-2'>
                                <CardTitle className='text-base font-medium'>支付计划</CardTitle>
                                <Wallet className='h-4 w-4 text-muted-foreground group-hover:text-primary' />
                            </CardHeader>
                            <CardContent>
                                <p className='text-xs text-muted-foreground'>查看账单分期、实缴记录及待收金额。</p>
                            </CardContent>
                        </Card>
                    </div>

                    <Card className='border-none shadow-md'>
                        <CardHeader className='pb-2'>
                            <CardTitle className='text-lg'>履约动态</CardTitle>
                            <CardDescription>跟踪合同签署及执行的时间轴记录</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className='relative pl-6 space-y-6 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[2px] before:bg-muted'>
                                <div className='relative'>
                                    <div className='absolute -left-[21px] top-1 w-4 h-4 rounded-full border-2 border-background bg-primary' />
                                    <p className='text-sm font-semibold'>合同系统录入</p>
                                    <p className='text-xs text-muted-foreground'>{new Date(contract.created_at).toLocaleString()}</p>
                                </div>
                                <div className='relative'>
                                    <div className='absolute -left-[21px] top-1 w-4 h-4 rounded-full border-2 border-background bg-muted-foreground/30' />
                                    <p className='text-sm font-semibold text-muted-foreground italic'>等待客户电子签署...</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <div className='p-6 border-2 border-dashed rounded-xl bg-muted/20 text-center space-y-2'>
                        <p className='text-sm font-medium'>需要协助吗？</p>
                        <p className='text-xs text-muted-foreground'>如合同条款有误或需修改，请联系法务部门进行审核。</p>
                    </div>
                </div>
            </div>

            <AddContractSheet
                open={isEditSheetOpen}
                onOpenChange={setIsEditSheetOpen}
                onSuccess={fetchContractDetails}
                contractData={contract}
            />
        </div>
    )
}
