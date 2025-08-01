"""Add substitute_record_id to bills and payrolls uniqe

Revision ID: 2020170da134
Revises: 32b556ddd825
Create Date: 2025-07-24 10:40:41.854954

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '2020170da134'
down_revision = '32b556ddd825'
branch_labels = None
depends_on = None


def upgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    with op.batch_alter_table('customer_bills', schema=None) as batch_op:
        batch_op.drop_constraint('uq_bill_contract_period', type_='unique')
        batch_op.create_unique_constraint('uq_bill_contract_period', ['contract_id', 'year', 'month', 'cycle_start_date', 'source_substitute_record_id'])

    with op.batch_alter_table('employee_payrolls', schema=None) as batch_op:
        batch_op.drop_constraint('uq_payroll_contract_period', type_='unique')
        batch_op.create_unique_constraint('uq_payroll_contract_period', ['contract_id', 'year', 'month', 'cycle_start_date', 'source_substitute_record_id'])

    with op.batch_alter_table('exampapercourse', schema=None) as batch_op:
        batch_op.drop_constraint('exampapercourse_exam_paper_id_fkey', type_='foreignkey')
        batch_op.drop_constraint('exampapercourse_course_id_fkey1', type_='foreignkey')
        batch_op.create_foreign_key(None, 'exampaper', ['exam_paper_id'], ['id'], ondelete='CASCADE')
        batch_op.create_foreign_key(None, 'trainingcourse', ['course_id'], ['id'], ondelete='CASCADE')

    # ### end Alembic commands ###


def downgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    with op.batch_alter_table('exampapercourse', schema=None) as batch_op:
        batch_op.drop_constraint(None, type_='foreignkey')
        batch_op.drop_constraint(None, type_='foreignkey')
        batch_op.create_foreign_key('exampapercourse_course_id_fkey1', 'trainingcourse', ['course_id'], ['id'], ondelete='CASCADE')
        batch_op.create_foreign_key('exampapercourse_exam_paper_id_fkey', 'exampaper', ['exam_paper_id'], ['id'], ondelete='CASCADE')

    with op.batch_alter_table('employee_payrolls', schema=None) as batch_op:
        batch_op.drop_constraint('uq_payroll_contract_period', type_='unique')
        batch_op.create_unique_constraint('uq_payroll_contract_period', ['contract_id', 'year', 'month', 'cycle_start_date'])

    with op.batch_alter_table('customer_bills', schema=None) as batch_op:
        batch_op.drop_constraint('uq_bill_contract_period', type_='unique')
        batch_op.create_unique_constraint('uq_bill_contract_period', ['contract_id', 'year', 'month', 'cycle_start_date'])

    # ### end Alembic commands ###
