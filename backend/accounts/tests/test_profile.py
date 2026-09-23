import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

User = get_user_model()

pytestmark = pytest.mark.django_db


@pytest.fixture
def authed_client(test_user):
    """Cliente con sesión iniciada: access token en el header (JWT) + cookie
    httpOnly del refresh (como el frontend real)."""
    client = APIClient()
    login = client.post(
        "/api/auth/login/", {"email": test_user.email, "password": "testpass123"}
    )
    assert login.status_code == 200
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
    return client


class TestMeProfile:
    def test_me_returns_profile_fields(self, test_user, authed_client):
        response = authed_client.get("/api/auth/me/")
        assert response.status_code == 200
        assert response.data["email"] == test_user.email
        assert response.data["name"] == "Mariano"
        assert response.data["first_name"] == ""
        assert response.data["last_name"] == ""

    def test_me_update_name_and_last_name_ignores_email(self, test_user, authed_client):
        response = authed_client.put(
            "/api/auth/me/",
            {
                "name": "Mari",
                "first_name": "María",
                "last_name": "Barrios",
                "email": "otro@invalido.com",
            },
            format="json",
        )
        assert response.status_code == 200

        test_user.refresh_from_db()
        assert test_user.name == "Mari"
        assert test_user.first_name == "María"
        assert test_user.last_name == "Barrios"
        # el email identifica la cuenta: no se puede cambiar desde el perfil
        assert test_user.email == "mariano@test.com"

    def test_me_requires_auth(self):
        client = APIClient()
        assert client.get("/api/auth/me/").status_code == 401


class TestChangePassword:
    def test_change_password_success(self, test_user, authed_client):
        response = authed_client.post(
            "/api/auth/change-password/",
            {
                "current_password": "testpass123",
                "new_password": "NewPass99!x",
                "confirm_password": "NewPass99!x",
            },
            format="json",
        )
        assert response.status_code == 200

        test_user.refresh_from_db()
        assert test_user.check_password("NewPass99!x")

        # con la contraseña nueva se puede iniciar sesión
        fresh_client = APIClient()
        login = fresh_client.post(
            "/api/auth/login/",
            {"email": test_user.email, "password": "NewPass99!x"},
        )
        assert login.status_code == 200

    def test_change_password_wrong_current(self, test_user, authed_client):
        response = authed_client.post(
            "/api/auth/change-password/",
            {
                "current_password": "wrong-password",
                "new_password": "NewPass99!x",
                "confirm_password": "NewPass99!x",
            },
            format="json",
        )
        assert response.status_code == 400
        assert "current_password" in response.data
        test_user.refresh_from_db()
        # como falló la validación, la contraseña vieja sigue funcionando
        assert test_user.check_password("testpass123")

    def test_change_password_mismatch(self, authed_client):
        response = authed_client.post(
            "/api/auth/change-password/",
            {
                "current_password": "testpass123",
                "new_password": "NewPass99!x",
                "confirm_password": "NewPass98!x",
            },
            format="json",
        )
        assert response.status_code == 400

    def test_change_password_weak_new(self, authed_client):
        response = authed_client.post(
            "/api/auth/change-password/",
            {
                "current_password": "testpass123",
                "new_password": "12345678",
                "confirm_password": "12345678",
            },
            format="json",
        )
        assert response.status_code == 400

    def test_change_password_same_as_current(self, authed_client):
        response = authed_client.post(
            "/api/auth/change-password/",
            {
                "current_password": "testpass123",
                "new_password": "testpass123",
                "confirm_password": "testpass123",
            },
            format="json",
        )
        assert response.status_code == 400

    def test_change_password_requires_auth(self):
        client = APIClient()
        response = client.post("/api/auth/change-password/", {})
        assert response.status_code == 401