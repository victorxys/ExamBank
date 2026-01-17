// 测试七牛云视频URL转换
const MENGSCHOOL_API = 'https://mengschool.mengyimengsao.com';
const QINIU_API_KEY = 'hr_mengyimengsao_com'; // 示例API Key

function getVideoUrl(qiniuVideoUrl) {
  if (!qiniuVideoUrl) {
    console.warn('[videoUtils] Empty video URL provided');
    return '';
  }

  try {
    // Check if it's already an HLS manifest URL
    if (qiniuVideoUrl.includes('hls-manifest')) {
      return qiniuVideoUrl;
    }

    // Extract key from Qiniu Cloud URL
    const urlObj = new URL(qiniuVideoUrl);
    const key = urlObj.pathname.slice(1); // Remove leading slash

    if (!key) {
      console.warn('[videoUtils] No key found in Qiniu URL:', qiniuVideoUrl);
      return qiniuVideoUrl; // Return original URL as fallback
    }

    // Use the MengSchool proxy API to get HLS manifest
    const hlsUrl = `${MENGSCHOOL_API}/api/v1/courses/public/video/hls-manifest?key=${encodeURIComponent(key)}&token=${QINIU_API_KEY}`;
    
    console.log('[videoUtils] Converted Qiniu URL to HLS:', {
      original: qiniuVideoUrl,
      key: key,
      hls: hlsUrl.replace(QINIU_API_KEY, '***') // Hide API key in logs
    });

    return hlsUrl;
  } catch (error) {
    console.error('[videoUtils] Error converting Qiniu URL:', error);
    return qiniuVideoUrl; // Return original URL as fallback
  }
}

// 测试你的视频URL
const testUrl = 'https://rss.mengyimengsao.com/videos/1768662820-final_output_fast.mp4';
console.log('测试视频URL:', testUrl);

const hlsUrl = getVideoUrl(testUrl);
console.log('转换后的HLS URL:', hlsUrl);

// 验证转换结果
console.log('\n验证结果:');
console.log('- 原始URL:', testUrl);
console.log('- 提取的key:', 'videos/1768662820-final_output_fast.mp4');
console.log('- HLS URL:', hlsUrl);
console.log('- 期望格式:', 'https://mengschool.mengyimengsao.com/api/v1/courses/public/video/hls-manifest?key=videos%2F1768662820-final_output_fast.mp4&token=examdb_system');