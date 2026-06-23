"""add user wechat accounts

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-06-23 17:40:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "f2a3b4c5d6e7"
down_revision = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("user_wechat_accounts"):
        return

    op.create_table(
        "user_wechat_accounts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, comment="主键"),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False, comment="关联后台用户ID"),
        sa.Column("mini_openid", sa.String(length=100), nullable=False, comment="微信小程序openid"),
        sa.Column("unionid", sa.String(length=100), nullable=True, comment="微信开放平台unionid"),
        sa.Column("phone_number", sa.String(length=20), nullable=True, comment="绑定手机号"),
        sa.Column(
            "bind_method",
            sa.String(length=50),
            server_default="phone_password_verify",
            nullable=False,
            comment="绑定方式: phone_password_verify/admin/dev_mock",
        ),
        sa.Column("verified_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True, comment="绑定验证时间"),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True, comment="最后登录时间"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True, comment="创建时间"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True, comment="更新时间"),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("mini_openid", name="uq_user_wechat_accounts_mini_openid"),
        comment="后台用户小程序微信身份绑定表",
    )
    op.create_index("ix_user_wechat_accounts_user_id", "user_wechat_accounts", ["user_id"], unique=False)
    op.create_index("ix_user_wechat_accounts_unionid", "user_wechat_accounts", ["unionid"], unique=False)


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("user_wechat_accounts"):
        return

    op.drop_index("ix_user_wechat_accounts_unionid", table_name="user_wechat_accounts")
    op.drop_index("ix_user_wechat_accounts_user_id", table_name="user_wechat_accounts")
    op.drop_table("user_wechat_accounts")
