import os
import sys
import requests
from PIL import Image
import io
from psycopg2.extras import RealDictCursor
import logging

# 添加项目根目录到Python路径
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.db import get_db_connection

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

def download_and_convert_avatar(avatar_url, output_path):
    try:
        # 下载图片
        response = requests.get(avatar_url)
        response.raise_for_status()
        
        # 使用PIL打开图片
        image = Image.open(io.BytesIO(response.content))
        
        # 转换为RGB模式（如果是RGBA，会自动移除透明通道）
        if image.mode in ('RGBA', 'LA') or (image.mode == 'P' and 'transparency' in image.info):
            background = Image.new('RGB', image.size, (255, 255, 255))
            if image.mode == 'P':
                image = image.convert('RGBA')
            background.paste(image, mask=image.split()[-1])
            image = background
        
        # 调整图片尺寸为256x256，保持宽高比
        target_size = (300, 300)
        ratio = min(target_size[0] / image.size[0], target_size[1] / image.size[1])
        new_size = tuple(int(dim * ratio) for dim in image.size)
        resized_image = image.resize(new_size, Image.Resampling.LANCZOS)
        
        # 创建白色背景
        final_image = Image.new('RGB', target_size, (255, 255, 255))
        # 将调整后的图片居中放置
        paste_pos = ((target_size[0] - new_size[0]) // 2, (target_size[1] - new_size[1]) // 2)
        final_image.paste(resized_image, paste_pos)

        # 初始质量设置为100（最高质量）
        quality = 100
        max_size_kb = 32  # 最大允许的文件大小（KB）

        # 使用临时内存缓冲区检查文件大小
        temp_buffer = io.BytesIO()
        final_image.save(temp_buffer, format='JPEG', quality=quality)
        file_size_kb = len(temp_buffer.getvalue()) / 1024
        
        # 如果文件大小超过32KB，降低质量到80
        if file_size_kb > max_size_kb:
            quality = 95
            logging.info(f"图片大小 {file_size_kb:.2f}KB 超过 {max_size_kb}KB，降低质量至 {quality}")
        else:
            logging.info(f"图片大小 {file_size_kb:.2f}KB，保持最高质量 {quality}")
        
        # 保存为JPG格式，使用动态质量参数
        final_image.save(output_path, 'JPEG', quality=quality)
        return True
    except Exception as e:
        logging.error(f"Error processing {avatar_url}: {str(e)}")
        return False

def main():
    # 确保输出目录存在
    output_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 
                             'frontend', 'public', 'avatar')
    os.makedirs(output_dir, exist_ok=True)
    
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        # 获取所有用户的ID和头像URL
        cur.execute('SELECT id, avatar FROM "user" WHERE avatar IS NOT NULL')
        users = cur.fetchall()
        
        total_users = len(users)
        processed = 0
        success = 0
        
        for user in users:
            processed += 1
            user_id = user['id']
            avatar_url = user['avatar']
            
            if not avatar_url:
                continue
                
            output_path = os.path.join(output_dir, f"{user_id}-avatar.jpg")
            
            logging.info(f"Processing {processed}/{total_users}: {avatar_url}")
            
            # 检查文件是否已存在，存在则跳过下载
            # if os.path.exists(output_path):
            #     logging.info(f"File already exists, skipping: {output_path}")
            #     success += 1
            #     continue
                
            if download_and_convert_avatar(avatar_url, output_path):
                success += 1
                
        logging.info(f"\nProcessing completed:\n")
        logging.info(f"Total users processed: {total_users}")
        logging.info(f"Successfully downloaded and converted: {success}")
        logging.info(f"Failed: {total_users - success}")
        
    except Exception as e:
        logging.error(f"Database error: {str(e)}")
    finally:
        cur.close()
        conn.close()

if __name__ == '__main__':
    main()