// frontend/src/utils/videoUtils.js
// Qiniu Cloud video URL utilities

const MENGSCHOOL_API = 'https://mengschool.mengyimengsao.com';
const QINIU_API_KEY = import.meta.env.VITE_QINIU_API_KEY || 'examdb_system';

/**
 * Convert Qiniu Cloud video URL to HLS manifest URL using MengSchool proxy
 * @param {string} qiniuVideoUrl - Original Qiniu Cloud video URL
 * @returns {string} HLS manifest URL for streaming
 */
export function getVideoUrl(qiniuVideoUrl) {
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
    // Format: /api/v1/courses/public/video/hls-manifest?key={key}&token={apiKey}
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

/**
 * Check if a URL is a Qiniu Cloud video URL
 * @param {string} url - URL to check
 * @returns {boolean} True if it's a Qiniu Cloud URL
 */
export function isQiniuVideoUrl(url) {
  if (!url) return false;
  
  try {
    const urlObj = new URL(url);
    // Check for common Qiniu Cloud domains
    return urlObj.hostname.includes('mengyimengsao.com') || 
           urlObj.hostname.includes('qiniucdn.com') ||
           urlObj.hostname.includes('clouddn.com');
  } catch (error) {
    return false;
  }
}

/**
 * Check if a URL is an HLS manifest
 * @param {string} url - URL to check
 * @returns {boolean} True if it's an HLS manifest URL
 */
export function isHLSUrl(url) {
  if (!url) return false;
  return url.includes('.m3u8') || url.includes('hls-manifest');
}