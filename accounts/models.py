from django.db import models
from django.contrib.auth.models import User
from django.db.models.signals import post_save
from django.dispatch import receiver


class UserProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    avatar = models.ImageField(upload_to='avatars/', null=True, blank=True)
    bio = models.CharField(max_length=140, blank=True, default='')
    last_seen = models.DateTimeField(null=True, blank=True)
    is_online = models.BooleanField(default=False)

    class Meta:
        verbose_name = 'User Profile'
        verbose_name_plural = 'User Profiles'

    def __str__(self):
        return f'{self.user.username} Profile'

    @property
    def display_name(self):
        full = f'{self.user.first_name} {self.user.last_name}'.strip()
        return full if full else self.user.username

    @property
    def avatar_url(self):
        if self.avatar:
            return self.avatar.url
        return None

    def get_last_seen_display(self):
        from django.utils import timezone
        from django.utils.timesince import timesince
        if self.is_online:
            return 'Online'
        if self.last_seen:
            return f'Last seen {timesince(self.last_seen)} ago'
        return 'Offline'


@receiver(post_save, sender=User)
def create_user_profile(sender, instance, created, **kwargs):
    if created:
        UserProfile.objects.create(user=instance)


@receiver(post_save, sender=User)
def save_user_profile(sender, instance, **kwargs):
    if hasattr(instance, 'profile'):
        instance.profile.save()
