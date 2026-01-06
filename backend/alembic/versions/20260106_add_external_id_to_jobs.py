"""Add external_id to jobs

Revision ID: add_external_id_jobs
Revises: add_external_id_credential_stores
Create Date: 2026-01-06
"""
from alembic import op
import sqlalchemy as sa
import sqlmodel
import uuid

# revision identifiers, used by Alembic.
revision = 'add_external_id_jobs'
down_revision = 'add_external_id_credential_stores'
branch_labels = None
depends_on = None


def upgrade():
    # Add nullable first for backfill (SQLite-friendly), then backfill, then enforce not null + unique index.
    op.add_column('jobs', sa.Column('external_id', sqlmodel.sql.sqltypes.AutoString(), nullable=True))

    conn = op.get_bind()
    jobs_table = sa.table('jobs', sa.column('id', sa.Integer()), sa.column('external_id', sa.String()))
    rows = conn.execute(sa.select(jobs_table.c.id).where(jobs_table.c.external_id == None)).fetchall()  # noqa: E711
    for row in rows:
        conn.execute(
            sa.update(jobs_table)
            .where(jobs_table.c.id == row.id)
            .values(external_id=str(uuid.uuid4()))
        )

    op.alter_column('jobs', 'external_id', existing_type=sqlmodel.sql.sqltypes.AutoString(), nullable=False)
    op.create_index('ix_jobs_external_id', 'jobs', ['external_id'], unique=True)


def downgrade():
    op.drop_index('ix_jobs_external_id', table_name='jobs')
    op.drop_column('jobs', 'external_id')
