from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.views.decorators.http import require_POST
from django.http import JsonResponse
from accounts.forms import ProfileEditForm
from accounts.models import UserProfile


@login_required
def profile_view(request, username=None):
    if username:
        user = get_object_or_404(User, username=username)
    else:
        user = request.user
    profile = get_object_or_404(UserProfile, user=user)
    return render(request, 'accounts/profile.html', {'profile_user': user, 'profile': profile})


@login_required
def profile_edit_view(request):
    profile = get_object_or_404(UserProfile, user=request.user)
    if request.method == 'POST':
        form = ProfileEditForm(request.POST, request.FILES, instance=profile, user=request.user)
        if form.is_valid():
            form.save()
            if request.headers.get('x-requested-with') != 'XMLHttpRequest':
                return redirect('accounts:profile')
            return JsonResponse({'success': True, 'message': 'Profile updated!'})
        if request.headers.get('x-requested-with') != 'XMLHttpRequest':
            return redirect('accounts:profile')
        return JsonResponse({'success': False, 'errors': form.errors}, status=400)
    return JsonResponse({'success': False}, status=405)


@login_required
def user_search_view(request):
    q = request.GET.get('q', '').strip()
    users = []
    if q and len(q) >= 2:
        qs = User.objects.filter(
            username__icontains=q
        ).exclude(
            id=request.user.id
        ).select_related('profile')[:10]

        users = [{
            'id': u.id,
            'username': u.username,
            'display_name': u.profile.display_name if hasattr(u, 'profile') else u.username,
            'avatar_url': u.profile.avatar_url if hasattr(u, 'profile') else None,
            'is_online': u.profile.is_online if hasattr(u, 'profile') else False,
        } for u in qs]

    return JsonResponse({'users': users})
