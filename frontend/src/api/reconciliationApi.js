// frontend/src/api/reconciliationApi.js

import api from './axios'; // <--- 关键：导入并使用全局配置的 axios 实例

export const reconciliationApi = {
    postStatement: (lines) => {
        return api.post('/bank-statement/reconcile', { statement_lines: lines });
    },

    getUnmatchedTransactions: ({ year, month }) => {
        // Axios 会自动将 params 对象转换为 URL 查询字符串
        return api.get('/bank-transactions', { 
            params: { year, month } 
        });
    },

    getMatchingDetails: ({ transactionId, year, month }) => {
        // 将查询参数作为 params 对象传递
        return api.get(`/bank-transactions/${transactionId}/matching-details`, {
            params: { year, month }
        });
    },

    allocateTransaction: ({ transactionId, allocations }) => {
        return api.post(`/bank-transactions/${transactionId}/allocate`, { allocations });
    },
    cancelAllocation: (transactionId) => {
        return api.post(`/bank-transactions/${transactionId}/cancel-allocation`);
    },
    ignoreTransaction: (transactionId) => {
        return api.post(`/bank-transactions/${transactionId}/ignore`);
    },
    unignoreTransaction: (transactionId) => {
        return api.post(`/bank-transactions/${transactionId}/unignore`);
    }
};