import { createFileRoute } from '@tanstack/react-router'
import { EmployeeDetails } from '@/features/employees/components/employee-details'

export const Route = createFileRoute('/_authenticated/employees/$employeeId')({
    component: EmployeeDetails,
})
