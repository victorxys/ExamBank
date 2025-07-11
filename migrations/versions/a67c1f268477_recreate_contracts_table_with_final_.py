"""Recreate contracts table with final structure

Revision ID: a67c1f268477
Revises: 88fe75840193
Create Date: 2025-07-09 14:28:42.062496

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a67c1f268477'
down_revision = '88fe75840193'
branch_labels = None
depends_on = None


def upgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    op.alter_column('contracts', 'start_date',
               existing_type=sa.DATE(),
               comment='合同开始日期 (育儿嫂)',
               existing_nullable=True)
    op.alter_column('contracts', 'end_date',
               existing_type=sa.DATE(),
               comment='合同结束日期 (育儿嫂和月嫂)',
               existing_nullable=True)
    op.alter_column('contracts', 'provisional_start_date',
               existing_type=sa.DATE(),
               comment='预产期 (月嫂)',
               existing_comment='预产期',
               existing_nullable=True)
    op.alter_column('contracts', 'actual_onboarding_date',
               existing_type=sa.DATE(),
               comment='实际上户日期 (月嫂)',
               existing_comment='实际上户日期',
               existing_nullable=True)
    op.drop_constraint('exampapercourse_course_id_fkey', 'exampapercourse', type_='foreignkey')
    op.drop_constraint('exampapercourse_exam_paper_id_fkey', 'exampapercourse', type_='foreignkey')
    op.create_foreign_key(None, 'exampapercourse', 'exampaper', ['exam_paper_id'], ['id'], source_schema='public', ondelete='CASCADE')
    op.create_foreign_key(None, 'exampapercourse', 'trainingcourse', ['course_id'], ['id'], source_schema='public', ondelete='CASCADE')
    # ### end Alembic commands ###


def downgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_constraint(None, 'exampapercourse', schema='public', type_='foreignkey')
    op.drop_constraint(None, 'exampapercourse', schema='public', type_='foreignkey')
    op.create_foreign_key('exampapercourse_exam_paper_id_fkey', 'exampapercourse', 'exampaper', ['exam_paper_id'], ['id'], ondelete='CASCADE')
    op.create_foreign_key('exampapercourse_course_id_fkey', 'exampapercourse', 'trainingcourse', ['course_id'], ['id'], ondelete='CASCADE')
    op.alter_column('contracts', 'actual_onboarding_date',
               existing_type=sa.DATE(),
               comment='实际上户日期',
               existing_comment='实际上户日期 (月嫂)',
               existing_nullable=True)
    op.alter_column('contracts', 'provisional_start_date',
               existing_type=sa.DATE(),
               comment='预产期',
               existing_comment='预产期 (月嫂)',
               existing_nullable=True)
    op.alter_column('contracts', 'end_date',
               existing_type=sa.DATE(),
               comment=None,
               existing_comment='合同结束日期 (育儿嫂和月嫂)',
               existing_nullable=True)
    op.alter_column('contracts', 'start_date',
               existing_type=sa.DATE(),
               comment=None,
               existing_comment='合同开始日期 (育儿嫂)',
               existing_nullable=True)
    # ### end Alembic commands ###
