import React, { useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, RotateCcw, Check } from 'lucide-react';
import { cn } from '../../utils';

/**
 * 全屏横屏签名组件
 */
const FullscreenSignaturePad = ({
    value,
    onChange,
    disabled = false,
    placeholder = '点击此处签名',
    className
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [signatureImage, setSignatureImage] = useState(value || null);

    useEffect(() => {
        setSignatureImage(value || null);
    }, [value]);

    const openSignaturePad = useCallback(() => {
        if (disabled) return;
        setIsOpen(true);
    }, [disabled]);

    const clearSavedSignature = useCallback((e) => {
        e.stopPropagation();
        setSignatureImage(null);
        onChange?.(null);
    }, [onChange]);

    const handleSignatureComplete = useCallback((dataUrl) => {
        if (dataUrl) {
            setSignatureImage(dataUrl);
            onChange?.(dataUrl);
        }
        setIsOpen(false);
    }, [onChange]);

    const handleCancel = useCallback(() => {
        setIsOpen(false);
    }, []);

    return (
        <>
            <div
                onClick={openSignaturePad}
                className={cn(
                    "w-full min-h-[120px] border rounded-md bg-gray-50 flex items-center justify-center cursor-pointer transition-colors",
                    disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-gray-100 hover:border-gray-400",
                    className
                )}
            >
                {signatureImage ? (
                    <div className="relative w-full h-full min-h-[120px]">
                        <img src={signatureImage} alt="签名" className="w-full h-full object-contain" />
                        {!disabled && (
                            <button onClick={clearSavedSignature} className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 z-10">
                                <X className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="text-gray-400 flex flex-col items-center gap-2">
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                        <span className="text-sm">{placeholder}</span>
                    </div>
                )}
            </div>

            {isOpen && createPortal(
                <LandscapeSignatureModal onConfirm={handleSignatureComplete} onCancel={handleCancel} />,
                document.body
            )}
        </>
    );
};

/**
 * 横屏签名模态框
 */
const LandscapeSignatureModal = ({ onConfirm, onCancel }) => {
    const canvasRef = useRef(null);
    const ctxRef = useRef(null);
    const isDrawingRef = useRef(false);
    const [ready, setReady] = useState(false);
    
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const isPortrait = screenH > screenW;
    
    // 横屏后的实际尺寸
    const width = isPortrait ? screenH : screenW;
    const height = isPortrait ? screenW : screenH;
    const toolbarH = 56;
    const canvasH = height - toolbarH;

    useEffect(() => {
        // 保存当前滚动位置
        const scrollY = window.scrollY;
        const scrollX = window.scrollX;
        
        document.body.style.overflow = 'hidden';
        document.body.style.position = 'fixed';
        document.body.style.width = '100%';
        document.body.style.top = `-${scrollY}px`;
        
        return () => {
            document.body.style.overflow = '';
            document.body.style.position = '';
            document.body.style.width = '';
            document.body.style.top = '';
            // 恢复滚动位置
            window.scrollTo(scrollX, scrollY);
        };
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            
            // 直接设置 canvas 的像素尺寸
            canvas.width = width;
            canvas.height = canvasH;
            
            const ctx = canvas.getContext('2d');
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 3;
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, width, canvasH);
            
            ctxRef.current = ctx;
            setReady(true);
        }, 150);
        return () => clearTimeout(timer);
    }, [width, canvasH]);

    // 关键：根据是否旋转来转换坐标
    const getPoint = useCallback((e) => {
        let clientX, clientY;
        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }

        if (isPortrait) {
            // 竖屏被旋转90度后，触摸坐标需要转换
            // 屏幕坐标 (clientX, clientY) -> canvas 坐标
            // 旋转后: canvas的x = 屏幕的y, canvas的y = 屏幕宽度 - 屏幕的x - 工具栏高度
            return {
                x: clientY,
                y: screenW - clientX - toolbarH
            };
        } else {
            // 横屏直接使用，减去工具栏高度
            return {
                x: clientX,
                y: clientY - toolbarH
            };
        }
    }, [isPortrait, screenW, toolbarH]);

    const startDrawing = useCallback((e) => {
        e.preventDefault();
        if (!ctxRef.current) return;
        isDrawingRef.current = true;
        const point = getPoint(e);
        ctxRef.current.beginPath();
        ctxRef.current.moveTo(point.x, point.y);
    }, [getPoint]);

    const draw = useCallback((e) => {
        if (!isDrawingRef.current || !ctxRef.current) return;
        e.preventDefault();
        const point = getPoint(e);
        ctxRef.current.lineTo(point.x, point.y);
        ctxRef.current.stroke();
        ctxRef.current.beginPath();
        ctxRef.current.moveTo(point.x, point.y);
    }, [getPoint]);

    const stopDrawing = useCallback(() => {
        isDrawingRef.current = false;
        if (ctxRef.current) ctxRef.current.beginPath();
    }, []);

    const clearSignature = useCallback(() => {
        if (!canvasRef.current || !ctxRef.current) return;
        ctxRef.current.fillStyle = '#fff';
        ctxRef.current.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }, []);

    const isCanvasEmpty = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return true;
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 0; i < data.length; i += 4) {
            if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) return false;
        }
        return true;
    }, []);

    const confirmSignature = useCallback(() => {
        if (!canvasRef.current || isCanvasEmpty()) {
            onCancel();
            return;
        }
        onConfirm(canvasRef.current.toDataURL('image/png'));
    }, [onConfirm, onCancel, isCanvasEmpty]);

    const wrapperStyle = isPortrait ? {
        position: 'fixed',
        top: 0,
        left: screenW,
        width: `${screenH}px`,
        height: `${screenW}px`,
        transform: 'rotate(90deg)',
        transformOrigin: 'top left',
        zIndex: 99999,
        backgroundColor: '#fff',
    } : {
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 99999,
        backgroundColor: '#fff',
    };

    return (
        <div style={wrapperStyle}>
            {/* 工具栏 */}
            <div style={{
                height: `${toolbarH}px`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 16px',
                backgroundColor: '#f3f4f6',
                borderBottom: '1px solid #e5e7eb',
            }}>
                <button onClick={onCancel} style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', background: 'none', border: 'none', color: '#4b5563', fontSize: '14px', cursor: 'pointer' }}>
                    <X style={{ width: 20, height: 20, marginRight: 4 }} />取消
                </button>
                <span style={{ fontSize: '18px', fontWeight: 500, color: '#374151' }}>请签名</span>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={clearSignature} style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', background: '#fff', border: '1px solid #d1d5db', borderRadius: '6px', color: '#4b5563', fontSize: '14px', cursor: 'pointer' }}>
                        <RotateCcw style={{ width: 16, height: 16, marginRight: 4 }} />清除
                    </button>
                    <button onClick={confirmSignature} style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', background: '#2563eb', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '14px', cursor: 'pointer' }}>
                        <Check style={{ width: 16, height: 16, marginRight: 4 }} />确认
                    </button>
                </div>
            </div>

            {/* Canvas 签名区 */}
            <div style={{ position: 'relative', width: `${width}px`, height: `${canvasH}px`, touchAction: 'none' }}>
                <canvas
                    ref={canvasRef}
                    style={{ display: 'block', touchAction: 'none' }}
                    onMouseDown={ready ? startDrawing : undefined}
                    onMouseMove={ready ? draw : undefined}
                    onMouseUp={ready ? stopDrawing : undefined}
                    onMouseLeave={ready ? stopDrawing : undefined}
                    onTouchStart={ready ? startDrawing : undefined}
                    onTouchMove={ready ? draw : undefined}
                    onTouchEnd={ready ? stopDrawing : undefined}
                />
                <div style={{ position: 'absolute', bottom: 50, left: 32, right: 32, borderBottom: '2px dashed #d1d5db', pointerEvents: 'none' }} />
                <span style={{ position: 'absolute', bottom: 24, left: 32, color: '#9ca3af', fontSize: '14px', pointerEvents: 'none' }}>签名区域</span>
            </div>
        </div>
    );
};

export { FullscreenSignaturePad };
