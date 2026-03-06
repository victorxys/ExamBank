import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

const formSchema = z.object({
  name: z.string().min(2, { message: '姓名至少2个字符' }),
  name_pinyin: z.string().optional().or(z.literal('')),
  phone_number: z.string().optional().or(z.literal('')),
  id_card_number: z.string().optional().or(z.literal('')),
  address: z.string().optional().or(z.literal('')),
  is_active: z.boolean(),
})

type FormValues = z.infer<typeof formSchema>

interface AddEmployeeSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  employeeData?: any
}

export function AddEmployeeSheet({
  open,
  onOpenChange,
  onSuccess,
  employeeData,
}: AddEmployeeSheetProps) {
  const { auth } = useAuthStore()
  const isEdit = !!employeeData

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      name_pinyin: '',
      phone_number: '',
      id_card_number: '',
      address: '',
      is_active: true,
    },
  })

  useEffect(() => {
    if (open) {
      if (employeeData) {
        form.reset({
          name: employeeData.name || '',
          name_pinyin: employeeData.name_pinyin || '',
          phone_number: employeeData.phone_number || '',
          id_card_number: employeeData.id_card_number || '',
          address: employeeData.address || '',
          is_active: employeeData.is_active ?? true,
        })
      } else {
        form.reset({
          name: '',
          name_pinyin: '',
          phone_number: '',
          id_card_number: '',
          address: '',
          is_active: true,
        })
      }
    }
  }, [employeeData, form, open])

  const onSubmit = async (values: FormValues) => {
    try {
      const token = auth.accessToken || localStorage.getItem('access_token')
      const url = isEdit
        ? `/api/v1/employees/${employeeData.id}`
        : '/api/v1/employees/'

      const method = isEdit ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(values),
      })

      if (response.ok) {
        toast.success(isEdit ? '编辑成功' : '添加成功')
        onSuccess()
        onOpenChange(false)
      } else {
        const err = await response.json()
        toast.error(err.detail || '操作失败')
      }
    } catch (error) {
      toast.error('网络请求失败')
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className='sm:max-w-[540px]'>
        <SheetHeader>
          <SheetTitle>{isEdit ? '编辑员工' : '新增员工'}</SheetTitle>
          <SheetDescription>
            在此填写员工的详细信息。点击保存以提交。
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4 py-4'>
            <FormField
              control={form.control}
              name='name'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>姓名</FormLabel>
                  <FormControl>
                    <Input placeholder='请输入姓名' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='name_pinyin'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>姓名拼音</FormLabel>
                  <FormControl>
                    <Input placeholder='请输入姓名拼音 (可选)' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='phone_number'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>手机号</FormLabel>
                  <FormControl>
                    <Input placeholder='请输入手机号' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='id_card_number'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>身份证号</FormLabel>
                  <FormControl>
                    <Input placeholder='请输入身份证号' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='address'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>现住址</FormLabel>
                  <FormControl>
                    <Textarea placeholder='请输入现住址' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='is_active'
              render={({ field }) => (
                <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4 shadow-sm'>
                  <div className='space-y-0.5'>
                    <FormLabel>在职状态</FormLabel>
                    <div className='text-sm text-muted-foreground'>
                      设置为离职后将无法在合同中指派该员工
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
            <SheetFooter className='gap-2 pt-4 sm:gap-0'>
              <Button type='submit' className='w-full'>保存</Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  )
}
