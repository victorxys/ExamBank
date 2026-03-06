import { createFileRoute } from '@tanstack/react-router'
import { ContractList } from '@/features/contracts'

export const Route = createFileRoute('/_authenticated/contracts/trial')({
    component: () => <ContractList targetType="trial" />,
})
