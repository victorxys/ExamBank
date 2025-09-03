"""add_employee_commission_offset_type

Revision ID: a7603fdc279e
Revises: 7aad51570503
Create Date: 2025-09-03 12:42:00.555477

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a7603fdc279e'
down_revision = '7aad51570503'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TYPE adjustmenttype ADD VALUE 'EMPLOYEE_COMMISSION_OFFSET'")


def downgrade():
    # 冲账类型是增款逻辑的一部分，移除它会破坏现有逻辑的完整性，
    # 因此我们不支持自动降级。
    pass
