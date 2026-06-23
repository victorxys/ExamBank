"""add miniapp debug access

Revision ID: e1f2a3b4c5d6
Revises: d9e0f1a2b3c4
Create Date: 2026-06-23 10:20:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "e1f2a3b4c5d6"
down_revision = "d9e0f1a2b3c4"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("miniapp_debug_access"):
        return

    op.create_table(
        "miniapp_debug_access",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, comment="主键"),
        sa.Column("debugger_openid", sa.String(length=100), nullable=False, comment="调试人员微信小程序openid"),
        sa.Column("role", sa.String(length=20), nullable=False, comment="临时登录角色: employee/customer"),
        sa.Column("target_type", sa.String(length=20), nullable=False, comment="目标类型: employee/customer"),
        sa.Column("target_id", postgresql.UUID(as_uuid=True), nullable=False, comment="目标员工或客户ID"),
        sa.Column("reason", sa.Text(), nullable=True, comment="授权原因"),
        sa.Column("enabled", sa.Boolean(), server_default=sa.text("true"), nullable=False, comment="是否启用"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False, comment="过期时间"),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True, comment="最近使用时间"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True, comment="创建管理员ID"),
        sa.Column("disabled_by", postgresql.UUID(as_uuid=True), nullable=True, comment="停用管理员ID"),
        sa.Column("disabled_at", sa.DateTime(timezone=True), nullable=True, comment="停用时间"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True, comment="创建时间"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True, comment="更新时间"),
        sa.ForeignKeyConstraint(["created_by"], ["user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["disabled_by"], ["user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        comment="小程序临时调试授权表",
    )
    op.create_index("ix_miniapp_debug_access_openid", "miniapp_debug_access", ["debugger_openid"], unique=False)
    op.create_index("ix_miniapp_debug_access_target", "miniapp_debug_access", ["target_type", "target_id"], unique=False)
    op.create_index("ix_miniapp_debug_access_expires_at", "miniapp_debug_access", ["expires_at"], unique=False)


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("miniapp_debug_access"):
        return

    op.drop_index("ix_miniapp_debug_access_expires_at", table_name="miniapp_debug_access")
    op.drop_index("ix_miniapp_debug_access_target", table_name="miniapp_debug_access")
    op.drop_index("ix_miniapp_debug_access_openid", table_name="miniapp_debug_access")
    op.drop_table("miniapp_debug_access")
