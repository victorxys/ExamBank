# /Users/victor/develop/examdb/celery_worker.py
import os
from celery import Celery
from dotenv import load_dotenv
from celery.schedules import crontab # <--- 1. 导入 crontab
from datetime import datetime 
import pytz                 


# 在这里加载 .env，因为它现在与 .env 文件在同一目录（项目根目录）
# 或者您的 .env 文件确实在 backend/ 目录下，那么路径需要调整
# 假设 .env 在项目根目录
dotenv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
if os.path.exists(dotenv_path):
    load_dotenv(dotenv_path=dotenv_path)
    print(f"Celery App (root): Loaded .env file from: {dotenv_path}")
else:
    # 如果 .env 在 backend/
    backend_dotenv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backend', '.env')
    if os.path.exists(backend_dotenv_path):
        load_dotenv(dotenv_path=backend_dotenv_path)
        print(f"Celery App (root): Loaded .env file from: {backend_dotenv_path}")
        # 打印代理设置以供调试
        print(f"Celery Worker: HTTP_PROXY is set to '{os.environ.get('HTTP_PROXY')}'")
        print(f"Celery Worker: HTTPS_PROXY is set to '{os.environ.get('HTTPS_PROXY')}'")
        
    else:
        print(f"Warning: .env file not found for Celery app at root or backend/.env")


celery_broker_url = os.environ.get('CELERY_BROKER_URL', 'redis://localhost:6379/0')
celery_result_backend = os.environ.get('CELERY_RESULT_BACKEND', 'redis://localhost:6379/0')

print(f"Celery App (root): Broker URL: {celery_broker_url}")
print(f"Celery App (root): Result Backend URL: {celery_result_backend}")

# 输出 TTS-Server 配置用于调试
tts_server_url = os.environ.get('TTS_SERVER_BASE_URL', 'http://localhost:5002')
tts_server_api_key = os.environ.get('TTS_SERVER_API_KEY', '')
print(f"Celery Worker: TTS_SERVER_BASE_URL = {tts_server_url}")
print(f"Celery Worker: TTS_SERVER_API_KEY = {'***' + tts_server_api_key[-4:] if len(tts_server_api_key) > 4 else '(empty)'}")

# Celery 应用实例，应用名可以是 'proj' 或其他
# include 参数现在指向 'backend.tasks'，因为是从项目根目录导入
celery_app  = Celery( # 通常将 Celery 实例命名为 app 或 celery_app
    'examdb_tasks', # 或者您的项目名
    broker=celery_broker_url,
    backend=celery_result_backend,
    include=['backend.tasks'] # Celery 会从 sys.path (包含当前目录) 查找 backend.tasks
)

# 从 celeryconfig.py 文件加载所有配置
celery_app.config_from_object('celeryconfig')

# 为所有任务自动添加 Flask 应用上下文
class FlaskTask(celery_app.Task):
    def __call__(self, *args, **kwargs):
        # 确保可以从 backend.app 导入 Flask app 实例
        from backend.app import app as flask_app
        with flask_app.app_context():
            return super().__call__(*args, **kwargs)

# 将自定义的 Task 类应用到 Celery 实例
celery_app.Task = FlaskTask

# 注意：不需要 if __name__ == '__main__': app.start()
# 这个文件只用于定义 Celery app 实例

# 如果您将 backend/tasks.py 的内容也移到这里，
# 那么 include 就不需要了，或者指向当前文件定义的任务。
# 但通常保持 tasks.py 分离更好。