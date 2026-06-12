from django.contrib import admin
from accounts.models import UserProfile


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ['user', 'is_online', 'last_seen', 'bio']
    list_filter = ['is_online']
    search_fields = ['user__username', 'user__email']
    raw_id_fields = ['user']
