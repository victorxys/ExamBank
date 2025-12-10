# Project Structure

## Repository Layout

```
examdb/
├── backend/              # Flask backend application
├── frontend/             # React frontend application
├── meng/                 # WeChat mini-program
├── migrations/           # Alembic database migrations (root level)
├── scripts/              # Utility scripts for data migration
├── tools/                # Database and development tools
├── db/                   # SQL dumps and database backups
├── docs/                 # Design documents
├── logs/                 # Application logs
└── instance/             # Flask instance folder (uploads, runtime data)
```

## Backend Structure (`backend/`)

```
backend/
├── api/                  # API route blueprints (modular endpoints)
│   ├── ai_generate.py
│   ├── billing_api.py
│   ├── contract_api.py
│   ├── course_resource_api.py
│   ├── dynamic_form_api.py
│   ├── evaluation*.py    # Multiple evaluation-related APIs
│   ├── financial_adjustment_api.py
│   ├── llm_config_api.py
│   ├── staff_api.py
│   ├── tts_api.py
│   ├── user_api.py
│   └── ...
├── migrations/           # Backend-specific migrations
├── scripts/              # Data processing and migration scripts
├── services/             # Business logic layer
├── static/               # Static files (TTS audio, etc.)
├── templates/            # Email/report templates
├── tests/                # Backend tests
├── app.py               # Main Flask application entry point
├── models.py            # SQLAlchemy ORM models
├── models_generated.py  # Auto-generated models (from sqlacodegen)
├── db.py                # Database connection utilities
├── extensions.py        # Flask extensions initialization (db, migrate)
├── tasks.py             # Celery async tasks
├── security_utils.py    # Password hashing utilities
└── requirements.txt     # Python dependencies
```

### API Blueprint Pattern

Each API module in `backend/api/` follows this pattern:
- Creates a Flask Blueprint
- Defines related routes
- Registered in `app.py` with URL prefix
- Example: `billing_bp`, `contract_bp`, `tts_bp`

### Database Models

- `models.py` - Hand-written ORM models with relationships
- `models_generated.py` - Auto-generated from existing schema
- Mixed usage: ORM for complex queries, raw SQL for performance-critical operations

## Frontend Structure (`frontend/`)

```
frontend/
├── src/
│   ├── components/       # Reusable React components
│   ├── pages/            # Page-level components (routes)
│   ├── contexts/         # React Context providers
│   ├── hooks/            # Custom React hooks
│   ├── utils/            # Utility functions
│   ├── services/         # API service layer (axios calls)
│   ├── App.jsx           # Root component
│   └── main.jsx          # Entry point
├── public/               # Static assets
├── dist/                 # Production build output
├── index.html            # HTML template
├── vite.config.js        # Vite configuration
├── tailwind.config.js    # Tailwind CSS configuration
├── eslint.config.js      # ESLint configuration
└── package.json          # Node dependencies
```

### Frontend Routing

- React Router DOM v7 for client-side routing
- Route definitions typically in `App.jsx` or dedicated router file
- Protected routes use JWT authentication check

### API Communication

- Axios configured with base URL and interceptors
- JWT token automatically attached to requests
- Services layer abstracts API calls from components

## WeChat Mini-Program (`meng/`)

```
meng/
├── pages/                # Mini-program pages
├── utils/                # Utility functions
├── images/               # Image assets
├── app.js                # Mini-program entry
├── app.json              # Configuration
└── app.wxss              # Global styles
```

## Database Migrations

### Root Level (`migrations/`)
- Alembic migrations for main database schema
- Managed via Flask-Migrate
- Version control for schema changes

### Backend Level (`backend/migrations/`)
- Additional SQL migration scripts
- Manual migrations for complex data transformations

## Scripts and Tools

### `scripts/` (Root)
- `migrate_jinshuju_*.py` - Data migration from external forms
- `backfill_*.py` - Data backfilling scripts
- Database inspection and debugging tools

### `backend/scripts/`
- Form processing and conversion scripts
- Schema inspection and validation
- Data transformation utilities
- Backup and restore operations

### `tools/`
- `initdb.py` - Database initialization
- `csv_to_sql.py` - Data import utilities
- `clear_tables.py` - Database cleanup
- Development helper scripts

## Configuration Files

### Root Level
- `.env` - Environment variables (gitignored)
- `package.json` - Root npm config (Husky, lint-staged)
- `gunicorn_config.py` - Production server config
- `celeryconfig.py` - Celery worker config
- `pytest.ini` - Test configuration
- `.gitignore` - Git ignore rules

### Backend
- `backend/.env` - Backend-specific environment
- `backend/requirements.txt` - Python dependencies

### Frontend
- `frontend/.env.development` - Dev environment
- `frontend/.env.production` - Production environment
- `frontend/package.json` - Frontend dependencies

## Key Conventions

### File Naming
- Python: snake_case (e.g., `user_api.py`, `billing_api.py`)
- JavaScript/React: PascalCase for components, camelCase for utilities
- Database tables: lowercase with underscores

### Import Patterns
- Backend: Absolute imports from `backend.*`
- Frontend: Relative imports or `@/` alias for src directory
- Models imported from `backend.models` or `backend.extensions`

### API Endpoints
- RESTful conventions: `/api/resource` for collections, `/api/resource/<id>` for items
- Blueprint prefixes: `/api/billing`, `/api/tts`, `/api/wechat`
- Authentication via `@jwt_required()` decorator

### Database Access
- ORM preferred for CRUD operations with relationships
- Raw SQL via `get_db_connection()` for complex queries or performance
- Always use parameterized queries (never string interpolation)
- Use `RealDictCursor` for dictionary-style results

### Error Handling
- Backend: Try-except blocks with proper rollback
- Frontend: Axios interceptors for global error handling
- Logging via Python's logging module to `logs/flask.log`

## Data Storage

### File Uploads
- `instance/uploads/` - User-uploaded files
- `backend/static/tts_audio/` - Generated TTS audio files
- `backend/data/avatars/` - User avatar images

### Logs
- `logs/flask.log` - Application logs
- `logs/gunicorn_*.log` - Production server logs

### Database Backups
- `db/` - SQL dumps organized by date
- Manual backups before major migrations
