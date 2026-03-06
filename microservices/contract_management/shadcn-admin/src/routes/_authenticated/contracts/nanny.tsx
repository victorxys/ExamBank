import { createFileRoute } from '@tanstack/react-router'
import { ContractList } from '@/features/contracts'

export const Route = createFileRoute('/_authenticated/contracts/nanny')({
    component: () => <ContractList targetType="育儿嫂正式合同" />,
})
