import json

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse

from chat.models import Conversation, Message


class ChatHttpFallbackTests(TestCase):
    def setUp(self):
        self.alice = User.objects.create_user(username='alice', password='pass12345')
        self.bob = User.objects.create_user(username='bob', password='pass12345')
        self.eve = User.objects.create_user(username='eve', password='pass12345')
        self.conversation, _ = Conversation.get_or_create_direct(self.alice, self.bob)

    def test_send_message_creates_text_message(self):
        self.client.force_login(self.alice)
        response = self.client.post(
            reverse('chat:send_message', args=[self.conversation.id]),
            data=json.dumps({'content': 'Salom'}),
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(Message.objects.count(), 1)
        message = Message.objects.get()
        self.assertEqual(message.content, 'Salom')
        self.assertEqual(message.sender, self.alice)
        self.assertEqual(response.json()['message']['content'], 'Salom')

    def test_send_message_requires_participant(self):
        self.client.force_login(self.eve)
        response = self.client.post(
            reverse('chat:send_message', args=[self.conversation.id]),
            data={'content': 'Nope'},
        )

        self.assertEqual(response.status_code, 404)
        self.assertFalse(Message.objects.exists())

    def test_messages_after_id_returns_new_messages(self):
        old = Message.objects.create(
            conversation=self.conversation,
            sender=self.alice,
            message_type=Message.TYPE_TEXT,
            content='Old',
        )
        new = Message.objects.create(
            conversation=self.conversation,
            sender=self.bob,
            message_type=Message.TYPE_TEXT,
            content='New',
        )

        self.client.force_login(self.alice)
        response = self.client.get(
            reverse('chat:load_more_messages', args=[self.conversation.id]),
            {'after_id': old.id},
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual([message['id'] for message in data['messages']], [new.id])
        self.assertTrue(new.read_by.filter(id=self.alice.id).exists())
