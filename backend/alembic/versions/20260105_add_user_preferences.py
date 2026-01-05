"""Add user preferences column

Revision ID: add_user_preferences
Revises: add_user_security_fields
Create Date: 2026-01-05
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_user_preferences'
down_revision = 'add_user_security_fields'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('user', sa.Column('preferences_json', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('user', 'preferences_json')
