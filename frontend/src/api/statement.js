import api from './axios';

/**
 * 获取月度结算单列表
 * @param {object} params - 查询参数
 * @param {number} params.page - 页码
 * @param {number} params.perPage - 每页数量
 * @returns {Promise<object>} - 包含结算单列表和分页信息
 */
const getStatements = (params) => {
  return api.get('/statements', { params });
};

/**
 * 获取单个结算单的详细信息
 * @param {number} statementId - 结算单ID
 * @returns {Promise<object>} - 结算单详细信息，包含账单列表
 */
const getStatementDetail = (statementId) => {
  return api.get(`/statements/${statementId}`);
};

/**
 * 支付月度结算单
 * @param {number} statementId - 结算单ID
 * @param {object} paymentData - 支付数据
 * @param {string|number} paymentData.amount - 支付金额
 * @param {string} paymentData.payment_date - 支付日期 (YYYY-MM-DD)
 * @param {string} paymentData.method - 支付方式
 * @param {string} paymentData.notes - 备注
 * @returns {Promise<object>} - 成功或失败的响应
 */
const payStatement = (statementId, paymentData) => {
  return api.post(`/statements/${statementId}/pay`, paymentData);
};

export default {
  getStatements,
  getStatementDetail,
  payStatement,
};