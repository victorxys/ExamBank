"""add substitute_management_fee to adjustmenttype enum

Revision ID: 45fcaf6a06b7
Revises: be3e56ced248
Create Date: 2025-10-20 21:48:14.191386

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '45fcaf6a06b7'
down_revision = 'be3e56ced248'
branch_labels = None
depends_on = None


def upgrade():
    # op.execute("ALTER TYPE adjustmenttype ADqD VALUE 'substitute_management_fee'")
    op.execute("ALTER TYPE adjustmenttype ADD VALUE 'SUBSTITUTE_MANAGEMENT_FEE'")


def downgrade():
    op.execute("ALTER TABLE financial_adjustments ALTER COLUMN adjustment_type TYPE TEXT;")
    op.execute("DROP TYPE adjustmenttype;")
    op.execute("""
        CREATE TYPE adjustmenttype AS ENUM(
            'CUSTOMER_INCREASE', 
            'CUSTOMER_DECREASE', 
            'CUSTOMER_DISCOUNT', 
            'EMPLOYEE_INCREASE', 
            'EMPLOYEE_DECREASE', 
            'EMPLOYEE_CLIENT_PAYMENT', 
            'EMPLOYEE_COMMISSION', 
            'EMPLOYEE_COMMISSION_OFFSET', 
            'DEFERRED_FEE', 
            'INTRODUCTION_FEE', 
            'DEPOSIT', 
            'COMPANY_PAID_SALARY'
        );
    """)
    op.execute("ALTER TABLE financial_adjustments ALTER COLUMN adjustment_type TYPE adjustmenttype USING adjustment_type::adjustmenttype;")