print("DEBUG: env.py IS BEING EXECUTED (Top of file)")
import os
import sys
import logging
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool
from alembic import context

# --- 加载 .env 文件 (保持不变) ---
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
dotenv_path = os.path.join(project_root, '.env')
# 确保 DOTENV_PATH 指向正确的位置
# 优先使用项目根目录的 .env，其次是 backend/.env
# (您可以根据您的实际 .env 文件位置调整此逻辑)
if os.path.exists(dotenv_path):
    print(f"DEBUG [env.py]: Loading .env from {dotenv_path}")
    from dotenv import load_dotenv # 确保导入
    load_dotenv(dotenv_path=dotenv_path)
else:
    backend_dotenv_path = os.path.join(project_root, 'backend', '.env')
    if os.path.exists(backend_dotenv_path):
        print(f"DEBUG [env.py]: Loading .env from {backend_dotenv_path}")
        from dotenv import load_dotenv # 确保导入
        load_dotenv(dotenv_path=backend_dotenv_path)
    else:
        print(f"DEBUG [env.py]: No .env file found at {dotenv_path} or {backend_dotenv_path}")
# --------------------------

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)
logger = logging.getLogger('alembic.env')

# --- 获取 target_metadata 的修改 ---
try:
    from flask import current_app
    # 优先尝试通过 Flask 应用上下文获取元数据
    target_metadata = current_app.extensions['migrate'].db.metadata
    print(f"DEBUG [env.py]: Successfully got metadata from current_app. Tables: {list(target_metadata.tables.keys())}")
    logger.info(f"DEBUG [env.py]: Successfully got metadata from current_app. Tables: {list(target_metadata.tables.keys())}")
except RuntimeError:
    # 如果在 Flask 应用上下文之外运行 (例如直接调用 alembic)
    print("DEBUG [env.py]: Running outside of Flask app context. Attempting to load models directly.")
    logger.info("DEBUG [env.py]: Running outside of Flask app context. Attempting to load models directly.")
    # 确保 backend 包在 sys.path 中
    sys.path.insert(0, project_root) # 将项目根目录添加到路径首位
    try:
        from backend.extensions import db as direct_db
        from backend import models # 确保导入 models 以注册它们
        target_metadata = direct_db.metadata
        print(f"DEBUG [env.py]: Successfully got metadata directly from models. Tables: {list(target_metadata.tables.keys())}")
        logger.info(f"DEBUG [env.py]: Successfully got metadata directly from models. Tables: {list(target_metadata.tables.keys())}")
    except Exception as e:
        print(f"ERROR [env.py]: Failed to load metadata directly: {e}")
        logger.error(f"ERROR [env.py]: Failed to load metadata directly: {e}", exc_info=True)
        target_metadata = None # 或者抛出异常

if target_metadata is None:
    raise RuntimeError(
        "Could not get target_metadata. Ensure your Flask app is configured"
        " correctly or models can be imported directly."
    )
# ------------------------------------

def get_engine_url():
    # 尝试从 Flask app 获取，如果失败则从 alembic.ini (config 对象) 获取
    try:
        from flask import current_app
        return current_app.extensions['migrate'].db.get_engine().url.render_as_string(hide_password=False).replace('%', '%%')
    except RuntimeError: # Not in app context
        print("DEBUG [env.py get_engine_url]: Not in app context, using sqlalchemy.url from alembic.ini")
        return config.get_main_option("sqlalchemy.url") # 直接从 alembic.ini 读取
    except (TypeError, AttributeError): # Fallback for other Flask-Migrate/SQLAlchemy versions
        try:
            from flask import current_app
            return str(current_app.extensions['migrate'].db.engine.url).replace('%', '%%')
        except RuntimeError:
            return config.get_main_option("sqlalchemy.url")


def get_engine():
    try:
        from flask import current_app
        return current_app.extensions['migrate'].db.get_engine()
    except (RuntimeError, TypeError, AttributeError):
        # 在 Flask 上下文之外，根据 alembic.ini 中的 sqlalchemy.url 创建引擎
        print("DEBUG [env.py get_engine]: Not in app context or db not fully initialized via app, creating engine from alembic.ini url.")
        db_url = config.get_main_option("sqlalchemy.url")
        if not db_url:
            raise ValueError("sqlalchemy.url is not set in alembic.ini and Flask app context is not available.")
        return engine_from_config(
            {"sqlalchemy.url": db_url}, # 需要一个字典
            prefix="sqlalchemy.",
            poolclass=pool.NullPool,
        )

# ... (run_migrations_offline 和 run_migrations_online 函数基本保持不变，但它们会使用上面修改过的 get_engine_url 和 get_engine)

def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    url = get_engine_url()
    print(f"DEBUG [env.py run_migrations_offline]: URL: {url}")
    logger.info(f"DEBUG [env.py run_migrations_offline]: URL: {url}")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    print("DEBUG [env.py run_migrations_online]: ENTERING function")
    logger.info("DEBUG [env.py run_migrations_online]: ENTERING function (via logger)")

    def process_revision_directives(context, revision, directives):
        # ... (保持不变)
        print("DEBUG [env.py process_revision_directives]: CALLED")
        logger.info("DEBUG [env.py process_revision_directives]: CALLED (via logger)")
        if getattr(config.cmd_opts, 'autogenerate', False):
            script = directives[0]
            if script.upgrade_ops.is_empty():
                directives[:] = []
                logger.info('No changes in schema detected (from process_revision_directives).')
                print('DEBUG [env.py process_revision_directives]: No changes detected.')


    # 尝试从 Flask app 获取 conf_args，如果失败则使用空字典
    try:
        from flask import current_app
        conf_args = current_app.extensions['migrate'].configure_args
        if conf_args.get("process_revision_directives") is None:
            conf_args["process_revision_directives"] = process_revision_directives
    except RuntimeError:
        print("DEBUG [env.py run_migrations_online]: Not in app context, using default conf_args for Alembic.")
        conf_args = {"process_revision_directives": process_revision_directives} # 提供一个默认值

    print(f"DEBUG [env.py run_migrations_online]: target_metadata.tables before configure: {list(target_metadata.tables.keys())}")
    print(f"DEBUG [env.py run_migrations_online]: conf_args before configure: {conf_args}")
    logger.info(f"DEBUG [env.py run_migrations_online]: target_metadata.tables before configure (via logger): {list(target_metadata.tables.keys())}")
    logger.info(f"DEBUG [env.py run_migrations_online]: conf_args before configure (via logger): {conf_args}")

    connectable = get_engine()

    with connectable.connect() as connection:
        print("DEBUG [env.py run_migrations_online]: Connection established, calling context.configure")
        logger.info("DEBUG [env.py run_migrations_online]: Connection established, calling context.configure (via logger)")
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            **conf_args
        )
        print("DEBUG [env.py run_migrations_online]: context.configure called, calling context.run_migrations")
        logger.info("DEBUG [env.py run_migrations_online]: context.configure called, calling context.run_migrations (via logger)")
        with context.begin_transaction():
            context.run_migrations()
        print("DEBUG [env.py run_migrations_online]: context.run_migrations finished")
        logger.info("DEBUG [env.py run_migrations_online]: context.run_migrations finished (via logger)")


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()