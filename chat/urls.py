from django.urls import path
from chat import views

app_name = 'chat'

urlpatterns = [
    path('', views.index, name='index'),
    path('chat/<int:conversation_id>/', views.conversation_view, name='conversation'),
    path('chat/start/', views.start_conversation, name='start_conversation'),
    path('chat/<int:conversation_id>/upload/', views.upload_attachment, name='upload_attachment'),
    path('chat/message/<int:message_id>/delete/', views.delete_message, name='delete_message'),
    path('chat/message/<int:message_id>/edit/', views.edit_message, name='edit_message'),
    path('chat/<int:conversation_id>/messages/', views.load_more_messages, name='load_more_messages'),
]
