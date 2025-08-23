import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth import get_user_model
from .models import ChatRoom, Message, MessageRead
from django.utils import timezone

User = get_user_model()

class ChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.room_id = self.scope['url_route']['kwargs']['room_id']
        self.room_group_name = f'chat_{self.room_id}'
        self.user = self.scope["user"]

        if self.user.is_anonymous:
            await self.close()
            return

        # Verify user is participant of the room before allowing connection
        is_participant = await self.user_in_room(self.user.id, self.room_id)
        if not is_participant:
            await self.close()
            return

        # Join room group
        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )

        await self.accept()

        # Update user online status
        await self.update_user_online_status(True)

    async def disconnect(self, close_code):
        # Leave room group
        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )

        # Update user online status
        await self.update_user_online_status(False)

    async def receive(self, text_data):
        print(f"Received WebSocket message: {text_data}")
        try:
            data = json.loads(text_data)
            print(f"Parsed data: {data}")
        except json.JSONDecodeError:
            print("Invalid JSON received")
            return

        message_type = data.get('type', 'text')
        content = (data.get('content') or '').strip()
        print(f"Message type: {message_type}, Content: '{content}'")

        # Guard: user must be in room for all events
        if not await self.user_in_room(self.user.id, self.room_id):
            print(f"User {self.user.id} not authorized for room {self.room_id}")
            return

        if message_type == 'text':
            if not content:
                print("Empty message content")
                return

            try:
                # Save message to database
                message = await self.save_message(content, message_type)
                print(f"Message saved: {message.id}")

                # Send message to room group
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'chat_message',
                        'message': {
                            'id': str(message.id),
                            'content': message.content,
                            'message_type': message.message_type,
                            'sender': {
                                'id': str(message.sender.id),
                                'username': message.sender.username,
                                'first_name': message.sender.first_name,
                                'last_name': message.sender.last_name,
                            },
                            'created_at': message.created_at.isoformat(),
                            'file_url': None,
                            'file_size': None,
                        }
                    }
                )
                print(f"Message broadcasted to group: {self.room_group_name}")
            except Exception as e:
                print(f"Error sending message: {e}")
                return
        elif message_type == 'media_uploaded':
            # Handle media file upload notification
            message_id = data.get('message_id')
            if message_id:
                message = await self.get_message_by_id(message_id)
                if message:
                    await self.channel_layer.group_send(
                        self.room_group_name,
                        {
                            'type': 'chat_message',
                            'message': {
                                'id': str(message.id),
                                'content': message.content,
                                'message_type': message.message_type,
                                'sender': {
                                    'id': str(message.sender.id),
                                    'username': message.sender.username,
                                    'first_name': message.sender.first_name,
                                    'last_name': message.sender.last_name,
                                    'profile_picture': message.sender.profile_picture.url if message.sender.profile_picture else None,
                                },
                                'created_at': message.created_at.isoformat(),
                                'file_url': message.file.url if message.file else None,
                                'file_size': message.file_size,
                                'duration': message.duration,
                            }
                        }
                    )
        elif message_type == 'typing':
            # Handle typing indicator
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'typing_indicator',
                    'user': {
                        'id': str(self.user.id),
                        'username': self.user.username,
                        'first_name': self.user.first_name,
                    },
                    'is_typing': data.get('is_typing', False)
                }
            )

    async def chat_message(self, event):
        # Send message to WebSocket
        await self.send(text_data=json.dumps({
            'type': 'message',
            'message': event['message']
        }))

    async def typing_indicator(self, event):
        # Don't send typing indicator to the sender
        if event['user']['id'] != str(self.user.id):
            await self.send(text_data=json.dumps({
                'type': 'typing',
                'user': event['user'],
                'is_typing': event['is_typing']
            }))

    @database_sync_to_async
    def save_message(self, content, message_type):
        chat_room = ChatRoom.objects.get(id=self.room_id)
        message = Message.objects.create(
            chat_room=chat_room,
            sender=self.user,
            content=content,
            message_type=message_type
        )
        return message

    @database_sync_to_async
    def update_user_online_status(self, is_online):
        User.objects.filter(id=self.user.id).update(
            is_online=is_online,
            last_seen=timezone.now()
        )
    
    @database_sync_to_async
    def get_message_by_id(self, message_id):
        try:
            return Message.objects.select_related('sender').get(id=message_id)
        except Message.DoesNotExist:
            return None

    @database_sync_to_async
    def user_in_room(self, user_id, room_id):
        try:
            return ChatRoom.objects.filter(id=room_id, participants__id=user_id).exists()
        except Exception:
            return False
