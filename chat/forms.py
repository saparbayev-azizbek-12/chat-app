from django import forms
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth import get_user_model
from .models import Message

User = get_user_model()

class UserRegistrationForm(UserCreationForm):
    first_name = forms.CharField(max_length=30, required=True)
    last_name = forms.CharField(max_length=30, required=True)

    class Meta:
        model = User
        fields = ('username', 'first_name', 'last_name', 'password1', 'password2')

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for field_name, field in self.fields.items():
            field.widget.attrs['class'] = 'form-control'
            field.widget.attrs['placeholder'] = field.label

    def save(self, commit=True):
        user = super().save(commit=False)
        user.first_name = self.cleaned_data['first_name']
        user.last_name = self.cleaned_data['last_name']
        if commit:
            user.save()
        return user

class UserProfileForm(forms.ModelForm):
    class Meta:
        model = User
        fields = ('first_name', 'last_name', 'email', 'bio', 'phone_number', 'profile_picture', 'theme_preference')
        widgets = {
            'bio': forms.Textarea(attrs={'rows': 4}),
            'theme_preference': forms.Select(choices=[('light', 'Light'), ('dark', 'Dark')])
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for field_name, field in self.fields.items():
            if field_name != 'profile_picture':
                field.widget.attrs['class'] = 'form-control'
            else:
                field.widget.attrs['class'] = 'form-control-file'

class MessageForm(forms.ModelForm):
    class Meta:
        model = Message
        fields = ('content',)
        widgets = {
            'content': forms.TextInput(attrs={
                'class': 'form-control',
                'placeholder': 'Type a message...',
                'autocomplete': 'off'
            })
        }
