"""Mails de la app: bienvenida al registrarse y formato del código de reset."""

import pytest
from django.core import mail
from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APIClient
from unittest import mock

import accounts.views as accounts_views
from accounts.models import PasswordReset, User

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def clear_cache():
    """El registro y el pedido de código comparten el scope de throttle
    'register': sin limpiar la cache, el segundo test se come un 429."""
    cache.clear()
    yield
    cache.clear()

BASE_CLAIMS = {
    "iss": "https://accounts.google.com",
    "aud": "test-client-id.apps.googleusercontent.com",
    "sub": "google-sub-123",
    "email": "sofia@test.com",
    "email_verified": True,
    "name": "Sofía García",
    "given_name": "Sofía",
    "family_name": "García",
}


@pytest.fixture
def google_client():
    """APIClient con GOOGLE_CLIENT_ID configurado (como en producción)."""
    with override_settings(GOOGLE_CLIENT_ID="test-client-id.apps.googleusercontent.com"):
        yield APIClient()


@pytest.fixture
def mock_google_token():
    """Mockea la verificación criptográfica del id_token."""
    with mock.patch.object(accounts_views.id_token, "verify_oauth2_token") as mocked:
        mocked.return_value = dict(BASE_CLAIMS)
        yield mocked


def _google_login(client):
    return client.post(
        "/api/auth/google/", {"credential": "un-id-token"}, format="json"
    )


def _register(client, email="nueva@test.com", first_name="Ana"):
    return client.post(
        "/api/auth/register/",
        {
            "first_name": first_name,
            "last_name": "Lopez",
            "email": email,
            "password": "StrongPass99!x",
        },
    )


def _html_of(index=0):
    return mail.outbox[index].alternatives[0][0]


class TestWelcomeEmail:
    def test_registro_manda_bienvenida(self):
        client = APIClient()
        response = _register(client)
        assert response.status_code == 201

        assert len(mail.outbox) == 1
        welcome = mail.outbox[0]
        assert welcome.to == ["nueva@test.com"]
        assert "Bienvenido a KmSplit" in welcome.subject

        # Saluda con el nombre de pila, no con el nombre completo.
        assert "Hola Ana" in welcome.body
        assert "Lopez" not in welcome.body

    def test_bienvenida_explica_que_puede_hacer(self):
        client = APIClient()
        _register(client)
        welcome = mail.outbox[0]

        # Los tres pasos de la app están en el texto plano (el que se ve si el
        # cliente no muestra HTML)...
        for expected in ("grupo", "viajes", "liquidación"):
            assert expected in welcome.body

        # ...y también en el HTML maquetado, que es lo que ve Gmail.
        html = _html_of()
        assert "<html" in html
        for expected in ("Crear mi grupo", "liquidación", "km"):
            assert expected in html

    def test_bienvenida_tiene_boton_con_link_a_la_app(self, settings):
        settings.FRONTEND_URL = "https://kmsplit.vercel.app"
        client = APIClient()
        _register(client)

        assert "https://kmsplit.vercel.app/grupos/nuevo" in _html_of()
        assert "https://kmsplit.vercel.app/grupos/nuevo" in mail.outbox[0].body

    def test_google_crea_cuenta_y_manda_bienvenida(self, google_client, mock_google_token):
        response = _google_login(google_client)
        assert response.status_code == 200
        assert User.objects.filter(email="sofia@test.com").exists()
        assert len(mail.outbox) == 1
        assert "Bienvenido a KmSplit" in mail.outbox[0].subject

    def test_google_de_cuenta_existente_no_re_manda_bienvenida(
        self, test_user, google_client, mock_google_token
    ):
        # el id_token trae el email de una cuenta que YA existe en KmSplit
        accounts_views.id_token.verify_oauth2_token.return_value = dict(
            BASE_CLAIMS, email=test_user.email
        )

        response = _google_login(google_client)
        assert response.status_code == 200
        # entra a esa misma cuenta y no se le reenvía el mail de bienvenida
        assert len(mail.outbox) == 0

    def test_si_el_mail_falla_el_registro_no_se_cae(self, settings, monkeypatch):
        settings.BREVO_API_KEY = "xkeysib-test"

        def boom(*args, **kwargs):
            raise Exception("brevo caido")

        monkeypatch.setattr("core.mail.send_brevo_email", boom)

        client = APIClient()
        response = _register(client)
        assert response.status_code == 201
        assert User.objects.filter(email="nueva@test.com").exists()


class TestPasswordResetEmail:
    def _request_code(self, client, email):
        return client.post("/api/auth/password-reset/request/", {"email": email})

    def test_el_reset_manda_html_con_el_codigo(self, test_user):
        client = APIClient()
        response = self._request_code(client, test_user.email)
        assert response.status_code == 200

        code = PasswordReset.objects.filter(user=test_user).latest("created_at").code
        message = mail.outbox[0]

        # Texto plano: el código se lee siempre.
        assert code in message.body
        assert "minutos" in message.body

        # HTML: mismo código, maquetado, con el link a la pantalla de reset.
        html = _html_of()
        assert code in html
        assert "/recuperar-contrasena" in html

    def test_el_asunto_del_reset_incluye_el_codigo(self, test_user):
        client = APIClient()
        self._request_code(client, test_user.email)
        code = PasswordReset.objects.filter(user=test_user).latest("created_at").code
        assert code in mail.outbox[0].subject

    def test_el_escape_del_nombre_no_rompe_el_html(self, test_user):
        """Un nombre con HTML inyectado tiene que verse literal, no ejecutarse."""
        test_user.name = "<script>alert(1)</script> Mario"
        test_user.save(update_fields=["name"])

        client = APIClient()
        self._request_code(client, test_user.email)

        html = _html_of()
        assert "<script>" not in html
        assert "&lt;script&gt;" in html
