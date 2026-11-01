# backend/db.py
import psycopg2
import os
import logging
import sys
from dotenv import load_dotenv

load_dotenv()

log = logging.getLogger(__name__)
log.setLevel(logging.DEBUG)

# 容器日志输出到 stdout，不要求运行用户能写入镜像内的 logs 目录。
# 本地未配置环境变量时，继续使用项目 logs/flask.log。
if not log.handlers:
    log_file = os.environ.get("FLASK_LOG_FILE")
    if log_file == "-":
        handler = logging.StreamHandler(sys.stdout)
    else:
        if not log_file:
            log_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), "logs", "flask.log")
        os.makedirs(os.path.dirname(os.path.abspath(log_file)), exist_ok=True)
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
