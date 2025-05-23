"""remove_share_slug_and_latest_flag_from_course_resource

Revision ID: 7228dc2a7677
Revises: 6290938714e0
Create Date: 2025-05-23 07:56:55.333924

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '7228dc2a7677'
down_revision = '6290938714e0'
branch_labels = None
depends_on = None


def upgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_index('ix_course_resource_share_slug', table_name='course_resource')
    op.drop_column('course_resource', 'is_latest_for_slug')
    op.drop_column('course_resource', 'share_slug')
    op.drop_constraint('exampapercourse_course_id_fkey', 'exampapercourse', type_='foreignkey')
    op.drop_constraint('exampapercourse_exam_paper_id_fkey', 'exampapercourse', type_='foreignkey')
    op.create_foreign_key(None, 'exampapercourse', 'trainingcourse', ['course_id'], ['id'], source_schema='public', ondelete='CASCADE')
    op.create_foreign_key(None, 'exampapercourse', 'exampaper', ['exam_paper_id'], ['id'], source_schema='public', ondelete='CASCADE')
    # ### end Alembic commands ###


def downgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_constraint(None, 'exampapercourse', schema='public', type_='foreignkey')
    op.drop_constraint(None, 'exampapercourse', schema='public', type_='foreignkey')
    op.create_foreign_key('exampapercourse_exam_paper_id_fkey', 'exampapercourse', 'exampaper', ['exam_paper_id'], ['id'], ondelete='CASCADE')
    op.create_foreign_key('exampapercourse_course_id_fkey', 'exampapercourse', 'trainingcourse', ['course_id'], ['id'], ondelete='CASCADE')
    op.add_column('course_resource', sa.Column('share_slug', sa.VARCHAR(length=128), autoincrement=False, nullable=True, comment='固定分享链接的唯一标识符 (slug)'))
    op.add_column('course_resource', sa.Column('is_latest_for_slug', sa.BOOLEAN(), server_default=sa.text('false'), autoincrement=False, nullable=False, comment='是否是此 share_slug 的最新版本'))
    op.create_index('ix_course_resource_share_slug', 'course_resource', ['share_slug'], unique=True)
    # ### end Alembic commands ###
