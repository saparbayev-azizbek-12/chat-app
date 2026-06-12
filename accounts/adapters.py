from allauth.account.adapter import DefaultAccountAdapter
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from django.conf import settings


class AccountAdapter(DefaultAccountAdapter):
    def get_login_redirect_url(self, request):
        return '/'

    def get_signup_redirect_url(self, request):
        return '/'


class SocialAccountAdapter(DefaultSocialAccountAdapter):
    def get_connect_redirect_url(self, request, socialaccount):
        return '/'

    def populate_user(self, request, sociallogin, data):
        user = super().populate_user(request, sociallogin, data)
        # Ensure display name from Google is set
        if not user.first_name and data.get('first_name'):
            user.first_name = data['first_name']
        if not user.last_name and data.get('last_name'):
            user.last_name = data['last_name']
        return user
