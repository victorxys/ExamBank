"""增加客交保证金为育儿嫂合同

Revision ID: 1944e200e358
Revises: b3950cc3a445
Create Date: 2025-07-28 15:37:45.636585

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '1944e200e358'
down_revision = 'b3950cc3a445'
branch_labels = None
depends_on = None


def upgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    with op.batch_alter_table('exampapercourse', schema=None) as batch_op:
        batch_op.drop_constraint('exampapercourse_exam_paper_id_fkey', type_='foreignkey')
        batch_op.drop_constraint('exampapercourse_course_id_fkey', type_='foreignkey')
        batch_op.create_foreign_key(None, 'trainingcourse', ['course_id'], ['id'], ondelete='CASCADE')
        batch_op.create_foreign_key(None, 'exampaper', ['exam_paper_id'], ['id'], ondelete='CASCADE')

    # ### end Alembic commands ###


def downgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    with op.batch_alter_table('exampapercourse', schema=None) as batch_op:
        batch_op.drop_constraint(None, type_='foreignkey')
        batch_op.drop_constraint(None, type_='foreignkey')
        batch_op.create_foreign_key('exampapercourse_course_id_fkey', 'trainingcourse', ['course_id'], ['id'], ondelete='CASCADE')
        batch_op.create_foreign_key('exampapercourse_exam_paper_id_fkey', 'exampaper', ['exam_paper_id'], ['id'], ondelete='CASCADE')

    # ### end Alembic commands ###
