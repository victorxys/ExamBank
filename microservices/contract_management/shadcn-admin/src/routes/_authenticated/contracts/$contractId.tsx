import { createFileRoute } from '@tanstack/react-router'
import { ContractDetails } from '@/features/contracts/components/contract-details'

export const Route = createFileRoute('/_authenticated/contracts/$contractId')({
    component: ContractDetails,
})
