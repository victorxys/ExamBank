import pytest
from flask import Flask
from backend.extensions import db, migrate
from sqlalchemy import event
import os
import sqlalchemy as sa
from flask_jwt_extended import JWTManager
from backend.models import User

# Import the blueprint that the test file needs
from backend.api.dynamic_form_data_api import dynamic_form_data_bp
from backend.api.contract_template_api import contract_template_bp

@pytest.fixture(scope='session')
def _app():
    """
    Session-wide test `Flask` application.
    Creates a minimal Flask app for testing to avoid problematic imports.
    """
    app = Flask(__name__)
    app.config.update({
        "TESTING": True,
        "SQLALCHEMY_DATABASE_URI": "postgresql://postgres:xys131313@localhost:5432/ExamDB",
        "SECRET_KEY": "test_secret_key",
        "JWT_SECRET_KEY": "test_jwt_secret_key",
        "JWT_ACCESS_TOKEN_EXPIRES": 3600,
        "SERVER_NAME": "localhost",
        "JWT_TOKEN_LOCATION": ["headers"] # Add token location for JWT
    })

    db.init_app(app)
    migrate.init_app(app, db)
    jwt = JWTManager(app) # Initialize JWTManager

    # Define a user lookup loader for JWT
    @jwt.user_lookup_loader
    def user_lookup_loader(_jwt_header, jwt_data):
        identity = jwt_data["sub"]
        return User.query.get(identity)

    # Register the blueprint required for the tests
    app.register_blueprint(dynamic_form_data_bp)
    app.register_blueprint(contract_template_bp)

    with app.app_context():
        yield app

@pytest.fixture(scope='function')
def client(_app):
    """
    A test client for the app.
    """
    return _app.test_client()

@pytest.fixture(scope='function')
def db_session(_app):
    """
    Provides a transactional database session for each test.
    This pattern ensures that each test runs in a clean transaction,
    which is rolled back at the end, preventing tests from affecting each other.
    """
    with _app.app_context():
        # Start a new nested transaction
        transaction = db.session.begin_nested()
        
        yield db.session

        # Rollback the transaction after the test is done
        transaction.rollback()
