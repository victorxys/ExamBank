import React, { useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
// import { createPortal } from 'react-dom'; // Removed to avoid production build issues
import { useParams, useLocation, useNavigate } from 'react-router-dom'; // 导入 useLocation 和 useNavigate
import { Model } from 'survey-core';
import { Survey } from 'survey-react-ui';
import 'survey-core/survey-core.min.css';
import '../styles/survey-theme-shadcn.css'; // Import Shadcn-style Theme
// Import Chinese language pack
import 'survey-core/i18n/simplified-chinese';
// 移除懒加载，直接使用 img 标签以确保所有图片立即加载
// import { LazyLoadImage } from 'react-lazy-load-image-component';
// import 'react-lazy-load-image-component/src/effects/blur.css';

// Note: Language will be set on each survey instance
import api from '../api/axios';
import {
    Container,
    CircularProgress,
    Alert,
    Box,
    Button,
    Typography,
    IconButton,
    Portal, // Import Portal from MUI
    Modal,
    Skeleton,
    Breadcrumbs,
    Link,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import {
    ImageNotSupported as ImageNotSupportedIcon,
    ChevronLeft as ChevronLeftIcon,
    ChevronRight as ChevronRightIcon,
    Close as CloseIcon,
    Download as DownloadIcon,
    Home as HomeIcon,
    NavigateNext as NavigateNextIcon,
    Delete as DeleteIcon,
} from '@mui/icons-material';
import { formatAddress } from '../utils/formatUtils';
import { createDateTimeRenderer, createSignaturePadFixer } from '../utils/surveyjs-custom-widgets.jsx';
import AlertMessage from './AlertMessage';

// 检测网络状况
const getNetworkQuality = () => {
    if ('connection' in navigator) {
        const connection = navigator.connection;
        if (connection.effectiveType === '4g') return 'high';
        if (connection.effectiveType === '3g') return 'medium';
        return 'low';
    }
    return 'medium'; // 默认中等质量
};

// ===== 完全统一图片加载系统 - 彻底避免重复网络请求 =====

// 从统一URL中提取原始URL（用于保存时恢复原始URL）
const extractOriginalUrl = (url) => {
    if (!url) return url;

    // 检查是否是已处理的统一URL（可能被重复处理多次）
    if (url.includes('img.mengyimengsao.com') && url.includes('/cdn-cgi/image/')) {
        // 循环移除所有 cdn-cgi/image/xxx/ 前缀，直到没有为止
        let cleanUrl = url;
        while (cleanUrl.includes('/cdn-cgi/image/')) {
            // 提取最后一个 cdn-cgi/image/xxx/ 后面的路径
            const match = cleanUrl.match(/img\.mengyimengsao\.com(?:\/cdn-cgi\/image\/[^/]+)+\/([^c].+)/);
            if (match && match[1]) {
                cleanUrl = `https://img.mengyimengsao.com/${match[1]}`;
            } else {
                // 如果匹配失败，尝试另一种模式
                const simpleMatch = cleanUrl.match(/\/cdn-cgi\/image\/[^/]+\/(.+)/);
                if (simpleMatch && simpleMatch[1] && !simpleMatch[1].startsWith('cdn-cgi')) {
                    cleanUrl = `https://img.mengyimengsao.com/${simpleMatch[1]}`;
                }
                break;
            }
        }

        if (cleanUrl !== url) {
            console.log(`🔙 恢复原始URL: ${url} -> ${cleanUrl}`);
        }
        return cleanUrl;
    }

    return url;
};

// ===== 三层图片URL系统 =====
// 1. 缩略图：小尺寸低质量，快速加载用于页面预览
// 2. 大图：适配显示器尺寸，100%质量，用于lightbox查看
// 3. 原图：原始尺寸100%质量，用于下载

// 获取显示器尺寸（用于计算大图尺寸）
const getScreenSize = () => {
    return {
        width: Math.min(window.screen.width, 1920),  // 最大1920
        height: Math.min(window.screen.height, 1080) // 最大1080
    };
};

// 从URL中提取原始路径（去除cdn-cgi处理参数）
const getCleanPath = (originalUrl) => {
    if (!originalUrl) return null;

    // 先用 extractOriginalUrl 清理可能被重复处理的URL
    const cleanedUrl = extractOriginalUrl(originalUrl);

    if (cleanedUrl.includes('img.mengyimengsao.com')) {
        try {
            const url = new URL(cleanedUrl);
            let path = url.pathname;

            // 确保路径以 / 开头
            if (!path.startsWith('/')) {
                path = '/' + path;
            }

            console.log(`🔍 提取路径: ${cleanedUrl} -> ${path}`);
            return path;
        } catch (e) {
            console.error(`❌ URL解析失败: ${cleanedUrl}`, e);
            return null;
        }
    }
    return null;
};

// 1. 缩略图URL - 小尺寸低质量，快速加载
const getThumbnailUrl = (originalUrl) => {
    if (!originalUrl) return originalUrl;

    // 先清理URL，确保没有重复的cdn-cgi参数
    const cleanedUrl = extractOriginalUrl(originalUrl);

    if (cleanedUrl.includes('img.mengyimengsao.com')) {
        const path = getCleanPath(cleanedUrl);
        if (path) {
            // 缩略图：width=400, quality=50
            const thumbnailUrl = `https://img.mengyimengsao.com/cdn-cgi/image/width=400,quality=50,format=jpeg${path}`;
            console.log(`🖼️ 生成缩略图URL: ${cleanedUrl} -> ${thumbnailUrl}`);
            return thumbnailUrl;
        }
    }

    // 金数据图床
    if (cleanedUrl.includes('jinshujufiles.com')) {
        try {
            const url = new URL(cleanedUrl);
            url.searchParams.set('imageView2', '2/w/400/q/50');
            return url.toString();
        } catch (e) {
            return cleanedUrl;
        }
    }

    return cleanedUrl;
};

// 2. 大图URL - 适配显示器尺寸，100%质量
const getLightboxUrl = (originalUrl) => {
    if (!originalUrl) return originalUrl;

    // 既然缩略图URL是正确的，我们直接基于缩略图URL生成大图URL
    // 这样可以确保使用相同的逻辑和路径处理
    const thumbnailUrl = getThumbnailUrl(originalUrl);

    if (thumbnailUrl.includes('img.mengyimengsao.com/cdn-cgi/image/')) {
        const screen = getScreenSize();
        // 将缩略图的参数替换为大图参数
        const lightboxUrl = thumbnailUrl.replace(
            /width=\d+,quality=\d+/,
            `width=${screen.width},quality=100`
        );
        // console.log(`🖼️ 基于缩略图生成大图URL: ${thumbnailUrl} -> ${lightboxUrl}`);
        return lightboxUrl;
    }

    // 金数据图床
    if (originalUrl.includes('jinshujufiles.com')) {
        try {
            const cleanedUrl = extractOriginalUrl(originalUrl);
            const url = new URL(cleanedUrl);
            const screen = getScreenSize();
            url.searchParams.set('imageView2', `2/w/${screen.width}/q/100`);
            return url.toString();
        } catch (e) {
            return originalUrl;
        }
    }

    // 如果都不匹配，返回原始URL
    return extractOriginalUrl(originalUrl);
};

// 3. 原图URL - 原始尺寸100%质量，用于下载
const getOriginalUrl = (originalUrl) => {
    // 确保返回的是干净的原始URL
    return extractOriginalUrl(originalUrl);
};

// 兼容性别名
const getUnifiedImageUrl = getThumbnailUrl; // 默认使用缩略图
const getOptimizedImageUrl = getThumbnailUrl;

// ===== 分层缓存管理 =====
const thumbnailCache = new Map();  // 缩略图缓存
const lightboxCache = new Map();   // 大图缓存（Blob URL）
const unifiedImageCache = thumbnailCache; // 兼容性别名

// 全局大图预加载队列（避免多个组件同时预加载导致请求阻塞）
let globalLightboxPreloadQueue = [];
let isPreloadingLightbox = false;

const addToLightboxPreloadQueue = (originalUrl) => {
    if (!globalLightboxPreloadQueue.includes(originalUrl) && !lightboxCache.has(originalUrl)) {
        globalLightboxPreloadQueue.push(originalUrl);
    }
};

const startGlobalLightboxPreload = async () => {
    if (isPreloadingLightbox || globalLightboxPreloadQueue.length === 0) return;

    isPreloadingLightbox = true;
    // console.log(`🚀 开始全局大图预加载队列: ${globalLightboxPreloadQueue.length} 张图片`);

    // 逐个预加载，避免并发请求过多
    while (globalLightboxPreloadQueue.length > 0) {
        const url = globalLightboxPreloadQueue.shift();
        if (lightboxCache.has(url)) continue;

        try {
            await preloadLightboxImage(url);
        } catch (error) {
            console.error(`❌ 全局预加载失败: ${url.substring(0, 50)}...`);
        }
    }

    isPreloadingLightbox = false;
    // console.log(`✅ 全局大图预加载完成，缓存大小: ${lightboxCache.size}`);
};

// 预加载大图到缓存（转换为Blob URL确保从内存读取）
const preloadLightboxImage = (originalUrl) => {
    return new Promise((resolve, reject) => {
        const lightboxUrl = getLightboxUrl(originalUrl);

        // 检查缓存
        if (lightboxCache.has(originalUrl)) {
            // console.log(`🎯 大图已在缓存中: ${originalUrl.substring(0, 50)}...`);
            resolve(lightboxCache.get(originalUrl));
            return;
        }

        // 输出完整的大图URL用于调试
        // console.log(`📥 预加载大图完整URL: ${lightboxUrl}`);
        // console.log(`📥 原始URL: ${originalUrl}`);

        // 使用Image对象预加载
        // 不设置 crossOrigin，避免 CORS 错误
        const img = new Image();
        img.referrerPolicy = 'no-referrer';

        const timeout = setTimeout(() => {
            // console.warn(`⏰ 大图加载超时: ${lightboxUrl.substring(0, 50)}...`);
            reject(new Error('Image load timeout'));
        }, 30000);

        img.onload = () => {
            clearTimeout(timeout);

            // 直接缓存URL（不转换为Blob，因为cdn-cgi不支持CORS）
            // 图片已经加载到浏览器缓存中，再次请求时会从缓存读取
            lightboxCache.set(originalUrl, {
                img,
                url: lightboxUrl,
                originalUrl: lightboxUrl,
                width: img.naturalWidth,
                height: img.naturalHeight,
                loaded: true,
                isBlob: false
            });
            // console.log(`✅ 大图预加载成功: ${img.naturalWidth}x${img.naturalHeight}, URL: ${lightboxUrl.substring(0, 60)}...`);
            resolve(lightboxCache.get(originalUrl));
        };

        img.onerror = (error) => {
            clearTimeout(timeout);
            // console.error(`❌ 大图预加载失败，完整URL: ${lightboxUrl}`);
            // console.error(`❌ 错误详情:`, error);
            // console.error(`❌ img.src: ${img.src}`);
            // console.error(`❌ img.complete: ${img.complete}`);
            // console.error(`❌ img.naturalWidth: ${img.naturalWidth}`);
            reject(error);
        };

        // 设置src开始加载
        // console.log(`🔄 开始加载图片: ${lightboxUrl}`);
        img.src = lightboxUrl;
    });
};

// 获取缓存的大图Blob URL
const getCachedLightboxUrl = (originalUrl) => {
    const cached = lightboxCache.get(originalUrl);
    if (cached && cached.blobUrl) {
        return cached.blobUrl;
    }
    // 如果没有缓存，返回网络URL
    return getLightboxUrl(originalUrl);
};

// 预加载缩略图（兼容旧代码）
const preloadUnifiedImage = (originalUrl) => {
    return new Promise((resolve, reject) => {
        const thumbnailUrl = getThumbnailUrl(originalUrl);

        // 检查缓存
        if (thumbnailCache.has(thumbnailUrl)) {
            // console.log(`🎯 缩略图已在缓存中: ${thumbnailUrl}`);
            resolve(thumbnailCache.get(thumbnailUrl));
            return;
        }

        const img = new Image();

        const timeout = setTimeout(() => {
            // console.warn(`⏰ 缩略图加载超时: ${thumbnailUrl}`);
            reject(new Error('Image load timeout'));
        }, 10000);

        img.onload = () => {
            clearTimeout(timeout);
            thumbnailCache.set(thumbnailUrl, img);
            // console.log(`✅ 缩略图缓存完成: ${thumbnailUrl}`);
            resolve(img);
        };

        img.onerror = (error) => {
            clearTimeout(timeout);
            // console.error(`❌ 统一图片加载失败: ${unifiedUrl}`, error);
            // console.log(`🔄 回退到原图: ${originalUrl}`);

            // 回退到原图
            const fallbackImg = new Image();
            const fallbackTimeout = setTimeout(() => {
                // console.warn(`⏰ 原图回退加载超时: ${originalUrl}`);
                reject(new Error('Fallback image load timeout'));
            }, 10000);

            fallbackImg.onload = () => {
                clearTimeout(fallbackTimeout);

                // 缓存原图（使用统一URL作为key）
                unifiedImageCache.set(unifiedUrl, fallbackImg);

                // console.log(`✅ 原图回退加载完成: ${originalUrl}`);
                resolve(fallbackImg);
            };

            fallbackImg.onerror = (fallbackError) => {
                clearTimeout(fallbackTimeout);
                // console.error(`❌ 原图回退也失败: ${originalUrl}`, fallbackError);
                reject(fallbackError);
            };

            fallbackImg.referrerPolicy = 'no-referrer';
            fallbackImg.src = originalUrl;
        };

        // 设置图片属性并开始加载
        img.referrerPolicy = 'no-referrer';
        img.src = unifiedUrl;
    });
};

// 兼容性别名
const preloadThumbnail = preloadUnifiedImage;
const preloadOptimizedImage = preloadUnifiedImage;

// Lightbox 图片组件 - 使用预加载的 URL（浏览器 HTTP 缓存）
const CachedLightboxImage = ({ src, alt, style, originalUrl, ...props }) => {
    const [imageLoaded, setImageLoaded] = useState(false);
    const [imageError, setImageError] = useState(false);
    const [isCached, setIsCached] = useState(false);
    const [displayUrl, setDisplayUrl] = useState('');

    useEffect(() => {
        if (!src || !originalUrl) return;

        // 重置状态
        setImageLoaded(false);
        setImageError(false);

        // 检查大图是否已经预加载到缓存
        const cached = lightboxCache.get(originalUrl);

        if (cached && cached.loaded && cached.url) {
            // 大图已预加载，使用缓存的 URL
            // console.log(`🎯 Lightbox使用预加载URL: ${cached.width}x${cached.height}`);
            setDisplayUrl(cached.url);
            setIsCached(true);
        } else {
            // 大图未缓存，需要从网络加载
            // console.log(`⚠️ Lightbox大图未缓存，从网络加载: ${src.substring(0, 60)}...`);
            setDisplayUrl(src);
            setIsCached(false);
        }
    }, [src, originalUrl]);

    const handleLoad = () => {
        if (!imageLoaded) {
            setImageLoaded(true);
            setImageError(false);
            // console.log(`✅ Lightbox 图片从网络加载完成`);
        }
    };

    const handleError = (error) => {
        console.warn(`❌ Lightbox 图片加载失败`, error);
        setImageError(true);
        setImageLoaded(false);
    };

    // 没有 displayUrl，显示加载中
    if (!displayUrl) {
        return (
            <Box
                sx={{
                    ...style,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    minWidth: '200px',
                    minHeight: '200px',
                }}
            >
                <CircularProgress size={40} sx={{ color: 'white' }} />
                <Typography sx={{ color: 'white', ml: 2 }}>准备图片...</Typography>
            </Box>
        );
    }

    if (imageError) {
        return (
            <Box
                sx={{
                    ...style,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: '#f8f9fa',
                    border: '1px solid #dee2e6',
                    borderRadius: '8px',
                    minHeight: '200px',
                }}
            >
                <Typography variant="h6" color="text.secondary">
                    图片加载失败
                </Typography>
            </Box>
        );
    }

    // 显示图片（使用 displayUrl，浏览器会从 HTTP 缓存读取已预加载的图片）
    return (
        <Box sx={{ position: 'relative', ...style }}>
            {/* 加载指示器 - 仅在图片未加载完成时显示 */}
            {!imageLoaded && (
                <Box
                    sx={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        display: 'flex',
                        alignItems: 'center',
                        backgroundColor: 'rgba(0, 0, 0, 0.7)',
                        padding: '12px 20px',
                        borderRadius: '20px',
                        zIndex: 1,
                    }}
                >
                    <CircularProgress size={24} sx={{ color: 'white' }} />
                    <Typography sx={{ color: 'white', ml: 1.5, fontSize: '14px' }}>
                        {isCached ? '从缓存加载...' : '加载大图...'}
                    </Typography>
                </Box>
            )}

            {/* 大图 - 使用 displayUrl */}
            <img
                src={displayUrl}
                alt={alt}
                onLoad={handleLoad}
                onError={handleError}
                referrerPolicy="no-referrer"
                style={{
                    maxWidth: '90vw',
                    maxHeight: '90vh',
                    width: 'auto',
                    height: 'auto',
                    objectFit: 'contain',
                    opacity: imageLoaded ? 1 : 0.3,
                    transition: 'opacity 0.2s ease',
                }}
            />

            {/* 缓存状态指示器 */}
            {imageLoaded && (
                <Box
                    sx={{
                        position: 'absolute',
                        top: 10,
                        left: 10,
                        backgroundColor: isCached ? 'rgba(0, 128, 0, 0.8)' : 'rgba(0, 100, 200, 0.8)',
                        color: 'white',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                    }}
                >
                    {isCached ? '✓ 已预加载' : '✓ 网络加载'}
                </Box>
            )}
        </Box>
    );
};

// 三阶段图片轮播组件
const OptimizedFileCarousel = ({ questionValue, onImageClick, onPreloadUpdate }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [imageErrors, setImageErrors] = useState({});
    const [thumbnailsLoaded, setThumbnailsLoaded] = useState({}); // 第一阶段：缩略图加载状态
    const [lightboxPreloaded, setLightboxPreloaded] = useState({}); // 第二阶段：大图预加载状态
    const [allThumbnailsComplete, setAllThumbnailsComplete] = useState(false);

    const updateDisplay = (index) => {
        setCurrentIndex(index);
    };

    // 简化的初始化 - 重置状态
    useEffect(() => {
        if (!questionValue || questionValue.length === 0) return;

        // console.log(`🚀 初始化图片轮播组件: ${questionValue.length} 张图片`);

        // 重置状态
        setThumbnailsLoaded({});
        setAllThumbnailsComplete(false);
        setImageErrors({});

        // 打印图片URL用于调试
        questionValue.forEach((imageFile, index) => {
            const originalUrl = imageFile?.content;
            // console.log(`🔍 原始图片 ${index + 1}:`, originalUrl);

            const cleanedUrl = extractOriginalUrl(originalUrl);
            // console.log(`🧹 清理后URL ${index + 1}:`, cleanedUrl);

            const path = getCleanPath(cleanedUrl);
            // console.log(`📁 提取路径 ${index + 1}:`, path);

            const thumbnailUrl = getThumbnailUrl(originalUrl);
            // console.log(`🖼️ 缩略图URL ${index + 1}:`, thumbnailUrl);

            const lightboxUrl = getLightboxUrl(originalUrl);
            // console.log(`🔍 大图URL ${index + 1}:`, lightboxUrl);
        });
    }, [questionValue]);

    // 第二阶段：缩略图全部加载完成后，将大图添加到全局预加载队列
    useEffect(() => {
        if (!allThumbnailsComplete || !questionValue || questionValue.length === 0) return;

        // console.log(`🎉 缩略图加载完成，将 ${questionValue.length} 张大图添加到预加载队列...`);

        // 将大图URL添加到全局队列
        questionValue.forEach((file, i) => {
            const originalUrl = file?.content;
            if (originalUrl) {
                addToLightboxPreloadQueue(originalUrl);
            }
        });

        // 延迟启动全局预加载（等待所有组件的缩略图都加载完成）
        setTimeout(() => {
            startGlobalLightboxPreload();
        }, 500);

        // 标记为已预加载（实际预加载在全局队列中进行）
        const allPreloaded = {};
        questionValue.forEach((_, index) => {
            allPreloaded[index] = true;
        });
        setLightboxPreloaded(allPreloaded);
    }, [allThumbnailsComplete, questionValue]);

    // 第三阶段：下载原图函数
    const downloadOriginalImage = async (imageUrl, index) => {
        // console.log(`📥 第三阶段：下载原图 ${index + 1}`);

        const originalUrl = getOriginalUrl(imageUrl);
        const filename = originalUrl.split('/').pop()?.split('?')[0] || `image-${index + 1}.jpg`;

        try {
            const response = await fetch(originalUrl, {
                mode: 'cors',
                credentials: 'same-origin',
            });

            if (!response.ok) {
                throw new Error(`Network response was not ok: ${response.status}`);
            }

            const originalBlob = await response.blob();
            const blob = new Blob([originalBlob], { type: 'application/octet-stream' });

            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.style.display = 'none';

            document.body.appendChild(link);
            link.click();

            setTimeout(() => {
                document.body.removeChild(link);
                window.URL.revokeObjectURL(url);
            }, 100);
        } catch (error) {
            console.warn('原图下载失败，使用直接链接:', error);
            const link = document.createElement('a');
            link.href = originalUrl;
            link.download = filename;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.style.display = 'none';

            document.body.appendChild(link);
            link.click();

            setTimeout(() => {
                document.body.removeChild(link);
            }, 100);
        }
    };

    if (!Array.isArray(questionValue) || questionValue.length === 0) {
        return null;
    }

    const currentFile = questionValue[currentIndex];

    return (
        <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, mt: 1 }}>
            {/* 图片显示区域 */}
            <Box
                sx={{
                    position: 'relative',
                    maxWidth: '500px',
                    maxHeight: '350px',
                    width: '100%',
                    cursor: 'pointer',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    backgroundColor: '#f9fafb',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'box-shadow 0.2s ease',
                    '&:hover': {
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                    }
                }}
                onClick={() => {
                    if (onImageClick) {
                        onImageClick(currentIndex, lightboxPreloaded);
                    }
                }}
            >
                {imageErrors[currentIndex] ? (
                    <Box
                        sx={{
                            width: '100%',
                            height: '250px',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: '#f8f9fa',
                            padding: 2,
                        }}
                    >
                        <ImageNotSupportedIcon sx={{ fontSize: 48, color: '#9ca3af', mb: 1 }} />
                        <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center', mb: 1 }}>
                            图片加载失败
                        </Typography>
                        <Typography variant="caption" color="text.disabled" sx={{ fontSize: '10px', textAlign: 'center', wordBreak: 'break-all' }}>
                            URL: {currentFile?.content || '无URL'}
                        </Typography>
                        <Button
                            size="small"
                            variant="text"
                            onClick={(e) => {
                                e.stopPropagation();
                                setImageErrors(prev => {
                                    const newErrors = { ...prev };
                                    delete newErrors[currentIndex];
                                    return newErrors;
                                });
                            }}
                            sx={{ mt: 1, fontSize: '11px' }}
                        >
                            重试
                        </Button>
                    </Box>
                ) : (
                    <Box sx={{
                        position: 'relative',
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}>
                        {/* 预加载所有图片，但只显示当前的 */}
                        {questionValue.map((imageFile, index) => {
                            const originalUrl = imageFile?.content;
                            const thumbnailUrl = getThumbnailUrl(originalUrl);

                            return (
                                <img
                                    key={index}
                                    src={thumbnailUrl}
                                    alt={`缩略图 ${index + 1}`}
                                    loading="eager"
                                    referrerPolicy="no-referrer"
                                    onError={(e) => {
                                        // 防止重复回退导致死循环
                                        if (e.target.dataset.fallback) return;
                                        e.target.dataset.fallback = 'true';
                                        console.warn(`缩略图 ${index + 1} 加载失败，回退到原图: ${originalUrl}`);
                                        // 直接回退到原图
                                        e.target.src = originalUrl;
                                    }}
                                    onLoad={(e) => {
                                        const loadedUrl = e.target.src;
                                        // 使用统一URL作为缓存key，确保lightbox能找到
                                        const cacheKey = thumbnailUrl;

                                        // console.log(`✅ 缩略图 ${index + 1} 加载完成`);
                                        // console.log(`   实际URL: ${loadedUrl}`);
                                        // console.log(`   缓存Key: ${cacheKey}`);

                                        // 关键修复：使用统一URL作为缓存key
                                        if (!unifiedImageCache.has(cacheKey)) {
                                            unifiedImageCache.set(cacheKey, e.target);
                                            // console.log(`📦 图片已添加到统一缓存: ${cacheKey}`);
                                        }

                                        // 同时也用实际URL作为key（以防URL被浏览器修改）
                                        if (loadedUrl !== cacheKey && !unifiedImageCache.has(loadedUrl)) {
                                            unifiedImageCache.set(loadedUrl, e.target);
                                            // console.log(`📦 图片也用实际URL缓存: ${loadedUrl}`);
                                        }

                                        // 更新加载状态
                                        setThumbnailsLoaded(prev => {
                                            const newLoaded = { ...prev, [index]: true };
                                            const loadedCount = Object.keys(newLoaded).length;

                                            if (loadedCount === questionValue.length) {
                                                // console.log(`🎉 所有 ${questionValue.length} 张缩略图加载完成！`);
                                                // console.log(`📊 统一缓存大小: ${unifiedImageCache.size}`);
                                                // console.log(`📊 缓存Keys:`, Array.from(unifiedImageCache.keys()));
                                                setAllThumbnailsComplete(true);
                                            }

                                            return newLoaded;
                                        });
                                    }}
                                    style={{
                                        maxWidth: '100%',
                                        maxHeight: '350px',
                                        width: 'auto',
                                        height: 'auto',
                                        objectFit: 'contain',
                                        display: index === currentIndex ? 'block' : 'none', // 只显示当前图片
                                        position: index === currentIndex ? 'static' : 'absolute',
                                        top: 0,
                                        left: 0,
                                    }}
                                />
                            );
                        })}
                    </Box>
                )}

                {/* 悬停操作按钮 */}
                <Box
                    sx={{
                        position: 'absolute',
                        bottom: 8,
                        left: 8,
                        right: 8,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        opacity: 0,
                        transition: 'opacity 0.2s ease',
                        pointerEvents: 'none',
                        '.MuiBox-root:hover &': {
                            opacity: 1,
                        }
                    }}
                >
                    {/* 下载按钮 */}
                    <IconButton
                        size="small"
                        onClick={(e) => {
                            e.stopPropagation();
                            if (currentFile?.content) {
                                downloadOriginalImage(currentFile.content, currentIndex);
                            }
                        }}
                        sx={{
                            backgroundColor: 'rgba(0, 0, 0, 0.6)',
                            color: 'white',
                            pointerEvents: 'auto',
                            '&:hover': {
                                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                            }
                        }}
                    >
                        <DownloadIcon sx={{ fontSize: '16px' }} />
                    </IconButton>

                    {/* 点击提示 */}
                    <Box
                        sx={{
                            backgroundColor: 'rgba(0, 0, 0, 0.6)',
                            color: 'white',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '12px',
                            pointerEvents: 'none',
                        }}
                    >
                        点击查看大图
                    </Box>
                </Box>
            </Box>

            {/* 导航控制 */}
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, width: '100%' }}>
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '100%',
                        maxWidth: '200px',
                        height: '40px',
                        position: 'relative'
                    }}
                >
                    {/* 左箭头 */}
                    <Box sx={{ position: 'absolute', left: 0 }}>
                        {questionValue.length > 1 && (
                            <IconButton
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (currentIndex > 0) updateDisplay(currentIndex - 1);
                                }}
                                disabled={currentIndex === 0}
                                size="small"
                                sx={{
                                    backgroundColor: '#f3f4f6',
                                    '&:hover': {
                                        backgroundColor: '#e5e7eb',
                                    },
                                    '&.Mui-disabled': {
                                        backgroundColor: '#f9fafb',
                                    }
                                }}
                            >
                                <ChevronLeftIcon />
                            </IconButton>
                        )}
                    </Box>

                    {/* 图片计数 */}
                    <Box
                        sx={{
                            position: 'absolute',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            minWidth: '60px',
                            height: '100%'
                        }}
                    >
                        <Typography
                            variant="body2"
                            sx={{
                                color: '#6b7280',
                                fontWeight: 500,
                                textAlign: 'center',
                                fontSize: '14px'
                            }}
                        >
                            {questionValue.length > 1
                                ? `${currentIndex + 1} / ${questionValue.length}`
                                : '1 张图片'
                            }
                        </Typography>
                    </Box>

                    {/* 右箭头 */}
                    <Box sx={{ position: 'absolute', right: 0 }}>
                        {questionValue.length > 1 && (
                            <IconButton
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (currentIndex < questionValue.length - 1) updateDisplay(currentIndex + 1);
                                }}
                                disabled={currentIndex === questionValue.length - 1}
                                size="small"
                                sx={{
                                    backgroundColor: '#f3f4f6',
                                    '&:hover': {
                                        backgroundColor: '#e5e7eb',
                                    },
                                    '&.Mui-disabled': {
                                        backgroundColor: '#f9fafb',
                                    }
                                }}
                            >
                                <ChevronRightIcon />
                            </IconButton>
                        )}
                    </Box>
                </Box>

                {/* 简化的加载进度指示器 */}
                {Object.keys(thumbnailsLoaded).length < questionValue.length && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <CircularProgress size={16} />
                        <Typography variant="caption" color="text.secondary">
                            图片加载中 {Object.keys(thumbnailsLoaded).length}/{questionValue.length}
                        </Typography>
                    </Box>
                )}
            </Box>
        </Box>
    );
};

