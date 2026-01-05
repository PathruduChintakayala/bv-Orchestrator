"""Add user security and token version fields

Revision ID: add_user_security_fields
Revises: add_revoked_at_invites
Create Date: 2026-01-05
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_user_security_fields'
down_revision = 'add_revoked_at_invites'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('user', sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('1')))
    op.add_column('user', sa.Column('disabled_at', sa.DateTime(), nullable=True))
    op.add_column('user', sa.Column('disabled_by_user_id', sa.Integer(), nullable=True))
    op.add_column('user', sa.Column('failed_login_attempts', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('user', sa.Column('last_failed_login_at', sa.DateTime(), nullable=True))
    op.add_column('user', sa.Column('locked_until', sa.DateTime(), nullable=True))
    op.add_column('user', sa.Column('token_version', sa.Integer(), nullable=False, server_default='1'))
    op.add_column('user', sa.Column('last_login', sa.DateTime(), nullable=True))
    op.create_index('ix_user_is_active', 'user', ['is_active'], unique=False)
    op.create_index('ix_user_disabled_at', 'user', ['disabled_at'], unique=False)
    op.create_index('ix_user_disabled_by_user_id', 'user', ['disabled_by_user_id'], unique=False)
    op.create_index('ix_user_last_failed_login_at', 'user', ['last_failed_login_at'], unique=False)
    op.create_index('ix_user_locked_until', 'user', ['locked_until'], unique=False)
    op.create_index('ix_user_last_login', 'user', ['last_login'], unique=False)


def downgrade():
    op.drop_index('ix_user_last_login', table_name='user')
    op.drop_index('ix_user_locked_until', table_name='user')
    op.drop_index('ix_user_last_failed_login_at', table_name='user')
    op.drop_index('ix_user_disabled_by_user_id', table_name='user')
    op.drop_index('ix_user_disabled_at', table_name='user')
    op.drop_index('ix_user_is_active', table_name='user')
    op.drop_column('user', 'last_login')
    op.drop_column('user', 'token_version')
    op.drop_column('user', 'locked_until')
    op.drop_column('user', 'last_failed_login_at')
    op.drop_column('user', 'failed_login_attempts')
    op.drop_column('user', 'disabled_by_user_id')
    op.drop_column('user', 'disabled_at')
    op.drop_column('user', 'is_active')