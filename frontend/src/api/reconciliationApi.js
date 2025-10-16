// frontend/src/api/reconciliationApi.js

import api from './axios'; // <--- 关键：导入并使用全局配置的 axios 实例

export const reconciliationApi = {
    postStatement: (lines) => {
        return api.post('/bank-statement/reconcile', { statement_lines: lines });
    },

    getUnmatchedTransactions: ({ year, month }) => {
        // Axios 会自动将 params 对象转换为 URL 查询字符串
        return api.get('/bank-statement/unmatched-transactions', { 
            params: { year, month } 
        });
    },

    getAllTransactions: ({ year, month, page, per_page, search_term, status, direction }) => {
        return api.get('/bank-transactions', {
            params: { year, month, page, per_page, search_term, status, direction }
        });
    },

    
    getCategorizedOutboundTransactions: ({ year, month }) => {
        return api.get('/outbound-transactions/categorized', {
            params: { year, month }
        });
    },

    getPayableItems: ({ year, month }) => {
        return api.get('/payable-items', {
            params: { year, month }
        });
    },

    searchPayableItems: (searchTerm) => {
        return api.get('/search-payable-items', { params: { search: searchTerm } });
    },

    getOutboundTransactions: ({ year, month, page, per_page, search_term, status }) => {
        return api.get('/outbound-transactions', {
            params: { year, month, page, per_page, search_term, status }
        });
    },

    allocateOutboundTransaction: (transactionId, payload) => {
        return api.post(`/outbound-transactions/${transactionId}/allocate`, payload);
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
    ignoreTransaction: (transactionId, data) => {
        return api.post(`/bank-transactions/${transactionId}/ignore`,data);
    },
    unignoreTransaction: (transactionId) => {
        return api.post(`/bank-transactions/${transactionId}/unignore`);
    }
};