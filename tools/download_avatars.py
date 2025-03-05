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
        
        # 保存为JPG格式
        image.save(output_path, 'JPEG', quality=95)
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
            if os.path.exists(output_path):
                logging.info(f"File already exists, skipping: {output_path}")
                success += 1
                continue
                
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