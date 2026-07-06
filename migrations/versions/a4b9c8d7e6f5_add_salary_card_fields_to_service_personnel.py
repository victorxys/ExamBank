"""add salary card fields to service personnel

Revision ID: a4b9c8d7e6f5
Revises: f2a3b4c5d6e7
Create Date: 2026-07-03 10:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "a4b9c8d7e6f5"
down_revision = "f2a3b4c5d6e7"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("service_personnel")}

    with op.batch_alter_table("service_personnel", schema=None) as batch_op:
        if "salary_card_holder_name" not in columns:
            batch_op.add_column(sa.Column("salary_card_holder_name", sa.String(length=255), nullable=True, comment="工资卡持卡人姓名"))
        if "salary_card_bank_name" not in columns:
            batch_op.add_column(sa.Column("salary_card_bank_name", sa.String(length=255), nullable=True, comment="工资卡开户行"))
        if "salary_card_number" not in columns:
            batch_op.add_column(sa.Column("salary_card_number", sa.String(length=100), nullable=True, comment="工资卡卡号"))


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("service_personnel")}

    with op.batch_alter_table("service_personnel", schema=None) as batch_op:
        if "salary_card_number" in columns:
            batch_op.drop_column("salary_card_number")
        if "salary_card_bank_name" in columns:
            batch_op.drop_column("salary_card_bank_name")
        if "salary_card_holder_name" in columns:
            batch_op.drop_column("salary_card_holder_name")
