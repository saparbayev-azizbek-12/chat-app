from django.db import models
from django.contrib.auth.models import AbstractUser
from django.utils import timezone
import uuid

class User(AbstractUser):
    """Extended user model with profile information"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    profile_picture = models.ImageField(upload_to='profile_pics/', null=True, blank=True)
    bio = models.TextField(max_length=500, blank=True)
    phone_number = models.CharField(max_length=20, blank=True)
    is_online = models.BooleanField(default=False)
    last_seen = models.DateTimeField(default=timezone.now)
    theme_preference = models.CharField(
        max_length=10,
        choices=[('light', 'Light'), ('dark', 'Dark')],
        default='light'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.username

class Contact(models.Model):
    """User contacts/friends"""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='contacts')
    contact = models.ForeignKey(User, on_delete=models.CASCADE, related_name='contacted_by')
    nickname = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('user', 'contact')

    def __str__(self):
        return f"{self.user.username} -> {self.contact.username}"

class ChatRoom(models.Model):
    """Chat room for conversations"""
    CHAT_TYPES = [
        ('private', 'Private'),
        ('group', 'Group'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, blank=True)
    chat_type = models.CharField(max_length=10, choices=CHAT_TYPES, default='private')
    participants = models.ManyToManyField(User, related_name='chat_rooms')
    created_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='created_rooms')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        if self.chat_type == 'private':
            participants = list(self.participants.all())
            if len(participants) == 2:
                return f"Chat between {participants[0].username} and {participants[1].username}"
        return self.name or f"Group Chat {self.id}"

    def get_other_participant(self, user):
        """Get the other participant in a private chat"""
        if self.chat_type == 'private':
            return self.participants.exclude(id=user.id).first()
        return None

class Message(models.Model):
    """Chat messages with support for different media types"""
    MESSAGE_TYPES = [
        ('text', 'Text'),
        ('image', 'Image'),
        ('video', 'Video'),
        ('audio', 'Audio'),
        ('voice', 'Voice'),
        ('file', 'File'),
        ('location', 'Location'),
        ('contact', 'Contact'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    chat_room = models.ForeignKey(ChatRoom, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey(User, on_delete=models.CASCADE, related_name='sent_messages')
    message_type = models.CharField(max_length=10, choices=MESSAGE_TYPES, default='text')
    content = models.TextField(blank=True)  # For text messages
    file = models.FileField(upload_to='chat_files/', null=True, blank=True)  # For media files
    thumbnail = models.ImageField(upload_to='thumbnails/', null=True, blank=True)  # For video thumbnails
    duration = models.PositiveIntegerField(null=True, blank=True)  # For audio/video duration in seconds
    file_size = models.PositiveIntegerField(null=True, blank=True)  # File size in bytes
    
    # Reply functionality
    reply_to = models.ForeignKey('self', on_delete=models.CASCADE, null=True, blank=True, related_name='replies')
    
    # Forward functionality
    forwarded_from = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True, related_name='forwards')
    
    # Message status
    is_deleted = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)
    
    # Edit functionality
    is_edited = models.BooleanField(default=False)
    edited_at = models.DateTimeField(null=True, blank=True)
    
    # Location data (for location messages)
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    location_name = models.CharField(max_length=255, blank=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        if self.message_type == 'text':
            return f"{self.sender.username}: {self.content[:50]}..."
        return f"{self.sender.username}: [{self.message_type.upper()}]"

class MessageRead(models.Model):
    """Track message read status for each user"""
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name='read_by')
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    read_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('message', 'user')

    def __str__(self):
        return f"{self.user.username} read {self.message.id}"

class MessageReaction(models.Model):
    """Message reactions like WhatsApp"""
    REACTION_TYPES = [
        ('👍', 'Thumbs Up'),
        ('❤️', 'Heart'),
        ('😂', 'Laugh'),
        ('😮', 'Wow'),
        ('😢', 'Sad'),
        ('😡', 'Angry'),
        ('👏', 'Clap'),
        ('🔥', 'Fire'),
    ]
    
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name='reactions')
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    reaction = models.CharField(max_length=10, choices=REACTION_TYPES)
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        unique_together = ('message', 'user')  # One reaction per user per message
    
    def __str__(self):
        return f"{self.user.username} reacted {self.reaction} to {self.message.id}"

class ChatRoomSettings(models.Model):
    """Settings for chat rooms"""
    chat_room = models.OneToOneField(ChatRoom, on_delete=models.CASCADE, related_name='settings')
    
    # Group settings
    description = models.TextField(blank=True, max_length=512)
    group_image = models.ImageField(upload_to='group_images/', null=True, blank=True)
    
    # Admin settings
    only_admins_can_send = models.BooleanField(default=False)
    only_admins_can_edit_info = models.BooleanField(default=True)
    only_admins_can_add_members = models.BooleanField(default=True)
    
    # Privacy settings
    disappearing_messages_timer = models.PositiveIntegerField(null=True, blank=True)  # In seconds, None = disabled
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    def __str__(self):
        return f"Settings for {self.chat_room}"

class ChatRoomMember(models.Model):
    """Extended information about chat room members"""
    MEMBER_ROLES = [
        ('member', 'Member'),
        ('admin', 'Admin'),
        ('creator', 'Creator'),
    ]
    
    chat_room = models.ForeignKey(ChatRoom, on_delete=models.CASCADE, related_name='memberships')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='memberships')
    role = models.CharField(max_length=10, choices=MEMBER_ROLES, default='member')
    joined_at = models.DateTimeField(auto_now_add=True)
    
    # Member permissions
    can_send_messages = models.BooleanField(default=True)
    can_send_media = models.BooleanField(default=True)
    
    # Member status
    is_muted = models.BooleanField(default=False)
    muted_until = models.DateTimeField(null=True, blank=True)
    
    class Meta:
        unique_together = ('chat_room', 'user')
    
    def __str__(self):
        return f"{self.user.username} in {self.chat_room} as {self.role}"

class MessageMention(models.Model):
    """Track user mentions in messages"""
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name='mentions')
    mentioned_user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='mentions')
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        unique_together = ('message', 'mentioned_user')
    
    def __str__(self):
        return f"{self.mentioned_user.username} mentioned in {self.message.id}"
