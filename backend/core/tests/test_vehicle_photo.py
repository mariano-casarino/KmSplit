import pytest
from rest_framework.test import APIClient

from core.validators import MAX_IMAGE_DATA_URI_BYTES

pytestmark = pytest.mark.django_db

# 1x1 PNG transparente en base64 (data URI válida)
DATA_URI = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def auth_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


class TestVehiclePhoto:
    def test_owner_can_upload_photo(self, family, vehicle):
        client = auth_client(family["owner"])
        response = client.patch(f"/api/vehicles/{vehicle.id}/", {"photo_url": DATA_URI})
        assert response.status_code == 200
        assert response.data["photo_url"] == DATA_URI

    def test_photo_url_is_optional_and_can_be_cleared(self, family, vehicle):
        client = auth_client(family["owner"])
        assert vehicle.photo_url == ""
        response = client.patch(f"/api/vehicles/{vehicle.id}/", {"photo_url": ""})
        assert response.status_code == 200
        assert response.data["photo_url"] == ""

    def test_photo_url_rejects_unknown_format(self, family, vehicle):
        client = auth_client(family["owner"])
        response = client.patch(
            f"/api/vehicles/{vehicle.id}/", {"photo_url": "javascript:alert(1)"}
        )
        assert response.status_code == 400

    def test_photo_url_rejects_oversized_payload(self, family, vehicle):
        client = auth_client(family["owner"])
        # el tope es 256 KB: antes las fotos podían pesar 4 MB de base64 y
        # terminaban viajando dentro de cada respuesta de la API
        huge = "data:image/png;base64," + "A" * (MAX_IMAGE_DATA_URI_BYTES + 1)
        response = client.patch(f"/api/vehicles/{vehicle.id}/", {"photo_url": huge})
        assert response.status_code == 400

    def test_photo_url_accepts_a_photo_at_the_size_limit(self, family, vehicle):
        """El límite tiene que dejar pasar lo que el frontend sí produce."""
        client = auth_client(family["owner"])
        justo = "data:image/jpeg;base64," + "A" * (MAX_IMAGE_DATA_URI_BYTES - 30)
        response = client.patch(f"/api/vehicles/{vehicle.id}/", {"photo_url": justo})
        assert response.status_code == 200

    def test_any_group_member_can_view_photo(self, family, vehicle):
        vehicle.photo_url = DATA_URI
        vehicle.save()
        client = auth_client(family["member"])
        response = client.get(f"/api/vehicles/{vehicle.id}/")
        assert response.status_code == 200
        assert response.data["photo_url"] == DATA_URI