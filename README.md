# ExamBank

## Introduction

ExamBank is a comprehensive online examination platform designed for creating, managing, and taking exams. It leverages AI-powered features to enhance the examination process. The original name '题库及在线考试' translates to 'Question Bank and Online Exams'.

## Features

*   **User Authentication:** Secure login and registration system.
*   **Exam Management:** Create, update, delete, and manage exams and question banks.
*   **Online Exam Taking:** Interface for users to take exams online.
*   **Course and Resource Management:** Organize and access course materials and related resources.
*   **AI-Powered Content:**
    *   Leverages Large Language Models (LLMs) for generating educational content (e.g., questions, summaries).
    *   Configuration and logging for LLM interactions.
*   **Text-to-Speech (TTS):** Convert text content to speech, potentially for accessibility or enhanced learning.
*   **Employee Evaluations:** Functionality for conducting and managing employee self-evaluations and performance reviews.
*   **User Profile Management:** Users can manage their profiles and view their activities.
*   **Permission System:** Role-based access control for different user types.
*   **WeChat Integration:** Features related to WeChat sharing.

## Tech Stack

### Backend

*   **Framework:** Flask
*   **Programming Language:** Python
*   **Database:** PostgreSQL
*   **ORM:** SQLAlchemy
*   **Database Migrations:** Flask-Migrate (Alembic)
*   **Asynchronous Tasks:** Celery
*   **Message Broker/Cache:** Redis
*   **API Authentication:** JWT (PyJWT, Flask-JWT-Extended)
*   **WSGI Server:** Gunicorn (for production)

### Frontend

*   **Framework/Library:** React (v19)
*   **Build Tool:** Vite
*   **Programming Language:** JavaScript
*   **UI Library:** Material UI (MUI)
*   **State Management:** React Context API / Zustand / Redux
*   **API Client:** Axios
*   **Routing:** React Router DOM

### AI

*   **Generative AI:** Google Generative AI (Gemini)
*   **Text-to-Speech (TTS):** Custom TTS integration

## Project Structure

*   **`backend/`**: Contains the Flask (Python) backend application, including API endpoints, database models, business logic, and AI integrations.
*   **`frontend/`**: Contains the React (JavaScript/Vite) frontend application, including UI components, pages, and client-side logic.
*   **`migrations/`**: Houses database migration scripts managed by Alembic (via Flask-Migrate), used for evolving the database schema.
*   **`resource/`**: Contains static resources, potentially including data for exams, courses, or other application assets (e.g., JSON files, images).
*   **`tools/`**: Includes utility scripts for development and maintenance, such as database initialization scripts (`initdb.py`).
*   **`.husky/`**: Configuration for Husky, used for Git hooks (e.g., pre-commit checks).
*   **`celery_worker.py`**: Script to run the Celery worker for background task processing.
*   **Other configuration files**: Such as `.flaskenv`, `.gitignore`, `package.json`, etc., define environment settings, ignored files, and project dependencies.

## Prerequisites

Before you begin, ensure you have the following software installed on your system:

*   **Python:** (e.g., v3.9+). Check `backend/Pipfile` or `backend/requirements.txt` if a specific version is critical.
*   **Node.js and npm:** (e.g., Node v18+, npm v9+). Check `frontend/package.json` for specific version requirements (e.g., `engines` field if present).
*   **PostgreSQL:** A running instance of PostgreSQL server.
*   **Redis:** A running instance of Redis server (for Celery task queuing and caching).

## Setup and Installation

Follow these steps to set up the project environment on your local machine:

1.  **Clone the repository:**
    ```bash
    git clone <repository_url>
    cd <repository_directory>
    ```

### Backend Setup

1.  **Navigate to the backend directory:**
    ```bash
    cd backend
    ```
2.  **Create and activate a Python virtual environment:**
    *   We recommend using `venv`:
        ```bash
        python -m venv venv
        source venv/bin/activate  # On Windows use `venv\Scripts\activate`
        ```
3.  **Install Python dependencies:**
    ```bash
    pip install -r requirements.txt
    ```
