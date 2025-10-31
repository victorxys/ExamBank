import api from './axios';

/**
 * 请求账单合并的预览数据或执行合并。
 * @param {number} sourceBillId - 源账单的ID。
 * @param {number} targetContractId - 目标合同的ID。
 * @param {boolean} dryRun - True 为预览模式，False 为执行模式。
 * @returns {Promise<object>} API 返回的数据。
 */
export const mergeBills = (sourceBillId, targetContractId, dryRun) => {
  return api.post('/bill-merges', {
    source_bill_id: sourceBillId,
    target_contract_id: targetContractId,
    dry_run: dryRun,
  });
};
