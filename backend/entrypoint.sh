#!/bin/bash
set -e

# Wait for database to be ready
echo "Waiting for postgres..."
while ! nc -z db 5432; do
  sleep 0.1
done
echo "PostgreSQL started"

# Run migrations
echo "Running database migrations..."
# PYTHONPATH is /app, so we can run alembic from within the backend directory
# and it will find 'backend.models'
(cd backend && alembic upgrade head)

# Start application
echo "Starting application..."
exec uvicorn backend.main:socket_app --host 0.0.0.0 --port 8000