4.  **Set up environment variables:**
    *   Copy the example environment file:
        ```bash
        cp .env.example .env
        ```
    *   Modify the `.env` file with your local configuration. Key variables include:
        *   `DATABASE_URL`: Connection string for your PostgreSQL database (e.g., `postgresql://user:password@host:port/dbname`)
        *   `SECRET_KEY`: A strong secret key for Flask sessions and JWT.
        *   `JWT_SECRET_KEY`: Secret key for JWT.
        *   `REDIS_URL`: Connection string for your Redis server (e.g., `redis://localhost:6379/0`)
        *   `GOOGLE_API_KEY`: Your API key for Google Generative AI services.
        *   (Add any other critical variables you might anticipate from the backend structure)
5.  **Set up the PostgreSQL Database:**
    *   Ensure your PostgreSQL server is running.
    *   Create a new database for the project (e.g., `exambank_db`).
    *   Ensure the user specified in `DATABASE_URL` has permissions to create tables and access this database.
6.  **Run database migrations:**
    *   Initialize Alembic (if first time and `migrations` folder is not fully set up - typically done once by a dev):
        ```bash
        # flask db init  (If not already done)
        ```
    *   Create an initial migration (if no migrations exist yet):
        ```bash
        # flask db migrate -m "Initial database schema" (If not already done)
        ```
    *   Apply migrations to create the database schema:
        ```bash
        flask db upgrade
        ```
    *   (Alternatively, if there's an `initdb.py` script in `tools/` meant for this, mention it. Based on `ls` output, `tools/initdb.py` exists. Let's assume `flask db upgrade` is the standard.)

### Frontend Setup

1.  **Navigate to the frontend directory:**
    ```bash
    cd ../frontend  # Assuming you are in the backend directory
    # Or from project root:
    # cd frontend
    ```
2.  **Install Node.js dependencies:**
    ```bash
    npm install
    ```
3.  **Set up environment variables:**
    *   The frontend might use environment variables for settings like the API endpoint. Check for an `.env.development.example` or similar, or create `.env.development` and/or `.env.production`.
    *   A common variable is `VITE_API_BASE_URL` which should point to your backend server (e.g., `VITE_API_BASE_URL=http://localhost:5000/api`).
    *   Create a `.env.development` file if it doesn't exist and add necessary variables:
        ```env
        VITE_API_BASE_URL=http://localhost:5000 # Adjust if your backend runs on a different port or path
        ```

## Running the Application

### Backend

1.  **Start the Flask development server:**
    ```bash
    cd backend  # If not already there
    flask run
    ```
    *   By default, this usually starts the server on `http://127.0.0.1:5000`.

2.  **Start the Celery worker (for background tasks):**
    *   Open a new terminal, navigate to the project root.
    *   Ensure your Python virtual environment (from `backend/venv`) is activated.
    *   Run the Celery worker:
        ```bash
        celery -A celery_worker.celery worker --loglevel=info
        ```
    *   (Note: `celery_worker.py` should define the Celery app instance, typically named `celery`. If it's different, this command needs adjustment. The `ls` output shows `celery_worker.py` in the root.)

### Frontend

1.  **Start the Vite development server:**
    ```bash
    cd frontend # If not already there
    npm run dev
    ```
    *   This will typically start the frontend application on `http://localhost:5173` (Vite's default) and often opens it in your browser. Check the terminal output for the exact URL.

Ensure your PostgreSQL and Redis servers are running before starting the backend services.

## Running Tests

### Backend Tests

The backend uses Python's `unittest` module or `pytest`. Ensure you are in the `backend` directory and your virtual environment is activated.

*   **Using unittest (if `test_app.py` is structured for it):**
    ```bash
    python -m unittest discover -s tests  # Assuming tests are in a 'tests' subdirectory
    # Or if test_app.py is in the root of backend:
    # python -m unittest test_app.py
    ```
    *   (Note: The `ls` output shows `backend/test_app.py`. We'll assume it can be run directly or there's a `tests` folder. If `backend/test_app.py` is the main test runner, the command might be simpler. Let's provide a common approach.)
    A common way to run tests if `test_app.py` contains them:
    ```bash
    cd backend
    python -m unittest test_app.py
    ```

*   **Using pytest (if installed and preferred):**
    ```bash
    cd backend
    pytest
    ```

### Frontend Tests

The frontend tests can be run using the npm script if configured.

1.  **Run frontend tests:**
    ```bash
    cd frontend
    npm test
    ```
    *   This command will execute the test script defined in `frontend/package.json`. Check this file for details on the testing framework used (e.g., Jest, Vitest).

Ensure all dependencies are installed and the application is configured correctly before running tests. Some tests might require a running database or other services.

## Contributing

## License
