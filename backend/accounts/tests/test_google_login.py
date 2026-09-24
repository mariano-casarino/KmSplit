import pytest
from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.test import APIClient
from unittest import mock

import accounts.views as accounts_views

User = get_user_model()

pytestmark = pytest.mark.django_db

PICTURE = "https://lh3.googleusercontent.com/a/account-x=s96-c"

BASE_CLAIMS = {
    "iss": "https://accounts.google.com",
    "aud": "test-client-id.apps.googleusercontent.com",
    "sub": "google-sub-123",
    "email": "sofia@test.com",
    "email_verified": True,
    "name": "Sofía García",
    "given_name": "Sofía",
    "family_name": "García",
    "picture": PICTURE,
}


@pytest.fixture
def google_client():
    """APIClient con GOOGLE_CLIENT_ID configurado (como en producción)."""
    with override_settings(GOOGLE_CLIENT_ID="test-client-id.apps.googleusercontent.com"):
        yield APIClient()


@pytest.fixture
def mock_google_token():
    """Mockea la verificación criptográfica del id_token. Por default devuelve
    los claims de una cuenta válida; cada test puede pedir otra cosa."""
    with mock.patch.object(accounts_views.id_token, "verify_oauth2_token") as mocked:
        mocked.return_value = dict(BASE_CLAIMS)
        yield mocked


def google_login(client, claims=None):
    """Dispara POST /api/auth/google/ con un credential dummy y (opcionalmente)
    claims custom. Devuelve el response de DRF."""
    if claims is not None:
        accounts_views.id_token.verify_oauth2_token.return_value = claims
    return client.post("/api/auth/google/", {"credential": "un-id-token"}, format="json")


class TestGoogleLoginNewAccount:
    def test_creates_user_and_returns_tokens(self, google_client, mock_google_token):
        response = google_login(google_client)

        assert response.status_code == 200
        assert response.data["access"]
        assert response.data["refresh"]
        # cookie httpOnly del refresh, igual que el login con email+password
        assert response.cookies["kmsplit_refresh"].value

        user = User.objects.get(email="sofia@test.com")
        assert user.name == "Sofía García"
        assert user.first_name == "Sofía"
        assert user.last_name == "García"
        assert user.avatar_url == PICTURE
        assert user.google_picture == PICTURE

    def test_google_account_has_no_password(self, google_client, mock_google_token):
        google_login(google_client)
        user = User.objects.get(email="sofia@test.com")
        # creado desde Google: no tiene contraseña utilizable, solo entra por Google
        assert not user.has_usable_password()

    def test_without_given_name_falls_back_to_name(self, google_client, mock_google_token):
        claims = dict(BASE_CLAIMS, given_name="", name="Sofi")
        google_login(google_client, claims)
        user = User.objects.get(email="sofia@test.com")
        assert user.first_name == ""
        assert user.name == "Sofi"


class TestGoogleLoginExistingAccount:
    def test_links_by_email_and_keeps_existing_data(self, test_user, google_client, mock_google_token):
        """El mail coincide con una cuenta existente: entra a ESA cuenta y no pierde nada."""
        claims = dict(BASE_CLAIMS, email=test_user.email, picture=PICTURE)
        response = google_login(google_client, claims)

        assert response.status_code == 200
        user = User.objects.get(id=test_user.id)
        # misma cuenta: id intacto, datos que ya tenía intactos, foto de Google aplicada
        assert user.name == "Mariano"  # no lo pisa con el nombre de Google
        assert user.avatar_url == PICTURE
        assert user.google_picture == PICTURE
        test_user.refresh_from_db()
        assert test_user.id == user.id

    def test_respects_custom_avatar_changed_in_app(self, test_user, google_client, mock_google_token):
        """Si el usuario cambió su foto dentro de la app, el login de Google no la pisa."""
        test_user.avatar_url = "data:image/png;base64,iVBORw0KGgo="
        test_user.save(update_fields=["avatar_url"])

        claims = dict(BASE_CLAIMS, email=test_user.email)
        response = google_login(google_client, claims)

        assert response.status_code == 200
        test_user.refresh_from_db()
        # mantiene la foto que eligió en la app, pero guarda la nueva de Google como origen
        assert test_user.avatar_url == "data:image/png;base64,iVBORw0KGgo="
        assert test_user.google_picture == PICTURE

    def test_updates_avatar_when_still_google_photo(self, test_user, google_client, mock_google_token):
        """Si la foto actual todavía es la de Google, al volver a entrar se refresca."""
        test_user.avatar_url = "https://lh3.googleusercontent.com/a/foto-vieja"
        test_user.google_picture = "https://lh3.googleusercontent.com/a/foto-vieja"
        test_user.save(update_fields=["avatar_url", "google_picture"])

        claims = dict(BASE_CLAIMS, email=test_user.email, picture="https://lh3.googleusercontent.com/a/foto-nueva")
        response = google_login(google_client, claims)

        assert response.status_code == 200
        test_user.refresh_from_db()
        assert test_user.avatar_url == "https://lh3.googleusercontent.com/a/foto-nueva"
        assert test_user.google_picture == "https://lh3.googleusercontent.com/a/foto-nueva"


class TestGoogleLoginValidation:
    def test_invalid_token_rejected(self, google_client, mock_google_token):
        mock_google_token.side_effect = ValueError("firma inválida")
        response = google_login(google_client)
        assert response.status_code == 400

    def test_unverified_email_rejected(self, google_client, mock_google_token):
        response = google_login(google_client, dict(BASE_CLAIMS, email_verified=False))
        assert response.status_code == 400
        assert not User.objects.filter(email="sofia@test.com").exists()

    def test_missing_email_rejected(self, google_client, mock_google_token):
        claims = dict(BASE_CLAIMS)
        claims.pop("email")
        response = google_login(google_client, claims)
        assert response.status_code == 400

    def test_invalid_picture_ignored(self, google_client, mock_google_token):
        claims = dict(BASE_CLAIMS, picture="javascript:alert(1)")
        google_login(google_client, claims)
        user = User.objects.get(email="sofia@test.com")
        assert user.avatar_url == ""
        assert user.google_picture == ""

    def test_disabled_without_client_id(self, mock_google_token):
        # sin GOOGLE_CLIENT_ID configurado el endpoint no valida nada: 503
        with override_settings(GOOGLE_CLIENT_ID=""):
            response = APIClient().post(
                "/api/auth/google/", {"credential": "un-id-token"}, format="json"
            )
        assert response.status_code == 503