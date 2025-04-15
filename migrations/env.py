# migrations/env.py
import os
import sys
import logging # <--- 添加这一行导入
from logging.config import fileConfig

from flask import current_app # 使用 current_app
from dotenv import load_dotenv

from sqlalchemy import engine_from_config, pool
from alembic import context

# --- 加载 .env 文件 ---
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
dotenv_path = os.path.join(project_root, '.env')
load_dotenv(dotenv_path=dotenv_path)
# --------------------------

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)
logger = logging.getLogger('alembic.env')

# --- 获取 target_metadata (保持不变，依赖 current_app) ---
# Flask-Migrate 在设置 current_app 时会确保 db 扩展可用
target_metadata = current_app.extensions['migrate'].db.metadata
# ------------------------------------------------------

# --- 获取 Engine 和 URL 的函数 (保持不变，依赖 current_app) ---
def get_engine():
    try:
        return current_app.extensions['migrate'].db.get_engine()
    except (TypeError, AttributeError):
        return current_app.extensions['migrate'].db.engine

def get_engine_url():
    try:
        return get_engine().url.render_as_string(hide_password=False).replace('%', '%%')
    except AttributeError:
        return str(get_engine().url).replace('%', '%%')
# -------------------------------------------------------


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    url = get_engine_url() # 从 current_app 获取 URL
    context.configure(
        url=url,
        target_metadata=target_metadata, # 使用 current_app 获取的 metadata
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    def process_revision_directives(context, revision, directives):
        if getattr(config.cmd_opts, 'autogenerate', False):
            script = directives[0]
            if script.upgrade_ops.is_empty():
                directives[:] = []
                logger.info('No changes in schema detected.')

    conf_args = current_app.extensions['migrate'].configure_args
    if conf_args.get("process_revision_directives") is None:
        conf_args["process_revision_directives"] = process_revision_directives

    connectable = get_engine() # 从 current_app 获取 Engine

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata, # 使用 current_app 获取的 metadata
            **conf_args
        )
        with context.begin_transaction():
            context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()