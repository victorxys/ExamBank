import { createFileRoute } from '@tanstack/react-router'
import { ContractList } from '@/features/contracts'

export const Route = createFileRoute('/_authenticated/contracts/maternity-nurse')({
    component: () => <ContractList targetType="月嫂服务合同" />,
})