const OptimizedSignatureImage = ({ src, style }) => {
    const [imageError, setImageError] = useState(false);

    if (imageError) {
        return (
            <Box
                sx={{
                    ...style,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: '#f8f9fa',
                    border: '1px solid #dee2e6',
                    borderRadius: '4px',
                }}
            >
                <ImageNotSupportedIcon sx={{ fontSize: 40, color: '#6c757d' }} />
                <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                    签名加载失败
                </Typography>
            </Box>
        );
    }

    // 对签名图片也进行激进压缩
    const optimizedSrc = getOptimizedImageUrl(src, {
        width: 300,
        quality: 45, // 签名图片质量也降低
        format: 'webp'
    });

    return (
        <img
            src={optimizedSrc}
            alt="签名图片"
            onError={() => setImageError(true)}
            style={style}
        />
    );
};

// Portal Component to render buttons in the SurveyJS header
const HeaderButtonsPortal = ({ currentMode, toggleMode, formToken, dataId, api }) => {
    const [container, setContainer] = useState(null);

    useEffect(() => {
        // Find the target container (SurveyJS header)
        // We use a timer to ensure the element exists after SurveyJS renders
        const findContainer = () => {
            const el = document.querySelector('.sd-container-modern__title');
            if (el) {
                // Check if we already added a button container
                let btnContainer = el.querySelector('.custom-header-buttons');
                if (!btnContainer) {
                    btnContainer = document.createElement('div');
                    btnContainer.className = 'custom-header-buttons';
                    // Style it to float right or absolute position
                    btnContainer.style.cssText = 'position: absolute; right: 20px; top: 50%; transform: translateY(-50%); z-index: 10; display: flex; gap: 10px;';
                    el.appendChild(btnContainer);
                }
                setContainer(btnContainer);
            } else {
                // Retry if not found yet
                requestAnimationFrame(findContainer);
            }
        };

        findContainer();

        return () => {
            // Cleanup if needed (though SurveyJS re-renders might handle it)
        };
    }, []);

    if (!container) return null;

    // return (
    //     <Portal container={container}>
    //         {formToken === 'N0Il9H' && (
    //             <Button
    //                 variant="contained"
    //                 color="secondary"
    //                 size="small"
    //                 onClick={async () => {
    //                     if (!window.confirm('确定要根据当前表单数据创建/更新员工信息吗？')) return;
    //                     try {
    //                         const res = await api.post(`/staff/create-from-form/${dataId}`);
    //                         alert(res.data.message);
    //                     } catch (err) {
    //                         console.error(err);
    //                         alert('操作失败: ' + (err.response?.data?.message || err.message));
    //                     }
    //                 }}
    //                 sx={{
    //                     backgroundColor: 'white',
    //                     color: 'secondary.main',
    //                     '&:hover': { backgroundColor: '#f3f4f6' }
    //                 }}
    //             >
    //                 创建员工信息
    //             </Button>
    //         )}
    //         <Button
    //             variant="outlined"
    //             size="small"
    //             onClick={toggleMode}
    //             sx={{
    //                 color: 'white',
    //                 borderColor: 'white',
    //                 '&:hover': {
    //                     borderColor: 'white',
    //                     backgroundColor: 'rgba(255,255,255,0.1)'
    //                 }
    //             }}
    //         >
    //             切换到 {currentMode === 'admin_view' ? '编辑模式' : '查看模式'}
    //         </Button>
    //     </Portal>
    // );
};

