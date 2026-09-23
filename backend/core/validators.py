"""Validadores compartidos (fotos guardadas como data URI base64)."""

from rest_framework import serializers


def validate_image_data_uri(value):
    """Las fotos (vehículo, avatar de perfil) se guardan como data URI base64.
    Vacío/None = sin foto (placeholder o limpiar). Acepta data:image/* (subida
    del usuario) o https:// (URL externa). Todo lo demás se rechaza."""
    if not value:
        return value
    if not isinstance(value, str):
        raise serializers.ValidationError("La foto debe ser un texto.")
    # Límite blando ~4 MB en base64 (~3 MB de imagen). Evita filas gigantes.
    max_len = 4 * 1024 * 1024
    if len(value) > max_len:
        raise serializers.ValidationError(
            "La foto es demasiado grande. Probá con una imagen más liviana."
        )
    if value.startswith("data:image/") or value.startswith("http://") or value.startswith("https://"):
        return value
    raise serializers.ValidationError(
        "La foto debe ser una imagen base64 (data:image/...) o una URL."
    )