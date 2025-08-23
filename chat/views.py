from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth import login, authenticate, logout
from django.contrib.auth.decorators import login_required
from django.contrib import messages
from django.http import JsonResponse, HttpResponse
from django.db.models import Q, Max
from django.core.paginator import Paginator
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth import get_user_model
from .models import ChatRoom, Message, Contact, MessageRead, MessageReaction, ChatRoomSettings, ChatRoomMember, MessageMention
from .forms import UserRegistrationForm, UserProfileForm, MessageForm
import json
import uuid
import os
from django.utils import timezone

User = get_user_model()

def generate_unique_filename(original_filename):
    """Generate a unique filename while preserving the extension"""
    name, ext = os.path.splitext(original_filename)
    unique_id = str(uuid.uuid4())[:8]  # Use first 8 characters of UUID
    timestamp = timezone.now().strftime('%Y%m%d_%H%M%S')
    return f"{timestamp}_{unique_id}{ext}"

# Authentication Views
def login_view(request):
    if request.user.is_authenticated:
        return redirect('chat:home')
    
    if request.method == 'POST':
        username = request.POST['username']
        password = request.POST['password']
        user = authenticate(request, username=username, password=password)
        
        if user is not None:
            login(request, user)
            # Update online status
            user.is_online = True
            user.last_seen = timezone.now()
            user.save()
            return redirect('chat:home')
        else:
            messages.error(request, 'Invalid username or password.')
    
    return render(request, 'chat/auth/login.html')

def register_view(request):
    if request.user.is_authenticated:
        return redirect('chat:home')
    
    if request.method == 'POST':
        form = UserRegistrationForm(request.POST)
        if form.is_valid():
            user = form.save()
            username = form.cleaned_data.get('username')
            messages.success(request, f'Account created for {username}!')
            login(request, user)
            return redirect('chat:home')
    else:
        form = UserRegistrationForm()
    
    return render(request, 'chat/auth/register.html', {'form': form})

def logout_view(request):
    if request.user.is_authenticated:
        # Update offline status
        request.user.is_online = False
        request.user.last_seen = timezone.now()
        request.user.save()
    logout(request)
    return redirect('chat:login')

# Main Chat Views
@login_required
def home_view(request):
    # Get user's chat rooms with latest message
    chat_rooms = ChatRoom.objects.filter(
        participants=request.user
    ).annotate(
        latest_message_time=Max('messages__created_at')
    ).order_by('-latest_message_time')
    
    # Get contacts
    contacts = Contact.objects.filter(user=request.user).select_related('contact')
    
    context = {
        'chat_rooms': chat_rooms,
        'contacts': contacts,
        'user': request.user
    }
    return render(request, 'chat/home.html', context)

@login_required
def chat_room_view(request, room_id):
    chat_room = get_object_or_404(ChatRoom, id=room_id)
    
    # Check if user is participant
    if not chat_room.participants.filter(id=request.user.id).exists():
        messages.error(request, 'You are not authorized to access this chat.')
        return redirect('chat:home')
    
    # Get messages
    messages_list = Message.objects.filter(chat_room=chat_room).select_related('sender').order_by('created_at')
    
    # Mark messages as read
    unread_messages = messages_list.exclude(sender=request.user).exclude(
        read_by__user=request.user
    )
    for message in unread_messages:
        MessageRead.objects.get_or_create(message=message, user=request.user)
    
    # Get other participant for private chats
    other_participant = None
    if chat_room.chat_type == 'private':
        other_participant = chat_room.get_other_participant(request.user)
    
    # Get last message time for JavaScript
    last_message_time = None
    if messages_list.exists():
        last_message_time = messages_list.last().created_at.isoformat()
    
    context = {
        'chat_room': chat_room,
        'messages': messages_list,
        'other_participant': other_participant,
        'room_id': str(room_id),
        'last_message_time': last_message_time
    }
    return render(request, 'chat/chat_room.html', context)

