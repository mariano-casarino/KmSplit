from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from core.validators import validate_image_data_uri

from .models import User


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True)

    class Meta:
        model = User
        fields = ["id", "name", "last_name", "email", "password"]

    def validate_password(self, value):
        # Django trae validadores por default (largo mínimo, no ser una
        # contraseña común, no ser solo números, no parecerse al email/nombre)
        # pero DRF nunca los llama solo -- hay que invocarlos a mano acá.
        try:
            validate_password(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages))
        return value

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "name", "first_name", "last_name", "avatar_url", "email", "created_at"]
        read_only_fields = fields


class ProfileUpdateSerializer(serializers.ModelSerializer):
    """PUT /api/auth/me/ — el usuario edita su perfil (apodo + nombre + apellido)
    y su foto de perfil (avatar_url, data URI). El email es el identificador de
    la cuenta: solo lectura por ahora."""

    class Meta:
        model = User
        fields = ["id", "name", "first_name", "last_name", "avatar_url", "email"]
        read_only_fields = ["id", "email"]

    def validate_avatar_url(self, value):
        """Misma validación que la foto del vehículo (core.validators)."""
        return validate_image_data_uri(value)


class ChangePasswordSerializer(serializers.Serializer):
    """POST /api/auth/change-password/ — requiere la contraseña actual y
    valida la nueva con los validadores de Django (largo, no común, no
    numérica, no similar a nombre/email del usuario)."""

    current_password = serializers.CharField(write_only=True, trim_whitespace=False)
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)
    confirm_password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_new_password(self, value):
        try:
            validate_password(value, user=self.context["user"])
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages))
        return value

    def validate(self, attrs):
        user = self.context["user"]
        if not user.check_password(attrs["current_password"]):
            raise serializers.ValidationError(
                {"current_password": "La contraseña actual no es correcta."}
            )
        if attrs["new_password"] != attrs["confirm_password"]:
            raise serializers.ValidationError(
                {"confirm_password": "Las contraseñas no coinciden."}
            )
        if user.check_password(attrs["new_password"]):
            raise serializers.ValidationError(
                {"new_password": "La contraseña nueva no puede ser igual a la actual."}
            )
        return attrs
