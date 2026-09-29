"""Plantillas de los emails de KmSplit.

Los clientes de correo (Gmail, Outlook, Apple Mail) ignoran las hojas de
estilo externas y las clases CSS, así que la maqueta va con <table> y todo el
estilo inline. Cada plantilla devuelve la terna (asunto, texto plano, HTML):
el texto plano es el que se ve si el cliente decide no mostrar el HTML, y el
HTML es el que llega maquetado.

La paleta es la misma que la de la app (frontend/src/styles.scss).
"""

from django.conf import settings
from django.utils.html import escape

BLUE = "#2f6fed"
BLUE_DARK = "#1c3d63"
BLUE_LIGHT = "#e3ecfd"
GRAY_900 = "#1f2933"
GRAY_700 = "#52606d"
GRAY_500 = "#8a97a6"
GRAY_100 = "#f0f2f5"
WHITE = "#ffffff"
AMBER = "#e0a344"

# Un solo saludo: "Mariano Casarino" -> "Mariano".


def _first_name(name: str) -> str:
    return (name or "").strip().split(" ")[0]


def _app_url(path: str = "") -> str:
    base = (getattr(settings, "FRONTEND_URL", "") or "").rstrip("/")
    return f"{base}{path}"


def _paragraph(text: str) -> str:
    return (
        f'<p style="margin:0 0 16px 0;font-size:16px;line-height:24px;color:{GRAY_700};">'
        f"{text}</p>"
    )


def _heading(text: str) -> str:
    return (
        f'<h1 style="margin:0 0 20px 0;font-size:24px;line-height:30px;'
        f'font-weight:700;color:{BLUE_DARK};">{text}</h1>'
    )


def _button(label: str, url: str) -> str:
    """Botón con fallback VML: Outlook (que no soporta padding en <a>) usa el
    <v:roundrect>, el resto de clientes ven el <a> con fondo."""
    return f"""
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px 0;">
        <tr>
          <td align="center" bgcolor="{BLUE}" style="border-radius:12px;">
            <!--[if mso]>
            <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml"
                         style="height:48px;width:260px;v-text-anchor:middle;"
                         arcsize="24%" fillcolor="{BLUE}" stroke="f">
              <w:anchorlock/>
              <center style="color:{WHITE};font-family:Segoe UI,Roboto,Arial,sans-serif;font-size:16px;font-weight:600;">
                {label}
              </center>
            </v:roundrect>
            <![endif]-->
            <!--[if !mso]><!-- -->
            <a href="{escape(url)}"
               style="display:inline-block;padding:14px 32px;font-size:16px;
                      font-weight:600;line-height:20px;color:{WHITE};
                      text-decoration:none;border-radius:12px;background:{BLUE};">
              {label}
            </a>
            <!--<![endif]-->
          </td>
        </tr>
      </table>
    """


def _fallback_link(url: str) -> str:
    """Some clients strip the button: the raw URL always works."""
    return (
        f'<p style="margin:0 0 16px 0;font-size:13px;line-height:20px;color:{GRAY_500};">'
        f"Si el botón no funciona, copiá esta dirección:<br>"
        f'<a href="{escape(url)}" style="color:{BLUE};word-break:break-all;">{escape(url)}</a>'
        f"</p>"
    )


def _note(text: str) -> str:
    """Caja de aclaración (por ejemplo: "si no fuiste vos, ignorá este mail")."""
    return f"""
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="margin:0 0 20px 0;background:{GRAY_100};border-radius:12px;">
        <tr>
          <td style="padding:14px 18px;font-size:14px;line-height:20px;color:{GRAY_700};">
            {text}
          </td>
        </tr>
      </table>
    """


def _steps(items) -> str:
    rows = "".join(
        f"""
          <tr>
            <td valign="top" width="28" style="padding:0 0 16px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" width="22" height="22" bgcolor="{BLUE_LIGHT}"
                      style="border-radius:11px;font-size:13px;font-weight:700;color:{BLUE};">
                    {i}
                  </td>
                </tr>
              </table>
            </td>
            <td valign="top" style="padding:1px 0 16px 0;font-size:16px;line-height:24px;color:{GRAY_700};">
              {item}
            </td>
          </tr>
        """
        for i, item in enumerate(items, start=1)
    )
    return f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0">{rows}</table>'


def _code_box(code: str) -> str:
    return f"""
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="margin:0 0 20px 0;background:{BLUE_LIGHT};border-radius:12px;">
        <tr>
          <td align="center" style="padding:24px 16px;">
            <span style="font-size:38px;font-weight:700;letter-spacing:10px;
                         line-height:42px;color:{BLUE_DARK};
                         font-family:'Courier New',Courier,monospace;">{escape(code)}</span>
          </td>
        </tr>
      </table>
    """


