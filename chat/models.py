from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
import os

AUDIO_EXTENSIONS = {'mp3', 'm4a', 'wav', 'ogg', 'oga', 'opus', 'webm', 'aac', 'flac', 'mpeg'}
VIDEO_EXTENSIONS = {'mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv'}
IMAGE_EXTENSIONS = {'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'}


def attachment_upload_path(instance, filename):
    """Store attachments in media/chat/<conversation_id>/<filename>"""
    return f'chat/{instance.conversation.id}/{filename}'


class Conversation(models.Model):
    participants = models.ManyToManyField(User, related_name='conversations')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        names = ', '.join(u.username for u in self.participants.all()[:3])
        return f'Conversation({names})'

    def get_other_participant(self, user):
        return self.participants.exclude(id=user.id).first()

    def last_message(self):
        return self.messages.filter(
            deleted_for_everyone=False
        ).order_by('-created_at').first()

    def unread_count_for(self, user):
        return self.messages.filter(
            deleted_for_everyone=False
        ).exclude(
            sender_id=user.id
        ).exclude(
            read_by__id=user.id
        ).distinct().count()

    @classmethod
    def get_or_create_direct(cls, user1, user2):
        """Get existing or create new direct conversation between two users."""
        convs = cls.objects.filter(participants=user1).filter(participants=user2)
        if convs.exists():
            return convs.first(), False
        conv = cls.objects.create()
        conv.participants.add(user1, user2)
        return conv, True


class Message(models.Model):
    TYPE_TEXT = 'text'
    TYPE_IMAGE = 'image'
    TYPE_AUDIO = 'audio'
    TYPE_VIDEO = 'video'
    TYPE_FILE = 'file'
    TYPE_VOICE = 'voice'

    MESSAGE_TYPES = [
        (TYPE_TEXT, 'Text'),
        (TYPE_IMAGE, 'Image'),
        (TYPE_AUDIO, 'Audio'),
        (TYPE_VIDEO, 'Video'),
        (TYPE_FILE, 'File'),
        (TYPE_VOICE, 'Voice'),
    ]

    conversation = models.ForeignKey(
        Conversation, on_delete=models.CASCADE, related_name='messages'
    )
    sender = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='sent_messages'
    )
    message_type = models.CharField(max_length=10, choices=MESSAGE_TYPES, default=TYPE_TEXT)
    content = models.TextField(blank=True, default='')
    attachment = models.FileField(upload_to=attachment_upload_path, null=True, blank=True)
    attachment_name = models.CharField(max_length=255, blank=True, default='')
    attachment_size = models.PositiveIntegerField(default=0)  # bytes

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    is_edited = models.BooleanField(default=False)
    deleted_for_everyone = models.BooleanField(default=False)
    deleted_for = models.ManyToManyField(
        User, related_name='deleted_messages', blank=True
    )
    read_by = models.ManyToManyField(
        User, related_name='read_messages', blank=True
    )
    delivered_to = models.ManyToManyField(
        User, related_name='delivered_messages', blank=True
    )

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f'Message({self.sender.username}: {self.content[:30]})'

    @property
    def attachment_url(self):
        if self.attachment:
            return self.attachment.url
        return None

    @property
    def attachment_extension(self):
        if self.attachment_name:
            _, ext = os.path.splitext(self.attachment_name)
            return ext.lower().lstrip('.')
        return ''

    @property
    def attachment_size_display(self):
        size = self.attachment_size
        if size < 1024:
            return f'{size} B'
        elif size < 1024 * 1024:
            return f'{size / 1024:.1f} KB'
        else:
            return f'{size / (1024 * 1024):.1f} MB'

    @property
    def attachment_kind(self):
        if self.message_type in {self.TYPE_IMAGE, self.TYPE_AUDIO, self.TYPE_VIDEO, self.TYPE_VOICE}:
            return self.message_type
        ext = self.attachment_extension
        if ext in AUDIO_EXTENSIONS:
            return self.TYPE_AUDIO
        if ext in VIDEO_EXTENSIONS:
            return self.TYPE_VIDEO
        if ext in IMAGE_EXTENSIONS:
            return self.TYPE_IMAGE
        return self.TYPE_FILE

    @property
    def is_audio_attachment(self):
        return self.attachment_kind in {self.TYPE_AUDIO, self.TYPE_VOICE}

    def mark_read_by(self, user):
        if not self.read_by.filter(id=user.id).exists():
            self.delivered_to.add(user)
            self.read_by.add(user)

    def mark_delivered_to(self, user):
        if self.sender_id != user.id and not self.delivered_to.filter(id=user.id).exists():
            self.delivered_to.add(user)

    def is_deleted_for(self, user):
        return self.deleted_for.filter(id=user.id).exists()

    def to_dict(self, requesting_user=None):
        """Serialize message to dict for WebSocket/JSON."""
        data = {
            'id': self.id,
            'conversation_id': self.conversation_id,
            'sender_id': self.sender_id,
            'sender_username': self.sender.username,
            'sender_name': self.sender.profile.display_name if hasattr(self.sender, 'profile') else self.sender.username,
            'sender_avatar': self.sender.profile.avatar_url if hasattr(self.sender, 'profile') else None,
            'message_type': self.message_type,
            'attachment_kind': self.attachment_kind,
            'content': self.content,
            'attachment_url': self.attachment_url,
            'attachment_name': self.attachment_name,
            'attachment_size_display': self.attachment_size_display,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
            'is_edited': self.is_edited,
            'deleted_for_everyone': self.deleted_for_everyone,
            'delivered_to_count': self.delivered_to.count(),
            'read_by_count': self.read_by.count(),
        }
        if requesting_user:
            data['is_mine'] = self.sender_id == requesting_user.id
            data['is_delivered_to_me'] = self.delivered_to.filter(id=requesting_user.id).exists()
            data['is_read_by_me'] = self.read_by.filter(id=requesting_user.id).exists()
            data['delivery_status'] = self.delivery_status_for(requesting_user)
            data['is_deleted_for_me'] = self.is_deleted_for(requesting_user)
            if data['is_mine']:
                data['is_delivered'] = self.delivered_to.exclude(id=requesting_user.id).exists()
                data['is_read'] = self.read_by.exclude(id=requesting_user.id).exists()
        return data

    def delivery_status_for(self, user):
        if self.sender_id != user.id:
            return ''
        if self.read_by.exclude(id=user.id).exists():
            return 'read'
        if self.delivered_to.exclude(id=user.id).exists():
            return 'delivered'
        return 'sent'
