import { useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'

const customerSchema = z.object({
    name: z.string().min(1, '请输入姓名'),
    phone_number: z.string().min(1, '请输入手机号'),
    id_card_number: z.string().optional(),
})

interface AddCustomerDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSuccess: (customer: any) => void
}

export function AddCustomerDialog({ open, onOpenChange, onSuccess }: AddCustomerDialogProps) {
    const [isLoading, setIsLoading] = useState(false)
    const { auth } = useAuthStore()

    const form = useForm<z.infer<typeof customerSchema>>({
        resolver: zodResolver(customerSchema),
        defaultValues: {
            name: '',
            phone_number: '',
            id_card_number: '',
        },
    })

    async function onSubmit(data: z.infer<typeof customerSchema>) {
        setIsLoading(true)
        try {
            const token = auth.accessToken || localStorage.getItem('access_token')
            const response = await fetch('/api/v1/customers/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(data),
            })

            if (response.ok) {
                const newCustomer = await response.json()
                toast.success(`客户 ${newCustomer.name} 收录成功`)
                onSuccess(newCustomer)
                onOpenChange(false)
                form.reset()
            } else {
                const err = await response.json()
                toast.error(err.detail || '收录客户失败')
            }
        } catch (error) {
            toast.error('网络请求错误')
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <UserPlus className="h-5 w-5 text-primary" />
                        快速收录客户
                    </DialogTitle>
                    <DialogDescription>
                        录入基础信息后会自动关联到当前合同。
                    </DialogDescription>
                </DialogHeader>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
                        <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>姓名</FormLabel>
                                    <FormControl>
                                        <Input placeholder="张三" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="phone_number"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>手机号</FormLabel>
                                    <FormControl>
                                        <Input placeholder="13800000000" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="id_card_number"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>身份证号 (可选)</FormLabel>
                                    <FormControl>
                                        <Input placeholder="110101..." {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <DialogFooter className="pt-4">
                            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                                取消
                            </Button>
                            <Button type="submit" disabled={isLoading}>
                                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                立即收录
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}
