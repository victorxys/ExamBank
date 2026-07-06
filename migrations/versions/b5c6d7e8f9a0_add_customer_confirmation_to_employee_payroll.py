"""add customer confirmation to employee payroll

Revision ID: b5c6d7e8f9a0
Revises: a4b9c8d7e6f5
Create Date: 2026-07-03 15:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "b5c6d7e8f9a0"
down_revision = "a4b9c8d7e6f5"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("employee_payrolls")}
    indexes = {index["name"] for index in inspector.get_indexes("employee_payrolls")}

    with op.batch_alter_table("employee_payrolls", schema=None) as batch_op:
        if "customer_confirmed_at" not in columns:
            batch_op.add_column(sa.Column("customer_confirmed_at", sa.DateTime(timezone=True), nullable=True, comment="客户在小程序确认应付劳务费的时间"))
        if "customer_confirmed_openid" not in columns:
            batch_op.add_column(sa.Column("customer_confirmed_openid", sa.String(length=128), nullable=True, comment="确认应付劳务费的小程序openid"))
        if "ix_employee_payrolls_customer_confirmed_at" not in indexes:
            batch_op.create_index("ix_employee_payrolls_customer_confirmed_at", ["customer_confirmed_at"], unique=False)


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("employee_payrolls")}
    indexes = {index["name"] for index in inspector.get_indexes("employee_payrolls")}

    with op.batch_alter_table("employee_payrolls", schema=None) as batch_op:
        if "ix_employee_payrolls_customer_confirmed_at" in indexes:
            batch_op.drop_index("ix_employee_payrolls_customer_confirmed_at")
        if "customer_confirmed_openid" in columns:
            batch_op.drop_column("customer_confirmed_openid")
        if "customer_confirmed_at" in columns:
            batch_op.drop_column("customer_confirmed_at")
