// frontend/src/api/payerAliasApi.js
import api from './axios';

export const payerAliasApi = {
    createAlias: ({ payer_name, contract_id, notes = '' }) => {
        return api.post('/payer-aliases', {
            payer_name,
            contract_id,
            notes
        });
    },
    deleteAlias: (payerName, params = {}) => {
        // 注意 URL编码，以防付款人姓名包含特殊字符
        return api.delete(`/payer-aliases/${encodeURIComponent(payerName)}`, { params });
    }
    
};