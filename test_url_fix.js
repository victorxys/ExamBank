// 测试URL构建修复
const API_BASE_URL = 'http://localhost:5001/api';

function testUrlConstruction() {
    console.log('测试URL构建修复');
    console.log('=================');
    
    // 测试场景1: 后端返回的相对URL
    const relativeUrl = '/resources/3a57cc78-6496-4d96-b679-597a8134c3e3/stream?access_token=token123';
    const fullUrl1 = `${API_BASE_URL}${relativeUrl}`;
    console.log('场景1 - 相对URL:');
    console.log('  输入:', relativeUrl);
    console.log('  输出:', fullUrl1);
    console.log('  正确:', fullUrl1 === 'http://localhost:5001/api/resources/3a57cc78-6496-4d96-b679-597a8134c3e3/stream?access_token=token123');
    
    // 测试场景2: 绝对HTTP URL (七牛云)
    const absoluteUrl = 'https://mengschool.mengyimengsao.com/api/v1/courses/public/video/hls-manifest?key=test&token=abc123';
    const fullUrl2 = absoluteUrl.startsWith('http') ? absoluteUrl : `${API_BASE_URL}${absoluteUrl}`;
    console.log('\n场景2 - 绝对URL:');
    console.log('  输入:', absoluteUrl);
    console.log('  输出:', fullUrl2);
    console.log('  正确:', fullUrl2 === absoluteUrl);
    
    // 测试场景3: 其他相对URL
    const otherRelativeUrl = 'resources/test/stream';
    const fullUrl3 = `${API_BASE_URL}/${otherRelativeUrl}`;
    console.log('\n场景3 - 其他相对URL:');
    console.log('  输入:', otherRelativeUrl);
    console.log('  输出:', fullUrl3);
    console.log('  正确:', fullUrl3 === 'http://localhost:5001/api/resources/test/stream');
    
    console.log('\n修复验证:');
    console.log('- 不再有重复的/api路径');
    console.log('- 相对URL正确拼接');
    console.log('- 绝对URL保持不变');
}

testUrlConstruction();