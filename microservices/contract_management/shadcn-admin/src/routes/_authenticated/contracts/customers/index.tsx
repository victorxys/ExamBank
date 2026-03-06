import { createFileRoute } from '@tanstack/react-router'
import { CustomerList } from '@/features/customers'

export const Route = createFileRoute('/_authenticated/contracts/customers/')({
  component: CustomerList,
})
