# Technology Stack

## Backend

**Framework & Core**
- Flask 3.0.0 with Flask-SQLAlchemy 3.0.5
- PostgreSQL database with UUID, JSONB, and ARRAY support
- SQLAlchemy 2.0.40 (supports mixed mode - both ORM and raw SQL)
- Alembic 1.15.2 for database migrations via Flask-Migrate

**Authentication & Security**
- Flask-JWT-Extended 4.5.3 (30-day token expiration)
- JWT tokens via headers and cookies
- pbkdf2 password hashing via Werkzeug
- CORS enabled for multiple frontend origins

**Async Processing**
- Celery 5.5.2 with Redis 6.1.0 as message broker
- Gevent 25.5.1 for async workers
- APScheduler 3.11.0 for scheduled tasks

**AI/LLM Integration**
- Google Generative AI (Gemini) 0.8.5
- Custom LLM configuration and prompt management
- TTS audio generation with multiple provider support

**Media Processing**
- MoviePy 1.0.3 for video synthesis
- PyMuPDF 1.26.0 for PDF processing
- Pillow 9.5.0 for image handling
- Pydub 0.25.1 for audio manipulation

**Utilities**
- pypinyin 0.54.0 for Chinese name search
- python-dotenv 1.0.0 for environment configuration
- psycopg2-binary 2.9.9 for PostgreSQL driver
- WeChat SDK integration (wechatpy 1.8.18)

**Production Server**
- Gunicorn 23.0.0 (10 workers, Unix socket binding)
- Configured for macOS deployment

## Frontend

**Framework & Build**
- React 18.2.0 with Vite 6.1.0
- React Router DOM 7.1.5 for routing

**UI Components**
- Material-UI (MUI) v5.15.21 with icons
- Radix UI components (Dialog, Popover, Select, Toast)
- Ant Design Mobile 5.41.1 for mobile views
- Tailwind CSS 4.1.17 with animations

**Data Visualization**
- ApexCharts 5.3.3 with React wrapper
- Recharts 2.15.1
- Material React Table 2.13.3

**Media & Special Features**
- React Player 2.16.0 for video playback
- Wavesurfer.js 7.9.5 for audio waveforms
- React Signature Canvas for digital signatures
- SurveyJS (survey-react-ui 2.3.15) for dynamic forms
- QRCode.react 4.2.0 for QR generation

**Utilities**
- Axios 1.7.9 for HTTP requests
- Lodash 4.17.21, dayjs 1.11.13, date-fns 2.30.0
- jwt-decode 4.0.0 for token parsing
- pinyin-pro 3.26.0 for Chinese text processing
- React Markdown 9.0.3 with GitHub flavored markdown

**Development Tools**
- ESLint 9.19.0 with React plugins
- Vite compression plugin for gzip
- PostCSS with Autoprefixer

## Database

**PostgreSQL Features Used**
- UUID primary keys (uuid-ossp extension)
- JSONB columns for flexible schema
- Array columns for multi-value fields
- Timezone-aware timestamps
- Complex indexes and constraints

## Code Quality

**Linting & Formatting**
- Backend: Ruff 0.4.4 (Python linter/formatter)
- Frontend: ESLint with React configuration
- Husky 9.1.7 for pre-commit hooks
- lint-staged 15.2.0 for staged file linting

## Common Commands

### Backend Development
```bash
# Setup
cd backend
pip install -r requirements.txt
export FLASK_APP=app.py

# Database migrations
flask db upgrade                    # Apply migrations
flask db migrate -m "description"   # Create new migration
flask db downgrade                  # Rollback migration

# Run development server
python backend/app.py               # Direct Flask (port 5001)

# Run Celery worker
celery -A backend.tasks worker --loglevel=info

# Production with Gunicorn
gunicorn -c gunicorn_config.py backend.app:app
```

### Frontend Development
```bash
cd frontend
npm install
npm run dev      # Development server (port 5175)
npm run build    # Production build
npm run preview  # Preview production build
npm run lint     # Run ESLint
```

### Code Quality
```bash
# Run linters manually
cd backend && ruff check --fix      # Python
cd frontend && npm run lint         # JavaScript/React

# Pre-commit hooks run automatically via Husky
```

## Environment Configuration

Required environment variables (`.env` files):
- `DATABASE_URL` - PostgreSQL connection string
- `SECRET_KEY` - Flask secret key
- `JWT_SECRET_KEY` - JWT signing key
- `BACKEND_BASE_URL` - Backend URL (default: http://localhost:5001)
- `FRONTEND_BASE_URL` - Frontend URL (default: http://localhost:5175)
- `FLASK_LOG_FILE` - Log file path

## Deployment

- Backend runs on Gunicorn with Unix socket
- Frontend built with Vite (gzip compression enabled)
- Nginx typically used as reverse proxy
- Celery workers for background tasks
- Redis for task queue and caching
