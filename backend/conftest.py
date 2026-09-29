import pytest


@pytest.fixture(autouse=True)
def _disable_https_redirects(settings):
    """Desactiva el redirect HTTPS y las cookies-secure durante los tests.

    El .env local suele poner ENVIRONMENT=production (para probar las
    cookies httpOnly/secure en desarrollo), lo que activa
    SECURE_SSL_REDIRECT=True. En ese modo, toda petición http que hace el
    APIClient responde 301 (redirect a https) y rompe todos los tests que
    golpean la API. Los tests corren sobre http://testserver, así que hay
    que volver a apagar estos ajustes de seguridad.
    """
    settings.SECURE_SSL_REDIRECT = False
    settings.SESSION_COOKIE_SECURE = False
    settings.CSRF_COOKIE_SECURE = False
    settings.COOKIE_SECURE = False


@pytest.fixture(autouse=True)
def _emails_a_memoria(settings):
    """Ningún test manda emails reales.

    El .env local trae BREVO_API_KEY y credenciales de Gmail reales, así que sin
    esto cualquier test que registre un usuario o pida un código de recuperación
    se iba a la red de verdad. Todo se acumula en `mail.outbox`.
    """
    settings.BREVO_API_KEY = ""
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"