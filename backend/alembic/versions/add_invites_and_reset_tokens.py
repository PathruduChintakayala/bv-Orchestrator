"""Add invites and password reset token tables

Revision ID: add_invites_reset_tokens
Revises: add_machine_name_jobs
Create Date: 2026-01-05 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision = 'add_invites_reset_tokens'
down_revision = 'add_machine_name_jobs'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'user_invites',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('email', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('token_hash', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('role_ids_json', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('full_name', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('organization', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('message', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('created_by_user_id', sa.Integer(), nullable=True),
        sa.Column('accepted_at', sa.DateTime(), nullable=True),
        sa.Column('accepted_by_user_id', sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_user_invites_email', 'user_invites', ['email'], unique=False)
    op.create_index('ix_user_invites_token_hash', 'user_invites', ['token_hash'], unique=False)
    op.create_index('ix_user_invites_created_at', 'user_invites', ['created_at'], unique=False)
    op.create_index('ix_user_invites_expires_at', 'user_invites', ['expires_at'], unique=False)
    op.create_index('ix_user_invites_accepted_at', 'user_invites', ['accepted_at'], unique=False)
    op.create_index('ix_user_invites_created_by_user_id', 'user_invites', ['created_by_user_id'], unique=False)
    op.create_index('ix_user_invites_accepted_by_user_id', 'user_invites', ['accepted_by_user_id'], unique=False)

    op.create_table(
        'password_reset_tokens',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('token_hash', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('used_at', sa.DateTime(), nullable=True),
        sa.Column('created_ip', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_password_reset_tokens_user_id', 'password_reset_tokens', ['user_id'], unique=False)
    op.create_index('ix_password_reset_tokens_token_hash', 'password_reset_tokens', ['token_hash'], unique=False)
    op.create_index('ix_password_reset_tokens_created_at', 'password_reset_tokens', ['created_at'], unique=False)
    op.create_index('ix_password_reset_tokens_expires_at', 'password_reset_tokens', ['expires_at'], unique=False)
    op.create_index('ix_password_reset_tokens_used_at', 'password_reset_tokens', ['used_at'], unique=False)


def downgrade():
    op.drop_index('ix_password_reset_tokens_used_at', table_name='password_reset_tokens')
    op.drop_index('ix_password_reset_tokens_expires_at', table_name='password_reset_tokens')
    op.drop_index('ix_password_reset_tokens_created_at', table_name='password_reset_tokens')
    op.drop_index('ix_password_reset_tokens_token_hash', table_name='password_reset_tokens')
    op.drop_index('ix_password_reset_tokens_user_id', table_name='password_reset_tokens')
    op.drop_table('password_reset_tokens')

    op.drop_index('ix_user_invites_accepted_by_user_id', table_name='user_invites')
    op.drop_index('ix_user_invites_created_by_user_id', table_name='user_invites')
    op.drop_index('ix_user_invites_accepted_at', table_name='user_invites')
    op.drop_index('ix_user_invites_expires_at', table_name='user_invites')
    op.drop_index('ix_user_invites_created_at', table_name='user_invites')
    op.drop_index('ix_user_invites_token_hash', table_name='user_invites')
    op.drop_index('ix_user_invites_email', table_name='user_invites')
    op.drop_table('user_invites')
