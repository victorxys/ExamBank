import { useState, useEffect } from 'react'
import { Check, ChevronsUpDown, UserPlus, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command'
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover'
import { useAuthStore } from '@/stores/auth-store'
import { AddCustomerDialog } from './add-customer-dialog'
import { NameResolver } from './name-resolver'

interface Customer {
    id: string
    name: string
    phone_number: string
}

interface CustomerSelectorProps {
    value: string
    onChange: (value: string) => void
    onSelectCustomer?: (customer: Customer) => void
}

export function CustomerSelector({ value, onChange, onSelectCustomer }: CustomerSelectorProps) {
    const [open, setOpen] = useState(false)
    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
    const [searchValue, setSearchValue] = useState('')
    const [customers, setCustomers] = useState<Customer[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const { auth } = useAuthStore()

    const fetchCustomers = async (query: string) => {
        setIsLoading(true)
        try {
            const token = auth.accessToken || localStorage.getItem('access_token')
            const response = await fetch(
                `/api/v1/customers/?search=${encodeURIComponent(query)}&limit=10`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            )
            if (response.ok) {
                const data = await response.json()
                setCustomers(data)
            }
        } catch (error) {
            console.error('Error fetching customers:', error)
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        const timer = setTimeout(() => {
            fetchCustomers(searchValue)
        }, 300)
        return () => clearTimeout(timer)
    }, [searchValue])

    const selectedCustomer = customers.find((c) => c.id === value)

    return (
        <div className="flex items-center gap-2 w-full">
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={open}
                        className="w-full justify-between font-normal"
                    >
                        {selectedCustomer
                            ? `${selectedCustomer.name} (${selectedCustomer.phone_number})`
                            : value ? <NameResolver id={value} type='customer' fallback='已选择客户' /> : "选择或搜索客户..."}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-0" align="start">
                    <Command shouldFilter={false}>
                        <CommandInput
                            placeholder="输入姓名或手机号搜索..."
                            value={searchValue}
                            onValueChange={setSearchValue}
                        />
                        <CommandList>
                            {isLoading && (
                                <div className="flex items-center justify-center py-6">
                                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                </div>
                            )}
                            <CommandEmpty>未找到相关客户。</CommandEmpty>
                            <CommandGroup>
                                {customers.map((customer) => (
                                    <CommandItem
                                        key={customer.id}
                                        value={customer.id}
                                        onSelect={() => {
                                            onChange(customer.id === value ? "" : customer.id)
                                            onSelectCustomer?.(customer)
                                            setOpen(false)
                                        }}
                                    >
                                        <Check
                                            className={cn(
                                                "mr-2 h-4 w-4",
                                                value === customer.id ? "opacity-100" : "opacity-0"
                                            )}
                                        />
                                        <div className="flex flex-col">
                                            <span>{customer.name}</span>
                                            <span className="text-xs text-muted-foreground">{customer.phone_number}</span>
                                        </div>
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>

            <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={() => setIsAddDialogOpen(true)}
                title="收录新客户"
            >
                <UserPlus className="h-4 w-4" />
            </Button>

            <AddCustomerDialog
                open={isAddDialogOpen}
                onOpenChange={setIsAddDialogOpen}
                onSuccess={(newCustomer: Customer) => {
                    setCustomers(prev => [newCustomer, ...prev])
                    onChange(newCustomer.id)
                    onSelectCustomer?.(newCustomer)
                }}
            />
        </div>
    )
}
