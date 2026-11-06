from django.conf import settings
from django.contrib import admin
from django.urls import include, path

from core.views import health_check

urlpatterns = [
    path("health", health_check, name="health-root"),
    path("health/", health_check, name="health-root-slash"),
    path(settings.ADMIN_URL, admin.site.urls),
    path("api/auth/", include("accounts.urls")),
    path("api/", include("core.urls")),
]