def _layout(*, preheader: str, title: str, body: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{escape(title)}</title>
</head>
<body style="margin:0;padding:0;background:{GRAY_100};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">{escape(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="background:{GRAY_100};padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0"
               style="width:100%;max-width:600px;background:{WHITE};border-radius:14px;
                      font-family:'Segoe UI',Roboto,Arial,sans-serif;">

          <tr>
            <td style="padding:28px 32px 12px 32px;">
              <span style="font-size:26px;font-weight:700;color:{BLUE};">Km</span><span
                style="font-size:26px;font-weight:700;color:{BLUE_DARK};">Split</span>
              <p style="margin:6px 0 0 0;font-size:13px;line-height:18px;color:{GRAY_500};">
                Repartí el combustible, no las discusiones
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:12px 32px 32px 32px;">
              {_heading(title)}
              {body}
            </td>
          </tr>

          <tr>
            <td style="padding:20px 32px;background:{GRAY_100};border-radius:0 0 14px 14px;">
              <p style="margin:0 0 6px 0;font-size:12px;line-height:18px;color:{GRAY_500};">
                KmSplit · Córdoba, Argentina
              </p>
              <p style="margin:0;font-size:12px;line-height:18px;color:{GRAY_500};">
                Este mail se envió porque hay una cuenta con esta dirección en KmSplit.
                No es un newsletter: solo te escribimos por tu cuenta.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def password_reset_email(*, name: str, code: str, ttl_minutes: int):
    """Mail con el código de 6 dígitos para recuperar la contraseña."""
    first = escape(_first_name(name)) or "hola"
    url = _app_url("/recuperar-contrasena")

    subject = f"{code} es tu código para recuperar la contraseña"
    text = (
        f"Hola {first}!\n\n"
        f"Tu código de recuperación es: {code}\n\n"
        f"Vence en {ttl_minutes} minutos. Ingresalo en {url}\n\n"
        "Si no pediste recuperar tu contraseña, ignorá este mail: "
        "no pasa nada y el código no sirve para nada."
    )
    body = (
        _paragraph(f"Hola <strong>{first}</strong>,")
        + _paragraph(
            "Recibimos un pedido para recuperar la contraseña de tu cuenta. "
            "Copiá este código y pegalo en la app:"
        )
        + _code_box(code)
        + _paragraph(
            f"El código vence en <strong>{ttl_minutes} minutos</strong>. "
            "Si no lo usás, simplemente se invalida."
        )
        + _button("Recuperar mi contraseña", url)
        + _fallback_link(url)
        + _note(
            "¿No fuiste vos? Tranqui, ignorá este mail. "
            "Nunca te vamos a pedir el código por teléfono ni por chat."
        )
    )
    html = _layout(
        preheader=f"Tu código es {code} y vence en {ttl_minutes} minutos.",
        title="Recuperá tu contraseña",
        body=body,
    )
    return subject, text, html


def welcome_email(*, name: str):
    """Mail de bienvenida para una cuenta nueva (registro o alta con Google)."""
    first = escape(_first_name(name)) or "hola"
    cta_url = _app_url("/grupos/nuevo")
    app_url = _app_url()

    subject = "Bienvenido a KmSplit 🎉"
    text = (
        f"¡Hola {first}! Gracias por usar KmSplit.\n\n"
        "Esto es lo que podés hacer:\n\n"
        "1. Creá tu grupo e invitá a las personas que comparten el auto.\n"
        "2. Cargá los viajes de cada uno (km inicial y final) y las cargas de\n"
        "   combustible (fecha, odómetro y cuánto se puso).\n"
        "3. Mirá la liquidación: KmSplit reparte el gasto en proporción a los km\n"
        "   que maneja cada uno, en vez de dividirlo a partes iguales.\n\n"
        f"Para empezar: {cta_url}\n\n"
        "Y dos cosas más: la campana te avisa cuando alguien del grupo registra\n"
        "algo, y podés agregar la app a la pantalla de inicio de tu celular para\n"
        "abrirla como si fuera nativa.\n\n"
        "¡Gracias por probar KmSplit! Cualquier duda, escribinos."
    )
    body = (
        _paragraph(f"¡Hola <strong>{first}</strong>! Gracias por usar <strong>KmSplit</strong> 🙌")
        + _paragraph(
            "Acá nadie carga la nafta a ciegas: KmSplit reparte el gasto de "
            "combustible en proporción a los kilómetros que maneja cada uno."
        )
        + _heading("Para empezar")
        + _steps(
            [
                "Creá tu grupo e <strong>invitá</strong> a las personas que comparten el auto.",
                "Cargá los <strong>viajes</strong> de cada uno (km inicial y final) y las "
                "<strong>cargas de combustible</strong> (fecha, odómetro y cuánto se puso).",
                "Mirá la <strong>liquidación</strong>: el gasto se reparte solo, "
                "proporcional a los km de cada uno.",
            ]
        )
        + _button("Crear mi grupo", cta_url)
        + _fallback_link(cta_url)
        + _note(
            "<strong>Dos Tips:</strong> la <strong>campana</strong> te avisa cuando alguien "
            "del grupo registra un viaje o una carga, y podés <strong>agregar la app a la "
            "pantalla de inicio</strong> de tu celular para abrirla como si fuera nativa."
        )
        + _paragraph(
            'Si algo no cierra o se te ocurre una idea, contanos: '
            f'<a href="{escape(app_url)}" style="color:{BLUE};">KmSplit</a>.'
        )
    )
    html = _layout(
        preheader="Repartí el combustible, no las discusiones: así se usa KmSplit.",
        title="¡Gracias por usar KmSplit!",
        body=body,
    )
    return subject, text, html
