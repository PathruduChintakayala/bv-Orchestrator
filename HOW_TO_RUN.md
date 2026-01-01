# HOW_TO_RUN

FastAPI backend runs consistently on Windows, Linux, Docker, and CI with Python 3.12.

## Prerequisites
- Python 3.12
- pip
- (Recommended) virtual environment

## Setup
1) From repo root: `python -m venv .venv`
2) Activate venv:
   - Windows: `.venv\Scripts\activate`
   - Linux/macOS: `source .venv/bin/activate`
3) Install backend deps: `pip install -r backend/requirements.txt`

## Run (canonical command)
- `python -m uvicorn backend.main:app`
- Optional for development: add `--reload` to the same command.

## API Docs
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## Common Errors & Fixes
- ImportError about relative imports: use the canonical command above (do **not** run `uvicorn main:app`).
- bcrypt missing `__about__`: reinstall deps to ensure `bcrypt==4.0.1` and `passlib[bcrypt]==1.7.4` are installed.
- Password too long for bcrypt: passwords are pre-hashed with SHA-256 when over 72 bytes; no user action needed.
- Avoid setting PYTHONPATH or running from inside backend/; always run from repo root with the canonical command.

## Warnings
- Do **not** run `uvicorn main:app` or `python backend/main.py`.
- Do **not** change imports back to relative paths.
