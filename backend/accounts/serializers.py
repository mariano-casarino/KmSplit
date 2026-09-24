from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from core.validators import validate_image_data_uri

from .models import User


class RegisterSerializer(serializers.ModelSerializer):
    """Registro: el nombre real (first_name) es obligatorio y el apodo (name)
    opcional. Si no se manda apodo, se usa el nombre real como apodo para que
    la app/planillas siempre tengan un nombre para mostrar."""

    password = serializers.CharField(write_only=True)
    name = serializers.CharField(required=False, allow_blank=True, max_length=150)

    class Meta:
        model = User
        fields = ["id", "name", "first_name", "last_name", "email", "password"]

    def validate_password(self, value):
        # Django trae validadores por default (largo mínimo, no ser una
        # contraseña común, no ser solo números, no parecerse al email/nombre)
        # pero DRF nunca los llama solo -- hay que invocarlos a mano acá.
        try:
            validate_password(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages))
        return value

    def validate(self, attrs):
        first_name = (attrs.get("first_name") or "").strip()
        if not first_name:
            raise serializers.ValidationError(
                {"first_name": "El nombre real es obligatorio."}
            )
        # apodo opcional: si no va, usamos el nombre real
        name = (attrs.get("name") or "").strip()
        attrs["name"] = name or first_name
        return attrs

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


class GoogleLoginSerializer(serializers.Serializer):
    """POST /api/auth/google/ — recibe el id_token de Google Sign-In (GIS) y
    valida que no venga vacío. La verificación criptográfica del token se hace
    en la vista (id_token.verify_oauth2_token)."""

    credential = serializers.CharField(trim_whitespace=True)


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
