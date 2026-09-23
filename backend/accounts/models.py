import secrets

from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.utils import timezone


class PasswordResetManager(models.Manager):
    """Manager para la invalidación de tokens viejos del mismo usuario."""

    def invalidate_for(self, user):
        self.filter(user=user, is_used=False).update(is_used=True, used_at=timezone.now())


class UserManager(BaseUserManager):
    """
    Manager custom porque no usamos 'username': el login es por email.
    """

    def create_user(self, email, name, password=None, **extra_fields):
        if not email:
            raise ValueError("El usuario debe tener un email")
        email = self.normalize_email(email)
        user = self.model(email=email, name=name, **extra_fields)
        user.set_password(password)  # nunca guarda texto plano, hashea con PBKDF2
        user.save(using=self._db)
        return user

    def create_superuser(self, email, name, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        return self.create_user(email, name, password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    # "name" es el apodo: el nombre para mostrar que se usa en toda la app y
    # en las planillas. first_name/last_name son el nombre real, opcional.
    name = models.CharField(max_length=150)
    first_name = models.CharField(max_length=150, blank=True, default="")
    last_name = models.CharField(max_length=150, blank=True, default="")
    email = models.EmailField(unique=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["name"]

    def __str__(self):
        return f"{self.name} ({self.email})"


class PasswordReset(models.Model):
    """
    Código de recuperación de contraseña de 6 dígitos.
    Se crea al pedir el reset y se consume (is_used=True) cuando el usuario
    confirma la nueva contraseña, o se invalida si se genera uno nuevo.
    """

    class Meta:
        get_latest_by = "created_at"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="password_resets"
    )
    code = models.CharField(max_length=6)
    is_used = models.BooleanField(default=False)
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    objects = PasswordResetManager()

    @property
    def is_expired(self):
        return timezone.now() > self.expires_at

    @staticmethod
    def generate_code():
        """Código numérico seguro de 6 dígitos (evita secuencias predecibles)."""
        return f"{secrets.randbelow(1000000):06d}"

    def is_valid(self):
        return not self.is_used and not self.is_expired

    def __str__(self):
        return f"Reset {self.user.email} ({self.code})"
