from django import template
from django.utils import timezone
import datetime

register = template.Library()

@register.filter
def day_label(value):
    """Return a friendly day label for a datetime/date.

    - Today
    - Yesterday
    - 8-June (if same year)
    - 8-June, 2025 (if different year)
    """
    if not value:
        return ''
    # ensure timezone-aware and local
    try:
        dt = timezone.localtime(value)
    except Exception:
        # value might be a date
        if isinstance(value, datetime.date) and not isinstance(value, datetime.datetime):
            dt = datetime.datetime.combine(value, datetime.time.min)
            dt = timezone.make_aware(dt)
            dt = timezone.localtime(dt)
        else:
            return str(value)

    now = timezone.localtime(timezone.now())
    d = dt.date()
    if d == now.date():
        return 'Today'
    if d == (now.date() - datetime.timedelta(days=1)):
        return 'Yesterday'
    month = dt.strftime('%B')
    if d.year == now.year:
        return f"{dt.day}-{month}"
    return f"{dt.day}-{month}, {dt.year}"
