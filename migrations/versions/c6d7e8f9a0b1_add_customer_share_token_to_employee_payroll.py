"""add customer share token to employee payroll

Revision ID: c6d7e8f9a0b1
Revises: b5c6d7e8f9a0
Create Date: 2026-07-06 10:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "c6d7e8f9a0b1"
down_revision = "b5c6d7e8f9a0"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("employee_payrolls")}
    indexes = {index["name"] for index in inspector.get_indexes("employee_payrolls")}
    unique_constraints = {constraint["name"] for constraint in inspector.get_unique_constraints("employee_payrolls")}

    with op.batch_alter_table("employee_payrolls", schema=None) as batch_op:
        if "customer_share_token" not in columns:
            batch_op.add_column(sa.Column("customer_share_token", sa.String(length=36), nullable=True, comment="客户查看并确认应付劳务费的小程序分享令牌"))
        if "ix_employee_payrolls_customer_share_token" not in indexes:
            batch_op.create_index("ix_employee_payrolls_customer_share_token", ["customer_share_token"], unique=False)
        if "uq_employee_payrolls_customer_share_token" not in unique_constraints:
            batch_op.create_unique_constraint("uq_employee_payrolls_customer_share_token", ["customer_share_token"])


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("employee_payrolls")}
    indexes = {index["name"] for index in inspector.get_indexes("employee_payrolls")}
    unique_constraints = {constraint["name"] for constraint in inspector.get_unique_constraints("employee_payrolls")}

    with op.batch_alter_table("employee_payrolls", schema=None) as batch_op:
        if "uq_employee_payrolls_customer_share_token" in unique_constraints:
            batch_op.drop_constraint("uq_employee_payrolls_customer_share_token", type_="unique")
        if "ix_employee_payrolls_customer_share_token" in indexes:
            batch_op.drop_index("ix_employee_payrolls_customer_share_token")
        if "customer_share_token" in columns:
            batch_op.drop_column("customer_share_token")
