import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def clear_cache():
    """
    El throttling y el bloqueo de cuenta usan el cache de Django -- sin
    limpiarlo entre tests, un test podría heredar el contador de intentos
    fallidos de otro y dar falsos positivos/negativos.
    """
    cache.clear()
    yield
    cache.clear()


class TestLoginLockout:
    def test_account_locks_after_too_many_failed_attempts(self, test_user):
        client = APIClient()

        for _ in range(5):
            client.post("/api/auth/login/", {"email": test_user.email, "password": "wrong-password"})

        response = client.post(
            "/api/auth/login/", {"email": test_user.email, "password": "wrong-password"}
        )
        assert response.status_code == 429
        assert "retry_after_seconds" in response.data
        assert 0 < response.data["retry_after_seconds"] <= 15 * 60

    def test_successful_login_resets_attempt_counter(self, test_user):
        client = APIClient()

        for _ in range(3):
            client.post("/api/auth/login/", {"email": test_user.email, "password": "wrong-password"})

        response = client.post(
            "/api/auth/login/", {"email": test_user.email, "password": "testpass123"}
        )
        assert response.status_code == 200

    def test_correct_password_still_works_when_under_the_limit(self, test_user):
        client = APIClient()

        client.post("/api/auth/login/", {"email": test_user.email, "password": "wrong-password"})
        client.post("/api/auth/login/", {"email": test_user.email, "password": "wrong-password"})

        response = client.post(
            "/api/auth/login/", {"email": test_user.email, "password": "testpass123"}
        )
        assert response.status_code == 200


class TestPasswordValidation:
    def test_common_password_is_rejected(self):
        client = APIClient()
        response = client.post(
            "/api/auth/register/",
            {
                "first_name": "Test",
                "email": "weakpass@test.com",
                "password": "password123",
            },
        )
        assert response.status_code == 400

    def test_fully_numeric_password_is_rejected(self):
        client = APIClient()
        response = client.post(
            "/api/auth/register/",
            {
                "first_name": "Test",
                "email": "numericpass@test.com",
                "password": "12345678",
            },
        )
        assert response.status_code == 400

    def test_strong_password_is_accepted(self):
        client = APIClient()
        response = client.post(
            "/api/auth/register/",
            {
                "first_name": "Test",
                "email": "strongpass@test.com",
                "password": "Xk9$mQ2vRp8Lw",
            },
        )
        assert response.status_code == 201

    def test_register_saves_nickname_and_last_name(self):
        client = APIClient()
        response = client.post(
            "/api/auth/register/",
            {
                "name": "Pepe",
                "first_name": "José",
                "last_name": "Gómez",
                "email": "pepe@test.com",
                "password": "Xk9$mQ2vRp8Lw",
            },
            format="json",
        )
        assert response.status_code == 201
        assert response.data["name"] == "Pepe"
        assert response.data["first_name"] == "José"
        assert response.data["last_name"] == "Gómez"

    def test_register_without_nickname_uses_real_name(self):
        client = APIClient()
        response = client.post(
            "/api/auth/register/",
            {
                "first_name": "Mariana",
                "last_name": "López",
                "email": "mariana@test.com",
                "password": "Xk9$mQ2vRp8Lw",
            },
            format="json",
        )
        assert response.status_code == 201
        assert response.data["name"] == "Mariana"
        assert response.data["first_name"] == "Mariana"

    def test_register_requires_a_real_name(self):
        client = APIClient()
        response = client.post(
            "/api/auth/register/",
            {
                "name": "Apodo",
                "email": "noname@test.com",
                "password": "Xk9$mQ2vRp8Lw",
            },
            format="json",
        )
        assert response.status_code == 400

