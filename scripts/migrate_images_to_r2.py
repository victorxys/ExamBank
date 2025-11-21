import os
import json
import requests
import boto3
from botocore.client import Config
from urllib.parse import urlparse
from backend.app import app
from backend.extensions import db
from backend.models import DynamicFormData, DynamicForm
from sqlalchemy.orm.attributes import flag_modified

# Configuration
CF_ACCOUNT_ID = os.environ.get("CF_ACCOUNT_ID")
R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY")
R2_BUCKET_NAME = os.environ.get("R2_BUCKET_NAME")
PUBLIC_DOMAIN = os.environ.get("PUBLIC_DOMAIN")

if not all([CF_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, PUBLIC_DOMAIN]):
    print("Error: Missing R2 configuration in .env file.")

# S3 Client Setup
s3 = boto3.client(
    's3',
    endpoint_url=f'https://{CF_ACCOUNT_ID}.r2.cloudflarestorage.com',
    aws_access_key_id=R2_ACCESS_KEY_ID,
    aws_secret_access_key=R2_SECRET_ACCESS_KEY,
    config=Config(signature_version='s3v4')
)

def upload_to_r2(file_content, file_name, content_type):
    try:
        s3.put_object(
            Bucket=R2_BUCKET_NAME,
            Key=file_name,
            Body=file_content,
            ContentType=content_type
        )
        return f"{PUBLIC_DOMAIN}/{file_name}"
    except Exception as e:
        print(f"Error uploading {file_name}: {e}")
        return None

def is_jinshuju_url(url):
    if not url or not isinstance(url, str):
        return False
    return 'jinshujufiles.com' in url

def migrate_url(url, entry, field_key, original_filename=None):
    try:
        print(f"  Downloading: {url[:60]}...")
        response = requests.get(url, stream=True, timeout=30)
        if response.status_code == 200:
            if not original_filename:
                parsed_url = urlparse(url)
                original_filename = os.path.basename(parsed_url.path)
            
            if not original_filename:
                original_filename = f"file_{os.urandom(4).hex()}.jpg"
            
            # Structure: form_token/entry_id/field_key/filename
            # We need form_token. We can get it from entry.form (relationship) if available, 
            # or fetch it. But fetching per URL is expensive.
            # We will pass form_token to this function or assume entry has it.
            # entry.form_token is not a direct attribute usually, it's on DynamicForm.
            # But we can pass it.
            
            # Let's assume we pass form_token.
            pass
    except Exception as e:
        print(f"  Error downloading: {e}")
        return None

def migrate_url_with_token(url, entry, field_key, form_token, original_filename=None):
    try:
        print(f"  Downloading: {url[:60]}...")
        response = requests.get(url, stream=True, timeout=30)
        if response.status_code == 200:
            if not original_filename:
                parsed_url = urlparse(url)
                original_filename = os.path.basename(parsed_url.path)
            
            if not original_filename:
                original_filename = f"file_{os.urandom(4).hex()}.jpg"
            
            # Structure: form_token/entry_id/field_key/filename
            new_filename = f"{form_token}/{entry.id}/{field_key}/{original_filename}"
            
            content_type = response.headers.get('Content-Type', 'application/octet-stream')
            new_url = upload_to_r2(response.content, new_filename, content_type)
            
            if new_url:
                print(f"  -> Migrated to: {new_url}")
                return new_url
            else:
                print("  -> Upload failed")
                return None
        else:
            print(f"  -> Download failed ({response.status_code})")
            return None
    except Exception as e:
        print(f"  Error processing URL: {e}")
        return None

import argparse
import sys

# ... (imports remain the same, but need to ensure argparse is imported if not already)

def migrate_entry_generic(entry, form_token, dry_run=False):
    data = entry.data
    updated = False
    migrated_count = 0
    
    for key, value in data.items():
        # 1. List of items (could be dicts or strings)
        if isinstance(value, list):
            new_list = []
            list_updated = False
            for item in value:
                # Dict (SurveyJS file object)
                if isinstance(item, dict) and 'content' in item:
                    url = item['content']
                    if is_jinshuju_url(url):
                        if dry_run:
                            print(f"  [Dry Run] Found image to migrate: {url[:60]}...")
                            migrated_count += 1
                            new_list.append(item) # Keep original
                        else:
                            new_url = migrate_url_with_token(url, entry, key, form_token, item.get('name'))
                            if new_url:
                                item['content'] = new_url
                                new_list.append(item)
                                list_updated = True
                                updated = True
                                migrated_count += 1
                            else:
                                new_list.append(item)
                    else:
                        new_list.append(item)
                
                # String URL
                elif isinstance(item, str) and is_jinshuju_url(item):
                    if dry_run:
                        print(f"  [Dry Run] Found image to migrate: {item[:60]}...")
                        migrated_count += 1
                        new_list.append(item)
                    else:
                        new_url = migrate_url_with_token(item, entry, key, form_token)
                        if new_url:
                            new_list.append(new_url)
                            list_updated = True
                            updated = True
                            migrated_count += 1
                        else:
                            new_list.append(item)
                else:
                    new_list.append(item)
            
            if list_updated:
                data[key] = new_list
        
        # 2. Single String URL
        elif isinstance(value, str) and is_jinshuju_url(value):
            if dry_run:
                print(f"  [Dry Run] Found image to migrate: {value[:60]}...")
                migrated_count += 1
            else:
                new_url = migrate_url_with_token(value, entry, key, form_token)
                if new_url:
                    data[key] = new_url
                    updated = True
                    migrated_count += 1

    if updated and not dry_run:
        flag_modified(entry, "data")
        db.session.commit()
        print(f"Entry {entry.id} updated successfully.")
    
    return migrated_count

def main():
    parser = argparse.ArgumentParser(description='Migrate Jinshuju images to R2')
    parser.add_argument('--dry-run', action='store_true', help='Scan for images to migrate without processing them')
    args = parser.parse_args()

    with app.app_context():
        print(f"--- Starting Generic Batch Migration for ALL Forms (Dry Run: {args.dry_run}) ---")
        
        forms = DynamicForm.query.all()
        print(f"Found {len(forms)} forms.")
        
        total_images_found = 0
        
        for form in forms:
            print(f"\nProcessing Form: {form.form_token} ({form.name})")
            
            entries = DynamicFormData.query.filter_by(form_id=form.id).order_by(DynamicFormData.id).all()
            total_entries = len(entries)
            print(f"Found {total_entries} entries.")
            
            form_images_count = 0
            for i, entry in enumerate(entries):
                # if i % 10 == 0:
                #     print(f"  Progress: {i}/{total_entries}")
                count = migrate_entry_generic(entry, form.form_token, dry_run=args.dry_run)
                form_images_count += count
            
            print(f"  -> Form {form.form_token}: {form_images_count} images to migrate.")
            total_images_found += form_images_count
            
        print(f"\n--- All Migrations Completed. Total images to migrate: {total_images_found} ---")

if __name__ == "__main__":
    main()
