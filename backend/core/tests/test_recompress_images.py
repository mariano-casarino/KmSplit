"""Tests del comando `recompress_images`.

Contexto: las fotos se guardan como data URI base64 y viajan dentro de cada
respuesta de la API. Las que se subieron con la compresión vieja del frontend
(1200px, calidad 0.82) pesan 100-380 KB cada una, y por eso un /auth/me llegó a
pesar 232 KB y el dashboard de un vehículo 694 KB. Este comando las pasa por
los mismos límites que hoy usa el frontend.
"""

import base64
import io
import json

import pytest
from django.core.cache import cache
from django.core.management import call_command
from PIL import Image, ImageFilter

from core.models import Group
from core.validators import MAX_IMAGE_DATA_URI_BYTES

pytestmark = pytest.mark.django_db


def data_uri_de(width, height, quality=95):
    """Arma un data URI JPEG real que se parezca a una foto.

    No usamos un color plano: uno solo pesa 1.5 KB y no representaría nada. Con
    nubes de ruido, una foto de 1200px queda en el orden de los cientos de KB,
    que es lo que pasaba en producción.
    """
    img = Image.effect_noise((width // 3, height // 3), 40).resize(
        (width, height), Image.Resampling.BICUBIC
    )
    img = img.filter(ImageFilter.GaussianBlur(1.2))
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=quality)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode()


def dimensiones_de(data_uri):
    payload = data_uri.partition(",")[2]
    with Image.open(io.BytesIO(base64.b64decode(payload))) as img:
        return img.size


class TestRecomprimirFotos:
    def test_achica_un_avatar_de_1200px(self, family):
        """1200px es lo que producía la compresión vieja: tiene que bajar a 320."""
        user = family["owner"]
        user.avatar_url = data_uri_de(1200, 1200)
        user.save()

        call_command("recompress_images")

        user.refresh_from_db()
        assert dimensiones_de(user.avatar_url) == (320, 320)
        assert user.avatar_url.startswith("data:image/jpeg;base64,")

    def test_achica_el_avatar_de_un_grupo(self, family):
        family["group"].avatar_url = data_uri_de(1200, 900)
        family["group"].save()

        call_command("recompress_images")

        family["group"].refresh_from_db()
        assert dimensiones_de(family["group"].avatar_url) == (480, 360)

    def test_achica_la_foto_de_un_vehiculo(self, vehicle):
        vehicle.photo_url = data_uri_de(1200, 900)
        vehicle.save()

        call_command("recompress_images")

        vehicle.refresh_from_db()
        assert dimensiones_de(vehicle.photo_url) == (900, 675)

    def test_no_escala_hacia_arriba(self, family):
        """Una foto de 100px no se agranda (y desde luego no se infla)."""
        user = family["owner"]
        original = data_uri_de(100, 100)
        user.avatar_url = original
        user.save()

        call_command("recompress_images")

        user.refresh_from_db()
        assert dimensiones_de(user.avatar_url) == (100, 100)
        assert len(user.avatar_url) <= len(original)

    def test_una_imagen_ya_liviana_no_se_toca(self, family):
        """Re-codificar de más es pérdida de calidad gratis.

        Esta foto ya es un avatar de 320px y estáTan comprimida que volver a
        pasarla por el encoder solo la empeoraría, así que el comando la deja
        como está.
        """
        user = family["owner"]
        original = data_uri_de(320, 320, quality=25)
        user.avatar_url = original
        user.save()

        call_command("recompress_images")

        user.refresh_from_db()
        assert user.avatar_url == original

    def test_deja_intactas_las_urls_externas(self, family):
        user = family["owner"]
        url = "https://lh3.googleusercontent.com/a/abc123"
        user.avatar_url = url
        user.save()

        call_command("recompress_images")

        user.refresh_from_db()
        assert user.avatar_url == url

    def test_dry_run_no_escribe(self, family):
        user = family["owner"]
        user.avatar_url = data_uri_de(1200, 1200)
        user.save()
        original = user.avatar_url

        call_command("recompress_images", "--dry-run")

        user.refresh_from_db()
        assert user.avatar_url == original

    def test_una_foto_corrupta_no_rompe_el_comando(self, family, vehicle):
        user = family["owner"]
        rota = "data:image/jpeg;base64,no-soy-una-imagen"
        user.avatar_url = rota
        user.save()
        vehicle.photo_url = data_uri_de(1200, 1200)
        vehicle.save()

        call_command("recompress_images")

        user.refresh_from_db()
        vehicle.refresh_from_db()
        assert user.avatar_url == rota
        assert dimensiones_de(vehicle.photo_url) == (900, 900)


class TestPayloadDespuesDeRecomprimir:
    def test_el_dashboard_deja_de_pesar_lo_que_eran_las_fotos(self, family, vehicle):
        """La razón de todo esto: el dashboard es la request más pesada de la app.

        Antes de recomprimir, este payload era casi todo base64 de fotos: medido
        en 210 KiB de los cuales 198 KiB eran imágenes, y la pantalla ni siquiera
        dibuja ninguna.
        """
        vehicle.photo_url = data_uri_de(1200, 1200)
        vehicle.save()
        Group.objects.filter(pk=vehicle.group_id).update(
            avatar_url=data_uri_de(1200, 1200)
        )
        for user in (family["owner"], family["admin"], family["member"]):
            user.avatar_url = data_uri_de(1200, 1200)
            user.save()

        cliente = auth_client(family["owner"])
        antes = len(json.dumps(cliente.get(f"/api/vehicles/{vehicle.id}/dashboard/").data))

        call_command("recompress_images")
        cache.clear()  # el dashboard se cachea 300s: hay que invalidarla
        despues = len(json.dumps(cliente.get(f"/api/vehicles/{vehicle.id}/dashboard/").data))

        vehicle.refresh_from_db()
        assert len(vehicle.photo_url) < MAX_IMAGE_DATA_URI_BYTES
        assert despues < antes / 2

    def test_auth_me_deja_de_ser_una_foto(self, family):
        """/auth/me llegó a pesar 232 KiB: era, casi entero, un avatar."""
        user = family["owner"]
        user.avatar_url = data_uri_de(1200, 1200)
        user.save()

        cliente = auth_client(user)
        antes = len(json.dumps(cliente.get("/api/auth/me/").data))
        assert antes > 100_000  # la foto se comía la respuesta entera

        call_command("recompress_images")
        user.refresh_from_db()  # el objeto en memoria quedó con la foto vieja
        despues = len(json.dumps(cliente.get("/api/auth/me/").data))

        assert despues < antes / 5


def auth_client(user):
    from rest_framework.test import APIClient

    client = APIClient()
    client.force_authenticate(user=user)
    return client
