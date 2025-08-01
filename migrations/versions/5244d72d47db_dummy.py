"""dummy migration file"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '5244d72d47db'
down_revision = '92aa574c3ac2'
branch_labels = None
depends_on = None

def upgrade():
    # This is a dummy file, so the upgrade path is not needed.
    # The original upgrade was already (incorrectly) applied.
    pass

def downgrade():
    # Manually define the operations to revert the schema changes.
    with op.batch_alter_table('substitute_records', schema=None) as batch_op:
        batch_op.drop_column('substitute_days')
        batch_op.drop_column('management_fee_rate')