const DynamicFormPage = () => {
    const { formToken, dataId } = useParams();
    const location = useLocation(); // 获取 location 对象
    const navigate = useNavigate(); // 获取 navigate 函数
    const [surveyModel, setSurveyModel] = useState(null);
    const [submissionState, setSubmissionState] = useState('idle'); // 'idle', 'submitting', 'completed'
    const [scoreResult, setScoreResult] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [currentMode, setCurrentMode] = useState('admin_view'); // 默认为编辑模式
    const [alert, setAlert] = useState({ open: false, message: '', severity: 'info' });

    // 全局预加载状态
    const [globalPreloadStatus, setGlobalPreloadStatus] = useState({
        previewsLoaded: 0,
        originalsLoaded: 0,
        totalImages: 0
    });

    // Lightbox state for image viewing
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [lightboxImages, setLightboxImages] = useState([]);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);

    // Delete dialog state
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

    // 清理预加载的隐藏图片元素
    useEffect(() => {
        return () => {
            // 组件卸载时清理所有预加载的隐藏图片
            const preloadImages = document.querySelectorAll('img[data-preload-cache="true"]');
            preloadImages.forEach(img => {
                if (document.body.contains(img)) {
                    document.body.removeChild(img);
                }
            });
            // console.log(`🧹 清理了 ${preloadImages.length} 个预加载图片元素`);
        };
    }, []);

    useEffect(() => {
        const fetchForm = async () => {
            try {
                setLoading(true);
                if (!formToken) {
                    throw new Error('Form token is missing.');
                }
                // 1. 获取表单 Schema
                const formResponse = await api.get(`/dynamic_forms/${formToken}`);
                const formSchema = formResponse.data.surveyjs_schema;

                if (!formSchema) {
                    throw new Error('未找到表单的 SurveyJS Schema');
                }

                const survey = new Model(formSchema);

                // Set Chinese locale for the survey
                survey.locale = "zh-cn";

                // 强制显示所有页面内容（解决图片不完全加载的问题）
                survey.questionsOnPageMode = "singlePage";
                survey.showPageNumbers = false;
                survey.showProgressBar = false;

                // 根据场景决定是否显示SurveyJS默认按钮
                if (dataId) {
                    // 管理员查看/编辑模式：隐藏默认按钮，使用顶部自定义按钮
                    survey.showNavigationButtons = false;
                    survey.showPrevButton = false;
                    survey.showCompleteButton = false;
                } else {
                    // 访客填写模式：显示默认提交按钮
                    survey.showNavigationButtons = true;
                    survey.showCompleteButton = true;
                }

                // 管理员编辑模式下不显示完成页面
                if (dataId) {
                    survey.showCompletedPage = false;
                }

                // Force storeDataAsText to false for all file questions to ensure we store the URL, not Base64
                survey.getAllQuestions().forEach(question => {
                    if (question.getType() === 'file') {
                        question.storeDataAsText = false;
                        // 关键修复：禁用 SurveyJS 内置图片预览，避免重复加载
                        // 我们使用自定义的 OptimizedFileCarousel 组件来显示图片
                        question.allowImagesPreview = false;
                    }
                });

                // 注册自定义日期/时间选择器渲染器
                // 将 SurveyJS 的日期/时间字段替换为响应式选择器组件
                survey.onAfterRenderQuestion.add(createDateTimeRenderer());

                // 注册签名板修复器，解决触摸偏移问题
                survey.onAfterRenderQuestion.add(createSignaturePadFixer());

                // Add eye icon for private fields (visible: false in schema)
                survey.onAfterRenderQuestion.add((sender, options) => {
                    const question = options.question;
                    // Check if field was originally marked as not visible in schema
                    // (In detail view, all fields are shown, so we need to check the original schema)
                    const originalQuestion = formSchema.pages?.[0]?.elements?.find(el => el.name === question.name);
                    if (originalQuestion && originalQuestion.visible === false) {
                        const titleElement = options.htmlElement.querySelector('.sd-question__title');
                        if (titleElement && !titleElement.querySelector('.private-field-icon')) {
                            const icon = document.createElement('span');
                            icon.className = 'private-field-icon';
                            icon.innerHTML = `
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                                    <line x1="1" y1="1" x2="23" y2="23"></line>
                                </svg>
                            `;
                            icon.title = '此字段仅管理员可见';
                            icon.style.cssText = 'display: inline-flex;';
                            titleElement.appendChild(icon);
                        }
                    }
                });

                // Beautify table (matrixdynamic) display
                survey.onAfterRenderQuestion.add((sender, options) => {
                    const question = options.question;
                    if (question.getType() === 'matrixdynamic' || question.getType() === 'matrixdropdown') {
                        setTimeout(() => {
                            // Handle textareas
                            const textareas = options.htmlElement.querySelectorAll('textarea');
                            textareas.forEach(textarea => {
                                // In display mode, replace textarea with plain text div
                                if (sender.mode === 'display' && textarea.disabled) {
                                    const textContent = textarea.value || '';
                                    const textDiv = document.createElement('div');
                                    textDiv.textContent = textContent;
                                    textDiv.style.cssText = 'padding: 0.5rem 0; line-height: 1.5; color: #374151; white-space: pre-wrap; word-break: break-word;';
                                    textarea.parentNode.replaceChild(textDiv, textarea);
                                } else if (!textarea.disabled) {
                                    // In edit mode, enable auto-resize
                                    const autoResize = () => {
                                        textarea.style.height = 'auto';
                                        textarea.style.height = textarea.scrollHeight + 'px';
                                    };
                                    autoResize();
                                    textarea.addEventListener('input', autoResize);
                                    const observer = new MutationObserver(autoResize);
                                    observer.observe(textarea, { attributes: true, attributeFilter: ['value'] });
                                }
                            });

                            // Remove padding from cells containing file upload - more aggressive approach
                            const removeFileCellPadding = () => {
                                const allCells = options.htmlElement.querySelectorAll('.sd-table__cell, td');

                                let fileCount = 0;
                                allCells.forEach(cell => {
                                    const hasFile = cell.querySelector('.sd-file, .sd-file__decorator, .sd-question--file');
                                    if (hasFile) {
                                        fileCount++;

                                        cell.style.setProperty('padding', '0', 'important');
                                        cell.style.setProperty('margin', '0', 'important');


                                        // Also remove padding from any wrapper elements
                                        const wrappers = cell.querySelectorAll('.sd-question, .sd-question__content');
                                        wrappers.forEach(wrapper => {
                                            wrapper.style.setProperty('padding', '0', 'important');
                                            wrapper.style.setProperty('margin', '0', 'important');
                                        });
                                    }
                                });

                            };

                            // Initial removal
                            removeFileCellPadding();

                            // Watch for dynamic changes
                            const observer = new MutationObserver(removeFileCellPadding);
                            observer.observe(options.htmlElement, {
                                childList: true,
                                subtree: true
                            });

                            // 处理 textarea 的行数设置
                            const applyTextareaRows = () => {
                                const columns = question.columns || [];

                                const rows = options.htmlElement.querySelectorAll('tbody tr, .sd-table__row:not(.sd-table__row--header)');

                                rows.forEach((row, rowIdx) => {
                                    const allCells = row.querySelectorAll('td, .sd-table__cell');
                                    const dataCells = Array.from(allCells).filter(cell => !cell.querySelector('.sd-action-bar'));

                                    columns.forEach((col, colIndex) => {
                                        const cell = dataCells[colIndex];
                                        if (!cell) return;

                                        const textarea = cell.querySelector('textarea');
                                        if (textarea && col.rows && col.rows > 1) {
                                            // 设置 rows 属性
                                            textarea.setAttribute('rows', col.rows);
                                            // 计算高度：每行约 1.4em (正常行高) + padding
                                            const lineHeight = 1.4;
                                            const paddingPx = 16; // 8px top + 8px bottom
                                            const fontSizePx = 14; // 0.875rem
                                            const heightPx = Math.round(col.rows * lineHeight * fontSizePx + paddingPx);
                                            // 强制设置高度和行高
                                            textarea.style.setProperty('height', `${heightPx}px`, 'important');
                                            textarea.style.setProperty('min-height', `${heightPx}px`, 'important');
                                            textarea.style.setProperty('line-height', '1.4', 'important');
                                            textarea.style.setProperty('resize', 'vertical', 'important');
                                        }
                                    });
                                });
                            };

                            // 初始应用（延迟执行确保DOM已渲染）
                            setTimeout(applyTextareaRows, 100);

                            // 监听变化
                            const textareaObserver = new MutationObserver(() => {
                                setTimeout(applyTextareaRows, 50);
                            });
                            textareaObserver.observe(options.htmlElement, {
                                childList: true,
                                subtree: true
                            });

                            // 获取"图片"列的索引和列名
                            const getImageColumnInfo = () => {
                                const info = [];
                                const columns = question.columns || [];

                                // console.log('=== getImageColumnInfo ===');
                                // console.log('question.name:', question.name);
                                // console.log('columns.length:', columns.length);
                                // columns.forEach((col, i) => {
                                //     console.log(`列 ${i}:`, { name: col.name, title: col.title, value: col.value });
                                // });

                                // 直接遍历 SurveyJS 的 columns 定义，根据列标题匹配
                                columns.forEach((col, colIndex) => {
                                    const title = col.title || col.name || '';
                                    if (title.includes('图片') || title.includes('照片') || title.includes('凭证')) {
                                        const colName = col.name || col.value;
                                        // cellIndex 就是 colIndex，不需要 +1（操作按钮列在最后或不存在）
                                        info.push({ cellIndex: colIndex, colIndex, name: colName, title });
                                        // console.log('检测到图片列:', { colIndex, colName, title });
                                    }
                                });
                                return info;
                            };

                            // 处理表格中的图片列
                            const processImageColumns = () => {
                                const imageColInfo = getImageColumnInfo();
                                // console.log('imageColInfo:', imageColInfo);
                                if (imageColInfo.length === 0) return;

                                const rows = options.htmlElement.querySelectorAll('tbody tr, .sd-table__row:not(.sd-table__row--header)');
                                // console.log('找到行数:', rows.length);
                                rows.forEach((row, rowIndex) => {
                                    // 获取数据单元格（排除操作按钮列）
                                    const allCells = row.querySelectorAll('td, .sd-table__cell');
                                    // 过滤掉包含 action-bar 的单元格
                                    const dataCells = Array.from(allCells).filter(cell => !cell.querySelector('.sd-action-bar'));
                                    // console.log(`行 ${rowIndex} 数据单元格数:`, dataCells.length);

                                    imageColInfo.forEach(({ cellIndex, colIndex, name: colName }) => {
                                        const cell = dataCells[colIndex];
                                        if (!cell) {
                                            // console.log(`行 ${rowIndex}: 找不到单元格, colIndex=${colIndex}, dataCells.length=${dataCells.length}`);
                                            return;
                                        }

                                        // console.log(`行 ${rowIndex} 单元格内容:`, cell.innerHTML.substring(0, 200));

                                        // 跳过已处理的单元格
                                        if (cell.dataset.imageColumnProcessed === 'true') return;

                                        // 如果已有文件上传控件，跳过
                                        if (cell.querySelector('.sd-file, .matrix-image-uploader')) return;

                                        // 查找文本输入框或 textarea
                                        let input = cell.querySelector('input[type="text"]:not([type="date"]):not([type="number"])');
                                        if (!input) {
                                            input = cell.querySelector('textarea');
                                        }
                                        // 也尝试查找任何 input
                                        if (!input) {
                                            input = cell.querySelector('input:not([type="date"]):not([type="number"]):not([type="checkbox"]):not([type="radio"])');
                                        }
                                        if (!input) {
                                            // console.log(`行 ${rowIndex}: 找不到文本输入框或textarea, 单元格所有input:`, cell.querySelectorAll('input, textarea'));
                                            return;
                                        }

                                        const currentValue = input.value?.trim() || '';

                                        // 解析图片URL列表（支持逗号分隔的多图片）
                                        const parseImageUrls = (value) => {
                                            if (!value) return [];
                                            return value.split(',').map(url => url.trim()).filter(url => url.startsWith('http'));
                                        };

                                        const imageUrls = parseImageUrls(currentValue);
                                        cell.dataset.imageColumnProcessed = 'true';

                                        // 创建容器
                                        const container = document.createElement('div');
                                        container.className = 'matrix-image-container';
                                        container.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px; padding: 4px; align-items: center;';

                                        // 显示已有图片
                                        imageUrls.forEach((url, imgIndex) => {
                                            const imgWrapper = document.createElement('div');
                                            imgWrapper.style.cssText = 'position: relative; display: inline-block;';

                                            const img = document.createElement('img');
                                            img.src = getThumbnailUrl(url);
                                            img.alt = `图片${imgIndex + 1}`;
                                            img.style.cssText = 'width: 50px; height: 50px; object-fit: cover; border-radius: 4px; cursor: pointer; border: 1px solid #e5e7eb;';
                                            img.onclick = () => {
                                                const allImages = imageUrls.map(u => ({ lightboxUrl: getLightboxUrl(u), originalUrl: u }));
                                                setLightboxImages(allImages);
                                                setCurrentImageIndex(imgIndex);
                                                setLightboxOpen(true);
                                            };

                                            // 删除按钮
                                            const deleteBtn = document.createElement('button');
                                            deleteBtn.type = 'button';
                                            deleteBtn.innerHTML = '×';
                                            deleteBtn.style.cssText = 'position: absolute; top: -6px; right: -6px; width: 18px; height: 18px; border-radius: 50%; background: #ef4444; color: white; border: none; cursor: pointer; font-size: 12px; line-height: 1; display: flex; align-items: center; justify-content: center;';
                                            deleteBtn.onclick = (e) => {
                                                e.stopPropagation();
                                                const newUrls = imageUrls.filter((_, i) => i !== imgIndex);
                                                const newValue = newUrls.join(',');

                                                // 更新 SurveyJS 数据
                                                const matrixValue = question.value ? [...question.value] : [];
                                                if (matrixValue[rowIndex]) {
                                                    matrixValue[rowIndex] = { ...matrixValue[rowIndex], [colName]: newValue };
                                                    question.value = matrixValue;
                                                }
                                                input.value = newValue;

                                                // 重新渲染
                                                cell.dataset.imageColumnProcessed = 'false';
                                                container.remove();
                                                processImageColumns();
                                            };

                                            imgWrapper.appendChild(img);
                                            imgWrapper.appendChild(deleteBtn);
                                            container.appendChild(imgWrapper);
                                        });

                                        // 添加上传按钮
                                        const fileInput = document.createElement('input');
                                        fileInput.type = 'file';
                                        fileInput.accept = 'image/*';
                                        fileInput.multiple = true;
                                        fileInput.style.display = 'none';

                                        const uploadBtn = document.createElement('button');
                                        uploadBtn.type = 'button';
                                        uploadBtn.innerHTML = imageUrls.length > 0 ? '+' : '上传图片';
                                        uploadBtn.style.cssText = imageUrls.length > 0
                                            ? 'width: 50px; height: 50px; border: 1px dashed #d1d5db; border-radius: 4px; background: #f9fafb; cursor: pointer; font-size: 20px; color: #9ca3af; display: flex; align-items: center; justify-content: center;'
                                            : 'padding: 8px 16px; font-size: 12px; background: #f3f4f6; border: 1px dashed #d1d5db; border-radius: 4px; cursor: pointer; color: #6b7280;';
                                        uploadBtn.onclick = () => fileInput.click();

                                        fileInput.onchange = async (e) => {
                                            const files = Array.from(e.target.files || []);
                                            if (files.length === 0) return;

                                            uploadBtn.innerHTML = '上传中...';
                                            uploadBtn.disabled = true;

                                            try {
                                                const uploadedUrls = [];
                                                for (const file of files) {
                                                    const formData = new FormData();
                                                    formData.append('file', file);

                                                    const response = await fetch('/api/upload/r2', {
                                                        method: 'POST',
                                                        body: formData,
                                                        headers: {
                                                            'Authorization': `Bearer ${localStorage.getItem('token')}`
                                                        }
                                                    });

                                                    if (response.ok) {
                                                        const data = await response.json();
                                                        uploadedUrls.push(data.url || data.file_url);
                                                    }
                                                }

                                                if (uploadedUrls.length > 0) {
                                                    // 合并新旧图片URL
                                                    const allUrls = [...imageUrls, ...uploadedUrls];
                                                    const newValue = allUrls.join(',');

                                                    // console.log('=== 多图片上传成功 ===');
                                                    // console.log('新上传:', uploadedUrls);
                                                    // console.log('合并后:', newValue);

                                                    // 更新 SurveyJS 数据
                                                    const matrixValue = question.value ? [...question.value] : [];
                                                    while (matrixValue.length <= rowIndex) {
                                                        matrixValue.push({});
                                                    }
                                                    matrixValue[rowIndex] = { ...matrixValue[rowIndex], [colName]: newValue };
                                                    question.value = matrixValue;
                                                    input.value = newValue;

                                                    // 重新渲染
                                                    cell.dataset.imageColumnProcessed = 'false';
                                                    container.remove();
                                                    processImageColumns();
                                                }
                                            } catch (err) {
                                                console.error('Upload error:', err);
                                            }

                                            uploadBtn.innerHTML = imageUrls.length > 0 ? '+' : '上传图片';
                                            uploadBtn.disabled = false;
                                            fileInput.value = '';
                                        };

                                        container.appendChild(fileInput);
                                        container.appendChild(uploadBtn);

                                        input.style.display = 'none';
                                        input.parentNode.insertBefore(container, input);
                                    });
                                });
                            };

                            // 初始处理
                            processImageColumns();

                            // 监听变化（新增行时触发）
                            const imageColObserver = new MutationObserver(() => {
                                setTimeout(processImageColumns, 50);
                            });
                            imageColObserver.observe(options.htmlElement, {
                                childList: true,
                                subtree: true
                            });

                            // Relocate the "Add Row" button outside the scrollable table container
                            const relocateAddRowButton = () => {
                                const footer = options.htmlElement.querySelector('.sd-matrixdynamic__footer');
                                if (!footer || footer.dataset.customizedFooter === 'true') {
                                    return;
                                }

                                footer.dataset.customizedFooter = 'true';

                                const questionRoot = options.htmlElement;
                                const content = questionRoot.querySelector('.sd-question__content');
                                const table = content?.querySelector('.sd-table');

                                // Wrap table in a scroll container if not already wrapped
                                if (table && !table.parentElement.classList.contains('matrix-scroll-container')) {
                                    const scrollContainer = document.createElement('div');
                                    scrollContainer.className = 'matrix-scroll-container';
                                    table.parentNode.insertBefore(scrollContainer, table);
                                    scrollContainer.appendChild(table);
                                }

                                let wrapper = questionRoot.querySelector('.matrix-add-row-wrapper');

                                if (!wrapper) {
                                    wrapper = document.createElement('div');
                                    wrapper.className = 'matrix-add-row-wrapper';

                                    if (content && content.parentNode) {
                                        content.insertAdjacentElement('afterend', wrapper);
                                    } else {
                                        questionRoot.appendChild(wrapper);
                                    }
                                }

                                wrapper.appendChild(footer);
                            };

                            relocateAddRowButton();

                            const footerObserver = new MutationObserver(relocateAddRowButton);
                            footerObserver.observe(options.htmlElement, {
                                childList: true,
                                subtree: true
                            });
                        }, 100); // Increased timeout
                    }
                });

                // Enable HTML rendering for form description
                survey.onAfterRenderHeader.add((sender, options) => {
                    // Find the description element. SurveyJS uses .sd-description (V2) or .sv-description (V1)
                    const descriptionEl = options.htmlElement.querySelector(".sd-description") || options.htmlElement.querySelector(".sv-description");
                    if (descriptionEl && sender.description) {
                        descriptionEl.innerHTML = sender.description;
                    }
                });

                let initialMode = 'edit'; // 默认新表单为编辑模式

                // 2. 如果有 dataId，获取已存在的数据
                if (dataId) {
                    const dataResponse = await api.get(`/form-data/${dataId}`);
                    const rawData = dataResponse.data.data;
                    const jinshujuSchema = formResponse.data.jinshuju_schema;

                    // --- DATA COMPATIBILITY LOGIC START ---
                    // Check if this is a legacy jinshuju-synced form AND the data actually looks like legacy data (field_x keys)
                    const hasLegacySchema = !!jinshujuSchema;
                    const hasLegacyDataKeys = rawData && Object.keys(rawData).some(key => key.startsWith('field_'));

                    let displayData = rawData;

                    if (hasLegacySchema && hasLegacyDataKeys) {
                        // --- LEGACY LOGIC FOR JINSHUJU DATA ---

                        // 1. Build mapping from jinshuju: field_x -> label
                        const fieldMap = {};
                        jinshujuSchema.fields.forEach(fieldWrapper => {
                            for (const fieldId in fieldWrapper) {
                                if (fieldWrapper[fieldId].label) {
                                    fieldMap[fieldId] = fieldWrapper[fieldId].label;
                                }
                            }
                        });

                        // 2. Build reverse mapping: label -> field_x
                        const reverseFieldMap = {};
                        for (const fieldId in fieldMap) {
                            reverseFieldMap[fieldMap[fieldId]] = fieldId;
                        }

                        // 3. Build choice mapping: question_label -> { choice_text -> choice_value }
                        const choiceMap = {};
                        if (formSchema.pages) {
                            formSchema.pages.forEach(page => {
                                if (page.elements) {
                                    page.elements.forEach(question => {
                                        if (question.choices) {
                                            choiceMap[question.name] = {};
                                            question.choices.forEach(choice => {
                                                choiceMap[question.name][choice.text] = choice.value;
                                            });
                                        }
                                    });
                                }
                            });
                        }

                        // 4. Transform raw answers to displayable data for SurveyJS
                        displayData = {};


                        if (formSchema.pages) {
                            formSchema.pages.forEach(page => {
                                if (page.elements) {
                                    page.elements.forEach(question => {
                                        const questionName = question.name; // This is usually the label in our generated schemas
                                        let fieldId = null;

                                        // Priority 1: If the question name itself is a field_x ID, use it directly.
                                        // This allows us to manually override mappings in the SurveyJS schema (e.g. for form Iqltzj).
                                        if (questionName.startsWith('field_')) {
                                            fieldId = questionName;
                                        }

                                        // Priority 2: Try matching by Name (Label)
                                        if (!fieldId) {
                                            fieldId = reverseFieldMap[questionName];
                                        }

                                        // Priority 3: Try matching by Title (Label) if Name didn't work
                                        if (!fieldId && question.title) {
                                            fieldId = reverseFieldMap[question.title];
                                        }

                                        // Look up field definition in Jinshuju schema if available
                                        let fieldDef = null;
                                        if (fieldId && jinshujuSchema && jinshujuSchema.fields) {
                                            const fieldEntry = jinshujuSchema.fields.find(f => f[fieldId]);
                                            if (fieldEntry) fieldDef = fieldEntry[fieldId];
                                        }

                                        if (fieldId && rawData[fieldId] !== undefined) {
                                            let userAnswer = rawData[fieldId];

                                            // Normalize file objects if this is a file field with nested content structure
                                            // Check if userAnswer is an array of file objects with nested content
                                            if (Array.isArray(userAnswer) && userAnswer.length > 0) {
                                                const firstItem = userAnswer[0];
                                                // Check if it looks like a file object with nested content
                                                if (firstItem && typeof firstItem === 'object' &&
                                                    firstItem.content && typeof firstItem.content === 'object' &&
                                                    firstItem.content.content) {
                                                    userAnswer = userAnswer.map(fileObj => {
                                                        if (fileObj && typeof fileObj === 'object' &&
                                                            fileObj.content && typeof fileObj.content === 'object' &&
                                                            fileObj.content.content) {
                                                            return {
                                                                content: fileObj.content.content,
                                                                name: fileObj.content.name || fileObj.name || "image.jpg",
                                                                type: fileObj.content.type || fileObj.type || "image/jpeg"
                                                            };
                                                        }
                                                        return fileObj;
                                                    });
                                                }
                                            }

                                            // Handle Address Object
                                            if ((fieldDef && fieldDef.type === 'address') ||
                                                (userAnswer && typeof userAnswer === 'object' && (userAnswer.province || userAnswer.city))) {
                                                userAnswer = formatAddress(userAnswer);
                                            }

                                            const associatedKeys = Object.keys(rawData).filter(key => key.startsWith(`${fieldId}_associated_field_`));

                                            // Check if association fields are already expanded in surveyjs_schema
                                            let isExpanded = false;
                                            if (formSchema && formSchema.pages) {
                                                formSchema.pages.forEach(page => {
                                                    if (page.elements) {
                                                        const hasAssociatedElements = page.elements.some(el =>
                                                            el.name && el.name.startsWith(`${fieldId}_associated_field_`)
                                                        );
                                                        if (hasAssociatedElements) {
                                                            isExpanded = true;
                                                        }
                                                    }
                                                });
                                            }

                                            // Only generate HTML if NOT expanded in schema
                                            if (((fieldDef && fieldDef.type === 'form_association') || associatedKeys.length > 0) && !isExpanded) {
                                                if (associatedKeys.length > 0) {
                                                    // 使用 API 返回的 associated_form_meta 动态获取字段标签
                                                    const associatedMeta = formResponse.data.associated_form_meta?.[fieldId];

                                                    const fieldLabels = {};

                                                    if (associatedMeta && associatedMeta.fields) {
                                                        // 构建字段标签映射
                                                        Object.keys(associatedMeta.fields).forEach(fid => {
                                                            fieldLabels[fid] = associatedMeta.fields[fid].label;
                                                        });
                                                    }



                                                    // Sort keys numerically by the associated field ID
                                                    associatedKeys.sort((a, b) => {
                                                        const idA = parseInt(a.split('_associated_field_')[1]);
                                                        const idB = parseInt(b.split('_associated_field_')[1]);
                                                        return idA - idB;
                                                    });

                                                    const associatedValues = associatedKeys.map(key => {
                                                        const val = rawData[key];
                                                        const subFieldId = key.split('_associated_field_')[1];

                                                        if (val == userAnswer) return null;

                                                        let displayVal = val;
                                                        // Fix: fieldLabels keys are like 'field_2', but subFieldId is just '2'
                                                        let label = fieldLabels[`field_${subFieldId}`] || '';

                                                        if (val && typeof val === 'object' && (val.province || val.city)) {
                                                            displayVal = formatAddress(val);
                                                        } else if (typeof displayVal === 'string') {
                                                            displayVal = displayVal.trim();
                                                        }

                                                        // 检查是否是签名字段
                                                        const fieldType = associatedMeta?.fields?.[`field_${subFieldId}`]?.type;
                                                        if (fieldType === 'e_signature' ||
                                                            (typeof val === 'string' && (
                                                                ((val.includes('jinshujufiles.com') || val.includes('mengyimengsao.com')) && val.includes('signature')) ||
                                                                val.includes('/api/contracts/signatures/')
                                                            ))) {
                                                            return {
                                                                label,
                                                                value: `[SIGNATURE:${val}]`,
                                                                isSignature: true
                                                            };
                                                        }

                                                        return {
                                                            label,
                                                            value: displayVal,
                                                            isSignature: false
                                                        };
                                                    }).filter(Boolean);

                                                    if (associatedValues.length > 0) {
                                                        // Construct HTML block structure
                                                        let html = '<div class="nested-form-container" style="padding: 5px 0;">';

                                                        // Add main title if needed (though SurveyJS usually handles it, adding a class allows us to control it)
                                                        // html += `<h4 class="nested-form-title" style="margin-bottom: 15px; font-weight: bold;">${questionName}</h4>`;

                                                        associatedValues.forEach(item => {
                                                            html += `<div class="nested-field-item" style="margin-bottom: 10px;">
                                                                    <div class="nested-field-label" style="font-size: 14px; font-weight: bold; margin-bottom: 4px; color: #333;">${item.label}</div>
                                                                    <div class="nested-field-value" style="background: #f9f9f9; padding: 8px 10px; border-radius: 4px; min-height: 20px; border: 1px solid #eee; color: #333; word-break: break-word; white-space: pre-wrap; line-height: 1.5;">${item.value}</div>
                                                                </div>`;
                                                        });
                                                        html += '</div>';
                                                        userAnswer = html;
                                                    }
                                                }
                                            }

                                            if (choiceMap[questionName]) { // It's a choice-based question
                                                const answerAsArray = Array.isArray(userAnswer) ? userAnswer : [userAnswer];

                                                // Build reverse map (value -> value) for checking if data is already a value
                                                const choiceValues = Object.values(choiceMap[questionName]);

                                                const mappedValues = answerAsArray
                                                    .map(item => {
                                                        // If item is already a valid choice value, use it directly
                                                        if (choiceValues.includes(item)) {
                                                            return item;
                                                        }
                                                        // Otherwise, try to map from text to value
                                                        return choiceMap[questionName][item];
                                                    })
                                                    .filter(Boolean); // Filter out any failed lookups

                                                if (question.type === 'checkbox') {
                                                    displayData[questionName] = mappedValues; // Checkbox expects an array
                                                } else if (mappedValues.length > 0) {
                                                    displayData[questionName] = mappedValues[0]; // Radiogroup/dropdown expects a single value
                                                }
                                            } else if (question.type === 'file') {
                                                // Handle file uploads (convert URL strings to SurveyJS file objects)
                                                // Also handle nested content objects from backend

                                                // Helper function to normalize a single file object
                                                const normalizeFileObject = (fileObj) => {
                                                    // If it's already a string URL, convert to file object
                                                    if (typeof fileObj === 'string') {
                                                        let name = "image.jpg";
                                                        try {
                                                            const urlObj = new URL(fileObj);
                                                            const params = new URLSearchParams(urlObj.search);
                                                            if (params.has('attname')) {
                                                                name = params.get('attname');
                                                            } else {
                                                                name = urlObj.pathname.split('/').pop();
                                                            }
                                                        } catch (e) {
                                                            // ignore invalid URLs
                                                        }
                                                        return {
                                                            name: name,
                                                            type: "image/jpeg",
                                                            content: fileObj
                                                        };
                                                    }

                                                    // If it's an object, check for nested content structure
                                                    if (typeof fileObj === 'object' && fileObj !== null) {
                                                        // Check if content is nested: { content: { content: "url", name: "...", type: "..." } }
                                                        if (fileObj.content && typeof fileObj.content === 'object' && fileObj.content.content) {
                                                            return {
                                                                content: fileObj.content.content,
                                                                name: fileObj.content.name || fileObj.name || "image.jpg",
                                                                type: fileObj.content.type || fileObj.type || "image/jpeg"
                                                            };
                                                        }
                                                        // Already in correct format
                                                        return fileObj;
                                                    }

                                                    return fileObj;
                                                };

                                                if (Array.isArray(userAnswer)) {
                                                    displayData[questionName] = userAnswer.map(normalizeFileObject);
                                                } else if (userAnswer) {
                                                    displayData[questionName] = [normalizeFileObject(userAnswer)];
                                                }
                                            } else if (question.type === 'matrixdynamic') {
                                                // Handle matrixdynamic (table) data
                                                // Data from DB uses Chinese labels as keys, but schema uses field_X
                                                // Need to transform: {"类别": "xxx"} -> {"field_2": "xxx"}

                                                if (Array.isArray(userAnswer) && userAnswer.length > 0) {
                                                    // Get column definitions from schema
                                                    const columns = question.columns || [];

                                                    // Build mapping: Chinese label -> field_X
                                                    const labelToFieldMap = {};
                                                    columns.forEach(col => {
                                                        labelToFieldMap[col.title] = col.name;
                                                    });

                                                    // Transform each row
                                                    const transformedData = userAnswer.map(row => {
                                                        const newRow = {};
                                                        Object.keys(row).forEach(key => {
                                                            const fieldName = labelToFieldMap[key] || key;
                                                            newRow[fieldName] = row[key];
                                                        });
                                                        return newRow;
                                                    });

                                                    displayData[questionName] = transformedData;

                                                } else {
                                                    displayData[questionName] = userAnswer;
                                                }
                                            } else if (question.type === 'matrixdropdown') {
                                                // Transform Jinshuju matrix data to SurveyJS matrixdropdown format
                                                // Jinshuju: [{ statement: 'row_val', dimensions: { col_key: 'val' } }]
                                                // SurveyJS: { 'row_val': { 'col_key': 'val' } }

                                                if (Array.isArray(userAnswer)) {
                                                    const transformedData = {};
                                                    userAnswer.forEach(item => {
                                                        // Use statement value as row key
                                                        let rowKey = item.statement;

                                                        // Try to map statement text to row value if possible
                                                        if (rowKey && question.rows) {
                                                            const rowDef = question.rows.find(r => r.text === rowKey || r.value === rowKey);
                                                            if (rowDef) {
                                                                rowKey = rowDef.value;
                                                            }
                                                        }

                                                        // If rowKey is empty, try to find a default row from question definition
                                                        if (!rowKey && question.rows && question.rows.length > 0) {
                                                            // If there's only one row, use it
                                                            if (question.rows.length === 1) {
                                                                rowKey = question.rows[0].value;
                                                            } else {
                                                                // If multiple rows, try to find one with empty value or specific marker
                                                                const emptyRow = question.rows.find(r => !r.value || r.value === "dQIl");
                                                                if (emptyRow) {
                                                                    rowKey = emptyRow.value;
                                                                } else {
                                                                    // Fallback to first row
                                                                    rowKey = question.rows[0].value;
                                                                }
                                                            }
                                                        }

                                                        // Map dimensions: Chinese Label -> Column Name (field_X)
                                                        const rowData = {};
                                                        const dimensions = item.dimensions || {};

                                                        // Get column mapping
                                                        const colMap = {};
                                                        if (question.columns) {
                                                            question.columns.forEach(col => {
                                                                colMap[col.title] = col.name;
                                                            });
                                                        }

                                                        Object.keys(dimensions).forEach(dimKey => {
                                                            // dimKey is likely the Chinese label (e.g., "合同编号")
                                                            // We need to map it to the column name (e.g., "field_1")
                                                            const colName = colMap[dimKey] || dimKey;
                                                            let cellValue = dimensions[dimKey];

                                                            // Check if this column is a dropdown and needs value mapping
                                                            if (question.columns) {
                                                                const colDef = question.columns.find(c => c.name === colName);
                                                                if (colDef && (colDef.cellType === 'dropdown' || colDef.choices)) {
                                                                    // Try to find the value corresponding to the text
                                                                    if (colDef.choices && cellValue) {
                                                                        const choice = colDef.choices.find(c => c.text === cellValue || c.value === cellValue);
                                                                        if (choice) {
                                                                            cellValue = choice.value;
                                                                        }
                                                                    }
                                                                }
                                                            }

                                                            rowData[colName] = cellValue;
                                                        });

                                                        if (rowKey) {
                                                            transformedData[rowKey] = rowData;
                                                        }
                                                    });
                                                    displayData[questionName] = transformedData;
                                                } else {
                                                    displayData[questionName] = userAnswer;
                                                }
                                            } else if (question.type === 'matrix') {
                                                // Transform Jinshuju likert data to SurveyJS matrix format
                                                // Jinshuju: [{ choice: 'col_text', statement: 'row_text' }]
                                                // SurveyJS: { 'row_val': 'col_val' }
                                                if (Array.isArray(userAnswer)) {
                                                    const transformedData = {};
                                                    userAnswer.forEach(item => {
                                                        let rowKey = item.statement;
                                                        let colVal = item.choice;

                                                        // Map row text to row value
                                                        if (question.rows) {
                                                            const rowDef = question.rows.find(r => r.text === rowKey || r.value === rowKey);
                                                            if (rowDef) rowKey = rowDef.value;
                                                        }

                                                        // Map column text to column value
                                                        if (question.columns) {
                                                            const colDef = question.columns.find(c => c.text === colVal || c.value === colVal);
                                                            if (colDef) colVal = colDef.value;
                                                        }

                                                        if (rowKey) {
                                                            transformedData[rowKey] = colVal;
                                                        }
                                                    });
                                                    displayData[questionName] = transformedData;
                                                } else {
                                                    displayData[questionName] = userAnswer;
                                                }
                                            } else if (question.type === 'rating') {
                                                // Handle rating type (simple value)
                                                displayData[questionName] = userAnswer;

                                            } else { // Simple text question

                                                // Handle empty values - show placeholder
                                                if (userAnswer === null || userAnswer === undefined || userAnswer === '') {
                                                    displayData[questionName] = '空';
                                                } else if (typeof userAnswer === 'object' && !Array.isArray(userAnswer)) {
                                                    // Handle object values - convert to JSON string
                                                    displayData[questionName] = JSON.stringify(userAnswer, null, 2);
                                                } else {
                                                    displayData[questionName] = userAnswer;
                                                }
                                            }
                                        }
                                    });
                                }
                            });
                        }

                        // Add Signature Rendering Logic
                        survey.onAfterRenderQuestion.add((sender, options) => {
                            const questionName = options.question.name;
                            const questionValue = options.question.value;

                            // Try to get fieldId - if questionName is already field_X format, use it directly
                            let fieldId = questionName.match(/^field_\d+$/) ? questionName : reverseFieldMap[questionName];

                            let fieldDef = null;
                            if (fieldId && jinshujuSchema && jinshujuSchema.fields) {
                                const fieldEntry = jinshujuSchema.fields.find(f => f[fieldId]);
                                if (fieldEntry) fieldDef = fieldEntry[fieldId];
                            }

                            // Check if this is a signature field
                            // 注意：排除 signaturepad 类型，因为它已经由 createSignaturePadFixer 处理
                            const questionType = options.question.getType();
                            if (questionType === 'signaturepad') {
                                // signaturepad 类型由自定义组件处理，跳过这里的签名渲染逻辑
                                return;
                            }

                            const signatureMarker = '[SIGNATURE:';
                            const hasSignatureMarker = typeof questionValue === 'string' && questionValue.includes(signatureMarker);
                            const isMultiLineAssociation = typeof questionValue === 'string' && (questionValue.includes('\n') || questionValue.includes('nested-form-container'));

                            const isSignature = (fieldDef && fieldDef.type === 'e_signature') ||
                                (typeof questionValue === 'string' && (
                                    ((questionValue.includes('jinshujufiles.com') || questionValue.includes('mengyimengsao.com')) && questionValue.includes('signature')) ||
                                    questionValue.includes('/api/contracts/signatures/')
                                )) ||
                                hasSignatureMarker ||
                                isMultiLineAssociation;

                            // Force title rendering for HTML questions if not present
                            if (options.question.getType() === 'html') {
                                // Check if title exists
                                const titleEl = options.htmlElement.querySelector('.sd-question__title') || options.htmlElement.querySelector('.sv-question__title');
                                if (!titleEl && options.question.title) {
                                    const customTitle = document.createElement('h5');
                                    customTitle.className = 'sd-question__title sd-element__title';
                                    customTitle.style.cssText = 'margin: 0 0 10px 0; font-weight: bold; font-size: 16px; color: #404040;';
                                    customTitle.innerText = options.question.title;

                                    // Insert at the top
                                    options.htmlElement.insertBefore(customTitle, options.htmlElement.firstChild);
                                }
                            }

                            // Custom Rendering for File Questions
                            if (options.question.getType() === 'file') {
                                const questionValue = options.question.value;
                                const questionName = options.question.name;
                                const contentDiv = options.htmlElement.querySelector('.sd-question__content') || options.htmlElement;

                                // Prevent duplicate rendering
                                const existingCarousel = contentDiv.querySelector('.custom-file-carousel-root');
                                if (existingCarousel) {

                                    return;
                                }

                                // 在所有模式下都使用自定义渲染器来显示图片
                                // 只有在 full_edit 模式下才同时显示原生控件以支持删除功能
                                const isFullEditMode = currentMode === 'full_edit';

                                if (Array.isArray(questionValue) && questionValue.length > 0) {

                                    // 在非完全编辑模式下隐藏默认预览，并移除其中的图片以防止加载
                                    const defaultPreview = contentDiv.querySelector('.sd-file');
                                    if (defaultPreview && !isFullEditMode) {
                                        defaultPreview.style.display = 'none';
                                        // 移除 SurveyJS 原生预览中的图片，防止重复加载
                                        const nativeImages = defaultPreview.querySelectorAll('img');
                                        nativeImages.forEach(img => {
                                            img.src = '';
                                            img.removeAttribute('src');
                                        });
                                    }

                                    // Create container for React component
                                    const carouselContainer = document.createElement('div');
                                    carouselContainer.className = 'custom-file-carousel-root';
                                    carouselContainer.style.width = '100%';
                                    contentDiv.appendChild(carouselContainer);

                                    // Render React component using createRoot
                                    const root = createRoot(carouselContainer);

                                    // Extract image URLs from questionValue
                                    const imageUrls = questionValue.map(file => file.content).filter(Boolean);

                                    root.render(
                                        <OptimizedFileCarousel
                                            questionValue={questionValue}
                                            onPreloadUpdate={(loaded, total) => {
                                                setGlobalPreloadStatus(prev => ({
                                                    ...prev,
                                                    originalsLoaded: prev.originalsLoaded + 1,
                                                    totalImages: Math.max(prev.totalImages, total)
                                                }));
                                            }}
                                            onImageClick={(index, lightboxPreloadedStatus) => {
                                                // console.log(`📸 打开 Lightbox: 图片 ${index + 1}`);
                                                // console.log(`📊 lightboxCache 大小: ${lightboxCache.size}`);

                                                // 生成所有图片的大图URL（优先使用缓存的URL）
                                                const lightboxData = questionValue.map((file, idx) => {
                                                    const originalUrl = file?.content;
                                                    const cached = lightboxCache.get(originalUrl);

                                                    // 优先使用缓存的URL（已预加载到浏览器缓存），否则使用网络URL
                                                    const lightboxUrl = cached?.url || getLightboxUrl(originalUrl);
                                                    const isCached = !!cached?.loaded;

                                                    // console.log(`图片 ${idx + 1}: ${isCached ? '✅ 已缓存' : '⚠️ 网络加载'} ${cached ? `(${cached.width}x${cached.height})` : ''}`);

                                                    return {
                                                        lightboxUrl,
                                                        originalUrl,
                                                        index: idx,
                                                        isCached,
                                                        dimensions: cached ? `${cached.width}x${cached.height}` : 'N/A'
                                                    };
                                                });

                                                // 统计缓存状态
                                                const cachedCount = lightboxData.filter(item => item.isCached).length;
                                                console.log(`📈 大图缓存进度: ${cachedCount}/${questionValue.length}`);

                                                setLightboxImages(lightboxData);
                                                setCurrentImageIndex(index);
                                                setLightboxOpen(true);
                                            }}
                                        />
                                    );
                                } else {
                                    // console.log(`[File Rendering - ${questionName}] ✓ Using native SurveyJS control for edit mode`);
                                    // 在编辑模式下,确保显示原生控件
                                    const defaultPreview = contentDiv.querySelector('.sd-file');
                                    // console.log(`[File Rendering - ${questionName}] defaultPreview element:`, defaultPreview);
                                    if (defaultPreview) {
                                        defaultPreview.style.display = 'block';
                                        // console.log(`[File Rendering - ${questionName}] Ensured default preview is visible`);
                                    }
                                }
                                // console.log(`[File Rendering - ${questionName}] ===== END =====`);
                            }

                            if (isSignature) {
                                // console.log(`[DEBUG] Rendering signature for ${questionName}`);

                                // Check if already wrapped
                                if (options.htmlElement.querySelector('.custom-signature-wrapper')) {
                                    return;
                                }

                                // Create styled wrapper
                                const wrapper = document.createElement("div");
                                wrapper.className = "custom-signature-wrapper";
                                wrapper.style.cssText = "background-color: #fff; padding: 12px; border: 1px solid #e6e6e6; border-radius: 4px; margin-top: 10px;";

                                // Add title
                                const titleDiv = document.createElement("div");
                                titleDiv.innerText = options.question.title || options.question.name;
                                titleDiv.style.cssText = "font-size: 14px; font-weight: bold; margin-bottom: 8px; color: #404040;";
                                wrapper.appendChild(titleDiv);

                                // Add notes if available
                                if (fieldDef && fieldDef.notes) {
                                    const notesDiv = document.createElement("div");
                                    notesDiv.innerHTML = fieldDef.notes;
                                    notesDiv.style.cssText = "font-size: 12px; color: #666; margin-bottom: 8px; padding: 6px 8px; background-color: #f9f9f9; border-left: 3px solid #ffa500; border-radius: 2px;";
                                    wrapper.appendChild(notesDiv);
                                }

                                // Check if signature value is empty
                                const isEmptySignature = !questionValue || questionValue === '' || questionValue === '空';

                                if (isEmptySignature) {
                                    // Display empty placeholder
                                    const emptyDiv = document.createElement('div');
                                    emptyDiv.textContent = '空';
                                    emptyDiv.style.cssText = 'color: #999; font-style: italic; padding: 8px 0;';
                                    wrapper.appendChild(emptyDiv);
                                } else if (hasSignatureMarker || isMultiLineAssociation) {
                                    // Handle multi-line text with potential signature markers
                                    let htmlContent = questionValue;

                                    // Replace all signature markers with img tags
                                    const signatureRegex = /\[SIGNATURE:(https?:\/\/[^\]]+)\]/g;
                                    htmlContent = htmlContent.replace(signatureRegex, (match, url) => {
                                        return `<img src="${url}" class="signature-display" style="display: block; max-width: 200px; max-height: 100px;" alt="签名图片" />`;
                                    });

                                    // Convert newlines to br tags
                                    htmlContent = htmlContent.replace(/\n/g, '<br>');

                                    // Create content div
                                    const contentDiv = document.createElement('div');
                                    contentDiv.innerHTML = htmlContent;
                                    wrapper.appendChild(contentDiv);
                                } else {
                                    // Optimized signature image with React component
                                    const signatureContainer = document.createElement('div');
                                    wrapper.appendChild(signatureContainer);
                                    const root = createRoot(signatureContainer);
                                    root.render(
                                        <OptimizedSignatureImage
                                            src={questionValue}
                                            style={{ display: 'block', maxWidth: '200px', maxHeight: '100px' }}
                                        />
                                    );
                                }

                                // Clear and append wrapper
                                options.htmlElement.innerHTML = '';
                                options.htmlElement.appendChild(wrapper);
                            }

                            // Apply styling for html type questions (contract content) in Legacy mode
                            // DISABLED: This adds an unwanted border around HTML elements like section breaks
                            /*
                            if (options.question.getType() === "html") {
                                const container = options.htmlElement;

                                // Prevent double wrapping
                                if (container.querySelector('.custom-html-wrapper')) {
                                    return;
                                }

                                // Create a wrapper with consistent styling
                                const wrapper = document.createElement("div");
                                wrapper.className = "custom-html-wrapper";
                                wrapper.style.cssText = "background-color: #fff; padding: 12px; border: 1px solid #e6e6e6; border-radius: 4px; margin-top: 10px;";

                                // Move all children to the wrapper
                                while (container.firstChild) {
                                    wrapper.appendChild(container.firstChild);
                                }
                                container.appendChild(wrapper);
                            }
                            */
                        });
                    } else {
                        // --- NEW LOGIC FOR NATIVE SURVEYJS DATA (OR HYBRID) ---
                        // console.log("[DEBUG] Using Native/Hybrid Mapping");

                        // Add custom rendering for signatures in Native/Hybrid mode
                        survey.onAfterRenderQuestion.add((sender, options) => {
                            const question = options.question;
                            const name = question.name;

                            // Apply generic styling for all image questions (signatures)
                            if (question.getType() === "image") {
                                // Apply custom styling to the question container
                                const container = options.htmlElement;

                                // Prevent double wrapping
                                if (container.querySelector('.custom-signature-wrapper')) {
                                    return;
                                }

                                // Create a wrapper with the requested style
                                const wrapper = document.createElement("div");
                                wrapper.className = "custom-signature-wrapper";
                                wrapper.style.cssText = "background-color: #fff; padding: 12px; border: 1px solid #e6e6e6; border-radius: 4px; margin-top: 10px;";

                                // Create title element using the question's dynamic title
                                const titleDiv = document.createElement("div");
                                titleDiv.innerText = question.title || question.name;
                                titleDiv.style.cssText = "font-size: 14px; font-weight: bold; margin-bottom: 8px; color: #404040;";
                                wrapper.appendChild(titleDiv);

                                // Get fieldDef for notes
                                const questionName = question.name;
                                let fieldId = questionName.match(/^field_\d+$/) ? questionName : null;
                                let fieldDef = null;
                                if (fieldId && jinshujuSchema && jinshujuSchema.fields) {
                                    const fieldEntry = jinshujuSchema.fields.find(f => f[fieldId]);
                                    if (fieldEntry) fieldDef = fieldEntry[fieldId];
                                }

                                // Add notes if available
                                if (fieldDef && fieldDef.notes) {
                                    const notesDiv = document.createElement("div");
                                    notesDiv.innerHTML = fieldDef.notes;
                                    notesDiv.style.cssText = "font-size: 12px; color: #666; margin-bottom: 8px; padding: 6px 8px; background-color: #f9f9f9; border-left: 3px solid #ffa500; border-radius: 2px;";
                                    wrapper.appendChild(notesDiv);
                                }

                                // Check if signature value is empty
                                const questionValue = question.value;
                                const isEmptySignature = !questionValue || questionValue === '' || questionValue === '空';

                                if (isEmptySignature) {
                                    // Display empty placeholder
                                    const emptyDiv = document.createElement('div');
                                    emptyDiv.textContent = '空';
                                    emptyDiv.style.cssText = 'color: #999; font-style: italic; padding: 8px 0;';
                                    wrapper.appendChild(emptyDiv);
                                } else {
                                    // Move all children of the original container to the wrapper
                                    while (container.firstChild) {
                                        wrapper.appendChild(container.firstChild);
                                    }
                                }
                                container.appendChild(wrapper);
                            }

                            // Apply styling for html type questions (contract content)
                            if (question.getType() === "html") {
                                const container = options.htmlElement;

                                // Prevent double wrapping
                                if (container.querySelector('.custom-html-wrapper')) {
                                    return;
                                }

                                // Create a wrapper with consistent styling
                                const wrapper = document.createElement("div");
                                wrapper.className = "custom-html-wrapper";
                                wrapper.style.cssText = "background-color: #fff; padding: 12px; border: 1px solid #e6e6e6; border-radius: 4px; margin-top: 10px;";

                                // Move all children to the wrapper
                                while (container.firstChild) {
                                    wrapper.appendChild(container.firstChild);
                                }
                                container.appendChild(wrapper);
                            }
                        });

                        // 1. Build a mapping from Question Title -> Question Name
                        const titleToNameMap = {};
                        if (formSchema && formSchema.pages) {
                            formSchema.pages.forEach(page => {
                                if (page.elements) {
                                    page.elements.forEach(element => {
                                        // Map title to name. If title is missing, SurveyJS uses name as title.
                                        if (element.title) {
                                            titleToNameMap[element.title] = element.name;
                                        }
                                        titleToNameMap[element.name] = element.name;
                                    });
                                }
                            });
                        }

                        // 2. Normalize the data
                        displayData = {};
                        if (rawData) {
                            Object.keys(rawData).forEach(key => {
                                const mappedName = titleToNameMap[key];
                                const value = rawData[key];

                                // Handle empty values - show placeholder
                                const displayValue = (value === null || value === undefined || value === '') ? '空' : value;

                                if (mappedName) {
                                    displayData[mappedName] = displayValue;
                                } else {
                                    // If no mapping found, keep original key (fallback)
                                    displayData[key] = displayValue;
                                }
                            });
                        }
                    }
                    // --- DATA COMPATIBILITY LOGIC END ---

                    survey.data = displayData;

                    // --- NEW: Admin View Logic ---
                    // If we are viewing existing data (dataId present), we are likely in Admin View.
                    // We want to show hidden fields but make public fields read-only by default.

                    const allQuestions = survey.getAllQuestions();
                    const originalHiddenQuestions = [];

                    allQuestions.forEach(q => {
                        if (q.visible === false) {
                            originalHiddenQuestions.push(q.name);
                            q.visible = true; // Force visible
                        }
                    });

                    // Define a function to apply Admin View state
                    survey.applyAdminViewState = () => {
                        allQuestions.forEach(q => {
                            if (originalHiddenQuestions.includes(q.name)) {
                                q.readOnly = false; // Admin fields are editable
                            } else {
                                q.readOnly = true; // Public fields are read-only
                            }
                        });
                    };

                    // Define a function to apply Full Edit state
                    survey.applyFullEditState = () => {
                        allQuestions.forEach(q => {
                            q.readOnly = false; // All fields editable
                            q.visible = true;   // Show all fields including hidden ones
                        });
                    };

                    // Initial State: Full Edit (all fields editable)
                    // Initial State: Admin View (default for existing data)
                    survey.applyAdminViewState();
                    // survey.applyFullEditState(); // Commented out - default to admin view
                    survey.isAdminView = true; // Track state
                    initialMode = 'admin_view'; // We use 'admin_view' mode by default
                } else {
                    // --- AUTO-LOAD LOGIC ---
                    // Only auto-load for new submissions (no dataId)
                    const autoSaveKey = `survey-autosave-${formToken}`;
                    const savedData = localStorage.getItem(autoSaveKey);
                    if (savedData) {
                        try {
                            const parsedData = JSON.parse(savedData);
                            if (parsedData && Object.keys(parsedData).length > 0) {
                                survey.data = parsedData;
                                console.log(`🔄 自动加载本地暂存数据 (${formToken})`);
                            }
                        } catch (e) {
                            console.error('解析本地暂存数据失败:', e);
                        }
                    }
                }

                // --- AUTO-SAVE LOGIC ---
                // Listen for any value change to auto-save
                survey.onValueChanged.add((sender, options) => {
                    // Only auto-save for new submissions
                    if (dataId) return;

                    // Check if "姓名" (Name) is filled to trigger auto-save
                    // The name field is usually field_1, but we check common variations
                    const nameFieldNames = ['field_1', '姓名', 'name'];
                    const data = sender.data;
                    const hasName = nameFieldNames.some(name => {
                        const val = data[name];
                        return typeof val === 'string' && val.trim().length > 0;
                    }) || sender.getAllQuestions().some(q => {
                        // Also check question title for "姓名"
                        if (q.title && q.title.includes('姓名')) {
                            const val = data[q.name];
                            return typeof val === 'string' && val.trim().length > 0;
                        }
                        return false;
                    });

                    if (hasName) {
                        const autoSaveKey = `survey-autosave-${formToken}`;
                        localStorage.setItem(autoSaveKey, JSON.stringify(data));
                        // console.log(`💾 自动保存数据 (${formToken})`);
                    }
                });

                // 检查 URL 查询参数
                const queryParams = new URLSearchParams(location.search);

                // Set mode based on whether we have existing data or not
                if (dataId) {
                    setCurrentMode('admin_view');
                } else {
                    setCurrentMode('edit');
                }

                survey.mode = 'edit'; // SurveyJS mode is always 'edit' to allow admin edits

                // 3. 设置 onComplete 回调
                survey.onComplete.add(async (sender) => {
                    // 关键修复：在保存前，将统一URL恢复为原始URL
                    const formData = { ...sender.data };
                    const fileQuestions = sender.getAllQuestions().filter(q => q.getType() === 'file');
                    fileQuestions.forEach(q => {
                        const questionValue = formData[q.name];
                        if (Array.isArray(questionValue) && questionValue.length > 0) {
                            formData[q.name] = questionValue.map(file => {
                                if (file && file.content) {
                                    const originalUrl = extractOriginalUrl(file.content);
                                    if (originalUrl !== file.content) {
                                        console.log(`🔙 保存前恢复原始URL: ${file.content} -> ${originalUrl}`);
                                    }
                                    return { ...file, content: originalUrl };
                                }
                                return file;
                            });
                        }
                    });

                    setSubmissionState('submitting');

                    try {
                        let response;
                        if (dataId) {
                            // 更新数据
                            response = await api.patch(`/form-data/${dataId}`, { data: formData });
                        } else {
                            // 提交新数据
                            response = await api.post(`/form-data/submit/${formResponse.data.id}`, { data: formData });
                        }

                        // 准备结果数据
                        const backendScore = response.data?.score;
                        const questions = sender.getAllQuestions();
                        const isQuizLocal = questions.some(q => q.correctAnswer !== undefined);
                        const totalQuestions = sender.getQuizQuestionCount();

                        // 即使后端没有返回分数（例如 schema 缺少 correctAnswer），我们也尝试显示一个结果页
                        // 如果是 EXAM 类型，后端应该返回 score (可能是 0)

                        let finalScore = 0;
                        let correctAnswers = 0;

                        if (backendScore !== undefined) {
                            finalScore = backendScore;
                            correctAnswers = Math.round((finalScore / 100) * totalQuestions);
                        } else if (isQuizLocal) {
                            correctAnswers = sender.getCorrectedAnswerCount();
                            finalScore = totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 100) : 0;
                        }

                        // 只要是 EXAM 类型或者有分数，就显示结果页
                        const isExamType = formResponse.data.form_type === 'EXAM';

                        if (isExamType || backendScore !== undefined || isQuizLocal) {
                            // 考试类型：显示分数结果页面
                            setScoreResult({
                                score: finalScore,
                                correctAnswers: correctAnswers,
                                totalQuestions: totalQuestions,
                                incorrectAnswers: totalQuestions - correctAnswers
                            });
                            setSubmissionState('completed');
                            // Cleanup auto-save on successful completion
                            localStorage.removeItem(`survey-autosave-${formToken}`);
                        } else {
                            // 非考试类型：区分管理员编辑和访客提交
                            if (dataId) {
                                // 管理员编辑：显示提示并刷新页面，不设置 completed 状态
                                setAlert({
                                    open: true,
                                    message: '保存成功！',
                                    severity: 'success'
                                });
                                setTimeout(() => window.location.reload(), 100);
                            } else {
                                // 访客提交：设置 completed 状态，SurveyJS 会自动显示 completedHtml
                                setSubmissionState('completed');
                                // Cleanup auto-save on successful submission
                                localStorage.removeItem(`survey-autosave-${formToken}`);
                            }
                        }

                    } catch (err) {
                        console.error('提交表单失败:', err);
                        setAlert({
                            open: true,
                            message: `提交失败: ${err.response?.data?.message || err.message}`,
                            severity: 'error'
                        });
                        setSubmissionState('idle'); // 允许重试
                    }
                });

                // Universal HTML title rendering (for both new and existing forms)
                survey.onAfterRenderQuestion.add((sender, options) => {
                    // 1. Force title rendering for HTML questions if not present
                    if (options.question.getType() === 'html') {
                        // Check if title exists
                        const titleEl = options.htmlElement.querySelector('.sd-question__title') || options.htmlElement.querySelector('.sv-question__title');
                        if (!titleEl && options.question.title) {
                            const customTitle = document.createElement('h5');
                            customTitle.className = 'sd-question__title sd-element__title';
                            customTitle.style.cssText = 'margin: 0 0 10px 0; font-weight: bold; font-size: 16px; color: #404040;';
                            customTitle.innerText = options.question.title;

                            // Insert at the top
                            options.htmlElement.insertBefore(customTitle, options.htmlElement.firstChild);
                        }
                    }

                    // 2. 强制题目标题换行 - 使用 MutationObserver 持续监控
                    const forceWrapTitles = (container) => {
                        if (!container) return;

                        // 查找所有可能的标题元素
                        const selectors = [
                            '.sd-question__title',
                            '.sv-question__title',
                            '.sd-element__title',
                            '.sv-element__title',
                            '.sd-question__header',
                            '.sv-question__header',
                            'h5',
                            '.sd-question__title span', // 针对内部 span
                            '.sv-question__title span'
                        ];

                        selectors.forEach(selector => {
                            const elements = container.querySelectorAll(selector);
                            elements.forEach(el => {
                                // 跳过必填标记元素
                                if (el.classList.contains('sd-question__required-text') ||
                                    el.getAttribute('data-key') === 'req-text' ||
                                    el.getAttribute('data-key') === 'req-sp') {
                                    // 为必填标记设置 inline 显示
                                    el.style.setProperty('display', 'inline', 'important');
                                    el.style.setProperty('width', 'auto', 'important');
                                    return;
                                }

                                el.style.setProperty('white-space', 'normal', 'important');
                                el.style.setProperty('word-wrap', 'break-word', 'important');
                                el.style.setProperty('word-break', 'break-word', 'important');
                                el.style.setProperty('overflow-wrap', 'break-word', 'important');

                                // 标题容器使用 flex 布局
                                if (el.classList.contains('sd-question__title') ||
                                    el.classList.contains('sv-question__title') ||
                                    el.classList.contains('sd-element__title') ||
                                    el.classList.contains('sv-element__title')) {
                                    el.style.setProperty('max-width', '100%', 'important');
                                    el.style.setProperty('display', 'flex', 'important');
                                    el.style.setProperty('flex-wrap', 'wrap', 'important');
                                    el.style.setProperty('align-items', 'baseline', 'important');
                                }
                                // 标题内的文本 span 使用 inline 显示，不限制宽度
                                else if (el.classList.contains('sv-string-viewer') ||
                                    el.parentElement?.classList.contains('sd-question__title') ||
                                    el.parentElement?.classList.contains('sv-question__title')) {
                                    el.style.setProperty('display', 'inline', 'important');
                                    // 不设置 max-width，让文本和必填标记在同一行
                                }
                                // 其他元素使用 block
                                else {
                                    el.style.setProperty('max-width', '100%', 'important');
                                    el.style.setProperty('display', 'block', 'important');
                                }

                                el.style.setProperty('height', 'auto', 'important');
                            });
                        });
                    };

                    // 3. 规范必填标记，始终与题目文本同一行
                    const mergeTitleSpans = (container) => {
                        if (!container) return;

                        const titleSelectors = [
                            '.sd-question__title',
                            '.sv-question__title',
                            '.sd-element__title',
                            '.sv-element__title'
                        ];

                        titleSelectors.forEach(selector => {
                            const titles = container.querySelectorAll(selector);
                            titles.forEach(titleEl => {
                                if (titleEl.dataset.requiredNormalized === 'true') {
                                    return;
                                }

                                const requiredEls = Array.from(titleEl.querySelectorAll('.sd-question__required-text, [data-key="req-text"]'));
                                const spacerEls = Array.from(titleEl.querySelectorAll('[data-key="req-sp"]'));
                                spacerEls.forEach(el => el.remove());

                                if (requiredEls.length > 0) {
                                    const primaryReq = requiredEls.shift();
                                    requiredEls.forEach(el => el.remove());

                                    const textContainer = titleEl.querySelector('.sv-string-viewer, .sd-string-viewer, span[data-key="question-title"], span[data-name="title"]')
                                        || titleEl.querySelector('span:not(.private-field-icon):not(.sd-question__required-text)')
                                        || titleEl;

                                    // Ensure container can wrap text and star together
                                    textContainer.style.setProperty('display', 'inline', 'important');
                                    textContainer.style.setProperty('white-space', 'normal', 'important');
                                    textContainer.style.setProperty('word-break', 'break-word', 'important');

                                    primaryReq.textContent = '*';
                                    primaryReq.classList.add('sd-question__required-text');
                                    primaryReq.style.setProperty('color', 'hsl(0 84.2% 60.2%)', 'important');
                                    primaryReq.style.setProperty('display', 'inline', 'important');
                                    primaryReq.style.setProperty('width', 'auto', 'important');
                                    primaryReq.style.setProperty('margin-left', '0.25rem', 'important');

                                    primaryReq.remove();
                                    textContainer.appendChild(primaryReq);
                                }

                                titleEl.dataset.requiredNormalized = 'true';
                            });
                        });
                    };

                    // 立即执行一次
                    forceWrapTitles(options.htmlElement);
                    mergeTitleSpans(options.htmlElement);

                    // 设置 MutationObserver 持续监控
                    const observer = new MutationObserver(() => {
                        forceWrapTitles(options.htmlElement);
                        mergeTitleSpans(options.htmlElement);
                    });

                    observer.observe(options.htmlElement, {
                        attributes: true,
                        attributeFilter: ['style', 'class'],
                        subtree: true
                    });
                });

                // 4. Handle File Uploads to R2
                survey.onUploadFiles.add(async (sender, options) => {
                    const files = options.files;
                    const uploadResults = [];

                    try {
                        for (const file of files) {
                            const formData = new FormData();
                            formData.append('file', file);

                            const response = await api.post('/upload/r2', formData, {
                                headers: {
                                    'Content-Type': 'multipart/form-data'
                                }
                            });

                            uploadResults.push({
                                file: file,
                                content: response.data.url
                            });
                        }

                        options.callback("success", uploadResults);
                    } catch (error) {
                        console.error("Upload failed:", error);
                        options.callback("error", "Upload failed: " + (error.response?.data?.error || error.message));
                    }
                });

                // --- AUTO-FILL LOGIC FOR EXIT SUMMARY FORM (wWVDjd) ---
                if (formToken === 'wWVDjd') {
                    let debounceTimer;
                    survey.onValueChanged.add((sender, options) => {
                        const q = options.question;
                        // Identify the "Name" field (field_1)
                        const isNameField = q.name === 'field_1' || q.name === '姓名' || q.title === '姓名';

                        if (isNameField) {
                            const employeeName = options.value;

                            if (debounceTimer) clearTimeout(debounceTimer);

                            if (!employeeName || typeof employeeName !== 'string' || employeeName.trim().length < 2) {
                                return;
                            }

                            debounceTimer = setTimeout(async () => {
                                try {
                                    // console.log(`[AutoFill] Fetching contract for: ${employeeName}`);
                                    const res = await api.get(`/staff/employees/by-name/${encodeURIComponent(employeeName.trim())}/latest-contract`);
                                    const { auto_fill_data, contract } = res.data;

                                    if (auto_fill_data) {
                                        // Helper to find question by possible names/titles
                                        const findQ = (candidates) => {
                                            return survey.getAllQuestions().find(q => candidates.includes(q.name) || candidates.includes(q.title));
                                        };

                                        // Field 2: Customer Name
                                        const qCustomer = findQ(['field_2', '服务的客户姓名']);
                                        if (qCustomer) {
                                            qCustomer.value = auto_fill_data.field_2;
                                        }

                                        // Field 3: Date Range
                                        const qDate = findQ(['field_3', '写清楚上户和下户的时间？（上户年月日～下户年月日）']);
                                        if (qDate) {
                                            qDate.value = auto_fill_data.field_3;
                                        }

                                        // Field 14: Position
                                        const qPosition = findQ(['field_14', '在户上的职位是什么？']);
                                        if (qPosition) {
                                            // Try to match choice text
                                            const textToFind = auto_fill_data.field_14;
                                            const matchedChoice = qPosition.choices.find(c => c.text === textToFind || c.value === textToFind);
                                            if (matchedChoice) {
                                                qPosition.value = matchedChoice.value;
                                            }
                                        }

                                        // Show contract info in Name field description
                                        const contractInfo = `✅ 已自动匹配最新合同:\n类型: ${contract.type_display}${contract.is_monthly_auto_renew ? ' (月签)' : ''}\n客户: ${contract.customer_name}\n日期: ${contract.formatted_date_range}`;
                                        q.description = contractInfo;

                                        // Show success message (optional)
                                        // console.log(`[AutoFill] Successfully filled form for contract: ${contract.id}`);
                                    }
                                } catch (err) {
                                    // console.warn("[AutoFill] Failed to fetch contract:", err);
                                    // Silent fail is better for UX here
                                }
                            }, 500); // 500ms debounce
                        }
                    });
                }

                setSurveyModel(survey);

                console.log('🚀 表单加载完成，三阶段图片加载系统已启动');
            }
            catch (err) {
                console.error('加载表单失败:', err);
                setError(err.response?.data?.message || err.message);
            }
            finally {
                setLoading(false);
            }
        };
        fetchForm();
    }, [formToken, dataId, location.search]);

    // 切换模式的函数
    const toggleMode = () => {
        // console.log('[toggleMode] ===== TOGGLE MODE CALLED =====');
        // console.log('[toggleMode] Current surveyModel:', surveyModel);

        if (!surveyModel) {
            // console.log('[toggleMode] ⚠️ No surveyModel, returning');
            return;
        }

        // console.log('[toggleMode] Current isAdminView:', surveyModel.isAdminView);
        // console.log('[toggleMode] Current currentMode:', currentMode);

        // 保存当前数据，防止切换时数据丢失
        const currentData = { ...surveyModel.data };
        // console.log('[toggleMode] Saved current data');

        // If we are in "Admin View" (some readOnly, some not), switch to "Full Edit" (all not readOnly).
        // If we are in "Full Edit", switch back to "Admin View".

        if (surveyModel.isAdminView) {
            // console.log('[toggleMode] Switching from Admin View to Full Edit');

            // 关键修复：在切换到编辑模式前，将文件问题的URL替换为统一URL
            // 这样 SurveyJS 渲染时会使用已缓存的图片
            const fileQuestions = surveyModel.getAllQuestions().filter(q => q.getType() === 'file');
            fileQuestions.forEach(q => {
                q.allowImagesPreview = true; // 启用图片预览
                const questionValue = currentData[q.name];
                if (Array.isArray(questionValue) && questionValue.length > 0) {
                    currentData[q.name] = questionValue.map(file => {
                        if (file && file.content) {
                            const unifiedUrl = getUnifiedImageUrl(file.content);
                            console.log(`🔄 toggleMode: 替换图片URL为统一URL: ${file.content} -> ${unifiedUrl}`);
                            return { ...file, content: unifiedUrl };
                        }
                        return file;
                    });
                }
            });

            surveyModel.applyFullEditState();
            surveyModel.isAdminView = false;
            setCurrentMode('full_edit'); // Custom mode name for UI
            // console.log('[toggleMode] ✓ Switched to full_edit mode');
        } else {
            // console.log('[toggleMode] Switching from Full Edit to Admin View');

            // 切换回查看模式时，禁用图片预览
            const fileQuestions = surveyModel.getAllQuestions().filter(q => q.getType() === 'file');
            fileQuestions.forEach(q => {
                q.allowImagesPreview = false;
            });

            surveyModel.applyAdminViewState();
            surveyModel.isAdminView = true;
            setCurrentMode('admin_view'); // Custom mode name for UI
            // console.log('[toggleMode] ✓ Switched to admin_view mode');
        }

        // 恢复数据（以防万一）- 现在数据中的图片URL已经是统一URL了
        setTimeout(() => {
            surveyModel.data = currentData;
        }, 100);

        // Note: 实际的重新渲染在 useEffect 中处理,等待 currentMode 状态更新后执行
        // console.log('[toggleMode] ===== TOGGLE MODE END =====');
    };

    // 删除记录的函数
    const handleDeleteRecord = async () => {
        try {
            await api.delete(`/form-data/${dataId}`);
            setAlert({
                open: true,
                message: '记录删除成功！',
                severity: 'success'
            });
            // 延迟跳转到表单数据列表页面
            setTimeout(() => {
                navigate(`/forms/${formToken}/data`);
            }, 1500);
        } catch (err) {
            console.error('删除记录失败:', err);
            setAlert({
                open: true,
                message: `删除失败: ${err.response?.data?.message || err.message}`,
                severity: 'error'
            });
        }
        setDeleteDialogOpen(false);
    };

    // 监听 currentMode 变化,在模式切换后重新渲染文件问题
    useEffect(() => {
        if (!surveyModel || !dataId) return; // 只在查看已有数据时才需要切换模式

        // console.log('[useEffect currentMode] ===== MODE CHANGE DETECTED =====');
        // console.log('[useEffect currentMode] New mode:', currentMode);

        const fileQuestions = surveyModel.getAllQuestions().filter(q => q.getType() === 'file');
        // console.log('[useEffect currentMode] File questions to process:', fileQuestions.length);

        fileQuestions.forEach(q => {
            const questionRoot = document.querySelector(`[data-name="${q.name}"]`);
            if (!questionRoot) {
                // console.log('[useEffect currentMode] ⚠️ Question root not found for:', q.name);
                return;
            }

            // console.log('[useEffect currentMode] Processing question:', q.name);

            // 找到自定义渲染和原生文件控件
            const customRoot = questionRoot.querySelector('.custom-file-carousel-root');
            const nativeFileControl = questionRoot.querySelector('.sd-file');

            if (currentMode === 'full_edit') {
                // 编辑模式：显示原生控件，隐藏自定义轮播（不删除，避免重新加载）
                // console.log('[useEffect currentMode] → Switching to EDIT mode for:', q.name);

                // 关键修复：启用 SurveyJS 图片预览，并将图片URL替换为已缓存的统一URL
                // 这样 SurveyJS 会使用浏览器缓存而不是重新下载原图
                q.allowImagesPreview = true;

                const questionValue = q.value;
                if (Array.isArray(questionValue) && questionValue.length > 0) {
                    const optimizedValue = questionValue.map(file => {
                        if (file && file.content) {
                            const unifiedUrl = getUnifiedImageUrl(file.content);
                            console.log(`🔄 编辑模式：替换图片URL为统一URL: ${file.content} -> ${unifiedUrl}`);
                            return {
                                ...file,
                                content: unifiedUrl
                            };
                        }
                        return file;
                    });
                    // 临时更新值以使用缓存的URL
                    q.value = optimizedValue;
                }

                if (nativeFileControl) {
                    nativeFileControl.style.display = 'block';
                    // console.log('[useEffect currentMode] ✓ Showed native control');
                }

                // 隐藏自定义轮播而不是删除它，避免图片重新加载
                if (customRoot) {
                    customRoot.style.display = 'none';
                    // console.log('[useEffect currentMode] ✓ Hidden custom carousel');
                }

            } else {
                // 非完全编辑模式：显示自定义轮播，可能同时显示原生控件
                // console.log('[useEffect currentMode] → Switching to VIEW/EDIT mode for:', q.name);

                // 关键：禁用 SurveyJS 图片预览，使用自定义轮播组件
                q.allowImagesPreview = false;

                // 自定义轮播始终显示
                if (customRoot) {
                    customRoot.style.display = 'block';
                    // console.log('[useEffect currentMode] ✓ Showed existing custom carousel');
                } else {
                    // 手动触发 onAfterRenderQuestion 来创建自定义轮播
                    setTimeout(() => {
                        surveyModel.onAfterRenderQuestion.fire(surveyModel, {
                            question: q,
                            htmlElement: questionRoot
                        });
                        // console.log('[useEffect currentMode] ✓ Fired onAfterRenderQuestion for custom rendering');
                    }, 10);
                }

                // 在查看模式下隐藏原生控件，在编辑模式下可能显示
                if (nativeFileControl) {
                    if (currentMode === 'admin_view') {
                        nativeFileControl.style.display = 'none';
                    } else {
                        // 在普通编辑模式下，可以选择显示或隐藏原生控件
                        nativeFileControl.style.display = 'none'; // 暂时隐藏，专注于轮播组件
                    }
                    // console.log('[useEffect currentMode] ✓ Updated native control visibility');
                }
            }
        });

        // console.log('[useEffect currentMode] ===== MODE CHANGE COMPLETE =====');
    }, [currentMode, surveyModel, dataId]);

    // Score Display Component
    const ScoreDisplay = ({ result }) => {
        if (!result) return null;

        const { score, correctAnswers, totalQuestions, incorrectAnswers } = result;

        let scoreColor = "#f59e0b"; // 默认橙色
        let message = "继续加油，下次一定能通过！";

        if (score >= 90) {
            scoreColor = "#10b981"; // 绿色
            message = "太棒了！成绩优秀！";
        } else if (score >= 60) {
            scoreColor = "#3b82f6"; // 蓝色
            message = "恭喜通过考试！";
        }

        return (
            <Box sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                p: 4,
                bgcolor: 'white',
                borderRadius: 2,
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                maxWidth: 500,
                mx: 'auto',
                mt: 4,
                textAlign: 'center'
            }}>
                <Box sx={{ mb: 2 }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 24 24" fill="none" stroke={scoreColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                    </svg>
                </Box>

                <Typography variant="h5" sx={{ fontWeight: 700, color: '#111827', mb: 1 }}>
                    {message}
                </Typography>

                <Box sx={{ my: 3 }}>
                    <Typography variant="h1" sx={{ fontWeight: 800, color: scoreColor, fontSize: '4rem', display: 'flex', alignItems: 'baseline', justifyContent: 'center' }}>
                        {score}<Typography component="span" sx={{ fontSize: '1.5rem', color: '#6b7280', ml: 1 }}>分</Typography>
                    </Typography>
                </Box>

                <Box sx={{ display: 'flex', gap: 3, mb: 4, color: '#6b7280' }}>
                    <Typography variant="body1" sx={{ fontWeight: 500 }}>
                        <span style={{ color: '#10b981', marginRight: 4 }}>✓</span>
                        正确: {correctAnswers}
                    </Typography>
                    <Typography variant="body1" sx={{ fontWeight: 500 }}>
                        <span style={{ color: '#ef4444', marginRight: 4 }}>✗</span>
                        错误: {incorrectAnswers}
                    </Typography>
                </Box>

                <Button
                    variant="contained"
                    onClick={() => window.location.reload()}
                    sx={{
                        bgcolor: scoreColor,
                        '&:hover': { bgcolor: scoreColor },
                        px: 4,
                        py: 1.5,
                        borderRadius: 2,
                        fontSize: '1rem',
                        fontWeight: 600
                    }}
                >
                    再次挑战
                </Button>
            </Box>
        );
    };

    if (loading) {
        return <Container sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}><CircularProgress /></Container>;
    }

    if (error) {
        return <Container sx={{ mt: 4 }}><Alert severity="error">加载表单失败: {error}</Alert></Container>;
    }

    if (!surveyModel) {
        return <Container sx={{ mt: 4 }}><Alert severity="warning">无法加载表单模型。</Alert></Container>;
    }

    // Render Score Result if completed
    if (submissionState === 'completed' && scoreResult) {
        return (
            <Box sx={{ bgcolor: '#f3f4f6', minHeight: '100vh', py: 4 }}>
                <Container maxWidth="md">
                    <ScoreDisplay result={scoreResult} />
                </Container>
            </Box>
        );
    }

    // Render Loading during submission (only for visitor submissions, not admin edits)
    if (submissionState === 'submitting' && !dataId) {
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', bgcolor: '#f3f4f6' }}>
                <CircularProgress size={60} thickness={4} sx={{ mb: 2 }} />
                <Typography variant="h6" color="text.secondary">正在提交并计算分数...</Typography>
            </Box>
        );
    }

    return (
        <>


            {/* 固定顶部操作栏 - 仅在管理员查看/编辑模式下显示 */}
            {surveyModel && submissionState !== 'completed' && dataId && (
                <Box
                    sx={{
                        position: 'fixed',
                        top: 0,
                        left: { xs: 0, md: 240 }, // 移动端从0开始，桌面端避开左侧导航栏
                        right: 0,
                        backgroundColor: 'white',
                        borderBottom: '1px solid #e5e7eb',
                        boxShadow: '0 2px 4px -1px rgba(0, 0, 0, 0.1)',
                        zIndex: 1100,
                        padding: { xs: '8px 12px', md: '12px 24px' },
                        display: 'flex',
                        flexDirection: { xs: 'column', md: 'row' },
                        justifyContent: 'space-between',
                        alignItems: { xs: 'stretch', md: 'center' },
                        gap: { xs: 2, md: 3 }
                    }}
                >
                    {/* 面包屑导航 */}
                    <Breadcrumbs
                        separator={<NavigateNextIcon fontSize="small" />}
                        aria-label="breadcrumb"
                        sx={{
                            fontSize: '0.875rem',
                            '& .MuiBreadcrumbs-separator': {
                                marginLeft: 1,
                                marginRight: 1
                            }
                        }}
                    >
                        <Link
                            underline="hover"
                            sx={{
                                cursor: 'pointer',
                                color: 'text.secondary',
                                fontSize: '0.875rem',
                                '&:hover': {
                                    color: 'primary.main',
                                }
                            }}
                            onClick={() => window.location.href = '/forms'}
                        >
                            全部表单
                        </Link>
                        {dataId && (
                            <Link
                                underline="hover"
                                sx={{
                                    cursor: 'pointer',
                                    color: 'text.secondary',
                                    fontSize: '0.875rem',
                                    '&:hover': {
                                        color: 'primary.main',
                                    }
                                }}
                                onClick={() => window.location.href = `/forms/${formToken}/data`}
                            >
                                {surveyModel?.title || '表单'}
                            </Link>
                        )}
                        <Typography color="text.primary" sx={{ fontSize: '0.875rem' }}>
                            {dataId ? '查看详情' : (surveyModel?.title || '表单详情')}
                        </Typography>
                    </Breadcrumbs>

                    {/* 操作按钮组 */}
                    <Box sx={{
                        display: 'flex',
                        gap: { xs: 1, md: 2 },
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        justifyContent: { xs: 'center', md: 'flex-end' }
                    }}>
                        {/* 创建员工信息按钮（仅 N0Il9H 表单显示） */}
                        {formToken === 'N0Il9H' && dataId && (
                            <Button
                                variant="contained"
                                color="secondary"
                                size="small"
                                onClick={async () => {
                                    if (!window.confirm('确定要根据当前表单数据创建/更新员工信息吗？')) return;
                                    try {
                                        const res = await api.post(`/staff/create-from-form/${dataId}`);
                                        setAlert({
                                            open: true,
                                            message: res.data.message,
                                            severity: 'success'
                                        });
                                    } catch (err) {
                                        console.error(err);
                                        setAlert({
                                            open: true,
                                            message: '操作失败: ' + (err.response?.data?.message || err.message),
                                            severity: 'error'
                                        });
                                    }
                                }}
                                sx={{
                                    backgroundColor: 'secondary.main',
                                    color: 'white',
                                    '&:hover': {
                                        backgroundColor: 'secondary.dark'
                                    }
                                }}
                            >
                                创建员工信息
                            </Button>
                        )}

                        {/* 模式切换按钮（仅在查看已有数据时显示） */}
                        {dataId && (
                            <Button
                                variant="contained"
                                size="small"
                                onClick={toggleMode}
                                sx={{
                                    backgroundColor: 'primary.main',
                                    color: 'white',
                                    px: 3,
                                    '&:hover': {
                                        backgroundColor: 'primary.dark'
                                    },
                                    '&:disabled': {
                                        backgroundColor: '#9ca3af'
                                    }
                                }}
                            >
                                切换到 {currentMode === 'admin_view' ? '编辑模式' : '查看模式'}
                            </Button>
                        )}

                        {/* 提交按钮 */}
                        <Button
                            variant="contained"
                            size="small"
                            onClick={() => {
                                // 触发 SurveyJS 的提交
                                if (surveyModel) {
                                    surveyModel.completeLastPage();
                                }
                            }}
                            disabled={submissionState === 'submitting'}
                            sx={{
                                backgroundColor: 'primary.main',
                                color: 'white',
                                px: 3,
                                '&:hover': {
                                    backgroundColor: 'primary.dark'
                                },
                                '&:disabled': {
                                    backgroundColor: '#9ca3af'
                                }
                            }}
                        >
                            {submissionState === 'submitting' ? '提交中...' : (dataId ? '保存提交' : '提交表单')}
                        </Button>
                    </Box>
                </Box>
            )}

            <Container maxWidth="lg" sx={{
                mt: (surveyModel && submissionState !== 'completed' && dataId) ? { xs: 12, md: 10 } : 2,
                mb: 4
            }}>
                <AlertMessage
                    open={alert.open}
                    message={alert.message}
                    severity={alert.severity}
                    onClose={() => setAlert({ ...alert, open: false })}
                />
                {loading && <CircularProgress />}
                {error && <Alert severity="error">{error}</Alert>}
                {!loading && !error && surveyModel && (
                    <>
                        {submissionState === 'completed' && scoreResult ? (
                            <ScoreDisplay result={scoreResult} />
                        ) : (
                            <>
                                <Survey model={surveyModel} />

                                {/* 底部危险操作区域 - 仅在查看已有数据时显示 */}
                                {dataId && (
                                    <Box
                                        sx={{
                                            mt: 6,
                                            pt: 4,
                                            borderTop: '1px solid #e5e7eb',
                                            display: 'flex',
                                            justifyContent: 'center',
                                            backgroundColor: '#fafafa',
                                            borderRadius: 2,
                                            p: 3
                                        }}
                                    >
                                        <Box sx={{ textAlign: 'center' }}>
                                            <Typography
                                                variant="body2"
                                                color="text.secondary"
                                                sx={{ mb: 2, fontSize: '0.875rem' }}
                                            >
                                                危险操作区域
                                            </Typography>
                                            <Button
                                                variant="outlined"
                                                color="error"
                                                size="medium"
                                                startIcon={<DeleteIcon />}
                                                onClick={() => setDeleteDialogOpen(true)}
                                                sx={{
                                                    borderColor: 'error.main',
                                                    color: 'error.main',
                                                    px: 4,
                                                    '&:hover': {
                                                        borderColor: 'error.dark',
                                                        backgroundColor: 'error.light',
                                                        color: 'error.dark'
                                                    }
                                                }}
                                            >
                                                删除此记录
                                            </Button>
                                            <Typography
                                                variant="caption"
                                                color="text.disabled"
                                                sx={{
                                                    display: 'block',
                                                    mt: 1,
                                                    fontSize: '0.75rem',
                                                    fontStyle: 'italic'
                                                }}
                                            >
                                                此操作不可撤销，请谨慎操作
                                            </Typography>
                                        </Box>
                                    </Box>
                                )}
                            </>
                        )}
                    </>
                )}
            </Container>

            <style>{`
                /* 隐藏表单描述,减少顶部空白 */
                .sd-description,
                .sv-description {
                    display: none !important;
                }

                /* 为固定顶部操作栏预留空间 */
                body .sd-root-modern {
                    padding-top: 20px !important;
                }

                /* ===== 移动端强制优化 (最高优先级) ===== */
                @media (max-width: 768px) {
                    /* 强制减少顶部空白 */
                    body .sd-root-modern .sd-container-modern {
                        margin: 0.25rem auto !important;
                    }
                    
                    /* 强制减少标题区域 padding */
                    body .sd-root-modern .sd-container-modern__title {
                        padding: 1rem 0.75rem !important;
                    }
                    
                    /* 强制减少表单主体 padding */
                    body .sd-root-modern .sd-body {
                        padding: 0.75rem 0.5rem !important;
                    }
                    
                    /* 强制减少页面 padding */
                    body .sd-root-modern .sd-page {
                        padding: 0.25rem !important;
                    }
                    
                    /* 强制题目标题换行 - 核武器级 CSS */
                    body .sd-root-modern .sd-question__title,
                    body .sd-root-modern .sd-question__title *,
                    body .sd-root-modern .sv-question__title,
                    body .sd-root-modern .sv-question__title *,
                    body .sd-root-modern .sd-question__header,
                    body .sd-root-modern .sd-question__header *,
                    body .sd-root-modern h5,
                    body .sd-root-modern h5 * {
                        white-space: normal !important;
                        word-wrap: break-word !important;
                        word-break: break-word !important;
                        overflow-wrap: break-word !important;
                        overflow: visible !important;
                        text-overflow: clip !important;
                        height: auto !important;
                        width: auto !important;
                        max-width: 100% !important;
                        display: block !important;
                    }
                    
                    /* 必填标记例外：保持 inline 显示 */
                    body .sd-root-modern .sd-question__required-text,
                    body .sd-root-modern span[data-key="req-text"],
                    body .sd-root-modern span[data-key="req-sp"] {
                        display: inline !important;
                        width: auto !important;
                    }
                    
                    /* 强制题目容器边距 */
                    body .sd-root-modern .sd-question,
                    body .sd-root-modern .sv-question {
                        padding-left: 10px !important;
                        padding-right: 10px !important;
                        padding-top: 10px !important;
                    }
                    
                    /* 强制选项文字换行 */
                    body .sd-root-modern .sd-item__control-label,
                    body .sd-root-modern .sv-item__control-label,
                    body .sd-root-modern .sd-selectbase__label,
                    body .sd-root-modern .sv-selectbase__label {
                        white-space: normal !important;
                        word-wrap: break-word !important;
                        overflow-wrap: break-word !important;
                    }
                    
                    /* Container 优化 */
                    .MuiContainer-root {
                        padding-left: 8px !important;
                        padding-right: 8px !important;
                    }

                    /* 移动端头部按钮调整 */
                    .custom-header-buttons {
                        top: 1rem !important;
                        right: 0.5rem !important;
                        transform: none !important;
                    }
                }
            `}</style>

            {/* Lightbox Modal for Image Viewing */}
            <Modal
                open={lightboxOpen}
                onClose={() => setLightboxOpen(false)}
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
                onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft') {
                        setCurrentImageIndex((prev) => (prev > 0 ? prev - 1 : lightboxImages.length - 1));
                    } else if (e.key === 'ArrowRight') {
                        setCurrentImageIndex((prev) => (prev < lightboxImages.length - 1 ? prev + 1 : 0));
                    } else if (e.key === 'Escape') {
                        setLightboxOpen(false);
                    }
                }}
            >
                <Box
                    sx={{
                        position: 'relative',
                        outline: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Download Button */}
                    <IconButton
                        onClick={async () => {
                            // 第三阶段：下载原图
                            const originalImageUrl = lightboxImages[currentImageIndex]?.originalUrl;
                            const originalUrl = getOriginalUrl(originalImageUrl);
                            const filename = originalUrl.split('/').pop()?.split('?')[0] || `image-${currentImageIndex + 1}.jpg`;

                            console.log(`📥 第三阶段：从 Lightbox 下载原图: ${originalUrl}`);

                            try {
                                const response = await fetch(originalUrl, {
                                    mode: 'cors',
                                    credentials: 'same-origin',
                                });

                                if (!response.ok) {
                                    throw new Error(`Network response was not ok: ${response.status}`);
                                }

                                const originalBlob = await response.blob();
                                const blob = new Blob([originalBlob], { type: 'application/octet-stream' });

                                const url = window.URL.createObjectURL(blob);
                                const link = document.createElement('a');
                                link.href = url;
                                link.download = filename;
                                link.style.display = 'none';

                                document.body.appendChild(link);
                                link.click();

                                setTimeout(() => {
                                    document.body.removeChild(link);
                                    window.URL.revokeObjectURL(url);
                                }, 100);
                            } catch (error) {
                                console.warn('原图下载失败，使用直接链接:', error);
                                const link = document.createElement('a');
                                link.href = originalUrl;
                                link.download = filename;
                                link.target = '_blank';
                                link.rel = 'noopener noreferrer';
                                link.style.display = 'none';

                                document.body.appendChild(link);
                                link.click();

                                setTimeout(() => {
                                    document.body.removeChild(link);
                                }, 100);
                            }
                        }}
                        sx={{
                            position: 'fixed',
                            top: 20,
                            right: 70,
                            color: 'white',
                            backgroundColor: 'rgba(0, 0, 0, 0.6)',
                            zIndex: 1301,
                            '&:hover': {
                                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                            },
                        }}
                    >
                        <DownloadIcon />
                    </IconButton>

                    {/* Close Button */}
                    <IconButton
                        onClick={() => setLightboxOpen(false)}
                        sx={{
                            position: 'fixed',
                            top: 20,
                            right: 20,
                            color: 'white',
                            backgroundColor: 'rgba(0, 0, 0, 0.6)',
                            zIndex: 1301,
                            '&:hover': {
                                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                            },
                        }}
                    >
                        <CloseIcon />
                    </IconButton>

                    {/* Previous Button */}
                    {lightboxImages.length > 1 && (
                        <IconButton
                            onClick={() => setCurrentImageIndex((prev) => (prev > 0 ? prev - 1 : lightboxImages.length - 1))}
                            sx={{
                                position: 'fixed',
                                left: 20,
                                top: '50%',
                                transform: 'translateY(-50%)',
                                color: 'white',
                                backgroundColor: 'rgba(0, 0, 0, 0.6)',
                                zIndex: 1301,
                                '&:hover': {
                                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                                },
                            }}
                        >
                            <ChevronLeftIcon fontSize="large" />
                        </IconButton>
                    )}

                    {/* Image Container with Cache Optimization */}
                    <Box
                        sx={{
                            position: 'relative',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            maxWidth: '90vw',
                            maxHeight: '90vh',
                            width: 'auto',
                            height: 'auto',
                        }}
                    >
                        <CachedLightboxImage
                            src={lightboxImages[currentImageIndex]?.lightboxUrl}
                            originalUrl={lightboxImages[currentImageIndex]?.originalUrl}
                            alt={`Image ${currentImageIndex + 1}`}
                            style={{
                                maxWidth: '100%',
                                maxHeight: '100%',
                                width: 'auto',
                                height: 'auto',
                                display: 'block',
                                borderRadius: '8px',
                                backgroundColor: 'white',
                                boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                                objectFit: 'contain',
                            }}
                        />

                        {/* Quality Indicator */}
                        <Box
                            sx={{
                                position: 'absolute',
                                bottom: 10,
                                left: 10,
                                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                                color: 'white',
                                padding: '4px 8px',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontWeight: 500,
                            }}
                        >
                            当前不是原图，因此可能不清晰。
                        </Box>
                    </Box>

                    {/* Next Button */}
                    {lightboxImages.length > 1 && (
                        <IconButton
                            onClick={() => setCurrentImageIndex((prev) => (prev < lightboxImages.length - 1 ? prev + 1 : 0))}
                            sx={{
                                position: 'fixed',
                                right: 20,
                                top: '50%',
                                transform: 'translateY(-50%)',
                                color: 'white',
                                backgroundColor: 'rgba(0, 0, 0, 0.6)',
                                zIndex: 1301,
                                '&:hover': {
                                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                                },
                            }}
                        >
                            <ChevronRightIcon fontSize="large" />
                        </IconButton>
                    )}

                    {/* Image Counter - Fixed at bottom */}
                    {lightboxImages.length > 1 && (
                        <Box
                            sx={{
                                position: 'fixed',
                                bottom: 30,
                                left: '50%',
                                transform: 'translateX(-50%)',
                                color: 'white',
                                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                                padding: '10px 20px',
                                borderRadius: '25px',
                                fontSize: '1rem',
                                fontWeight: 500,
                                zIndex: 1301,
                                minWidth: '80px',
                                textAlign: 'center',
                                backdropFilter: 'blur(10px)',
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                            }}
                        >
                            {currentImageIndex + 1} / {lightboxImages.length}
                        </Box>
                    )}
                </Box>
            </Modal>

            {/* 删除确认对话框 */}
            <Dialog
                open={deleteDialogOpen}
                onClose={() => setDeleteDialogOpen(false)}
                aria-labelledby="delete-dialog-title"
                aria-describedby="delete-dialog-description"
            >
                <DialogTitle id="delete-dialog-title">
                    确认删除记录
                </DialogTitle>
                <DialogContent>
                    <DialogContentText id="delete-dialog-description">
                        您确定要删除这条记录吗？此操作不可撤销，删除后将无法恢复数据。
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={() => setDeleteDialogOpen(false)}
                        color="primary"
                    >
                        取消
                    </Button>
                    <Button
                        onClick={handleDeleteRecord}
                        color="error"
                        variant="contained"
                        autoFocus
                    >
                        确认删除
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
};

export default DynamicFormPage;
