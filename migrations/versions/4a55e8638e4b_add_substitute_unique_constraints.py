"""Add substitute unique constraints

Revision ID: 4a55e8638e4b
Revises: ed2eab73c8df
Create Date: 2025-07-24 10:25:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '4a55e8638e4b'
down_revision = 'ed2eab73c8df'
branch_labels = None
depends_on = None

def upgrade():
    with op.batch_alter_table('customer_bills', schema=None) as batch_op:
        batch_op.add_column(sa.Column('source_substitute_record_id', postgresql.UUID(as_uuid=True), nullable=True))
        batch_op.create_foreign_key('fk_customer_bills_source_substitute_record_id', 'substitute_records', ['source_substitute_record_id'], ['id'], ondelete='SET NULL')
        batch_op.drop_constraint('uq_bill_contract_period', type_='unique')
        batch_op.create_unique_constraint('uq_bill_contract_period_substitute', ['contract_id', 'cycle_start_date', 'source_substitute_record_id'])

    with op.batch_alter_table('employee_payrolls', schema=None) as batch_op:
        batch_op.add_column(sa.Column('source_substitute_record_id', postgresql.UUID(as_uuid=True), nullable=True))
        batch_op.create_foreign_key('fk_employee_payrolls_source_substitute_record_id', 'substitute_records', ['source_substitute_record_id'], ['id'], ondelete='SET NULL')
        batch_op.drop_constraint('uq_payroll_contract_period', type_='unique')
        batch_op.create_unique_constraint('uq_payroll_contract_period_substitute', ['contract_id', 'cycle_start_date', 'source_substitute_record_id'])

def downgrade():
    with op.batch_alter_table('employee_payrolls', schema=None) as batch_op:
        batch_op.drop_constraint('uq_payroll_contract_period_substitute', type_='unique')
        batch_op.create_unique_constraint('uq_payroll_contract_period', ['contract_id', 'year', 'month', 'cycle_start_date'])
        batch_op.drop_constraint('fk_employee_payrolls_source_substitute_record_id', type_='foreignkey')
        batch_op.drop_column('source_substitute_record_id')

    with op.batch_alter_table('customer_bills', schema=None) as batch_op:
        batch_op.drop_constraint('uq_bill_contract_period_substitute', type_='unique')
        batch_op.create_unique_constraint('uq_bill_contract_period', ['contract_id', 'year', 'month', 'cycle_start_date'])
        batch_op.drop_constraint('fk_customer_bills_source_substitute_record_id', type_='foreignkey')
        batch_op.drop_column('source_substitute_record_id')
