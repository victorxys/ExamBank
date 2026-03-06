import { useState, useEffect } from 'react'
import { useParams, useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { ArrowLeft, Edit, Calendar, BookOpen, ShieldCheck, Phone, MapPin, BadgeCheck, History } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { AddEmployeeSheet } from './add-employee-sheet'

interface SalaryHistory {
    id: string
    contract_id: string
    effective_date: string
    base_salary: number
    commission_rate?: number
    bonus?: number
    notes?: string
}

interface Employee {
    id: string
    name: string
    name_pinyin?: string
    phone_number?: string
    id_card_number?: string
    address?: string
    is_active: boolean
    created_at: string
    salary_history: SalaryHistory[]
}

export function EmployeeDetails() {
    const { employeeId } = useParams({ strict: false }) as { employeeId: string }
    const navigate = useNavigate()
    const [employee, setEmployee] = useState<Employee | null>(null)
    const [loading, setLoading] = useState(true)
    const [isEditSheetOpen, setIsEditSheetOpen] = useState(false)
    const { auth } = useAuthStore()

    const fetchEmployeeDetails = async () => {
        setLoading(true)
        try {
            const token = auth.accessToken || localStorage.getItem('access_token')
            const response = await fetch(`/api/v1/employees/${employeeId}`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            })

            if (response.ok) {
                const data = await response.json()
                setEmployee(data)
            } else {
                toast.error('获取员工详情失败')
                navigate({ to: '/employees' as string })
            }
        } catch (error) {
            toast.error('网络请求错误')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchEmployeeDetails()
    }, [employeeId])

    if (loading) {
        return <div className='p-8 flex items-center justify-center h-[50vh]'>正在加载中...</div>
    }

    if (!employee) {
        return <div className='p-8 text-center'>未找到员工信息</div>
    }

    return (
        <div className='container mx-auto space-y-6 py-10'>
            <div className='flex items-center justify-between'>
                <Button variant='ghost' onClick={() => navigate({ to: '/employees' as string })}>
                    <ArrowLeft className='mr-2 h-4 w-4' />
                    返回列表
                </Button>
                <div className='flex gap-2'>
                    <Button variant='outline' onClick={() => setIsEditSheetOpen(true)}>
                        <Edit className='mr-2 h-4 w-4' />
                        编辑资料
                    </Button>
                </div>
            </div>

            <div className='grid grid-cols-1 md:grid-cols-3 gap-6'>
                {/* Employee Profile Card */}
                <Card className='md:col-span-1 border-none shadow-md overflow-hidden bg-card'>
                    <div className='h-2 bg-primary w-full' />
                    <CardHeader className='pb-4'>
                        <div className='flex items-center justify-between mb-2'>
                            <Badge variant={employee.is_active ? 'default' : 'secondary'}>
                                {employee.is_active ? '在职' : '离职'}
                            </Badge>
                            <span className='text-xs text-muted-foreground font-mono truncate w-[100px]'>{employee.id}</span>
                        </div>
                        <CardTitle className='text-2xl font-bold flex items-baseline gap-2'>
                            {employee.name}
                            {employee.name_pinyin && <span className='text-sm font-normal text-muted-foreground'>({employee.name_pinyin})</span>}
                        </CardTitle>
                        <CardDescription>加入于 {new Date(employee.created_at).toLocaleDateString()}</CardDescription>
                    </CardHeader>
                    <CardContent className='space-y-4 text-sm'>
                        <div className='space-y-3'>
                            <div className='flex items-center gap-3 p-2 hover:bg-muted/50 rounded-md transition-colors'>
                                <Phone className='h-4 w-4 text-muted-foreground' />
                                <div className='flex-1'>
                                    <p className='text-[10px] text-muted-foreground uppercase tracking-wider'>手机号码</p>
                                    <p className='font-medium'>{employee.phone_number || '未设置'}</p>
                                </div>
                            </div>
                            <div className='flex items-center gap-3 p-2 hover:bg-muted/50 rounded-md transition-colors'>
                                <BadgeCheck className='h-4 w-4 text-muted-foreground' />
                                <div className='flex-1'>
                                    <p className='text-[10px] text-muted-foreground uppercase tracking-wider'>身份证号</p>
                                    <p className='font-medium'>{employee.id_card_number || '未设置'}</p>
                                </div>
                            </div>
                            <div className='flex items-center gap-3 p-2 hover:bg-muted/50 rounded-md transition-colors'>
                                <MapPin className='h-4 w-4 text-muted-foreground' />
                                <div className='flex-1'>
                                    <p className='text-[10px] text-muted-foreground uppercase tracking-wider'>现住址</p>
                                    <p className='font-medium leading-tight'>{employee.address || '未设置'}</p>
                                </div>
                            </div>
                        </div>

                        <Separator className='my-4' />

                        <div className='p-4 bg-primary/5 rounded-xl border border-primary/10'>
                            <div className='flex items-center gap-2 mb-2'>
                                <History className='h-4 w-4 text-primary' />
                                <h4 className='text-sm font-semibold text-primary'>当前状态</h4>
                            </div>
                            <p className='text-xs text-muted-foreground'>
                                {employee.is_active ? '该员工可以正常指派合同。' : '该员工已离职，历史记录仅供存档查询。'}
                            </p>
                        </div>
                    </CardContent>
                </Card>

                {/* Salary History Timeline */}
                <div className='md:col-span-2 space-y-6'>
                    <Card className='border-none shadow-md'>
                        <CardHeader className='pb-2 flex flex-row items-center justify-between'>
                            <div>
                                <CardTitle className='text-lg'>薪资历史追溯</CardTitle>
                                <CardDescription>由合同变动触发的薪资调整记录</CardDescription>
                            </div>
                            <History className='h-5 w-5 text-muted-foreground' />
                        </CardHeader>
                        <CardContent className='pt-6'>
                            {employee.salary_history.length === 0 ? (
                                <div className='text-center py-10 border-2 border-dashed rounded-lg'>
                                    <p className='text-sm text-muted-foreground'>暂无薪资调整记录</p>
                                </div>
                            ) : (
                                <div className='relative pl-6 space-y-8 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[2px] before:bg-muted'>
                                    {employee.salary_history.map((record, index) => (
                                        <div key={record.id} className='relative'>
                                            <div className={`absolute -left-[21px] top-1 w-4 h-4 rounded-full border-2 border-background ${index === 0 ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
                                            <div className='flex flex-col sm:flex-row sm:items-start justify-between gap-4'>
                                                <div className='space-y-1'>
                                                    <div className='flex items-center gap-2'>
                                                        <p className='text-sm font-bold'>基薪: ¥ {record.base_salary}</p>
                                                        {index === 0 && <Badge variant='outline' className='text-[10px] h-5 bg-emerald-50 text-emerald-700 border-emerald-200'>当前生效</Badge>}
                                                    </div>
                                                    <div className='flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground'>
                                                        <span className='flex items-center gap-1'><Calendar className='h-3 w-3' /> 生效于 {record.effective_date}</span>
                                                        {record.commission_rate && <span className='flex items-center gap-1'><BadgeCheck className='h-3 w-3' /> 提成 {Number(record.commission_rate * 100).toFixed(1)}%</span>}
                                                        {record.bonus && <span className='flex items-center gap-1'><ShieldCheck className='h-3 w-3' /> 奖金 ¥{record.bonus}</span>}
                                                    </div>
                                                    {record.notes && <p className='text-xs mt-2 p-2 bg-muted/30 rounded italic'>"{record.notes}"</p>}
                                                </div>
                                                <div className='flex items-center gap-2'>
                                                    <Button
                                                        variant='outline'
                                                        size='sm'
                                                        className='h-8 text-[10px]'
                                                        onClick={() => {
                                                            const contractUrl = import.meta.env.VITE_CONTRACT_APP_URL || 'http://localhost:5173'
                                                            window.open(`${contractUrl}/contracts/${record.contract_id}`, '_blank')
                                                        }}
                                                    >
                                                        <BookOpen className='mr-1 h-3 w-3' /> 查看关联合同
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card className='border-none shadow-sm bg-muted/30 border-dashed border-2'>
                        <CardHeader className='pb-2'>
                            <CardTitle className='text-sm font-semibold'>注意事项</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <ul className='text-xs text-muted-foreground list-disc pl-4 space-y-1'>
                                <li>薪资变动仅在合同生效、变更或续约时自动触发记录。</li>
                                <li>如需手动调整历史记录，请联系财务部或系统管理员。</li>
                                <li>生效日期以合同约定的服务开始日期为准。</li>
                            </ul>
                        </CardContent>
                    </Card>
                </div>
            </div>

            <AddEmployeeSheet
                open={isEditSheetOpen}
                onOpenChange={setIsEditSheetOpen}
                onSuccess={fetchEmployeeDetails}
                employeeData={employee}
            />
        </div>
    )
}
