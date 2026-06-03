"""relax legacy contract operation log columns

Revision ID: 9a2b3c4d5e6f
Revises: 8f1b2c3d4e5f
Create Date: 2026-06-03 11:10:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "9a2b3c4d5e6f"
down_revision = "8f1b2c3d4e5f"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("contract_operation_logs"):
        return

    columns = {
        column["name"]: column
        for column in inspector.get_columns("contract_operation_logs")
    }
    if "description" in columns and not columns["description"].get("nullable", True):
        op.alter_column(
            "contract_operation_logs",
            "description",
            existing_type=sa.Text(),
            nullable=True,
        )
    if "operator_name" in columns and not columns["operator_name"].get("nullable", True):
        op.alter_column(
            "contract_operation_logs",
            "operator_name",
            existing_type=sa.String(length=255),
            nullable=True,
        )


def downgrade():
    # 遗留字段只为兼容旧库保留，降级时不恢复 NOT NULL，避免历史新日志无法回退。
    pass
