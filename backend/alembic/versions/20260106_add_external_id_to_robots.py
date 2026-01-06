"""Add external_id to robots

Revision ID: add_external_id_robots
Revises: add_external_id_packages
Create Date: 2026-01-06
"""
from alembic import op
import sqlalchemy as sa
import sqlmodel
import uuid

# revision identifiers, used by Alembic.
revision = 'add_external_id_robots'
down_revision = 'add_external_id_packages'
branch_labels = None
depends_on = None


def upgrade():
    # Add nullable first for backfill (SQLite-friendly), then backfill, then enforce not null + unique index.
    op.add_column('robots', sa.Column('external_id', sqlmodel.sql.sqltypes.AutoString(), nullable=True))

    conn = op.get_bind()
    robots_table = sa.table('robots', sa.column('id', sa.Integer()), sa.column('external_id', sa.String()))
    rows = conn.execute(sa.select(robots_table.c.id).where(robots_table.c.external_id == None)).fetchall()  # noqa: E711
    for row in rows:
        conn.execute(
            sa.update(robots_table)
            .where(robots_table.c.id == row.id)
            .values(external_id=str(uuid.uuid4()))
        )

    op.alter_column('robots', 'external_id', existing_type=sqlmodel.sql.sqltypes.AutoString(), nullable=False)
    op.create_index('ix_robots_external_id', 'robots', ['external_id'], unique=True)


def downgrade():
    op.drop_index('ix_robots_external_id', table_name='robots')
    op.drop_column('robots', 'external_id')
