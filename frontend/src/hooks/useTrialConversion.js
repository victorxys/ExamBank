import { useState, useCallback } from 'react';
import api from '../api/axios';

export const useTrialConversion = (onActionComplete) => {
    const [alert, setAlert] = useState({ open: false, message: '', severity:'info' });
    const [contractToProcess, setContractToProcess] = useState(null);
    const [isConversionDialogOpen, setConversionDialogOpen] = useState(false);
    const [eligibleContracts, setEligibleContracts] = useState([]);
    const [isLoadingEligible, setLoadingEligible] = useState(false);
    const [selectedFormalContractId, setSelectedFormalContractId] = useState('');
    const [conversionCosts, setConversionCosts] = useState(null);
    const [isLoadingCosts, setLoadingCosts] = useState(false);
    const [conversionSuccess, setConversionSuccess] = useState(false);

    const openConversionDialog = useCallback(async (contract) => {
        setContractToProcess(contract);
        setSelectedFormalContractId('');
        setConversionDialogOpen(true);
        setEligibleContracts([]);
        setConversionCosts(null);
        setConversionSuccess(false);

        setLoadingEligible(true);
        setLoadingCosts(true);
        try {
            const employeeId = contract.user_id || contract.service_personnel_id;
            const [eligibleRes, costsRes] = await Promise.all([
                api.get('/billing/contracts', {
                    params: { customer_name: contract.customer_name,employee_id: employeeId, type: 'nanny', status: 'active', per_page: 100 }
                }),
                api.get(`/billing/nanny-trial-contracts/${contract.id}/conversion-preview`)
            ]);
            setEligibleContracts(eligibleRes.data.items.filter(c => c.id !==contract.id));
            setConversionCosts(costsRes.data); // <-- 直接设置costs对象
        } catch (error) {
            setAlert({ open: true, message: `获取转换详情失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
            setConversionDialogOpen(false);
        } finally {
            setLoadingEligible(false);
            setLoadingCosts(false);
        }
    }, []);

    const closeConversionDialog = useCallback(() => {
        setConversionDialogOpen(false);
        setContractToProcess(null);
    }, []);

    const handleConfirmConversion = useCallback(async () => {
        if (!selectedFormalContractId || !contractToProcess) return;
        try {
            await api.post(`/billing/nanny-trial-contracts/${contractToProcess.id}/convert`, {
                formal_contract_id: selectedFormalContractId
            });
            setConversionSuccess(true);
        } catch (error) {
            setAlert({ open: true, message: `操作失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        }
    }, [contractToProcess, selectedFormalContractId]);

    const handleStay = () => {
        closeConversionDialog();
        if (onActionComplete) onActionComplete();
    };

    const handleNavigate = () => {
        closeConversionDialog();
        if (onActionComplete) onActionComplete(selectedFormalContractId);
    };

    return {
        alert, setAlert, contractToProcess, isConversionDialogOpen,openConversionDialog,
        closeConversionDialog, handleConfirmConversion, eligibleContracts,isLoadingEligible,
        selectedFormalContractId, setSelectedFormalContractId,conversionCosts, isLoadingCosts,
        conversionSuccess, handleStay, handleNavigate,
    };
};