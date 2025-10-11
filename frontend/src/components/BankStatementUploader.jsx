import React, { useState } from 'react';
import api from '../api/axios'; // 假设你的 axios 实例在这里

const BankStatementUploader = () => {
  const [statementText, setStatementText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState(null);

  const handleReconcile = async () => {
    if (!statementText.trim()) {
      setMessage({ type: 'error', text: '对账单内容不能为空。' });
      return;
    }

    setIsLoading(true);
    setMessage(null);

    try {
      const response = await api.post('/api/bank-statement/reconcile', {
        statement_text: statementText,
      });
      setMessage({ type: 'success', text: response.data.message || '处理成功！' });
      setStatementText(''); // 清空文本框
    } catch (error) {
      const errorMessage = error.response?.data?.error || '发生未知错误，请检查后台日志。';
      setMessage({ type: 'error', text: errorMessage });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-4 bg-white shadow-md rounded-lg">
      <h2 className="text-2xl font-bold mb-4 text-gray-800">银行对账单自动核销</h2>
      <p className="mb-4 text-gray-600">
        请将从银行导出的对账单文本（从包含表头的第一行开始）完整粘贴到下面的文本框中，然后点击“开始核销”按钮。
      </p>
      
      <div className="mb-4">
        <textarea
          className="w-full h-64 p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition duration-150 ease-in-out"
          placeholder="在此处粘贴银行对账单文本..."
          value={statementText}
          onChange={(e) => setStatementText(e.target.value)}
          disabled={isLoading}
        />
      </div>

      <div className="flex items-center justify-between">
        <button
          onClick={handleReconcile}
          disabled={isLoading}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md disabled:bg-gray-400 disabled:cursor-not-allowed transition duration-300 ease-in-out"
        >
          {isLoading ? '正在处理中...' : '开始核销'}
        </button>

        {message && (
          <div 
            className={`p-3 rounded-md text-sm ${message.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            {message.text}
          </div>
        )}
      </div>
    </div>
  );
};

export default BankStatementUploader;
