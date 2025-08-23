# 🚀 WhatsApp-like Chat App

A modern, real-time chat application inspired by WhatsApp, built with Django and WebSocket technology. Features include instant messaging, media sharing, voice messages, group chats, and much more!

## ✨ Features

### 💬 **Core Messaging**
- **Real-time messaging** with WebSocket technology
- **Typing indicators** to see when someone is typing
- **Message read receipts** with delivery confirmations
- **Message reactions** (👍 ❤️ 😂 😮 😢 😡 👏 🔥)
- **Message forwarding** to other chats
- **Message editing** (within 24 hours)
- **Reply to messages** functionality

### 📱 **Media & Files**
- **Image sharing** with preview and modal view
- **Video sharing** with native video player
- **Audio file sharing** with custom audio player
- **Voice messages** with recording interface
- **File attachments** (PDF, DOC, TXT, ZIP, etc.)
- **Drag & drop file upload**
- **File size validation** and security checks

### 👥 **Group Features**
- **Create group chats** with multiple participants
- **Group admin controls** and permissions
- **Add/remove participants**
- **Group descriptions** and profile images
- **Member roles** (Creator, Admin, Member)

### 🎨 **User Experience**
- **WhatsApp-inspired design** with modern UI
- **Dark/Light theme** toggle
- **Mobile-responsive design** for all devices
- **Emoji picker** with categories
- **Online status indicators**
- **Last seen timestamps**
- **Contact management**
- **User profiles** with bio and profile pictures

### 🔒 **Security & Privacy**
- **User authentication** and authorization
- **File type restrictions** for security
- **Private and group chat permissions**
- **Session management**

## 🛠️ Tech Stack

- **Backend**: Django 5.2.4, Django Channels
- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **WebSocket**: Django Channels with in-memory layer
- **Database**: SQLite (development) / PostgreSQL (production)
- **Styling**: Bootstrap 5.3 + Custom CSS
- **Icons**: Font Awesome 6.4

## 📦 Installation

### Prerequisites
- Python 3.8+
- pip
- Git

### Quick Setup

1. **Clone the repository**
```bash
git clone <repository-url>
cd chat-app
```

2. **Create virtual environment**
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. **Install dependencies**
```bash
pip install -r requirements.txt
```

4. **Run the setup script**
```bash
python test_app.py
```

This script will:
- Check all requirements
- Create and apply database migrations
- Collect static files
- Set up a superuser account
- Start the development server

### Manual Setup

If you prefer manual setup:

```bash
# Apply migrations
python manage.py makemigrations
python manage.py migrate

# Create superuser
python manage.py createsuperuser

# Collect static files
python manage.py collectstatic

# Run development server
python manage.py runserver
```

## 🚀 Usage

1. **Access the application**
   - Open your browser and go to `http://127.0.0.1:8000`
   - For mobile testing, use your computer's IP address

2. **Create an account**
   - Register a new account or login with existing credentials
   - Set up your profile with name, bio, and profile picture

3. **Start chatting**
   - Search for users to start new conversations
   - Create group chats with multiple participants
   - Share media files, voice messages, and more!

4. **Admin panel**
   - Access admin panel at `http://127.0.0.1:8000/admin/`
   - Manage users, chats, and messages

## 📱 Mobile Support

The application is fully responsive and works great on:
- **iOS Safari** (iPhone/iPad)
- **Android Chrome**
- **Desktop browsers** (Chrome, Firefox, Safari, Edge)

### Mobile Features
- Touch-optimized interface
- Native file upload from camera/gallery
- Voice message recording
- Smooth scrolling and animations
- iOS safe area support

## 🎯 Key Components

### Models
- **User**: Extended user model with profile info
- **ChatRoom**: Private and group chat containers
- **Message**: Support for text, media, voice, files
- **MessageReaction**: Emoji reactions to messages
- **Contact**: User contact management
- **ChatRoomMember**: Group membership with roles

### WebSocket Consumer
- Real-time message broadcasting
- Typing indicator management
- Online status updates
- Connection handling and reconnection

### Frontend Features
- **Chat Interface**: WhatsApp-like chat bubbles
- **File Upload**: Drag & drop with progress indicators
- **Voice Recording**: Native audio recording API
- **Emoji Picker**: Categorized emoji selection
- **Theme Switching**: Dark/light mode toggle

## 🔧 Configuration

### Environment Variables
Create a `.env` file for production:

```env
DEBUG=False
SECRET_KEY=your-secret-key-here
ALLOWED_HOSTS=yourdomain.com,www.yourdomain.com
DATABASE_URL=postgresql://user:password@localhost/dbname
```

### Production Settings
For production deployment:
- Use PostgreSQL database
- Configure Redis for channel layers
- Set up proper static file serving
- Enable HTTPS for WebSocket security

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **WhatsApp** for design inspiration
- **Django** community for excellent documentation
- **Bootstrap** for responsive CSS framework
- **Font Awesome** for beautiful icons

## 📞 Support

If you encounter any issues or have questions:
1. Check the [Issues](../../issues) page
2. Create a new issue with detailed description
3. Include error messages and steps to reproduce

---

**Happy Chatting! 💬✨**