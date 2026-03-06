import { useState, useEffect } from 'react'
import { Check, ChevronsUpDown, Loader2, User } from 'lucide-react'
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
import { NameResolver } from './name-resolver'

interface Employee {
    id: string
    name: string
    phone_number: string
}

interface EmployeeSelectorProps {
    value: string
    onChange: (value: string) => void
    onSelectEmployee?: (employee: Employee) => void
}

export function EmployeeSelector({ value, onChange, onSelectEmployee }: EmployeeSelectorProps) {
    const [open, setOpen] = useState(false)
    const [searchValue, setSearchValue] = useState('')
    const [employees, setEmployees] = useState<Employee[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const { auth } = useAuthStore()

    const fetchEmployees = async (query: string) => {
        setIsLoading(true)
        try {
            const token = auth.accessToken || localStorage.getItem('access_token')
            const response = await fetch(
                `/api/v1/employees/?search=${encodeURIComponent(query)}&limit=10`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            )
            if (response.ok) {
                const data = await response.json()
                setEmployees(data)
            }
        } catch (error) {
            console.error('Error fetching employees:', error)
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        const timer = setTimeout(() => {
            fetchEmployees(searchValue)
        }, 300)
        return () => clearTimeout(timer)
    }, [searchValue])

    const selectedEmployee = employees.find((e) => e.id === value)

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
                        {selectedEmployee
                            ? `${selectedEmployee.name} (${selectedEmployee.phone_number})`
                            : value ? <NameResolver id={value} type='employee' fallback='已选择人员' /> : "选择或搜索服务人员..."}
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
                            <CommandEmpty>未找到相关人员。</CommandEmpty>
                            <CommandGroup>
                                {employees.map((employee) => (
                                    <CommandItem
                                        key={employee.id}
                                        value={employee.id}
                                        onSelect={() => {
                                            onChange(employee.id === value ? "" : employee.id)
                                            onSelectEmployee?.(employee)
                                            setOpen(false)
                                        }}
                                    >
                                        <Check
                                            className={cn(
                                                "mr-2 h-4 w-4",
                                                value === employee.id ? "opacity-100" : "opacity-0"
                                            )}
                                        />
                                        <div className="flex items-center gap-2">
                                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                                                <User className="h-4 w-4" />
                                            </div>
                                            <div className="flex flex-col">
                                                <span>{employee.name}</span>
                                                <span className="text-xs text-muted-foreground">{employee.phone_number}</span>
                                            </div>
                                        </div>
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
        </div>
    )
}
