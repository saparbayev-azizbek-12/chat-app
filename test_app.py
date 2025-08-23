#!/usr/bin/env python
"""
WhatsApp-like Chat App Test Script
Bu script barcha funksiyalarni test qiladi va development server'ni ishga tushiradi
"""

import os
import sys
import subprocess
import time
import requests
from pathlib import Path

def print_header(title):
    print("\n" + "="*60)
    print(f" {title} ")
    print("="*60)

def print_step(step):
    print(f"\n✓ {step}")

def print_error(error):
    print(f"\n❌ {error}")

def print_success(message):
    print(f"\n✅ {message}")

def check_requirements():
    """Check if all required packages are installed"""
    print_header("CHECKING REQUIREMENTS")
    
    required_packages = [
        ('django', 'django'),
        ('channels', 'channels'),
        ('PIL', 'pillow'),
        ('channels_redis', 'channels_redis')
    ]
    
    for import_name, display_name in required_packages:
        try:
            __import__(import_name)
            print_step(f"{display_name} is installed")
        except ImportError:
            print_error(f"{display_name} is not installed")
            return False
    
    return True

def run_migrations():
    """Create and apply migrations"""
    print_header("RUNNING MIGRATIONS")
    
    try:
        # Make migrations
        print_step("Creating migrations...")
        result = subprocess.run([
            sys.executable, 'manage.py', 'makemigrations'
        ], capture_output=True, text=True, cwd='.')
        
        if result.returncode != 0:
            print_error(f"Makemigrations failed: {result.stderr}")
            return False
        
        # Apply migrations
        print_step("Applying migrations...")
        result = subprocess.run([
            sys.executable, 'manage.py', 'migrate'
        ], capture_output=True, text=True, cwd='.')
        
        if result.returncode != 0:
            print_error(f"Migration failed: {result.stderr}")
            return False
        
        print_success("Migrations completed successfully")
        return True
        
    except Exception as e:
        print_error(f"Migration error: {e}")
        return False

def collect_static():
    """Collect static files"""
    print_header("COLLECTING STATIC FILES")
    
    try:
        result = subprocess.run([
            sys.executable, 'manage.py', 'collectstatic', '--noinput'
        ], capture_output=True, text=True, cwd='.')
        
        if result.returncode != 0:
            print_error(f"Collectstatic failed: {result.stderr}")
            return False
        
        print_success("Static files collected successfully")
        return True
        
    except Exception as e:
        print_error(f"Collectstatic error: {e}")
        return False

def create_superuser():
    """Create superuser if it doesn't exist"""
    print_header("CHECKING SUPERUSER")
    
    try:
        # Check if superuser exists
        result = subprocess.run([
            sys.executable, 'manage.py', 'shell', '-c',
            "from django.contrib.auth import get_user_model; User = get_user_model(); print('exists' if User.objects.filter(is_superuser=True).exists() else 'none')"
        ], capture_output=True, text=True, cwd='.')
        
        if 'exists' in result.stdout:
            print_step("Superuser already exists")
            return True
        
        print_step("Creating superuser...")
        print("\nPlease create a superuser account:")
        result = subprocess.run([
            sys.executable, 'manage.py', 'createsuperuser'
        ], cwd='.')
        
        return result.returncode == 0
        
    except Exception as e:
        print_error(f"Superuser creation error: {e}")
        return False

def check_file_structure():
    """Check if all required files exist"""
    print_header("CHECKING FILE STRUCTURE")
    
    required_files = [
        'manage.py',
        'config/settings.py',
        'config/urls.py',
        'config/asgi.py',
        'chat/models.py',
        'chat/views.py',
        'chat/consumers.py',
        'chat/routing.py',
        'chat/urls.py',
        'templates/chat/base.html',
        'templates/chat/home.html',
        'templates/chat/chat_room.html',
        'templates/chat/create_group.html',
        'static/css/style.css',
        'static/js/chat.js',
        'requirements.txt'
    ]
    
    missing_files = []
    for file_path in required_files:
        if Path(file_path).exists():
            print_step(f"✓ {file_path}")
        else:
            print_error(f"✗ {file_path}")
            missing_files.append(file_path)
    
    if missing_files:
        print_error(f"Missing files: {missing_files}")
        return False
    
    print_success("All required files exist")
    return True

def test_basic_functionality():
    """Test basic app functionality"""
    print_header("TESTING BASIC FUNCTIONALITY")
    
    # Test Django check
    print_step("Running Django system check...")
    result = subprocess.run([
        sys.executable, 'manage.py', 'check'
    ], capture_output=True, text=True, cwd='.')
    
    if result.returncode != 0:
        print_error(f"Django check failed: {result.stderr}")
        return False
    
    print_success("Django system check passed")
    return True

def start_development_server():
    """Start the development server"""
    print_header("STARTING DEVELOPMENT SERVER")
    
    print_step("Starting Django development server...")
    print("\n🚀 Server will be available at: http://127.0.0.1:8000")
    print("📱 Test on mobile by using your computer's IP address")
    print("\n🔥 WhatsApp-like Chat App Features:")
    print("   • Real-time messaging with WebSocket")
    print("   • File, image, video, audio sharing")
    print("   • Voice messages with recording")
    print("   • Emoji picker and reactions")
    print("   • Group chats with admin controls")
    print("   • Mobile-responsive design")
    print("   • Dark/Light theme toggle")
    print("   • Online status indicators")
    print("   • Message read receipts")
    print("   • Typing indicators")
    print("   • Message forwarding")
    print("\n⚙️  Admin panel: http://127.0.0.1:8000/admin/")
    print("\n🛑 Press Ctrl+C to stop the server")
    print("\n" + "="*60)
    
    try:
        subprocess.run([
            sys.executable, 'manage.py', 'runserver', '0.0.0.0:8000'
        ], cwd='.')
    except KeyboardInterrupt:
        print("\n\n🛑 Server stopped by user")
    except Exception as e:
        print_error(f"Server error: {e}")

def main():
    """Main test function"""
    print_header("WHATSAPP-LIKE CHAT APP SETUP & TEST")
    print("🚀 Setting up your WhatsApp-inspired chat application...")
    
    # Change to project directory
    if not os.path.exists('manage.py'):
        print_error("manage.py not found. Please run this script from the project root directory.")
        return
    
    # Run all checks and setup
    checks = [
        ("Checking requirements", check_requirements),
        ("Checking file structure", check_file_structure),
        ("Running migrations", run_migrations),
        ("Collecting static files", collect_static),
        ("Testing basic functionality", test_basic_functionality),
        ("Setting up superuser", create_superuser)
    ]
    
    for description, check_func in checks:
        if not check_func():
            print_error(f"Setup failed at: {description}")
            print("\n💡 Please fix the errors above and try again.")
            return
    
    print_success("🎉 All checks passed! App is ready to run.")
    
    # Start development server
    start_development_server()

if __name__ == '__main__':
    main()
