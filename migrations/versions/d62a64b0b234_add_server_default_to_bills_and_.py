"""Add server_default to bills and payrolls json fields

Revision ID: d62a64b0b234
Revises: 56eab19dad5b
Create Date: 2025-07-15 12:52:09.492620

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'd62a64b0b234'
down_revision = '56eab19dad5b'
branch_labels = None
depends_on = None


def upgrade():
    # --- 为 customer_bills 表进行安全更新 ---

    # 1. 先将所有现有的 NULL 值更新为空的 JSONB 对象 '{}'
    op.execute("UPDATE customer_bills SET payment_details = '{}'::jsonb WHERE payment_details IS NULL")
    op.execute("UPDATE customer_bills SET calculation_details = '{}'::jsonb WHERE calculation_details IS NULL")

    # 2. 为列添加 server_default 约束
    op.alter_column('customer_bills', 'payment_details',
               existing_type=postgresql.JSONB(astext_type=sa.Text()),
               server_default=sa.text("'{}'::jsonb"),
               nullable=False) # 这一步现在可以安全执行了
    op.alter_column('customer_bills', 'calculation_details',
               existing_type=postgresql.JSONB(astext_type=sa.Text()),
               server_default=sa.text("'{}'::jsonb"),
               nullable=False)

    # --- 为 employee_payrolls 表进行同样的安全更新 ---

    # 1. 先将所有现有的 NULL 值更新为空的 JSONB 对象 '{}'
    op.execute("UPDATE employee_payrolls SET payout_details = '{}'::jsonb WHERE payout_details IS NULL")
    op.execute("UPDATE employee_payrolls SET calculation_details = '{}'::jsonb WHERE calculation_details IS NULL")

    # 2. 为列添加 server_default 约束
    op.alter_column('employee_payrolls', 'payout_details',
               existing_type=postgresql.JSONB(astext_type=sa.Text()),
               server_default=sa.text("'{}'::jsonb"),
               nullable=False)
    op.alter_column('employee_payrolls', 'calculation_details',
               existing_type=postgresql.JSONB(astext_type=sa.Text()),
               server_default=sa.text("'{}'::jsonb"),
               nullable=False)


def downgrade():
    # 在降级时，我们只移除 server_default 和 NOT NULL 约束，不做数据恢复
    op.alter_column('employee_payrolls', 'calculation_details',
               existing_type=postgresql.JSONB(astext_type=sa.Text()),
               server_default=None,
               nullable=True)
    op.alter_column('employee_payrolls', 'payout_details',
               existing_type=postgresql.JSONB(astext_type=sa.Text()),
               server_default=None,
               nullable=True)
    op.alter_column('customer_bills', 'calculation_details',
               existing_type=postgresql.JSONB(astext_type=sa.Text()),
               server_default=None,
               nullable=True)
    op.alter_column('customer_bills', 'payment_details',
               existing_type=postgresql.JSONB(astext_type=sa.Text()),
               server_default=None,
               nullable=True)
