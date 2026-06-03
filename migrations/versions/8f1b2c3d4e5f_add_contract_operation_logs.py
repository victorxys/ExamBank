"""add contract operation logs

Revision ID: 8f1b2c3d4e5f
Revises: 7027b9c4f46a
Create Date: 2026-06-03 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "8f1b2c3d4e5f"
down_revision = "7027b9c4f46a"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_exists = inspector.has_table("contract_operation_logs")

    if not table_exists:
        op.create_table(
            "contract_operation_logs",
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("contract_id", sa.UUID(), nullable=True, comment="主合同ID"),
            sa.Column("related_contract_id", sa.UUID(), nullable=True, comment="关联的新/旧合同ID"),
            sa.Column("user_id", sa.UUID(), nullable=True, comment="操作人ID"),
            sa.Column("action", sa.String(length=50), nullable=False, comment="操作类型"),
            sa.Column("title", sa.String(length=255), nullable=False, comment="操作标题"),
            sa.Column("summary", sa.Text(), nullable=True, comment="操作摘要"),
            sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), nullable=True, comment="操作详情"),
            sa.Column("changes", postgresql.JSONB(astext_type=sa.Text()), nullable=True, comment="字段变更前后值"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
            sa.ForeignKeyConstraint(["contract_id"], ["contracts.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["related_contract_id"], ["contracts.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            comment="合同生命周期操作日志表",
        )
    else:
        columns = {column["name"] for column in inspector.get_columns("contract_operation_logs")}
        if "related_contract_id" not in columns:
            op.add_column(
                "contract_operation_logs",
                sa.Column("related_contract_id", sa.UUID(), nullable=True, comment="关联的新/旧合同ID"),
            )
        if "user_id" not in columns:
            op.add_column(
                "contract_operation_logs",
                sa.Column("user_id", sa.UUID(), nullable=True, comment="操作人ID"),
            )
        if "title" not in columns:
            op.add_column(
                "contract_operation_logs",
                sa.Column("title", sa.String(length=255), nullable=True, comment="操作标题"),
            )
            bind.execute(sa.text("UPDATE contract_operation_logs SET title = COALESCE(action, '合同操作')"))
            op.alter_column("contract_operation_logs", "title", nullable=False)
        if "summary" not in columns:
            op.add_column(
                "contract_operation_logs",
                sa.Column("summary", sa.Text(), nullable=True, comment="操作摘要"),
            )
            if "description" in columns:
                bind.execute(sa.text("UPDATE contract_operation_logs SET summary = description WHERE summary IS NULL"))
        if "details" not in columns:
            op.add_column(
                "contract_operation_logs",
                sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), nullable=True, comment="操作详情"),
            )
        if "changes" not in columns:
            op.add_column(
                "contract_operation_logs",
                sa.Column("changes", postgresql.JSONB(astext_type=sa.Text()), nullable=True, comment="字段变更前后值"),
            )

    inspector = sa.inspect(bind)
    existing_indexes = {index["name"] for index in inspector.get_indexes("contract_operation_logs")}
    for index_name, columns in (
        ("ix_contract_operation_logs_action", ["action"]),
        ("ix_contract_operation_logs_contract_created", ["contract_id", "created_at"]),
        ("ix_contract_operation_logs_contract_id", ["contract_id"]),
        ("ix_contract_operation_logs_created_at", ["created_at"]),
        ("ix_contract_operation_logs_related_contract", ["related_contract_id"]),
        ("ix_contract_operation_logs_user_id", ["user_id"]),
    ):
        if index_name not in existing_indexes:
            op.create_index(index_name, "contract_operation_logs", columns, unique=False)

    existing_fks = {
        tuple(fk["constrained_columns"])
        for fk in inspector.get_foreign_keys("contract_operation_logs")
    }
    if ("contract_id",) not in existing_fks:
        op.create_foreign_key(
            "fk_contract_operation_logs_contract_id",
            "contract_operation_logs",
            "contracts",
            ["contract_id"],
            ["id"],
            ondelete="SET NULL",
        )
    if ("related_contract_id",) not in existing_fks:
        op.create_foreign_key(
            "fk_contract_operation_logs_related_contract_id",
            "contract_operation_logs",
            "contracts",
            ["related_contract_id"],
            ["id"],
            ondelete="SET NULL",
        )
    if ("user_id",) not in existing_fks:
        op.create_foreign_key(
            "fk_contract_operation_logs_user_id",
            "contract_operation_logs",
            "user",
            ["user_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade():
    op.drop_table("contract_operation_logs")
