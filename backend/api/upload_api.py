from flask import Blueprint, request, jsonify, current_app
import boto3
from botocore.client import Config
import os
import uuid
from werkzeug.utils import secure_filename

upload_bp = Blueprint('upload_api', __name__, url_prefix='/api/upload')

# Configuration
CF_ACCOUNT_ID = os.environ.get("CF_ACCOUNT_ID")
R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY")
R2_BUCKET_NAME = os.environ.get("R2_BUCKET_NAME")
PUBLIC_DOMAIN = os.environ.get("PUBLIC_DOMAIN")

def get_r2_client():
    if not all([CF_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, PUBLIC_DOMAIN]):
        current_app.logger.error("Missing R2 configuration")
        return None

    return boto3.client(
        's3',
        endpoint_url=f'https://{CF_ACCOUNT_ID}.r2.cloudflarestorage.com',
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        config=Config(signature_version='s3v4')
    )

@upload_bp.route('/r2', methods=['POST'])
def upload_to_r2():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400

    if file:
        try:
            s3 = get_r2_client()
            if not s3:
                return jsonify({'error': 'Server configuration error'}), 500

            filename = secure_filename(file.filename)
            # Generate a unique filename to prevent collisions
            unique_filename = f"uploads/{uuid.uuid4()}/{filename}"
            
            s3.put_object(
                Bucket=R2_BUCKET_NAME,
                Key=unique_filename,
                Body=file,
                ContentType=file.content_type
            )
            
            url = f"{PUBLIC_DOMAIN}/{unique_filename}"
            return jsonify({'url': url}), 200
            
        except Exception as e:
            current_app.logger.error(f"Error uploading to R2: {e}")
            return jsonify({'error': str(e)}), 500

    return jsonify({'error': 'Unknown error'}), 500
