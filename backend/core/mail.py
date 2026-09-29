import json
import logging
import socket
import urllib.error
import urllib.request

from django.conf import settings
from django.core.mail import send_mail
from django.core.mail.backends.smtp import EmailBackend as BaseSMTPEmailBackend

logger = logging.getLogger(__name__)

BREVO_API_URL = "https://api.brevo.com/v3/smtp/email"


class SmtpEmailBackend(BaseSMTPEmailBackend):
    """Backend SMTP que fuerza conexiones IPv4.

    En entornos como Railway, `smtp.gmail.com` resuelve también a IPv6 (AAAA)
    pero la red del contenedor no rutea IPv6: `sock.connect()` falla con
    [Errno 101] Network is unreachable. Al forzar AF_INET usamos la ruta IPv4,
    que sí existe.
    """

    def open(self):
        original_getaddrinfo = socket.getaddrinfo

        def ipv4_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
            return original_getaddrinfo(host, port, socket.AF_INET, type, proto, flags)

        socket.getaddrinfo = ipv4_getaddrinfo
        try:
            return super().open()
        finally:
            socket.getaddrinfo = original_getaddrinfo


def send_brevo_email(*, subject, body, to_email, from_email, from_name, html_body=None):
    """Envía un mail usando la API REST de Brevo (HTTPS/443).

    Es el camino recomendado para producción: el SMTP saliente suele estar
    bloqueado en redes de los proveedores (Railway), mientras que HTTPS hacia
    api.brevo.com sale sin problemas.

    `body` es el texto plano (el que se ve en clientes sin HTML) y `html_body`
    la versión maquetada. Si no se pasa HTML, el mail sale solo en texto.
    """
    api_key = getattr(settings, "BREVO_API_KEY", "")
    if not api_key:
        raise RuntimeError("BREVO_API_KEY no está configurada")

    message = {
        "sender": {"email": from_email, "name": from_name},
        "to": [{"email": to_email}],
        "subject": subject,
        "textContent": body,
    }
    if html_body:
        message["htmlContent"] = html_body

    payload = json.dumps(message).encode("utf-8")

    request = urllib.request.Request(
        BREVO_API_URL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "accept": "application/json",
            "api-key": api_key,
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        logger.error("Brevo API respondió %s: %s", exc.code, detail)
        raise


def send_app_email(*, subject, body, to_email, html_body=None):
    """Envía un email de la app por el transporte que haya disponible.

    Con BREVO_API_KEY va por la API HTTPS (producción); sin ella, por el backend
    de Django configurado en settings (consola en desarrollo).

    Nunca levanta: un fallo del proveedor de email no puede tumbar un endpoint
    ni un registro de usuario. El error real queda en los logs del backend.
    """
    if getattr(settings, "BREVO_API_KEY", ""):
        try:
            send_brevo_email(
                subject=subject,
                body=body,
                html_body=html_body,
                to_email=to_email,
                from_email=settings.DEFAULT_FROM_EMAIL,
                from_name=settings.DEFAULT_FROM_NAME,
            )
        except Exception:
            logger.exception("No se pudo enviar por Brevo el mail '%s' a %s", subject, to_email)
        return

    try:
        send_mail(
            subject,
            body,
            settings.DEFAULT_FROM_EMAIL,
            [to_email],
            html_message=html_body,
            fail_silently=True,
        )
    except Exception:
        logger.exception("No se pudo enviar el mail '%s' a %s", subject, to_email)


def send_templated_email(template, *, to_email, **context):
    """Arma una plantilla de core.emails y la envía.

    `template` es una función que recibe **context y devuelve
    (subject, texto plano, html), por ejemplo `welcome_email`.
    """
    subject, body, html_body = template(**context)
    send_app_email(
        subject=subject,
        body=body,
        html_body=html_body,
        to_email=to_email,
    )