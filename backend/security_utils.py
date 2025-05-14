# backend/security_utils.py

from werkzeug.security import generate_password_hash as _generate_password_hash, check_password_hash
import os
from cryptography.fernet import Fernet
from dotenv import load_dotenv
from flask import current_app, Flask # 导入 Flask 以便在没有 app 上下文时创建临时 app
import logging # 使用标准的 logging

# 配置一个基础的 logger，以防 current_app 不可用
logger = logging.getLogger(__name__)
if not logger.handlers:
    handler = logging.StreamHandler()
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


# 确保 .env 文件在模块加载时就被读取
# 假设 .env 文件在项目根目录，而 security_utils.py 在 backend/ 目录下

# --- 修改这里的路径计算 ---
# 获取 security_utils.py 文件所在的目录
current_script_directory = os.path.dirname(os.path.abspath(__file__))
# .env 文件与 security_utils.py 在同一级目录 (backend/)
dotenv_path = os.path.join(current_script_directory, '.env') 
# --- 路径计算修改结束 ---
# print(f"DEBUG: Attempting to load .env from: {dotenv_path}") # 添加调试信息

if os.path.exists(dotenv_path):
    load_dotenv(dotenv_path=dotenv_path)
else:
    # 在脚本直接执行或测试环境中，可能没有 Flask app 上下文，使用标准 logger
    logger.warning(f".env 文件未在路径 {dotenv_path} 找到。环境变量可能未加载。")


ENCRYPTION_KEY_ENV_VAR = 'LLM_API_ENCRYPTION_KEY'
_fernet_instance = None


def generate_password_hash(password):
    """
    Generates a password hash using PBKDF2 with SHA256.
    """
    return _generate_password_hash(password, method='pbkdf2:sha256')

# check_password_hash 函数直接从 werkzeug.security 导入并可以在需要的地方使用
# 如果需要在这里重新导出，可以这样做：
# from werkzeug.security import check_password_hash as check_password_hash

# 或者更简洁，直接在需要验证密码的地方 (app.py 的 login 路由) 导入 check_password_hash


def get_fernet_instance_for_script():
    """专用于脚本环境（如 initdb.py）获取 Fernet 实例，不依赖 Flask app 上下文"""
    encryption_key_str = os.environ.get(ENCRYPTION_KEY_ENV_VAR)
    if not encryption_key_str:
        logger.error(f"错误: 环境变量 '{ENCRYPTION_KEY_ENV_VAR}' 未设置。请在 .env 文件中设置它。")
        logger.info(f"你可以使用以下Python代码生成一个新的密钥: from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")
        raise ValueError(f"环境变量 '{ENCRYPTION_KEY_ENV_VAR}' 未设置。")
    try:
        return Fernet(encryption_key_str.encode())
    except Exception as e:
        logger.error(f"错误：无法使用环境变量 '{ENCRYPTION_KEY_ENV_VAR}' 初始化加密器。请确保其为有效的Fernet密钥。错误: {e}", exc_info=True)
        raise


def get_fernet():
    """在 Flask 应用上下文中获取 Fernet 实例"""
    global _fernet_instance
    if _fernet_instance is None:
        # 优先使用 current_app.logger (如果在Flask上下文中)
        effective_logger = current_app.logger if current_app else logger

        encryption_key_str = os.environ.get(ENCRYPTION_KEY_ENV_VAR)
        if not encryption_key_str:
            effective_logger.error(f"关键错误: 环境变量 '{ENCRYPTION_KEY_ENV_VAR}' 未设置。请在 .env 文件中设置它。")
            effective_logger.info(f"你可以使用以下Python代码生成一个新的密钥: from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")
            # 在应用运行时，如果密钥缺失，应该抛出异常阻止应用不安全地运行
            raise RuntimeError(f"关键配置缺失: 环境变量 '{ENCRYPTION_KEY_ENV_VAR}' 未设置。应用无法安全运行。")
        
        try:
            _fernet_instance = Fernet(encryption_key_str.encode())
        except Exception as e:
            effective_logger.error(f"错误：无法使用环境变量 '{ENCRYPTION_KEY_ENV_VAR}' 初始化加密器。请确保其为有效的Fernet密钥。错误: {e}", exc_info=True)
            raise RuntimeError(f"加密器初始化失败: {e}")
    return _fernet_instance

def encrypt_data(data: str, use_script_fernet=False) -> str:
    fernet = get_fernet_instance_for_script() if use_script_fernet else get_fernet()
    if not isinstance(data, str):
        raise TypeError("加密数据必须是字符串类型。")
    return fernet.encrypt(data.encode()).decode()

def decrypt_data(encrypted_data: str, use_script_fernet=False) -> str:
    fernet = get_fernet_instance_for_script() if use_script_fernet else get_fernet()
    if not isinstance(encrypted_data, str):
        # 优先使用 current_app.logger
        effective_logger = current_app.logger if current_app else logger
        effective_logger.warning("解密数据类型错误，期望字符串，得到: %s", type(encrypted_data))
        return "" # 或者 raise TypeError
    try:
        return fernet.decrypt(encrypted_data.encode()).decode()
    except Exception as e:
        effective_logger = current_app.logger if current_app else logger
        effective_logger.warning(f"警告: 解密数据失败。可能原因：密钥不匹配或数据已损坏。返回空字符串。错误详情: {e}")
        return "" # 对于解密失败，返回空字符串可能比抛出异常更安全，防止敏感信息泄露

# 你已有的密码哈希函数
from werkzeug.security import generate_password_hash as _generate_password_hash, check_password_hash

def generate_password_hash(password):
    return _generate_password_hash(password, method='pbkdf2:sha256')