"""add session_id and event_type to play log

Revision ID: 708fb43ec328
Revises: bcef44d35683
Create Date: 2025-06-04 09:18:28.139799

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '708fb43ec328'
down_revision = 'bcef44d35683'
branch_labels = None
depends_on = None


def upgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_constraint('exampapercourse_course_id_fkey', 'exampapercourse', type_='foreignkey')
    op.drop_constraint('exampapercourse_exam_paper_id_fkey', 'exampapercourse', type_='foreignkey')
    op.create_foreign_key(None, 'exampapercourse', 'exampaper', ['exam_paper_id'], ['id'], source_schema='public', ondelete='CASCADE')
    op.create_foreign_key(None, 'exampapercourse', 'trainingcourse', ['course_id'], ['id'], source_schema='public', ondelete='CASCADE')
    op.add_column('user_resource_play_log', sa.Column('session_id', sa.String(length=100), nullable=True, comment='播放会话ID'))
    op.add_column('user_resource_play_log', sa.Column('event_type', sa.String(length=50), nullable=True, comment='事件类型 (e.g., session_start, heartbeat, session_end)'))
    op.create_index(op.f('ix_user_resource_play_log_session_id'), 'user_resource_play_log', ['session_id'], unique=False)
    # ### end Alembic commands ###


def downgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_index(op.f('ix_user_resource_play_log_session_id'), table_name='user_resource_play_log')
    op.drop_column('user_resource_play_log', 'event_type')
    op.drop_column('user_resource_play_log', 'session_id')
    op.drop_constraint(None, 'exampapercourse', schema='public', type_='foreignkey')
    op.drop_constraint(None, 'exampapercourse', schema='public', type_='foreignkey')
    op.create_foreign_key('exampapercourse_exam_paper_id_fkey', 'exampapercourse', 'exampaper', ['exam_paper_id'], ['id'], ondelete='CASCADE')
    op.create_foreign_key('exampapercourse_course_id_fkey', 'exampapercourse', 'trainingcourse', ['course_id'], ['id'], ondelete='CASCADE')
    # ### end Alembic commands ###
