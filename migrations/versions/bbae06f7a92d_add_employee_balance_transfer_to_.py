"""Add EMPLOYEE_BALANCE_TRANSFER to AdjustmentType enum

Revision ID: bbae06f7a92d
Revises: 9f776cf20d62
Create Date: 2025-12-02 13:16:47.321373

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'bbae06f7a92d'
down_revision = '9f776cf20d62'
branch_labels = None
depends_on = None


def upgrade():
    # 添加新的 enum 值到 AdjustmentType
    op.execute("ALTER TYPE adjustmenttype ADD VALUE IF NOT EXISTS 'EMPLOYEE_BALANCE_TRANSFER'")


def downgrade():
    # PostgreSQL 不支持直接删除 enum 值
    # 如果需要回滚,需要手动处理
    pass
