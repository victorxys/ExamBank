import { useState, useCallback, useEffect } from 'react';
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
        try {
            const employeeId = contract.user_id || contract.service_personnel_id;
            const eligibleRes = await api.get('/billing/contracts', {
                params: { customer_name: contract.customer_name, employee_id: employeeId, type: 'nanny', status: 'active', per_page: 100 }
            });
            const eligible = eligibleRes.data.items.filter(c => c.id !== contract.id);
            setEligibleContracts(eligible);
            // If there's only one eligible contract, pre-select it.
            if (eligible.length === 1) {
                setSelectedFormalContractId(eligible[0].id);
            }
        } catch (error) {
            setAlert({ open: true, message: `获取可关联的正式合同列表失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
            setConversionDialogOpen(false);
        } finally {
            setLoadingEligible(false);
        }
    }, []);

    // This new useEffect will fetch the costs when a formal contract is selected
    useEffect(() => {
        if (selectedFormalContractId && contractToProcess) {
            setLoadingCosts(true);
            setConversionCosts(null);
            api.get(`/billing/nanny-trial-contracts/${contractToProcess.id}/conversion-preview`, {
                params: { formal_contract_id: selectedFormalContractId }
            })
            .then(response => {
                setConversionCosts(response.data);
            })
            .catch(error => {
                setAlert({ open: true, message: `获取预览费用失败: ${error.response?.data?.error || error.message}`, severity: 'warning' });
            })
            .finally(() => {
                setLoadingCosts(false);
            });
        } else {
            // Clear costs if no formal contract is selected
            setConversionCosts(null);
        }
    }, [selectedFormalContractId, contractToProcess]);


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