from django.contrib import admin
from chat.models import Conversation, Message


@admin.register(Conversation)
class ConversationAdmin(admin.ModelAdmin):
    list_display = ['id', 'participant_names', 'created_at', 'updated_at']
    filter_horizontal = ['participants']

    def participant_names(self, obj):
        return ', '.join(u.username for u in obj.participants.all())
    participant_names.short_description = 'Participants'


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ['id', 'sender', 'conversation', 'message_type', 'content_preview', 'created_at', 'is_edited', 'deleted_for_everyone']
    list_filter = ['message_type', 'is_edited', 'deleted_for_everyone']
    search_fields = ['sender__username', 'content']
    raw_id_fields = ['sender', 'conversation']

    def content_preview(self, obj):
        return obj.content[:50] if obj.content else f'[{obj.message_type}]'
    content_preview.short_description = 'Content'
