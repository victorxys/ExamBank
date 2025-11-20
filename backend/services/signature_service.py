# backend/services/signature_service.py
import os
import uuid
import base64
from flask import current_app, url_for
from werkzeug.utils import secure_filename

class SignatureService:
    def __init__(self):
        self.upload_folder = os.path.join(current_app.root_path, 'static', 'signatures')
        os.makedirs(self.upload_folder, exist_ok=True)

    def save_signature_from_base64(self, base64_data, signature_type, contract_id):
        """
        Saves a base64 encoded signature image to the file system.
        Returns the relative path to the saved file.
        """
        if not base64_data or not base64_data.startswith('data:'):
            raise ValueError("Invalid base64 data URI provided.")

        # Extract MIME type and actual base64 string
        header, encoded = base64_data.split(',', 1)
        mime_type = header.split(';')[0].split(':')[1]
        
        # Determine file extension from MIME type
        if 'image/png' in mime_type:
            ext = 'png'
        elif 'image/jpeg' in mime_type:
            ext = 'jpg'
        elif 'image/svg+xml' in mime_type:
            ext = 'svg'
        else:
            raise ValueError(f"Unsupported MIME type: {mime_type}")

        decoded_data = base64.b64decode(encoded)

        # Create a unique filename
        filename = secure_filename(f"{contract_id}_{signature_type}_{uuid.uuid4().hex}.{ext}")
        file_path = os.path.join(self.upload_folder, filename)

        with open(file_path, 'wb') as f:
            f.write(decoded_data)
        
        # Return relative path for database storage
        return os.path.join('static', 'signatures', filename), mime_type

    def get_signature_url(self, file_path):
        """
        Generates a full URL for a given signature file path.
        """
        if not file_path:
            return None
        
        # Assuming file_path is relative from the app's root, e.g., 'static/signatures/abc.png'
        # url_for needs a blueprint or app context to work correctly.
        # For simplicity, we'll construct it directly, but in a real app,
        # you might expose a dedicated endpoint for serving these files.
        backend_base_url = current_app.config.get('BACKEND_BASE_URL', '')
        return f"{backend_base_url}/{file_path}"

    def delete_signature_file(self, file_path):
        """
        Deletes a signature file from the file system.
        """
        if not file_path:
            return False
        
        full_path = os.path.join(current_app.root_path, file_path)
        if os.path.exists(full_path):
            os.remove(full_path)
            return True
        return False
