"""Validadores compartidos (fotos guardadas como data URI base64)."""

from rest_framework import serializers

# Las fotos viajan DENTRO de cada respuesta de la API: el avatar del usuario va
# en /auth/me, en su grupo y en el dashboard de cada vehículo. Con el límite
# viejo (4 MB de base64) una sola foto inundaba la carga de la pantalla: un
# /auth/me llegó a pesar 232 KB y el dashboard de un vehículo 694 KB, casi todo
# fotos que esa pantalla ni siquiera dibuja. El frontend comprime a un máximo
# de 180 KB (ver frontend/src/app/shared/utils/image.util.ts) y este techo es
# la red de seguridad para que ningún cliente se cuelgue un data URI gigante.
MAX_IMAGE_DATA_URI_BYTES = 256 * 1024


def validate_image_data_uri(value):
    """Las fotos (vehículo, avatar de perfil) se guardan como data URI base64.
    Vacío/None = sin foto (placeholder o limpiar). Acepta data:image/* (subida
    del usuario) o https:// (URL externa). Todo lo demás se rechaza."""
    if not value:
        return value
    if not isinstance(value, str):
        raise serializers.ValidationError("La foto debe ser un texto.")
    if len(value) > MAX_IMAGE_DATA_URI_BYTES:
        raise serializers.ValidationError(
            "La foto es demasiado grande. Probá con una imagen más liviana."
        )
    if value.startswith("data:image/") or value.startswith("http://") or value.startswith("https://"):
        return value
    raise serializers.ValidationError(
        "La foto debe ser una imagen base64 (data:image/...) o una URL."
    )