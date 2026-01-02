FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for psycopg2 and wait script
RUN apt-get update && apt-get install -y \
    libpq-dev \
    gcc \
    netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source into a 'backend' subdirectory to maintain package structure
COPY . ./backend

# Move entrypoint script to root for easier access
RUN mv ./backend/entrypoint.sh ./entrypoint.sh && chmod +x ./entrypoint.sh

# Set PYTHONPATH to allow importing 'backend'
ENV PYTHONPATH=/app

EXPOSE 8000

CMD ["./entrypoint.sh"]

