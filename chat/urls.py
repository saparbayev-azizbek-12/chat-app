from django.urls import path
from . import views

app_name = 'chat'

urlpatterns = [
    # Authentication URLs
    path('auth/login/', views.login_view, name='login'),
    path('auth/register/', views.register_view, name='register'),
    path('auth/logout/', views.logout_view, name='logout'),
    
    # Main chat URLs
    path('', views.home_view, name='home'),
    path('chat/<uuid:room_id>/', views.chat_room_view, name='chat_room'),
    path('start-chat/<uuid:user_id>/', views.start_chat_view, name='start_chat'),
    
    # User and contact management
    path('search/', views.search_users_view, name='search_users'),
    path('profile/', views.profile_view, name='profile'),
    path('add-contact/<uuid:user_id>/', views.add_contact_view, name='add_contact'),

    
    # API endpoints
    path('api/upload/', views.upload_file_view, name='upload_file'),
    path('api/messages/<uuid:room_id>/', views.get_chat_messages_api, name='get_messages'),
    path('api/update-theme/', views.update_theme_view, name='update_theme'),
    path('api/online-status/', views.get_online_users_view, name='online_status'),
    path('api/delete-message/<uuid:message_id>/', views.delete_message_view, name='delete_message'),
    path('api/delete-messages/', views.delete_multiple_messages_view, name='delete_multiple_messages'),
    path('api/mark-read/<uuid:room_id>/', views.mark_messages_read_view, name='mark_read'),
    path('api/react/<uuid:message_id>/', views.react_to_message_view, name='react_to_message'),
    path('api/create-group/', views.create_group_view, name='create_group'),
    path('api/send-message/<uuid:room_id>/', views.send_message_view, name='send_message'),
    path('api/get-messages/<uuid:room_id>/', views.get_messages_view, name='get_messages'),
]
