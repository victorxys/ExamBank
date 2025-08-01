"""add_is_generating_bills_to_contract

Revision ID: f970db585426
Revises: bd832e8ce2e3
Create Date: 2025-07-29 15:24:04.503192

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'f970db585426'
down_revision = 'bd832e8ce2e3'
branch_labels = None
depends_on = None


def upgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    with op.batch_alter_table('exampapercourse', schema=None) as batch_op:
        batch_op.drop_constraint('exampapercourse_course_id_fkey1', type_='foreignkey')
        batch_op.drop_constraint('exampapercourse_exam_paper_id_fkey', type_='foreignkey')
        batch_op.create_foreign_key(None, 'exampaper', ['exam_paper_id'], ['id'], ondelete='CASCADE')
        batch_op.create_foreign_key(None, 'trainingcourse', ['course_id'], ['id'], ondelete='CASCADE')

    # ### end Alembic commands ###


def downgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    with op.batch_alter_table('exampapercourse', schema=None) as batch_op:
        batch_op.drop_constraint(None, type_='foreignkey')
        batch_op.drop_constraint(None, type_='foreignkey')
        batch_op.create_foreign_key('exampapercourse_exam_paper_id_fkey', 'exampaper', ['exam_paper_id'], ['id'], ondelete='CASCADE')
        batch_op.create_foreign_key('exampapercourse_course_id_fkey1', 'trainingcourse', ['course_id'], ['id'], ondelete='CASCADE')

    # ### end Alembic commands ###
