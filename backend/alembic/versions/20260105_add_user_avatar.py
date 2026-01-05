"""Add user avatar fields

Revision ID: add_user_avatar
Revises: add_user_preferences
Create Date: 2026-01-05
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_user_avatar'
down_revision = 'add_user_preferences'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('user', sa.Column('avatar_url', sa.Text(), nullable=True))
    op.add_column('user', sa.Column('avatar_updated_at', sa.DateTime(), nullable=True))
    op.create_index('ix_user_avatar_updated_at', 'user', ['avatar_updated_at'], unique=False)


def downgrade():
    op.drop_index('ix_user_avatar_updated_at', table_name='user')
    op.drop_column('user', 'avatar_updated_at')
    op.drop_column('user', 'avatar_url')