@login_required
def start_chat_view(request, user_id):
    other_user = get_object_or_404(User, id=user_id)
    
    if other_user == request.user:
        messages.error(request, 'You cannot start a chat with yourself.')
        return redirect('chat:home')
    
    # Check if chat room already exists
    existing_room = ChatRoom.objects.filter(
        chat_type='private',
        participants=request.user
    ).filter(
        participants=other_user
    ).first()
    
    if existing_room:
        return redirect('chat:chat_room', room_id=existing_room.id)
    
    # Create new chat room
    chat_room = ChatRoom.objects.create(
        chat_type='private',
        created_by=request.user
    )
    chat_room.participants.add(request.user, other_user)
    
    return redirect('chat:chat_room', room_id=chat_room.id)

@login_required
def search_users_view(request):
    query = request.GET.get('q', '')
    users = []
    
    if query:
        users = User.objects.filter(
            Q(username__icontains=query) |
            Q(first_name__icontains=query) |
            Q(last_name__icontains=query)
        ).exclude(id=request.user.id)[:10]
    
    if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
        users_data = [{
            'id': str(user.id),
            'username': user.username,
            'first_name': user.first_name,
            'last_name': user.last_name,
            'profile_picture': user.profile_picture.url if user.profile_picture else None,
            'is_online': user.is_online
        } for user in users]
        return JsonResponse({'users': users_data})
    
    return render(request, 'chat/search_users.html', {'users': users, 'query': query})

@login_required
def profile_view(request):
    if request.method == 'POST':
        form = UserProfileForm(request.POST, request.FILES, instance=request.user)
        if form.is_valid():
            form.save()
            messages.success(request, 'Profile updated successfully!')
            return redirect('chat:profile')
    else:
        form = UserProfileForm(instance=request.user)
    
    return render(request, 'chat/profile.html', {'form': form})

@login_required
def add_contact_view(request, user_id):
    contact_user = get_object_or_404(User, id=user_id)
    
    if contact_user == request.user:
        messages.error(request, 'You cannot add yourself as a contact.')
        return redirect('chat:home')
    
    contact, created = Contact.objects.get_or_create(
        user=request.user,
        contact=contact_user
    )
    
    if created:
        messages.success(request, f'{contact_user.username} added to your contacts!')
    else:
        messages.info(request, f'{contact_user.username} is already in your contacts.')
    
    return redirect('chat:home')

@login_required
@csrf_exempt
@require_http_methods(["POST"])
def upload_file_view(request):
    if not request.FILES.get('file'):
        return JsonResponse({'success': False, 'error': 'No file provided'})
    
    room_id = request.POST.get('room_id')
    if not room_id:
        return JsonResponse({'success': False, 'error': 'No room ID provided'})
    
    try:
        chat_room = ChatRoom.objects.get(id=room_id)
        if not chat_room.participants.filter(id=request.user.id).exists():
            return JsonResponse({'success': False, 'error': 'Unauthorized'})
        
        uploaded_file = request.FILES['file']
        file_size = uploaded_file.size

        # Basic validations
        MAX_FILE_SIZE = 25 * 1024 * 1024  # 25 MB similar to WhatsApp doc cap (example)
        if file_size > MAX_FILE_SIZE:
            return JsonResponse({'success': False, 'error': 'File too large. Max 25 MB allowed.'})
        
        # Generate unique filename
        original_filename = uploaded_file.name
        unique_filename = generate_unique_filename(original_filename)
        uploaded_file.name = unique_filename
        
        # Determine message type based on file extension
        file_name = original_filename.lower()
        if file_name.endswith(('.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.svg')):
            message_type = 'image'
        elif file_name.endswith(('.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv', '.3gp')):
            message_type = 'video'
        elif file_name.endswith(('.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.wma')):
            # Check if it's a voice message based on filename pattern
            if 'voice_' in file_name:
                message_type = 'voice'
            else:
                message_type = 'audio'
        else:
            message_type = 'file'

        # Restrict potentially dangerous extensions
        blocked_ext = ('.exe', '.bat', '.cmd', '.sh', '.js', '.msi', '.scr', '.com', '.pif', '.vbs')
        if file_name.endswith(blocked_ext):
            return JsonResponse({'success': False, 'error': 'This file type is not allowed for security reasons.'})
        
        # Get duration for voice/audio messages
        duration = None
        if message_type in ['voice', 'audio']:
            duration_str = request.POST.get('duration')
            if duration_str:
                try:
                    duration = int(duration_str)
                except ValueError:
                    duration = None
        
        # Create message with file
        message = Message.objects.create(
            chat_room=chat_room,
            sender=request.user,
            message_type=message_type,
            content=request.POST.get('caption', ''),
            file=uploaded_file,
            file_size=file_size,
            duration=duration
        )
        
        response_data = {
            'success': True,
            'message': {
                'id': str(message.id),
                'content': message.content,
                'message_type': message.message_type,
                'file_url': message.file.url,
                'file_size': message.file_size,
                'sender': {
                    'id': str(message.sender.id),
                    'username': message.sender.username,
                    'first_name': message.sender.first_name,
                    'last_name': message.sender.last_name,
                },
                'created_at': message.created_at.isoformat(),
            }
        }
        
        # Add duration for voice/audio messages
        if message.message_type in ['voice', 'audio'] and message.duration:
            response_data['message']['duration'] = message.duration
        
        return JsonResponse(response_data)
        
    except ChatRoom.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Chat room not found'})
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)})

