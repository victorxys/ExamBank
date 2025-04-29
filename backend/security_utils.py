# backend/security_utils.py

from werkzeug.security import generate_password_hash as _generate_password_hash, check_password_hash

def generate_password_hash(password):
    """
    Generates a password hash using PBKDF2 with SHA256.
    """
    return _generate_password_hash(password, method='pbkdf2:sha256')

# check_password_hash 函数直接从 werkzeug.security 导入并可以在需要的地方使用
# 如果需要在这里重新导出，可以这样做：
# from werkzeug.security import check_password_hash as check_password_hash

# 或者更简洁，直接在需要验证密码的地方 (app.py 的 login 路由) 导入 check_password_hash