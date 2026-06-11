"""add customer wechat accounts

Revision ID: b7c8d9e0f1a2
Revises: aa3c4d5e6f70
Create Date: 2026-06-09 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "b7c8d9e0f1a2"
down_revision = "aa3c4d5e6f70"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("customer_wechat_accounts"):
        return

    op.create_table(
        "customer_wechat_accounts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, comment="主键"),
        sa.Column("customer_id", postgresql.UUID(as_uuid=True), nullable=False, comment="关联客户ID"),
        sa.Column("mini_openid", sa.String(length=100), nullable=False, comment="微信小程序openid"),
        sa.Column("unionid", sa.String(length=100), nullable=True, comment="微信开放平台unionid"),
        sa.Column("phone_number", sa.String(length=20), nullable=True, comment="绑定手机号"),
        sa.Column(
            "bind_method",
            sa.String(length=50),
            server_default="contract_sign",
            nullable=False,
            comment="绑定方式: contract_sign/phone_verify/admin/dev_mock",
        ),
        sa.Column("verified_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True, comment="绑定验证时间"),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True, comment="最后登录时间"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True, comment="创建时间"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True, comment="更新时间"),
        sa.ForeignKeyConstraint(["customer_id"], ["customer.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("mini_openid", name="uq_customer_wechat_accounts_mini_openid"),
        comment="客户小程序微信身份绑定表",
    )
    op.create_index("ix_customer_wechat_accounts_customer_id", "customer_wechat_accounts", ["customer_id"], unique=False)
    op.create_index("ix_customer_wechat_accounts_unionid", "customer_wechat_accounts", ["unionid"], unique=False)


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("customer_wechat_accounts"):
        return

    op.drop_index("ix_customer_wechat_accounts_unionid", table_name="customer_wechat_accounts")
    op.drop_index("ix_customer_wechat_accounts_customer_id", table_name="customer_wechat_accounts")
    op.drop_table("customer_wechat_accounts")
