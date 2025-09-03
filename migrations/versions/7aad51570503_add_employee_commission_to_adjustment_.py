"""add_employee_commission_to_adjustment_type_by_manural

Revision ID: 7aad51570503
Revises: c3637ea3a7e2
Create Date: 2025-09-03 09:23:31.891570

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '7aad51570503'
down_revision = 'c3637ea3a7e2'
branch_labels = None
depends_on = None


def upgrade():
    """
    在 adjustmenttype 枚举中增加一个新的值 'EMPLOYEE_COMMISSION'。
    使用原生 SQL 执行，这是向 PostgreSQL 的 ENUM 类型添加值的标准做法。
    """
    op.execute("ALTER TYPE adjustmenttype ADD VALUE 'EMPLOYEE_COMMISSION'")


def downgrade():
    """
    从 ENUM 中移除一个值在 PostgreSQL 中是复杂且有风险的操作。
    它要求首先确保没有任何数据行正在使用这个值。
    为安全起见，我们不支持自动降级。如果确实需要，必须手动将所有
    'EMPLOYEE_COMMISSION' 的记录处理掉，然后才能执行类型变更。
    """
    # 我们故意将此留空，以防止意外的数据破坏。
    pass