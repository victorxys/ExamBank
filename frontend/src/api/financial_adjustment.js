import api from './axios'; // 修正：导入正确的 api 实例

// 获取调整项详情
export const getFinancialAdjustmentById = (adjustmentId) => {
  return api.get(`/financial-adjustments/${adjustmentId}`);
};

// 通过账单ID获取调整项列表
export const getFinancialAdjustmentsByBillId = (billId) => {
  return api.get(`/financial-adjustments`, {
    params: {
      customer_bill_id: billId
    }
  });
};

// 通过工资单ID获取调整项列表
export const getFinancialAdjustmentsByPayrollId = (payrollId) => {
  return api.get(`/financial-adjustments`, {
    params: {
      payroll_id: payrollId
    }
  });
};

// 转移财务调整项到另一个合同
export const transferFinancialAdjustment = (adjustmentId, targetContractId) => {
  return api.post(`/billing/financial-adjustments/${adjustmentId}/transfer`, {
    destination_contract_id: targetContractId
  });
};