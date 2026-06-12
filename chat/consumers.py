import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.utils import timezone


class ChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.user = self.scope['user']
        if not self.user.is_authenticated:
            await self.close()
            return

        self.conversation_id = self.scope['url_route']['kwargs']['conversation_id']
        self.room_group_name = f'chat_{self.conversation_id}'

        # Verify user is a participant
        if not await self.is_participant():
            await self.close()
            return

        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()

        seen_ids = await self.mark_visible_messages_seen()
        for message_id in seen_ids:
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'message_delivered',
                    'message_id': message_id,
                    'user_id': self.user.id,
                }
            )
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'message_read',
                    'message_id': message_id,
                    'user_id': self.user.id,
                }
            )

        # Mark user online
        await self.set_online(True)
        await self.channel_layer.group_send(
            self.room_group_name,
            {'type': 'presence_update', 'is_online': True, 'user_id': self.user.id}
        )
        await self.channel_layer.group_send(
            f'presence_{self.user.id}',
            {'type': 'presence_update', 'is_online': True, 'user_id': self.user.id}
        )

    async def disconnect(self, close_code):
        if hasattr(self, 'room_group_name'):
            await self.channel_layer.group_discard(self.room_group_name, self.channel_name)

        if hasattr(self, 'user') and self.user.is_authenticated:
            await self.set_online(False)
            last_seen = await self.update_last_seen()
            event = {
                'type': 'presence_update',
                'is_online': False,
                'user_id': self.user.id,
                'last_seen': last_seen.isoformat() if last_seen else None,
            }
            if hasattr(self, 'room_group_name'):
                await self.channel_layer.group_send(self.room_group_name, event)
            await self.channel_layer.group_send(f'presence_{self.user.id}', event)

    async def receive(self, text_data):
        data = json.loads(text_data)
        msg_type = data.get('type')

        handlers = {
            'chat_message': self.handle_chat_message,
            'typing': self.handle_typing,
            'stop_typing': self.handle_stop_typing,
            'mark_delivered': self.handle_mark_delivered,
            'mark_read': self.handle_mark_read,
            'edit_message': self.handle_edit_message,
            'delete_message': self.handle_delete_message,
        }

        handler = handlers.get(msg_type)
        if handler:
            await handler(data)

    # ─── Handlers ───────────────────────────────────────────────────────────

    async def handle_chat_message(self, data):
        content = data.get('content', '').strip()
        message_id = data.get('message_id')  # pre-saved message ID from file upload

        if message_id:
            # File message already saved via HTTP; just broadcast it.
            message_data = await self.get_message_data(message_id)
        elif content:
            message_data = await self.save_text_message(content)
        else:
            return

        if not message_data:
            return

        await self.channel_layer.group_send(
            self.room_group_name,
            {'type': 'chat_message', 'message': message_data}
        )
        # Update conversation sidebar for all participants
        await self.broadcast_conversation_update()

    async def handle_typing(self, data):
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'typing_indicator',
                'user_id': self.user.id,
                'username': self.user.username,
                'is_typing': True,
            }
        )

    async def handle_stop_typing(self, data):
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'typing_indicator',
                'user_id': self.user.id,
                'username': self.user.username,
                'is_typing': False,
            }
        )

    async def handle_mark_read(self, data):
        message_id = data.get('message_id')
        if message_id:
            await self.mark_message_read(message_id)
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'message_read',
                    'message_id': message_id,
                    'user_id': self.user.id,
                }
            )

    async def handle_mark_delivered(self, data):
        message_id = data.get('message_id')
        if message_id:
            await self.mark_message_delivered(message_id)
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'message_delivered',
                    'message_id': message_id,
                    'user_id': self.user.id,
                }
            )

    async def handle_edit_message(self, data):
        message_id = data.get('message_id')
        new_content = data.get('content', '').strip()
        if not message_id or not new_content:
            return

        success = await self.edit_message(message_id, new_content)
        if success:
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'message_edited',
                    'message_id': message_id,
                    'content': new_content,
                    'sender_id': self.user.id,
                }
            )

    async def handle_delete_message(self, data):
        message_id = data.get('message_id')
        delete_for = data.get('delete_for', 'me')  # 'me' or 'everyone'
        if not message_id:
            return

        result = await self.delete_message(message_id, delete_for)
        if result:
            event = {
                'type': 'message_deleted',
                'message_id': message_id,
                'delete_for': delete_for,
                'sender_id': self.user.id,
            }
            if delete_for == 'everyone':
                await self.channel_layer.group_send(self.room_group_name, event)
            else:
                await self.send(text_data=json.dumps(event))

    # ─── Group event handlers (called by channel layer) ──────────────────────

    async def chat_message(self, event):
        await self.send(text_data=json.dumps({
            'type': 'chat_message',
            'message': event['message'],
        }))

    async def typing_indicator(self, event):
        if event['user_id'] != self.user.id:
            await self.send(text_data=json.dumps({
                'type': 'typing',
                'user_id': event['user_id'],
                'username': event['username'],
                'is_typing': event['is_typing'],
            }))

    async def message_read(self, event):
        await self.send(text_data=json.dumps({
            'type': 'message_read',
            'message_id': event['message_id'],
            'user_id': event['user_id'],
        }))

    async def message_delivered(self, event):
        await self.send(text_data=json.dumps({
            'type': 'message_delivered',
            'message_id': event['message_id'],
            'user_id': event['user_id'],
        }))

    async def message_edited(self, event):
        await self.send(text_data=json.dumps({
            'type': 'message_edited',
            'message_id': event['message_id'],
            'content': event['content'],
            'sender_id': event['sender_id'],
        }))

    async def message_deleted(self, event):
        await self.send(text_data=json.dumps({
            'type': 'message_deleted',
            'message_id': event['message_id'],
            'delete_for': event['delete_for'],
            'sender_id': event['sender_id'],
        }))

    async def conversation_update(self, event):
        await self.send(text_data=json.dumps({
            'type': 'conversation_update',
            'conversation_id': event['conversation_id'],
        }))

    async def presence_update(self, event):
        await self.send(text_data=json.dumps({
            'type': 'presence_update',
            'user_id': event['user_id'],
            'is_online': event['is_online'],
            'last_seen': event.get('last_seen'),
        }))

    # ─── Database helpers ─────────────────────────────────────────────────────

    @database_sync_to_async
    def is_participant(self):
        from chat.models import Conversation
        return Conversation.objects.filter(
            id=self.conversation_id,
            participants=self.user
        ).exists()

    @database_sync_to_async
    def save_text_message(self, content):
        from chat.models import Conversation, Message
        conv = Conversation.objects.get(id=self.conversation_id)
        msg = Message.objects.create(
            conversation=conv,
            sender=self.user,
            message_type=Message.TYPE_TEXT,
            content=content,
        )
        conv.save()  # update updated_at
        return msg.to_dict(requesting_user=self.user)

    @database_sync_to_async
    def get_message_data(self, message_id):
        from chat.models import Message
        try:
            msg = Message.objects.select_related('sender', 'sender__profile').get(
                id=message_id,
                conversation_id=self.conversation_id
            )
            return msg.to_dict(requesting_user=self.user)
        except Message.DoesNotExist:
            return None

    @database_sync_to_async
    def mark_visible_messages_seen(self):
        from chat.models import Message
        qs = Message.objects.filter(
            conversation_id=self.conversation_id,
            deleted_for_everyone=False,
        ).exclude(
            sender_id=self.user.id
        )
        message_ids = []
        for msg in qs:
            msg.mark_read_by(self.user)
            message_ids.append(msg.id)
        return message_ids

    @database_sync_to_async
    def mark_message_delivered(self, message_id):
        from chat.models import Message
        try:
            msg = Message.objects.get(id=message_id, conversation_id=self.conversation_id)
            msg.mark_delivered_to(self.user)
        except Message.DoesNotExist:
            pass

    @database_sync_to_async
    def mark_message_read(self, message_id):
        from chat.models import Message
        try:
            msg = Message.objects.get(id=message_id, conversation_id=self.conversation_id)
            msg.mark_read_by(self.user)
        except Message.DoesNotExist:
            pass

    @database_sync_to_async
    def edit_message(self, message_id, new_content):
        from chat.models import Message
        try:
            msg = Message.objects.get(
                id=message_id,
                sender=self.user,
                conversation_id=self.conversation_id,
                message_type=Message.TYPE_TEXT,
                deleted_for_everyone=False,
            )
            msg.content = new_content
            msg.is_edited = True
            msg.save(update_fields=['content', 'is_edited', 'updated_at'])
            return True
        except Message.DoesNotExist:
            return False

    @database_sync_to_async
    def delete_message(self, message_id, delete_for):
        from chat.models import Message
        try:
            msg = Message.objects.get(
                id=message_id,
                conversation_id=self.conversation_id,
            )
            if delete_for == 'everyone' and msg.sender_id == self.user.id:
                msg.deleted_for_everyone = True
                msg.content = ''
                msg.save(update_fields=['deleted_for_everyone', 'content'])
            elif delete_for == 'me':
                msg.deleted_for.add(self.user)
            return True
        except Message.DoesNotExist:
            return False

    @database_sync_to_async
    def set_online(self, status):
        from accounts.models import UserProfile
        UserProfile.objects.filter(user=self.user).update(is_online=status)

    @database_sync_to_async
    def update_last_seen(self):
        from accounts.models import UserProfile
        now = timezone.now()
        UserProfile.objects.filter(user=self.user).update(last_seen=now, is_online=False)
        return now

    @database_sync_to_async
    def broadcast_conversation_update(self):
        """Notify all participants to refresh their sidebar."""
        from chat.models import Conversation
        conv = Conversation.objects.prefetch_related('participants').get(
            id=self.conversation_id
        )
        return [p.id for p in conv.participants.all()]
