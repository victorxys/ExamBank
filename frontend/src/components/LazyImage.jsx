// frontend/src/components/LazyImage.jsx
import React, { useRef, useEffect, useState } from 'react';

const LazyImage = ({ src, alt, style, ...props }) => {
  const imgRef = useRef(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          // 当图片进入视口时
          if (entry.isIntersecting) {
            setIsLoaded(true);
            // 停止观察该图片
            observer.unobserve(entry.target);
          }
        });
      },
      {
        // 预加载区域，当图片距离视口200px时开始加载
        rootMargin: '0px 0px 200px 0px',
      }
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => {
      if (imgRef.current) {
        observer.unobserve(img_ref.current);
      }
    };
  }, []);

  return (
    <img
      ref={imgRef}
      src={isLoaded ? src : ''} // 如果已加载，则设置真实的src，否则为空
      alt={alt}
      style={{
        ...style,
        // 添加一个简单的过渡效果
        transition: 'opacity 0.3s',
        opacity: isLoaded ? 1 : 0,
      }}
      {...props}
    />
  );
};

export default LazyImage;