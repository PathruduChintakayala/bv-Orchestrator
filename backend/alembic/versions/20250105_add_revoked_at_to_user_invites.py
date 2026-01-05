"""Add revoked_at to user_invites

Revision ID: add_revoked_at_invites
Revises: add_invites_reset_tokens
Create Date: 2025-01-05
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_revoked_at_invites'
down_revision = 'add_invites_reset_tokens'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('user_invites', sa.Column('revoked_at', sa.DateTime(), nullable=True))
    op.create_index('ix_user_invites_revoked_at', 'user_invites', ['revoked_at'], unique=False)

def downgrade():
    op.drop_index('ix_user_invites_revoked_at', table_name='user_invites')
    op.drop_column('user_invites', 'revoked_at')
