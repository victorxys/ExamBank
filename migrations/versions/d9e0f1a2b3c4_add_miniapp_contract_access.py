"""add miniapp contract access and evaluations

Revision ID: d9e0f1a2b3c4
Revises: c8d9e0f1a2b3
Create Date: 2026-06-10 13:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "d9e0f1a2b3c4"
down_revision = "c8d9e0f1a2b3"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("miniapp_contract_access"):
        op.create_table(
            "miniapp_contract_access",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, comment="主键"),
            sa.Column("mini_openid", sa.String(length=100), nullable=False, comment="微信小程序openid"),
            sa.Column("contract_id", postgresql.UUID(as_uuid=True), nullable=False, comment="关联合同ID"),
            sa.Column("customer_id", postgresql.UUID(as_uuid=True), nullable=True, comment="合同客户ID快照"),
            sa.Column(
                "relation_type",
                sa.String(length=50),
                server_default="contract_signer",
                nullable=False,
                comment="关系类型: contract_signer/attendance_signer/evaluation_submitter/manual_grant",
            ),
            sa.Column("source_token", sa.String(length=255), nullable=True, comment="产生关系的分享或签署token"),
            sa.Column("verified_phone", sa.String(length=20), nullable=True, comment="认证使用的手机号"),
            sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True, comment="认证或授权时间"),
            sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True, comment="最后使用时间"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True, comment="创建时间"),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True, comment="更新时间"),
            sa.ForeignKeyConstraint(["contract_id"], ["contracts.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["customer_id"], ["customer.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("mini_openid", "contract_id", "relation_type", name="uq_miniapp_contract_access_relation"),
            comment="小程序微信身份与合同的授权关系表",
        )
        op.create_index("ix_miniapp_contract_access_openid", "miniapp_contract_access", ["mini_openid"], unique=False)
        op.create_index("ix_miniapp_contract_access_contract_id", "miniapp_contract_access", ["contract_id"], unique=False)
        op.create_index("ix_miniapp_contract_access_customer_id", "miniapp_contract_access", ["customer_id"], unique=False)
        op.create_index("ix_miniapp_contract_access_source_token", "miniapp_contract_access", ["source_token"], unique=False)

    if not inspector.has_table("miniapp_contract_evaluations"):
        op.create_table(
            "miniapp_contract_evaluations",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, comment="主键"),
            sa.Column("mini_openid", sa.String(length=100), nullable=False, comment="微信小程序openid"),
            sa.Column("contract_id", postgresql.UUID(as_uuid=True), nullable=False, comment="关联合同ID"),
            sa.Column("customer_id", postgresql.UUID(as_uuid=True), nullable=True, comment="合同客户ID快照"),
            sa.Column("employee_id", postgresql.UUID(as_uuid=True), nullable=True, comment="被评价服务人员ID"),
            sa.Column("rating", sa.Integer(), nullable=False, comment="总体评分，1-5星"),
            sa.Column("tags", postgresql.JSONB(astext_type=sa.Text()), nullable=True, comment="评价标签"),
            sa.Column("comment", sa.Text(), nullable=True, comment="文字评价"),
            sa.Column("source_token", sa.String(length=255), nullable=True, comment="产生评价的分享token或来源"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True, comment="创建时间"),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True, comment="更新时间"),
            sa.ForeignKeyConstraint(["contract_id"], ["contracts.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["customer_id"], ["customer.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["employee_id"], ["service_personnel.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("mini_openid", "contract_id", name="uq_miniapp_contract_evaluation_openid_contract"),
            comment="小程序合同级客户评价表",
        )
        op.create_index("ix_miniapp_contract_evaluation_contract_id", "miniapp_contract_evaluations", ["contract_id"], unique=False)
        op.create_index("ix_miniapp_contract_evaluation_employee_id", "miniapp_contract_evaluations", ["employee_id"], unique=False)
        op.create_index("ix_miniapp_contract_evaluation_customer_id", "miniapp_contract_evaluations", ["customer_id"], unique=False)
        op.create_index("ix_miniapp_contract_evaluations_source_token", "miniapp_contract_evaluations", ["source_token"], unique=False)

    if not inspector.has_table("miniapp_contract_exit_summaries"):
        op.create_table(
            "miniapp_contract_exit_summaries",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, comment="主键"),
            sa.Column("contract_id", postgresql.UUID(as_uuid=True), nullable=False, comment="关联合同ID"),
            sa.Column("employee_id", postgresql.UUID(as_uuid=True), nullable=True, comment="填写下户总结的服务人员ID"),
            sa.Column("customer_id", postgresql.UUID(as_uuid=True), nullable=True, comment="合同客户ID快照"),
            sa.Column("mini_openid", sa.String(length=100), nullable=False, comment="填写人的微信小程序openid"),
            sa.Column("exit_date", sa.Date(), nullable=True, comment="下户日期"),
            sa.Column("learned", sa.Text(), nullable=True, comment="服务中的经验与亮点"),
            sa.Column("improved", sa.Text(), nullable=True, comment="后续可改进事项"),
            sa.Column("data", postgresql.JSONB(astext_type=sa.Text()), nullable=True, comment="扩展数据快照"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True, comment="创建时间"),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True, comment="更新时间"),
            sa.ForeignKeyConstraint(["contract_id"], ["contracts.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["customer_id"], ["customer.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["employee_id"], ["service_personnel.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("contract_id", "employee_id", name="uq_miniapp_contract_exit_summary_contract_employee"),
            comment="小程序合同级下户总结表",
        )
        op.create_index(
            "ix_miniapp_contract_exit_summary_contract_id",
            "miniapp_contract_exit_summaries",
            ["contract_id"],
            unique=False,
        )
        op.create_index(
            "ix_miniapp_contract_exit_summary_employee_id",
            "miniapp_contract_exit_summaries",
            ["employee_id"],
            unique=False,
        )
        op.create_index(
            "ix_miniapp_contract_exit_summary_openid",
            "miniapp_contract_exit_summaries",
            ["mini_openid"],
            unique=False,
        )


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("miniapp_contract_exit_summaries"):
        op.drop_index("ix_miniapp_contract_exit_summary_openid", table_name="miniapp_contract_exit_summaries")
        op.drop_index("ix_miniapp_contract_exit_summary_employee_id", table_name="miniapp_contract_exit_summaries")
        op.drop_index("ix_miniapp_contract_exit_summary_contract_id", table_name="miniapp_contract_exit_summaries")
        op.drop_table("miniapp_contract_exit_summaries")

    if inspector.has_table("miniapp_contract_evaluations"):
        op.drop_index("ix_miniapp_contract_evaluations_source_token", table_name="miniapp_contract_evaluations")
        op.drop_index("ix_miniapp_contract_evaluation_customer_id", table_name="miniapp_contract_evaluations")
        op.drop_index("ix_miniapp_contract_evaluation_employee_id", table_name="miniapp_contract_evaluations")
        op.drop_index("ix_miniapp_contract_evaluation_contract_id", table_name="miniapp_contract_evaluations")
        op.drop_table("miniapp_contract_evaluations")

    if not inspector.has_table("miniapp_contract_access"):
        return

    op.drop_index("ix_miniapp_contract_access_source_token", table_name="miniapp_contract_access")
    op.drop_index("ix_miniapp_contract_access_customer_id", table_name="miniapp_contract_access")
    op.drop_index("ix_miniapp_contract_access_contract_id", table_name="miniapp_contract_access")
    op.drop_index("ix_miniapp_contract_access_openid", table_name="miniapp_contract_access")
    op.drop_table("miniapp_contract_access")
