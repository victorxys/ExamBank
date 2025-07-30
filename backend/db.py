# backend/db.py
import psycopg2
import os
import logging
from dotenv import load_dotenv

load_dotenv()

# 确保日志目录存在
log_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "logs")
os.makedirs(log_dir, exist_ok=True)

log = logging.getLogger(__name__)
log.setLevel(logging.DEBUG)

# 设置日志文件路径
log_file = os.path.join(log_dir, "flask.log")
handler = logging.FileHandler(log_file)
formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
handler.setFormatter(formatter)
log.addHandler(handler)


def get_db_connection():
    try:
        conn = psycopg2.connect(os.environ["DATABASE_URL"])
        conn.set_client_encoding("UTF8")
        log.info("Database connection established successfully.")
        return conn
    except Exception:
        log.exception("Failed to connect to the database:")
        raise  # 重新抛出异常，以便上层处理
