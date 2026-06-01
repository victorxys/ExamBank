"""add system settings table

Revision ID: 7027b9c4f46a
Revises: 83b7d0a869a9
Create Date: 2026-06-01 10:25:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '7027b9c4f46a'
down_revision = '83b7d0a869a9'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('system_settings',
    sa.Column('id', sa.String(length=100), nullable=False, comment='配置键名'),
    sa.Column('value', sa.JSON(), nullable=False, comment='配置值(JSON)'),
    sa.Column('description', sa.String(length=255), nullable=True, comment='说明'),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    comment='系统全局配置表'
    )


def downgrade():
    op.drop_table('system_settings')
