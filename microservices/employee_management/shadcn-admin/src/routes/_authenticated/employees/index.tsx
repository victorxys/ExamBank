import { createFileRoute } from '@tanstack/react-router'
import { EmployeeList } from '@/features/employees'

export const Route = createFileRoute('/_authenticated/employees/')({
  component: EmployeeList,
})
