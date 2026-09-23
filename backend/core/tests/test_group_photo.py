import pytest
from rest_framework.test import APIClient

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


class TestGroupPhoto:
    def test_owner_can_upload_group_photo(self, family):
        client = auth_client(family["owner"])
        response = client.patch(
            f"/api/groups/{family['group'].id}/", {"avatar_url": DATA_URI}
        )
        assert response.status_code == 200
        assert response.data["avatar_url"] == DATA_URI

    def test_photo_url_is_optional_and_can_be_cleared(self, family):
        client = auth_client(family["owner"])
        response = client.patch(f"/api/groups/{family['group'].id}/", {"avatar_url": ""})
        assert response.status_code == 200
        assert response.data["avatar_url"] == ""

    def test_photo_url_rejects_unknown_format(self, family):
        client = auth_client(family["owner"])
        response = client.patch(
            f"/api/groups/{family['group'].id}/", {"avatar_url": "javascript:alert(1)"}
        )
        assert response.status_code == 400

    def test_photo_url_rejects_oversized_payload(self, family):
        client = auth_client(family["owner"])
        huge = "data:image/png;base64," + "A" * (4 * 1024 * 1024)
        response = client.patch(f"/api/groups/{family['group'].id}/", {"avatar_url": huge})
        assert response.status_code == 400

    def test_any_group_member_can_view_photo(self, family):
        group = family["group"]
        group.avatar_url = DATA_URI
        group.save()
        client = auth_client(family["member"])
        response = client.get(f"/api/groups/{group.id}/")
        assert response.status_code == 200
        assert response.data["avatar_url"] == DATA_URI

    def test_members_expose_the_profile_photo(self, family):
        """La lista de integrantes incluye user_avatar: así el front muestra la
        foto de perfil actualizada sin pedir cada usuario por separado."""
        family["owner"].avatar_url = DATA_URI
        family["owner"].save()
        client = auth_client(family["member"])
        response = client.get(f"/api/groups/{family['group'].id}/")
        owner = next(m for m in response.data["members"] if m["user"] == family["owner"].id)
        assert owner["user_avatar"] == DATA_URI
        assert all("user_avatar" in m for m in response.data["members"])