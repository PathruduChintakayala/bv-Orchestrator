"""Add external_id to users and roles

Revision ID: add_external_id_users_roles
Revises: add_external_id_jobs
Create Date: 2026-01-06
"""
from alembic import op
import sqlalchemy as sa
import sqlmodel
import uuid

# revision identifiers, used by Alembic.
revision = 'add_external_id_users_roles'
down_revision = 'add_external_id_jobs'
branch_labels = None
depends_on = None


def _backfill(table_name: str):
    conn = op.get_bind()
    table = sa.table(table_name, sa.column('id', sa.Integer()), sa.column('external_id', sa.String()))
    rows = conn.execute(sa.select(table.c.id).where(table.c.external_id == None)).fetchall()  # noqa: E711
    for row in rows:
        conn.execute(
            sa.update(table)
            .where(table.c.id == row.id)
            .values(external_id=str(uuid.uuid4()))
        )


def upgrade():
    # Users
    op.add_column('user', sa.Column('external_id', sqlmodel.sql.sqltypes.AutoString(), nullable=True))
    _backfill('user')
    op.alter_column('user', 'external_id', existing_type=sqlmodel.sql.sqltypes.AutoString(), nullable=False)
    op.create_index('ix_user_external_id', 'user', ['external_id'], unique=True)

    # Roles
    op.add_column('roles', sa.Column('external_id', sqlmodel.sql.sqltypes.AutoString(), nullable=True))
    _backfill('roles')
    op.alter_column('roles', 'external_id', existing_type=sqlmodel.sql.sqltypes.AutoString(), nullable=False)
    op.create_index('ix_roles_external_id', 'roles', ['external_id'], unique=True)


def downgrade():
    op.drop_index('ix_roles_external_id', table_name='roles')
    op.drop_column('roles', 'external_id')

    op.drop_index('ix_user_external_id', table_name='user')
    op.drop_column('user', 'external_id')
