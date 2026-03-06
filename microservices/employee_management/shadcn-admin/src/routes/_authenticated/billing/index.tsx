import { createFileRoute } from '@tanstack/react-router'
import { Billing } from '@/features/billing'

export const Route = createFileRoute('/_authenticated/billing/')({
  component: Billing,
})
