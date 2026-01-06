"""Queue item status/error contract update

Revision ID: queue_item_status_error_contract
Revises: add_revoked_at_invites
Create Date: 2026-01-06
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'queue_item_status_error_contract'
down_revision = 'add_revoked_at_invites'
branch_labels = None
depends_on = None

status_enum = sa.Enum('NEW', 'IN_PROGRESS', 'DONE', 'FAILED', 'ABANDONED', name='queueitemstatus')
error_type_enum = sa.Enum('APPLICATION', 'BUSINESS', name='queueitemerrortype')


def upgrade():
    # Add new columns before dropping legacy ones so data can be migrated safely.
    status_enum.create(op.get_bind(), checkfirst=True)
    error_type_enum.create(op.get_bind(), checkfirst=True)

    # Normalize deprecated status values to a supported terminal state before tightening the enum.
    op.execute("UPDATE queue_items SET status = 'ABANDONED' WHERE status = 'DELETED'")

    op.add_column('queue_items', sa.Column('output', sa.JSON(), nullable=True))
    op.add_column('queue_items', sa.Column('error_type', error_type_enum, nullable=True))
    op.add_column('queue_items', sa.Column('error_reason', sa.Text(), nullable=True))

    # Migrate legacy data into new columns.
    op.execute("UPDATE queue_items SET output = result WHERE result IS NOT NULL")
    op.execute("UPDATE queue_items SET error_reason = error_message WHERE error_message IS NOT NULL")
    op.execute("UPDATE queue_items SET error_type = 'APPLICATION' WHERE status = 'FAILED' AND error_type IS NULL")

    # Tighten status column to the new enum.
    op.alter_column('queue_items', 'status', existing_type=sa.String(), type_=status_enum, existing_nullable=False)

    # Drop legacy columns.
    op.drop_column('queue_items', 'result')
    op.drop_column('queue_items', 'error_message')


def downgrade():
    # Reintroduce legacy columns to hold migrated data before dropping new ones.
    op.add_column('queue_items', sa.Column('result', sa.Text(), nullable=True))
    op.add_column('queue_items', sa.Column('error_message', sa.Text(), nullable=True))

    # Migrate data back into legacy columns where possible.
    op.execute("UPDATE queue_items SET result = output WHERE output IS NOT NULL")
    op.execute("UPDATE queue_items SET error_message = error_reason WHERE error_reason IS NOT NULL")

    # Relax status back to string before removing enum types.
    op.alter_column('queue_items', 'status', existing_type=status_enum, type_=sa.String(), existing_nullable=False)

    # Drop new columns.
    op.drop_column('queue_items', 'error_reason')
    op.drop_column('queue_items', 'error_type')
    op.drop_column('queue_items', 'output')

    # Drop enum types.
    status_enum.drop(op.get_bind(), checkfirst=True)
    error_type_enum.drop(op.get_bind(), checkfirst=True)
*** End Patch