import { useState, useEffect } from 'react'
import { z } from 'zod'
import { format } from 'date-fns'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { zhCN } from 'date-fns/locale'
import { Loader2, CalendarIcon, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from '@/components/ui/switch'

import { CustomerSelector } from './customer-selector'
import { EmployeeSelector } from './employee-selector'

const formSchema = z.object({
  customer_id: z.string().uuid('请选择或收录客户'),
  employee_id: z.string().uuid('请选择服务人员').optional().or(z.literal('')),
  contract_number: z.string().min(1, '请输入合同编号'),
  type: z.string().min(1, '请选择合同类型'),
  status: z.string().min(1, '请选择合同状态'),
  start_date: z.date(),
  end_date: z.date(),
  total_amount: z.number().min(0, '金额不能小于0'),
  is_monthly_auto_renew: z.boolean(),
  deposit_status: z.string().optional(),
})

type FormValues = z.infer<typeof formSchema>

interface AddContractSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  contractData?: Record<string, any> | null
  defaultType?: string
}

export function AddContractSheet({
  open,
  onOpenChange,
  onSuccess,
  contractData,
  defaultType,
}: AddContractSheetProps) {
  const [isLoading, setIsLoading] = useState(false)
  const { auth } = useAuthStore()
  const isEditing = !!contractData

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      customer_id: '',
      employee_id: '',
      contract_number: '',
      type: '',
      status: '有效',
      start_date: new Date(),
      end_date: new Date(),
      total_amount: 0,
      is_monthly_auto_renew: false,
      deposit_status: 'unpaid',
    },
  })

  useEffect(() => {
    if (open) {
      if (contractData) {
        form.reset({
          customer_id: contractData.customer_id,
          employee_id: contractData.employee_id || '',
          contract_number: contractData.contract_number,
          type: contractData.type,
          status: contractData.status || '有效',
          start_date: contractData.start_date ? new Date(contractData.start_date) : new Date(),
          end_date: contractData.end_date ? new Date(contractData.end_date) : new Date(),
          total_amount: Number(contractData.total_amount) || 0,
          is_monthly_auto_renew: !!contractData.is_monthly_auto_renew,
          deposit_status: contractData.deposit_status || 'unpaid',
        } as FormValues)
      } else {
        form.reset({
          customer_id: '',
          employee_id: '',
          contract_number: `HT-${format(new Date(), 'yyyyMMdd')}-${Math.floor(Math.random() * 1000)}`,
          type: '',
          status: '有效',
          start_date: new Date(),
          end_date: new Date(),
          total_amount: 0,
          is_monthly_auto_renew: false,
          deposit_status: 'unpaid',
        } as FormValues)
        if (defaultType && defaultType !== 'trial') {
          form.setValue('type', defaultType)
        }
      }
    }
  }, [open, contractData, form])

  async function onSubmit(data: FormValues) {
    setIsLoading(true)
    try {
      const token = auth.accessToken || localStorage.getItem('access_token')

      const payload = {
        ...data,
        start_date: data.start_date ? format(data.start_date, 'yyyy-MM-dd') : null,
        end_date: data.end_date ? format(data.end_date, 'yyyy-MM-dd') : null,
      }

      const url = isEditing ? `/api/v1/contracts/${contractData?.id}` : '/api/v1/contracts/'
      const method = isEditing ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method: method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      })

      if (response.ok) {
        toast.success(isEditing ? '修改成功' : '创建成功')
        onSuccess()
        onOpenChange(false)
      } else {
        const errData = await response.json()
        toast.error(errData.detail || (isEditing ? '修改失败' : '创建失败'))
      }
    } catch (error) {
      toast.error('网络请求出错')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className='overflow-y-auto sm:max-w-[540px] px-10'>
        <SheetHeader className='text-left pb-6'>
          <SheetTitle className='flex items-center gap-2 text-2xl'>
            <FileText className='h-6 w-6 text-primary' />
            {isEditing ? '编辑合同' : '创建新合同'}
          </SheetTitle>
          <SheetDescription>
            请填写合规的服务合同信息。
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-6 pt-2'>
            <FormField
              control={form.control}
              name='customer_id'
              render={({ field }) => (
                <FormItem className='flex flex-col'>
                  <FormLabel>关联客户</FormLabel>
                  <FormControl>
                    <CustomerSelector
                      value={field.value}
                      onChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='employee_id'
              render={({ field }) => (
                <FormItem className='flex flex-col'>
                  <FormLabel>关联服务人员(员工)</FormLabel>
                  <FormControl>
                    <EmployeeSelector
                      value={field.value || ''}
                      onChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className='grid grid-cols-2 gap-4'>
              <FormField
                control={form.control}
                name='contract_number'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>合同编号</FormLabel>
                    <FormControl>
                      <Input placeholder='HT-202X...' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='status'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>合同状态</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="选择状态" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="有效">有效</SelectItem>
                        <SelectItem value="草稿">草稿</SelectItem>
                        <SelectItem value="已失效">已失效</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name='type'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>合同类型</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="选择合同类型" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="育儿嫂正式合同">育儿嫂正式合同</SelectItem>
                      <SelectItem value="育儿嫂试工协议">育儿嫂试工协议</SelectItem>
                      <SelectItem value="月嫂服务合同">月嫂服务合同</SelectItem>
                      <SelectItem value="月嫂试工协议">月嫂试工协议</SelectItem>
                      <SelectItem value="家政服务合同">家政服务合同</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {form.watch('type') === '育儿嫂正式合同' && (
              <FormField
                control={form.control}
                name='is_monthly_auto_renew'
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base font-medium">是否自动月签</FormLabel>
                      <div className="text-sm text-muted-foreground">
                        开启后，该育儿嫂合同将按月自动续约
                      </div>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            )}

            {form.watch('type') === '月嫂服务合同' && (
              <FormField
                control={form.control}
                name='deposit_status'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>定金状态</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || 'unpaid'}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="选择定金状态" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="unpaid">未支付</SelectItem>
                        <SelectItem value="paid">已支付</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <div className='grid grid-cols-2 gap-4'>
              <FormField
                control={form.control}
                name='start_date'
                render={({ field }) => (
                  <FormItem className='flex flex-col'>
                    <FormLabel>开始日期</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant={'outline'}
                            className={cn(
                              'pl-3 text-left font-normal',
                              !field.value && 'text-muted-foreground'
                            )}
                          >
                            {field.value ? (
                              format(field.value, 'PPP', { locale: zhCN })
                            ) : (
                              <span>选择日期</span>
                            )}
                            <CalendarIcon className='ml-auto h-4 w-4 opacity-50' />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className='w-auto p-0' align='start'>
                        <Calendar
                          mode='single'
                          selected={field.value}
                          onSelect={field.onChange}
                          disabled={(date) =>
                            date < new Date('1900-01-01')
                          }
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='end_date'
                render={({ field }) => (
                  <FormItem className='flex flex-col'>
                    <FormLabel>截止日期</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant={'outline'}
                            className={cn(
                              'pl-3 text-left font-normal',
                              !field.value && 'text-muted-foreground'
                            )}
                          >
                            {field.value ? (
                              format(field.value, 'PPP', { locale: zhCN })
                            ) : (
                              <span>选择日期</span>
                            )}
                            <CalendarIcon className='ml-auto h-4 w-4 opacity-50' />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className='w-auto p-0' align='start'>
                        <Calendar
                          mode='single'
                          selected={field.value}
                          onSelect={field.onChange}
                          disabled={(date) =>
                            date < new Date('1900-01-01')
                          }
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name='total_amount'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>合同总额</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      step='0.01'
                      placeholder='0.00'
                      {...field}
                      onChange={(e) => field.onChange(e.target.value === '' ? 0 : Number(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className='flex flex-col gap-3 pt-8 pb-4'>
              <Button type='submit' className='w-full' disabled={isLoading}>
                {isLoading && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
                {isEditing ? '保存修改' : '确认创建'}
              </Button>
              <Button
                type='button'
                variant='outline'
                className='w-full'
                onClick={() => onOpenChange(false)}
              >
                取消
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  )
}
