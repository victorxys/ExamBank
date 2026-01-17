#!/usr/bin/env python3
"""
Test script for Qiniu Cloud HLS integration
Run this script to test the new video streaming endpoints
"""

import requests
import json
import sys
import os

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

def test_qiniu_integration():
    """Test the Qiniu Cloud integration endpoints"""
    
    # Configuration
    BASE_URL = "http://localhost:5001/api"  # Adjust as needed
    
    # You'll need to replace these with actual values
    TEST_RESOURCE_ID = "your-test-resource-id"
    TEST_JWT_TOKEN = "your-test-jwt-token"
    
    headers = {
        "Authorization": f"Bearer {TEST_JWT_TOKEN}",
        "Content-Type": "application/json"
    }
    
    print("🧪 Testing Qiniu Cloud HLS Integration")
    print("=" * 50)
    
    # Test 1: Get video info
    print("\n1. Testing video info endpoint...")
    try:
        response = requests.get(
            f"{BASE_URL}/resources/{TEST_RESOURCE_ID}/qiniu-info",
            headers=headers,
            timeout=10
        )
        
        if response.status_code == 200:
            data = response.json()
            print("✅ Video info endpoint working")
            print(f"   Is Qiniu: {data.get('is_qiniu', 'Unknown')}")
            print(f"   Recommended URL: {data.get('recommended_url', 'None')[:80]}...")
        else:
            print(f"❌ Video info endpoint failed: {response.status_code}")
            print(f"   Response: {response.text}")
            
    except requests.RequestException as e:
        print(f"❌ Network error testing video info: {e}")
    
    # Test 2: Test MengSchool API connectivity
    print("\n2. Testing MengSchool API connectivity...")
    try:
        mengschool_url = "http://mengschool.mengyimengsao.com/api/v1/courses/public/video/hls-manifest"
        test_params = {"key": "test-key"}
        
        response = requests.get(
            mengschool_url,
            params=test_params,
            timeout=10
        )
        
        print(f"   MengSchool API response: {response.status_code}")
        if response.status_code != 200:
            print(f"   Response: {response.text[:200]}...")
        else:
            print("✅ MengSchool API is accessible")
            
    except requests.RequestException as e:
        print(f"❌ Cannot reach MengSchool API: {e}")
    
    # Test 3: Test proxy endpoint (if resource exists)
    print("\n3. Testing HLS proxy endpoint...")
    try:
        response = requests.get(
            f"{BASE_URL}/resources/{TEST_RESOURCE_ID}/qiniu-hls-proxy",
            headers=headers,
            timeout=10
        )
        
        if response.status_code == 200:
            print("✅ HLS proxy endpoint working")
            content_type = response.headers.get('content-type', 'unknown')
            print(f"   Content-Type: {content_type}")
        else:
            print(f"❌ HLS proxy endpoint failed: {response.status_code}")
            print(f"   Response: {response.text}")
            
    except requests.RequestException as e:
        print(f"❌ Network error testing HLS proxy: {e}")
    
    print("\n" + "=" * 50)
    print("🏁 Test completed")
    print("\nNote: Replace TEST_RESOURCE_ID and TEST_JWT_TOKEN with actual values to run full tests")

def test_video_utils():
    """Test the video utility functions"""
    print("\n🔧 Testing video utility functions")
    print("-" * 30)
    
    # Test URLs
    test_urls = [
        "https://rss.mengyimengsao.com/videos/example.mp4",
        "http://mengschool.mengyimengsao.com/api/v1/courses/public/video/hls-manifest?key=test",
        "uploads/local_video.mp4",
        "https://example.com/video.mp4"
    ]
    
    for url in test_urls:
        print(f"\nTesting URL: {url}")
        
        # Simulate the utility functions (since we can't import them directly)
        is_qiniu = any(domain in url for domain in ['mengyimengsao.com', 'qiniucdn.com', 'clouddn.com'])
        is_hls = '.m3u8' in url or 'hls-manifest' in url
        
        print(f"  Is Qiniu: {is_qiniu}")
        print(f"  Is HLS: {is_hls}")
        
        if is_qiniu and not is_hls:
            # Simulate URL conversion
            try:
                from urllib.parse import urlparse
                parsed = urlparse(url)
                key = parsed.path.lstrip('/')
                hls_url = f"http://mengschool.mengyimengsao.com/api/v1/courses/public/video/hls-manifest?key={key}"
                print(f"  Converted HLS URL: {hls_url}")
            except Exception as e:
                print(f"  Conversion error: {e}")

if __name__ == "__main__":
    print("Qiniu Cloud HLS Integration Test Suite")
    print("=====================================")
    
    # Test utility functions first
    test_video_utils()
    
    # Test API endpoints
    test_qiniu_integration()
    
    print("\n💡 Tips:")
    print("- Update TEST_RESOURCE_ID and TEST_JWT_TOKEN for full API testing")
    print("- Ensure backend server is running on localhost:5001")
    print("- Check network connectivity to mengschool.mengyimengsao.com")