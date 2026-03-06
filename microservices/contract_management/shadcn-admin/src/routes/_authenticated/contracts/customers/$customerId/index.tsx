import { createFileRoute } from '@tanstack/react-router'
import { CustomerDetails } from '@/features/customers/components/customer-details'

export const Route = createFileRoute('/_authenticated/contracts/customers/$customerId/')({
    component: CustomerDetails,
})
