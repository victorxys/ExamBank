const env = require('./env');

const configs = {
  local: {
    apiBaseUrl: 'http://127.0.0.1:5001/api',
    devMockOpenid: 'dev-miniapp-xu',
    enableMockLogin: true
  },
  production: {
    apiBaseUrl: 'https://hr.mengyimengsao.com/api',
    devMockOpenid: '',
    enableMockLogin: false
  }
};

const current = env.current || 'local';

module.exports = {
  env: current,
  ...(configs[current] || configs.local)
};
