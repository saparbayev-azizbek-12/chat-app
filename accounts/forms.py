from django import forms
from django.contrib.auth.models import User
from accounts.models import UserProfile


class ProfileEditForm(forms.ModelForm):
    first_name = forms.CharField(max_length=30, required=False, widget=forms.TextInput(
        attrs={'class': 'w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500', 'placeholder': 'First name'}
    ))
    last_name = forms.CharField(max_length=30, required=False, widget=forms.TextInput(
        attrs={'class': 'w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500', 'placeholder': 'Last name'}
    ))

    class Meta:
        model = UserProfile
        fields = ['avatar', 'bio']
        widgets = {
            'avatar': forms.FileInput(attrs={'class': 'hidden', 'id': 'avatar-input', 'accept': 'image/*'}),
            'bio': forms.TextInput(attrs={
                'class': 'w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500',
                'placeholder': 'Write something about yourself...',
                'maxlength': '140',
            }),
        }

    def __init__(self, *args, **kwargs):
        self.user = kwargs.pop('user', None)
        super().__init__(*args, **kwargs)
        if self.user:
            self.fields['first_name'].initial = self.user.first_name
            self.fields['last_name'].initial = self.user.last_name

    def save(self, commit=True):
        profile = super().save(commit=False)
        if self.user:
            self.user.first_name = self.cleaned_data.get('first_name', '')
            self.user.last_name = self.cleaned_data.get('last_name', '')
            self.user.save(update_fields=['first_name', 'last_name'])
        if commit:
            profile.save()
        return profile