@login_required
def get_chat_messages_api(request, room_id):
    chat_room = get_object_or_404(ChatRoom, id=room_id)
    
    if not chat_room.participants.filter(id=request.user.id).exists():
        return JsonResponse({'error': 'Unauthorized'}, status=403)
    
    page = request.GET.get('page', 1)
    messages_list = Message.objects.filter(
        chat_room=chat_room
    ).select_related('sender').order_by('-created_at')
    
    paginator = Paginator(messages_list, 50)
    messages_page = paginator.get_page(page)
    
    messages_data = [{
        'id': str(msg.id),
        'content': msg.content,
        'message_type': msg.message_type,
        'sender': {
            'id': str(msg.sender.id),
            'username': msg.sender.username,
            'first_name': msg.sender.first_name,
            'last_name': msg.sender.last_name,
        },
        'created_at': msg.created_at.isoformat(),
        'file_url': msg.file.url if msg.file else None,
    } for msg in reversed(messages_page.object_list)]
    
    return JsonResponse({
        'messages': messages_data,
        'has_next': messages_page.has_next(),
        'has_previous': messages_page.has_previous(),
    })

@login_required
def update_theme_view(request):
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            theme = data.get('theme', 'light')
            
            if theme in ['light', 'dark']:
                request.user.theme_preference = theme
                request.user.save()
                return JsonResponse({'success': True})
            else:
                return JsonResponse({'success': False, 'error': 'Invalid theme'})
        except json.JSONDecodeError:
            return JsonResponse({'success': False, 'error': 'Invalid JSON'})
    
    return JsonResponse({'success': False, 'error': 'Method not allowed'})

@login_required
def get_online_users_view(request):
    """Get list of online users"""
    try:
        print("get_online_users_view called")
        # Update current user's online status and last_seen
        request.user.is_online = True
        request.user.last_seen = timezone.now()
        request.user.save(update_fields=['is_online', 'last_seen'])
        
        # Clean up stale online users (older than 30 seconds)
        from datetime import timedelta
        stale_threshold = timezone.now() - timedelta(seconds=30)
        User.objects.filter(is_online=True, last_seen__lt=stale_threshold).update(is_online=False)
        
        online_users = User.objects.filter(is_online=True).values_list('id', flat=True)
        return JsonResponse({
            'online_users': [str(user_id) for user_id in online_users]
        })
    except Exception as e:
        print(f"Error in get_online_users_view: {e}")
        return JsonResponse({
            'online_users': [],
            'error': str(e)
        })

@login_required
def delete_message_view(request, message_id):
    """Delete a message"""
    if request.method == 'DELETE':
        try:
            message = Message.objects.get(id=message_id, sender=request.user)
            chat_room = message.chat_room
            
            # Check if user is participant
            if not chat_room.participants.filter(id=request.user.id).exists():
                return JsonResponse({'success': False, 'error': 'Unauthorized'}, status=403)
            
            message.delete()
            return JsonResponse({'success': True})
        except Message.DoesNotExist:
            return JsonResponse({'success': False, 'error': 'Message not found'}, status=404)
    
    return JsonResponse({'success': False, 'error': 'Method not allowed'})

