import api from './axios'; // 导入配置好的axios实例

/**
 * 获取所有员工的列表
 * @param {object} params - 查询参数 (分页, 搜索, 筛选等)
 * @returns {Promise<AxiosResponse<any>>}
 */
export const getEmployees = (params) => {
  return api.get('/staff/employees', { params });
};

/**
 * 获取单个员工的详细信息
 * @param {string} employeeId - 员工的UUID
 * @returns {Promise<AxiosResponse<any>>}
 */
export const getEmployeeDetails = (employeeId) => {
  return api.get(`/staff/employees/${employeeId}`);
};

const staffApi = {
  getEmployees,
  getEmployeeDetails,
};

export default staffApi;