class TestCookieBasedRefresh:
    def test_login_sets_httponly_refresh_cookie_and_also_returns_it_in_body(self, test_user):
        """Dual-write: el refresh token vive en la cookie httpOnly (primario)
        Y también viaja en el body (respaldo para iOS PWA que limpia cookies)."""
        client = APIClient()
        response = client.post(
            "/api/auth/login/", {"email": test_user.email, "password": "testpass123"}
        )

        assert response.status_code == 200
        assert "access" in response.data
        assert "refresh" in response.data  # respaldo en body (iOS PWA)

        cookie = response.cookies.get("kmsplit_refresh")
        assert cookie is not None
        assert cookie["httponly"] is True

    def test_refresh_works_using_cookie_without_sending_a_body(self, test_user):
        client = APIClient()
        client.post("/api/auth/login/", {"email": test_user.email, "password": "testpass123"})

        response = client.post("/api/auth/refresh/")
        assert response.status_code == 200
        assert "access" in response.data

    def test_refresh_works_using_body_token_when_no_cookie(self, test_user):
        """iOS PWA puede perder la cookie httpOnly al relanzar la app.
        El body con el refresh token es el respaldo."""
        client = APIClient()
        login_resp = client.post(
            "/api/auth/login/", {"email": test_user.email, "password": "testpass123"}
        )
        stored_refresh = login_resp.data["refresh"]

        client.cookies.clear()
        response = client.post("/api/auth/refresh/", {"refresh": stored_refresh})
        assert response.status_code == 200
        assert "access" in response.data

    def test_refresh_fails_without_any_cookie_or_body(self):
        client = APIClient()
        response = client.post("/api/auth/refresh/")
        assert response.status_code == 401

    def test_refresh_response_includes_new_refresh_token(self, test_user):
        """Tras rotar, el nuevo refresh viaja en body para que el frontend
        actualice su respaldo en localStorage."""
        client = APIClient()
        client.post(
            "/api/auth/login/",
            {"email": test_user.email, "password": "testpass123", "remember": True},
        )
        response = client.post("/api/auth/refresh/")
        assert response.status_code == 200
        assert "refresh" in response.data
        assert len(response.data["refresh"]) > 10  # no vacío

    def test_logout_invalidates_the_session(self, test_user):
        client = APIClient()
        client.post("/api/auth/login/", {"email": test_user.email, "password": "testpass123"})

        logout_response = client.post("/api/auth/logout/")
        assert logout_response.status_code == 200

        # después del logout, ya no debería poder refrescar con ese cliente
        refresh_response = client.post("/api/auth/refresh/")
        assert refresh_response.status_code == 401

    def test_logout_invalidates_body_token_when_no_cookie(self, test_user):
        """Logout también invalida el refresh token del body (iOS PWA)."""
        client = APIClient()
        login_resp = client.post(
            "/api/auth/login/", {"email": test_user.email, "password": "testpass123"}
        )
        stored_refresh = login_resp.data["refresh"]

        client.cookies.clear()
        logout_response = client.post("/api/auth/logout/", {"refresh": stored_refresh})
        assert logout_response.status_code == 200

        response = client.post("/api/auth/refresh/", {"refresh": stored_refresh})
        assert response.status_code == 401


class TestRememberMe:
    def test_remember_true_sets_persistent_cookie_with_max_age(self, test_user):
        client = APIClient()
        response = client.post(
            "/api/auth/login/",
            {"email": test_user.email, "password": "testpass123", "remember": True},
        )

        assert response.status_code == 200
        cookie = response.cookies.get("kmsplit_refresh")
        assert cookie is not None
        assert cookie["max-age"]  # persistente: ~7 días
        assert int(cookie["max-age"]) == 7 * 24 * 60 * 60

    def test_remember_false_sets_session_cookie_without_max_age(self, test_user):
        client = APIClient()
        response = client.post(
            "/api/auth/login/",
            {"email": test_user.email, "password": "testpass123", "remember": False},
        )

        assert response.status_code == 200
        cookie = response.cookies.get("kmsplit_refresh")
        assert cookie is not None
        # sin max-age = cookie de sesión (se borra al cerrar el navegador)
        assert not cookie.get("max-age")

    def test_remember_defaults_to_true(self, test_user):
        client = APIClient()
        response = client.post(
            "/api/auth/login/", {"email": test_user.email, "password": "testpass123"}
        )

        cookie = response.cookies.get("kmsplit_refresh")
        assert cookie is not None
        assert cookie["max-age"]

    def test_refresh_preserves_persistent_cookie_if_remember_true(self, test_user):
        client = APIClient()
        client.post(
            "/api/auth/login/",
            {"email": test_user.email, "password": "testpass123", "remember": True},
        )

        response = client.post("/api/auth/refresh/")
        assert response.status_code == 200
        cookie = response.cookies.get("kmsplit_refresh")
        assert cookie is not None
        assert cookie["max-age"]
        assert int(cookie["max-age"]) == 7 * 24 * 60 * 60

    def test_refresh_preserves_session_cookie_if_remember_false(self, test_user):
        client = APIClient()
        client.post(
            "/api/auth/login/",
            {"email": test_user.email, "password": "testpass123", "remember": False},
        )

        response = client.post("/api/auth/refresh/")
        assert response.status_code == 200
        cookie = response.cookies.get("kmsplit_refresh")
        assert cookie is not None
        assert not cookie.get("max-age")


class TestRememberMeProductionHardening:
    def test_login_no_crash_when_samesite_none_without_secure(self, test_user, settings):
        """Regresión: Django lanza ValueError con SameSite=None sin Secure.
        El login no debe convertirse en un 500 por eso nunca."""
        settings.COOKIE_SAMESITE = "None"
        settings.COOKIE_SECURE = False

        client = APIClient()
        response = client.post(
            "/api/auth/login/",
            {"email": test_user.email, "password": "testpass123"},
        )

        assert response.status_code == 200
        cookie = response.cookies.get("kmsplit_refresh")
        assert cookie is not None
        # con SameSite=None sin Secure se degrada a Lax en vez de reventar
        assert cookie["samesite"].lower() == "lax"

    def test_login_sets_secure_samesite_none_cookie_in_production(self, test_user, settings):
        """Config de producción típica: SameSite=None + Secure para cross-site
        (frontend en Vercel, backend en Railway) con credenciales cross-origin."""
        settings.COOKIE_SAMESITE = "None"
        settings.COOKIE_SECURE = True

        client = APIClient()
        response = client.post(
            "/api/auth/login/",
            {"email": test_user.email, "password": "testpass123", "remember": False},
        )

        assert response.status_code == 200
        cookie = response.cookies.get("kmsplit_refresh")
        assert cookie is not None
        assert cookie["samesite"].lower() == "none"
        assert cookie["secure"]