@login_required
@csrf_exempt
@require_http_methods(["POST"])
def delete_multiple_messages_view(request):
    """Delete multiple messages"""
    try:
        data = json.loads(request.body)
        message_ids = data.get('message_ids', [])
        
        if not message_ids:
            return JsonResponse({'success': False, 'error': 'No message IDs provided'})
        
        # Validate that all messages belong to the user
        messages = Message.objects.filter(
            id__in=message_ids,
            sender=request.user
        )
        
        if messages.count() != len(message_ids):
            return JsonResponse({'success': False, 'error': 'Some messages not found or unauthorized'})
        
        # Check if user is participant in all chat rooms
        chat_rooms = set(message.chat_room for message in messages)
        for chat_room in chat_rooms:
            if not chat_room.participants.filter(id=request.user.id).exists():
                return JsonResponse({'success': False, 'error': 'Unauthorized access to chat room'})
        
        # Delete all messages
        deleted_count = messages.delete()[0]
        
        return JsonResponse({
            'success': True, 
            'deleted_count': deleted_count,
            'message': f'{deleted_count} messages deleted successfully'
        })
        
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'error': 'Invalid JSON data'})
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)})

@login_required  
def mark_messages_read_view(request, room_id):
    """Mark messages as read"""
    if request.method == 'POST':
        try:
            chat_room = ChatRoom.objects.get(id=room_id)
            
            # Check if user is participant
            if not chat_room.participants.filter(id=request.user.id).exists():
                return JsonResponse({'success': False, 'error': 'Unauthorized'}, status=403)
            
            # Get unread messages
            unread_messages = Message.objects.filter(
                chat_room=chat_room
            ).exclude(sender=request.user).exclude(
                read_by__user=request.user
            )
            
            # Mark as read
            for message in unread_messages:
                MessageRead.objects.get_or_create(message=message, user=request.user)
            
            return JsonResponse({'success': True, 'marked_count': unread_messages.count()})
        except ChatRoom.DoesNotExist:
            return JsonResponse({'success': False, 'error': 'Chat room not found'}, status=404)
    
    return JsonResponse({'success': False, 'error': 'Method not allowed'})

@login_required
def react_to_message_view(request, message_id):
    """Add or remove reaction to a message"""
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            reaction = data.get('reaction')
            
            message = Message.objects.get(id=message_id)
            chat_room = message.chat_room
            
            # Check if user is participant
            if not chat_room.participants.filter(id=request.user.id).exists():
                return JsonResponse({'success': False, 'error': 'Unauthorized'}, status=403)
            
            # Check if reaction already exists
            existing_reaction = MessageReaction.objects.filter(
                message=message, 
                user=request.user
            ).first()
            
            if existing_reaction:
                if existing_reaction.reaction == reaction:
                    # Remove reaction if it's the same
                    existing_reaction.delete()
                    return JsonResponse({'success': True, 'action': 'removed'})
                else:
                    # Update reaction
                    existing_reaction.reaction = reaction
                    existing_reaction.save()
                    return JsonResponse({'success': True, 'action': 'updated'})
            else:
                # Add new reaction
                MessageReaction.objects.create(
                    message=message,
                    user=request.user,
                    reaction=reaction
                )
                return JsonResponse({'success': True, 'action': 'added'})
                
        except Message.DoesNotExist:
            return JsonResponse({'success': False, 'error': 'Message not found'}, status=404)
        except json.JSONDecodeError:
            return JsonResponse({'success': False, 'error': 'Invalid JSON'})
    
    return JsonResponse({'success': False, 'error': 'Method not allowed'})

@login_required
def create_group_view(request):
    """Create a new group chat"""
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            group_name = data.get('name', '').strip()
            participant_ids = data.get('participants', [])
            description = data.get('description', '').strip()
            
            if not group_name:
                return JsonResponse({'success': False, 'error': 'Group name is required'})
            
            if len(participant_ids) < 1:
                return JsonResponse({'success': False, 'error': 'At least 1 participant required'})
            
            # Create group
            group = ChatRoom.objects.create(
                name=group_name,
                chat_type='group',
                created_by=request.user
            )
            
            # Add creator
            group.participants.add(request.user)
            ChatRoomMember.objects.create(
                chat_room=group,
                user=request.user,
                role='creator'
            )
            
            # Add other participants
            for user_id in participant_ids:
                try:
                    user = User.objects.get(id=user_id)
                    if user != request.user:
                        group.participants.add(user)
                        ChatRoomMember.objects.create(
                            chat_room=group,
                            user=user,
                            role='member'
                        )
                except User.DoesNotExist:
                    continue
            
            # Create group settings
            ChatRoomSettings.objects.create(
                chat_room=group,
                description=description
            )
            
            return JsonResponse({
                'success': True,
                'group_id': str(group.id),
                'group_name': group.name
            })
            
        except json.JSONDecodeError:
            return JsonResponse({'success': False, 'error': 'Invalid JSON'})
    
    return JsonResponse({'success': False, 'error': 'Method not allowed'})

