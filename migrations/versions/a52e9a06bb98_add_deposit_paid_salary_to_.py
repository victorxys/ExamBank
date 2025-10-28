"""Add DEPOSIT_PAID_SALARY to AdjustmentType enum

Revision ID: a52e9a06bb98
Revises: 0240259fda98
Create Date: 2025-10-28 11:05:11.973583

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a52e9a06bb98'
down_revision = '0240259fda98'
branch_labels = None
depends_on = None


def upgrade():
    # ### Manually added command to update the ENUM ###
    op.execute("ALTER TYPE adjustmenttype ADD VALUE 'DEPOSIT_PAID_SALARY'")
    # ### end manual command ###


def downgrade():
    # ### Downgrading is destructive and not supported for this migration ###
    pass
    # ### end downgrade ###
