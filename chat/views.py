import json
import mimetypes
from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.views.decorators.http import require_POST, require_http_methods
from django.http import JsonResponse
from django.conf import settings
from django.utils import timezone
from django.core.paginator import Paginator
from chat.models import AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, Conversation, Message


@login_required
def index(request):
    """Main chat interface — three-panel layout."""
    conversations = Conversation.objects.filter(
        participants=request.user
    ).prefetch_related('participants', 'participants__profile')

    # Build conversations list with extra data
    conv_list = []
    for conv in conversations:
        other = conv.get_other_participant(request.user)
        if not other:
            continue
        last_msg = conv.last_message()
        unread = conv.unread_count_for(request.user)
        conv_list.append({
            'conversation': conv,
            'other_user': other,
            'last_message': last_msg,
            'unread_count': unread,
        })

    # Sort by last message time
    conv_list.sort(
        key=lambda x: x['last_message'].created_at if x['last_message'] else x['conversation'].created_at,
        reverse=True
    )

    return render(request, 'chat/index.html', {
        'conversations': conv_list,
        'active_conversation': None,
    })


@login_required
def conversation_view(request, conversation_id):
    """Load a specific conversation."""
    conversation = get_object_or_404(
        Conversation,
        id=conversation_id,
        participants=request.user
    )
    other_user = conversation.get_other_participant(request.user)

    # Load messages (last 50, paginated)
    messages_qs = Message.objects.filter(
        conversation=conversation,
        deleted_for_everyone=False,
    ).exclude(
        deleted_for=request.user
    ).select_related(
        'sender', 'sender__profile'
    ).order_by('-created_at')[:50]

    messages = list(reversed(list(messages_qs)))

    # Mark all received messages as read
    unread_msgs = Message.objects.filter(
        conversation=conversation,
        deleted_for_everyone=False
    ).exclude(
        sender=request.user
    ).exclude(
        read_by=request.user
    )
    for msg in unread_msgs:
        msg.mark_read_by(request.user)

    # Build sidebar conversations
    conversations = Conversation.objects.filter(
        participants=request.user
    ).prefetch_related('participants', 'participants__profile')

    conv_list = []
    for conv in conversations:
        other = conv.get_other_participant(request.user)
        if not other:
            continue
        last_msg = conv.last_message()
        unread = conv.unread_count_for(request.user)
        conv_list.append({
            'conversation': conv,
            'other_user': other,
            'last_message': last_msg,
            'unread_count': unread,
        })
    conv_list.sort(
        key=lambda x: x['last_message'].created_at if x['last_message'] else x['conversation'].created_at,
        reverse=True
    )

    return render(request, 'chat/index.html', {
        'conversations': conv_list,
        'active_conversation': conversation,
        'other_user': other_user,
        'messages': messages,
    })


@login_required
@require_POST
def start_conversation(request):
    """Start or open a conversation with another user."""
    user_id = request.POST.get('user_id')
    if not user_id:
        return JsonResponse({'error': 'user_id required'}, status=400)

    other_user = get_object_or_404(User, id=user_id)
    if other_user == request.user:
        return JsonResponse({'error': 'Cannot chat with yourself'}, status=400)

    conversation, created = Conversation.get_or_create_direct(request.user, other_user)
    return JsonResponse({
        'conversation_id': conversation.id,
        'redirect_url': f'/chat/{conversation.id}/',
    })


@login_required
@require_POST
def upload_attachment(request, conversation_id):
    """Handle file/image/audio/video uploads. Returns message ID for WS broadcast."""
    conversation = get_object_or_404(
        Conversation, id=conversation_id, participants=request.user
    )

    uploaded_file = request.FILES.get('file')
    if not uploaded_file:
        return JsonResponse({'error': 'No file provided'}, status=400)

    # Size validation (10 MB)
    if uploaded_file.size > settings.MAX_UPLOAD_SIZE:
        return JsonResponse({'error': 'File too large. Maximum size is 10 MB.'}, status=400)

    # Determine message type
    content_type = uploaded_file.content_type or mimetypes.guess_type(uploaded_file.name)[0] or ''
    ext = uploaded_file.name.rsplit('.', 1)[-1].lower() if '.' in uploaded_file.name else ''
    if content_type.startswith('image/') or ext in IMAGE_EXTENSIONS:
        msg_type = Message.TYPE_IMAGE
    elif content_type.startswith('audio/') or ext in AUDIO_EXTENSIONS:
        msg_type = Message.TYPE_AUDIO if 'voice' not in request.POST else Message.TYPE_VOICE
    elif content_type.startswith('video/') or ext in VIDEO_EXTENSIONS:
        msg_type = Message.TYPE_VIDEO
    else:
        msg_type = Message.TYPE_FILE

    # Check if it's a voice recording
    if request.POST.get('is_voice') == 'true':
        msg_type = Message.TYPE_VOICE

    caption = request.POST.get('caption', '').strip()

    msg = Message.objects.create(
        conversation=conversation,
        sender=request.user,
        message_type=msg_type,
        content=caption,
        attachment=uploaded_file,
        attachment_name=uploaded_file.name,
        attachment_size=uploaded_file.size,
    )
    conversation.save()  # update updated_at

    return JsonResponse({
        'success': True,
        'message_id': msg.id,
        'message': msg.to_dict(requesting_user=request.user),
    })


@login_required
@require_http_methods(['DELETE'])
def delete_message(request, message_id):
    data = json.loads(request.body)
    delete_for = data.get('delete_for', 'me')

    msg = get_object_or_404(Message, id=message_id)

    # Only sender can delete for everyone
    if delete_for == 'everyone' and msg.sender != request.user:
        return JsonResponse({'error': 'Not allowed'}, status=403)

    if not msg.conversation.participants.filter(id=request.user.id).exists():
        return JsonResponse({'error': 'Not a participant'}, status=403)

    if delete_for == 'everyone':
        msg.deleted_for_everyone = True
        msg.content = ''
        msg.save(update_fields=['deleted_for_everyone', 'content'])
    else:
        msg.deleted_for.add(request.user)

    return JsonResponse({'success': True})


@login_required
@require_POST
def edit_message(request, message_id):
    msg = get_object_or_404(Message, id=message_id, sender=request.user)
    data = json.loads(request.body)
    new_content = data.get('content', '').strip()

    if not new_content:
        return JsonResponse({'error': 'Content cannot be empty'}, status=400)

    if msg.message_type != Message.TYPE_TEXT:
        return JsonResponse({'error': 'Only text messages can be edited'}, status=400)

    msg.content = new_content
    msg.is_edited = True
    msg.save(update_fields=['content', 'is_edited', 'updated_at'])

    return JsonResponse({'success': True, 'content': new_content})


@login_required
def load_more_messages(request, conversation_id):
    """Pagination for older messages."""
    conversation = get_object_or_404(
        Conversation, id=conversation_id, participants=request.user
    )
    before_id = request.GET.get('before_id')
    qs = Message.objects.filter(
        conversation=conversation,
        deleted_for_everyone=False,
    ).exclude(
        deleted_for=request.user
    ).select_related('sender', 'sender__profile')

    if before_id:
        qs = qs.filter(id__lt=before_id)

    messages = list(qs.order_by('-created_at')[:20])
    messages.reverse()

    return JsonResponse({
        'messages': [m.to_dict(requesting_user=request.user) for m in messages],
        'has_more': len(messages) == 20,
    })