@login_required
def create_group_page_view(request):
    """Render create group page"""
    contacts = Contact.objects.filter(user=request.user).select_related('contact')
    return render(request, 'chat/create_group.html', {'contacts': contacts})

@login_required
@require_http_methods(["POST"])
def send_message_view(request, room_id):
    """Send a text message via AJAX"""
    try:
        # Get chat room and verify user is participant
        chat_room = get_object_or_404(ChatRoom, id=room_id)
        if not chat_room.participants.filter(id=request.user.id).exists():
            return JsonResponse({'success': False, 'error': 'Not authorized'})
        
        # Get message content
        content = request.POST.get('content', '').strip()
        if not content:
            return JsonResponse({'success': False, 'error': 'Empty message'})
        
        # Create message
        message = Message.objects.create(
            chat_room=chat_room,
            sender=request.user,
            content=content,
            message_type='text'
        )
        
        # Return success with message data
        return JsonResponse({
            'success': True,
            'message': {
                'id': str(message.id),
                'content': message.content,
                'message_type': message.message_type,
                'sender': {
                    'id': str(message.sender.id),
                    'username': message.sender.username,
                    'first_name': message.sender.first_name,
                    'profile_picture': message.sender.profile_picture.url if message.sender.profile_picture else None
                },
                'created_at': message.created_at.isoformat(),
                'is_own': True
            }
        })
        
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)})

@login_required
def get_messages_view(request, room_id):
    """Get messages for a chat room with optional timestamp filtering"""
    try:
        # Update user's online status (heartbeat)
        request.user.is_online = True
        request.user.last_seen = timezone.now()
        request.user.save(update_fields=['is_online', 'last_seen'])
        
        # Get chat room and verify user is participant
        chat_room = get_object_or_404(ChatRoom, id=room_id)
        if not chat_room.participants.filter(id=request.user.id).exists():
            return JsonResponse({'success': False, 'error': 'Not authorized'})
        
        # Get timestamp from request (last message time)
        last_message_time = request.GET.get('last_time')
        
        # Query for messages
        messages_query = Message.objects.filter(chat_room=chat_room).select_related('sender')
        
        if last_message_time:
            try:
                from django.utils.dateparse import parse_datetime
                last_time = parse_datetime(last_message_time)
                if last_time:
                    # Only get messages AFTER the last known time
                    messages_query = messages_query.filter(created_at__gt=last_time)
                    messages = messages_query.order_by('created_at')[:50]
                else:
                    # If parse failed, get all recent messages
                    messages = messages_query.order_by('-created_at')[:50]
                    messages = list(reversed(messages))
            except:
                # If any error, get all recent messages
                messages = messages_query.order_by('-created_at')[:50] 
                messages = list(reversed(messages))
        else:
            # No last_time provided, get all recent messages (for initial load)
            messages = messages_query.order_by('-created_at')[:50]
            messages = list(reversed(messages))  # Reverse to chronological order
        
        # Format messages
        messages_data = []
        for message in messages:
            message_data = {
                'id': str(message.id),
                'content': message.content,
                'message_type': message.message_type,
                'sender': {
                    'id': str(message.sender.id),
                    'username': message.sender.username,
                    'first_name': message.sender.first_name,
                    'profile_picture': message.sender.profile_picture.url if message.sender.profile_picture else None
                },
                'created_at': message.created_at.isoformat(),
                'is_own': message.sender.id == request.user.id
            }
            
            # Add file-related data for media messages
            if message.file:
                message_data['file_url'] = message.file.url
                message_data['file_size'] = message.file_size
            
            # Add duration for voice/audio messages
            if message.message_type in ['voice', 'audio'] and message.duration:
                message_data['duration'] = message.duration
                
            messages_data.append(message_data)
        
        return JsonResponse({
            'success': True,
            'messages': messages_data,
            'count': len(messages_data)
        })
        
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)})
