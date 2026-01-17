#!/usr/bin/env python3
"""
Debug script for resource streaming issues
"""

import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from backend.models import CourseResource
from backend.extensions import db
from backend.app import create_app

def debug_resource_streaming():
    """Debug the specific resource that's having streaming issues"""
    
    app = create_app()
    
    with app.app_context():
        # The resource ID from the error log
        resource_id = "3a57cc78-6496-4d96-b679-597a8134c3e3"
        
        print(f"🔍 Debugging resource: {resource_id}")
        print("=" * 50)
        
        # Get resource from database
        resource = CourseResource.query.get(resource_id)
        if not resource:
            print("❌ Resource not found in database")
            return
        
        print(f"✅ Resource found: {resource.name}")
        print(f"   File path: {resource.file_path}")
        print(f"   MIME type: {resource.mime_type}")
        print(f"   Size in DB: {resource.size_bytes} bytes")
        
        # Check if it's a Qiniu Cloud URL
        is_qiniu = any(domain in resource.file_path for domain in ['mengyimengsao.com', 'qiniucdn.com', 'clouddn.com'])
        print(f"   Is Qiniu Cloud: {is_qiniu}")
        
        if is_qiniu:
            print("🎬 This is a Qiniu Cloud video - should use HLS streaming")
            print("   The error suggests it's trying to use local streaming instead")
            print("   Check if the frontend is correctly detecting Qiniu URLs")
        else:
            # Check local file
            instance_folder = app.instance_path
            file_absolute_path = os.path.join(instance_folder, resource.file_path)
            
            print(f"\n📁 Local file check:")
            print(f"   Instance folder: {instance_folder}")
            print(f"   Absolute path: {file_absolute_path}")
            print(f"   File exists: {os.path.exists(file_absolute_path)}")
            
            if os.path.exists(file_absolute_path):
                actual_size = os.path.getsize(file_absolute_path)
                print(f"   Actual file size: {actual_size} bytes")
                print(f"   Size matches DB: {actual_size == resource.size_bytes}")
                
                if actual_size != resource.size_bytes:
                    print("⚠️  File size mismatch detected!")
                    print("   This could cause ERR_CONTENT_LENGTH_MISMATCH errors")
                    
                # Check file permissions
                print(f"   File readable: {os.access(file_absolute_path, os.R_OK)}")
                
                # Try to read a small portion
                try:
                    with open(file_absolute_path, 'rb') as f:
                        f.seek(0, 2)  # Seek to end
                        file_size = f.tell()
                        print(f"   File size via seek: {file_size} bytes")
                        
                        # Try reading from the problematic range
                        problem_start = 41704212
                        if file_size > problem_start:
                            f.seek(problem_start)
                            data = f.read(1024)  # Read 1KB
                            print(f"   Can read from position {problem_start}: {len(data)} bytes")
                        else:
                            print(f"   ❌ File too small for requested range (start: {problem_start})")
                            
                except Exception as e:
                    print(f"   ❌ Error reading file: {e}")
            else:
                print("   ❌ File does not exist on disk")
        
        print("\n🔧 Recommendations:")
        if is_qiniu:
            print("   1. Ensure frontend correctly detects Qiniu URLs")
            print("   2. Check if qiniu-info API is being called")
            print("   3. Verify HLS streaming is being used")
        else:
            print("   1. Check file integrity and permissions")
            print("   2. Verify file size matches database record")
            print("   3. Consider re-uploading the file if corrupted")

if __name__ == "__main__":
    debug_resource_streaming()