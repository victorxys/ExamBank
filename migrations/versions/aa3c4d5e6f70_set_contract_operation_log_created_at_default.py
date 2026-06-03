"""set contract operation log created_at default

Revision ID: aa3c4d5e6f70
Revises: 9a2b3c4d5e6f
Create Date: 2026-06-03 11:15:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "aa3c4d5e6f70"
down_revision = "9a2b3c4d5e6f"
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
    if "created_at" in columns:
        op.alter_column(
            "contract_operation_logs",
            "created_at",
            existing_type=sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        )


def downgrade():
    op.alter_column(
        "contract_operation_logs",
        "created_at",
        existing_type=sa.DateTime(timezone=True),
        server_default=None,
        nullable=False,
    )
