import base64
import json
import logging
import time

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.cache import cache
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import send_mail
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from google.auth.transport import requests
from google.oauth2 import id_token

from core.mail import send_brevo_email
from .models import PasswordReset, User
from .serializers import (
    ChangePasswordSerializer,
    GoogleLoginSerializer,
    ProfileUpdateSerializer,
    RegisterSerializer,
    UserSerializer,
)

MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_SECONDS = 15 * 60  # 15 minutos
REFRESH_COOKIE_NAME = "kmsplit_refresh"

logger = logging.getLogger(__name__)


def _set_refresh_cookie(response, refresh_token: str, remember: bool = True) -> None:
    """
    Guarda el refresh token en una cookie httpOnly.

    Con remember=True la cookie es persistente y dura REFRESH_TOKEN_LIFETIME
    (7 días) desde la última actividad -- al rotar en cada refresh, el reloj
    vuelve a partir de cero (sesión deslizante). Con remember=False la cookie
    es de sesión (sin Max-Age): dura hasta que el usuario cierra el navegador.
    """
    secure = settings.COOKIE_SECURE
    samesite = settings.COOKIE_SAMESITE
    # Django lanza ValueError si SameSite="None" sin Secure. Nunca dejamos que
    # eso rompa el login: si no hay Secure configurado, bajamos a Lax.
    if samesite == "None" and not secure:
        samesite = "Lax"
    response.set_cookie(
        REFRESH_COOKIE_NAME,
        refresh_token,
        max_age=(
            int(settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds())
            if remember
            else None
        ),
        httponly=True,
        secure=secure,
        samesite=samesite,
        path="/api/auth/",
    )


def _clear_refresh_cookie(response) -> None:
    response.delete_cookie(REFRESH_COOKIE_NAME, path="/api/auth/")


def _parse_remember(value) -> bool:
    """
    Normaliza el flag "remember" independientemente de cómo llegue:

      - JSON  : True / False  (bool)
      - query : "true" / "false" (str)
      - form  : ["False"] (lista, DRF decodifica así los campos repetidos)

    Si falta el campo, por defecto True (sesión persistente de 7 días).
    """
    if isinstance(value, list):
        value = value[0] if value else ""
    if isinstance(value, str):
        return value.strip().lower() not in ("", "0", "false", "no", "off")
    return bool(value)


class RegisterView(generics.CreateAPIView):
    """POST /api/auth/register/ — alta de usuario. No requiere estar logueado."""

    queryset = User.objects.all()
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "register"


class LockedLoginView(TokenObtainPairView):
    """
    POST /api/auth/login/ — devuelve el access token en el body como
    siempre, pero el refresh token ya NO viaja en el JSON: se manda como
    cookie httpOnly, invisible para JavaScript. También sigue teniendo el
    bloqueo de cuenta tras intentos fallidos que ya teníamos.
    """

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request, *args, **kwargs):
        email = (request.data.get("email") or "").strip().lower()
        attempts_key = f"login_attempts:{email}"
        lockout_key = f"login_lockout_until:{email}"

        if email:
            lockout_until = cache.get(lockout_key)
            if lockout_until:
                remaining = max(0, int(lockout_until - time.time()))
                if remaining > 0:
                    return Response(
                        {
                            "detail": "Demasiados intentos fallidos. Probá de nuevo más tarde.",
                            "retry_after_seconds": remaining,
                        },
                        status=status.HTTP_429_TOO_MANY_REQUESTS,
                    )
                cache.delete(lockout_key)
                cache.delete(attempts_key)

        try:
            response = super().post(request, *args, **kwargs)
        except Exception:
            if email:
                attempts = cache.get(attempts_key, 0) + 1
                cache.set(attempts_key, attempts, timeout=LOCKOUT_SECONDS)
                if attempts >= MAX_LOGIN_ATTEMPTS:
                    cache.set(lockout_key, time.time() + LOCKOUT_SECONDS, timeout=LOCKOUT_SECONDS)
            raise

        if email:
            cache.delete(attempts_key)
            cache.delete(lockout_key)

        # sacar el refresh del body: lo devolvemos al frontend (respaldo en
        # localStorage) Y lo seteamos como cookie httpOnly (mecanismo primario).
        refresh_token = response.data.get("refresh")
        if refresh_token:
            remember = _parse_remember(request.data.get("remember", True))
            # inyectamos el claim "remember" en el refresh token para que la
            # persistencia sobreviva a la rotación: cada refresh nuevo re-aplica
            # la misma cookie (7 días vs de sesión) que eligió el usuario.
            try:
                token = RefreshToken(refresh_token)
                token["kmsplit_remember"] = remember
                cookie_token = str(token)
            except Exception:
                cookie_token = refresh_token
            try:
                _set_refresh_cookie(response, cookie_token, remember=remember)
            except Exception:
                # nunca dejamos que un fallo al setear la cookie tumbe el login:
                # el access token igual se devuelve en el body.
                pass

        return response


class GoogleLoginView(APIView):
    """
    POST /api/auth/google/ — inicia sesión (o registra) con la cuenta de Google.

    Body: {"credential": "<id_token de Google Sign-In>", "remember": true}

    Flujo:
      1. Si GOOGLE_CLIENT_ID no está configurado en el servidor -> 503.
      2. Verifica criptográficamente el id_token (firma, audiencia, emisor).
      3. Busca la cuenta por email. Si no existe, la crea (con la foto de
         Google como avatar). Si existe, entra a esa MISMA cuenta y carga todo
         lo que ya tenía (viajes, grupos, vehículos).
      4. Sincroniza la foto de Google: solo sobrescribe avatar_url si el
         usuario no tiene foto propia (vacía) o si la actual todavía es la que
         vino de Google. Si la cambió dentro de la app, se respeta.
      5. Emite el mismo par access+refresh (y cookie httpOnly) del login.
    """

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        client_id = settings.GOOGLE_CLIENT_ID
        if not client_id:
            return Response(
                {"detail": "El login con Google no está habilitado en este servidor."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        serializer = GoogleLoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            info = id_token.verify_oauth2_token(
                serializer.validated_data["credential"],
                requests.Request(),
                client_id,
                clock_skew_in_seconds=settings.GOOGLE_CLOCK_SKEW_SECONDS,
            )
        except ValueError as exc:
            # La librería rechaza por varias razones: firma inválida, audiencia
            # distinta a nuestro client_id, token vencido, issuer inesperado o
            # reloj del servidor corrido ("Token used too early/late").
            # Loggeamos el motivo para poder diagnosticar (sin revelarlo al
            # usuario ni al frontend).
            logger.warning("Login con Google rechazado (client_id=%s): %s", client_id, exc)
            return Response(
                {"detail": "La credencial de Google no es válida."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Rechazamos cuentas con email sin verificar: evita hacerse pasar por
        # un email sin confirmar en Google.
        if not info.get("email_verified"):
            return Response(
                {"detail": "Verificá tu email en Google para poder iniciar sesión."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        email = (info.get("email") or "").strip().lower()
        if not email:
            return Response(
                {"detail": "La cuenta de Google no tiene email asociado."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        picture = (info.get("picture") or "").strip()
        # Solo URLs de imagen remotas. Nunca guardamos otra cosa en el avatar.
        if not picture.startswith(("http://", "https://")):
            picture = ""

        google_name = (info.get("name") or info.get("given_name") or email.split("@")[0]).strip()
        first_name = (info.get("given_name") or "").strip()
        last_name = (info.get("family_name") or "").strip()

        user = User.objects.filter(email__iexact=email).first()
        if user is None:
            # Cuenta nueva creada desde Google (sin password: la clave que genera
            # Django es inutilizable, el acceso es vía Google).
            user = User.objects.create_user(
                email=email,
                name=google_name or first_name or "Usuario",
                first_name=first_name,
                last_name=last_name,
                avatar_url=picture,
                google_picture=picture,
            )
        else:
            # Cuenta existente: se vincula por email y se actualizan los datos
            # de Google que falten, respetando lo que el usuario tocó en la app.
            fields = {}
            prev_picture = user.google_picture
            if picture and picture != prev_picture:
                fields["google_picture"] = picture
                # la foto mostrada solo se pisa si no hay una foto propia o si
                # la actual es todavía la foto que vino de Google
                if not user.avatar_url or user.avatar_url == prev_picture:
                    fields["avatar_url"] = picture
            if not user.name:
                fields["name"] = google_name or first_name or "Usuario"
            if not user.first_name:
                fields["first_name"] = first_name
            if not user.last_name:
                fields["last_name"] = last_name
            if fields:
                for key, value in fields.items():
                    setattr(user, key, value)
                user.save(update_fields=list(fields))

        remember = _parse_remember(request.data.get("remember", True))
        refresh = RefreshToken.for_user(user)
        refresh["kmsplit_remember"] = remember
        response = Response({
            "access": str(refresh.access_token),
            "refresh": str(refresh),
        })
        try:
            _set_refresh_cookie(response, str(refresh), remember=remember)
        except Exception:
            # nunca dejamos que un fallo al setear la cookie tumbe el login:
            # el access token igual se devuelve en el body.
            pass
        return response


class CookieTokenRefreshView(TokenRefreshView):
    """
    POST /api/auth/refresh/ — a diferencia del original de simplejwt, NO
    espera el refresh token en el body del request: lo lee de la cookie
    httpOnly. Como ROTATE_REFRESH_TOKENS está activado, cada refresh exitoso
    invalida el token viejo y pone uno nuevo en la cookie.
    """

    def post(self, request, *args, **kwargs):
        # Prioridad: cookie httpOnly (primario) → body (respaldo para iOS PWA
        # donde la cookie se limpia al relanzar la app desde el atajo).
        refresh_token = (
            request.COOKIES.get(REFRESH_COOKIE_NAME)
            or (request.data.get("refresh") or "").strip()
            or None
        )
        if not refresh_token:
            return Response({"detail": "No hay sesión activa."}, status=status.HTTP_401_UNAUTHORIZED)

        serializer = TokenRefreshSerializer(data={"refresh": refresh_token})
        try:
            serializer.is_valid(raise_exception=True)
        except Exception:
            response = Response(
                {"detail": "La sesión expiró. Volvé a iniciar sesión."},
                status=status.HTTP_401_UNAUTHORIZED,
            )
            _clear_refresh_cookie(response)
            return response

        data = serializer.validated_data
        new_refresh = data.get("refresh")  # presente porque ROTATE_REFRESH_TOKENS=True
        response = Response({
            "access": data["access"],
            # el refresh nuevo viaja en el body para que el frontend lo
            # guarde como respaldo (localStorage); la cookie sigue siendo el
            # mecanismo primario de sesión.
            "refresh": new_refresh or "",
        })

        if new_refresh:
            # preservamos la persistencia que el usuario eligió al iniciar
            # sesión (cookie de 7 días si marcó "recordarme", de sesión si no)
            remember = self._remember_from_token(refresh_token)
            try:
                token = RefreshToken(new_refresh)
                token["kmsplit_remember"] = remember
                cookie_token = str(token)
            except Exception:
                cookie_token = new_refresh
            _set_refresh_cookie(response, cookie_token, remember=remember)

        return response

    @staticmethod
    def _remember_from_token(refresh_token: str) -> bool:
        """Lee el claim "kmsplit_remember" del payload (sin validar firma/rotación)."""
        try:
            # JWT = header.payload.signature
            payload = refresh_token.split(".")[1]
            padded = payload + "=" * (-len(payload) % 4)
            claims = json.loads(base64.urlsafe_b64decode(padded))
            return bool(claims.get("kmsplit_remember", True))
        except Exception:
            # sin claim (tokens emitidos antes de esta feature): asumimos 7 días
            return True


class LogoutView(APIView):
    """
    POST /api/auth/logout/ — invalida el refresh token actual (blacklist) y
    borra la cookie. Se permite sin estar autenticado con JWT porque, en
    este punto, lo único que nos importa es la cookie -- si no hay sesión
    real, simplemente no hay nada que invalidar.
    """

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        # Cookie (primario) o body (respaldo para iOS PWA sin cookie).
        refresh_token = (
            request.COOKIES.get(REFRESH_COOKIE_NAME)
            or (request.data.get("refresh") or "").strip()
            or None
        )
        if refresh_token:
            try:
                RefreshToken(refresh_token).blacklist()
            except TokenError:
                pass  # ya estaba vencido o ya en blacklist, no importa

        response = Response({"detail": "Sesión cerrada."})
        _clear_refresh_cookie(response)
        return response


class MeView(APIView):
    """GET/PUT /api/auth/me/ — perfil del usuario logueado (según el token).
    GET lo devuelve; PUT edita apodo (name), nombre, apellido y foto de perfil
    (avatar_url). El email es de solo lectura."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user).data)

    def put(self, request):
        serializer = ProfileUpdateSerializer(
            request.user,
            data=request.data,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(UserSerializer(request.user).data)


class ChangePasswordView(APIView):
    """POST /api/auth/change-password/ — cambia la contraseña del usuario
    logueado. Requiere la contraseña actual y valida la nueva."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordSerializer(
            data=request.data,
            context={"user": request.user},
        )
        serializer.is_valid(raise_exception=True)
        request.user.set_password(serializer.validated_data["new_password"])
        request.user.save(update_fields=["password"])
        return Response({"detail": "Contraseña actualizada."})


class UserDetailView(APIView):
    """GET /api/auth/users/{id}/ — datos públicos de un usuario (nombre, email)."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        try:
            user = User.objects.get(pk=pk)
        except User.DoesNotExist:
            return Response({"detail": "Usuario no encontrado."}, status=status.HTTP_404_NOT_FOUND)
        return Response(UserSerializer(user).data)


def _get_latest_valid_reset(email):
    """Devuelve el PasswordReset vigente del usuario (si existe), o None."""
    try:
        user = User.objects.get(email__iexact=email)
    except User.DoesNotExist:
        return None
    try:
        latest = user.password_resets.filter(is_used=False).latest("created_at")
    except PasswordReset.DoesNotExist:
        return None
    if latest.is_expired:
        return None
    return latest


def _attempts_key(email):
    return f"password_reset_attempts:{email.strip().lower()}"


class PasswordResetRequestView(APIView):
    """
    POST /api/auth/password-reset/request/  body: {"email": "..."}
    Genera un código de 6 dígitos, lo guarda y lo envía por email.

    Devuelve siempre 200 aunque el email no exista (para no revelar qué
    cuentas están registradas). El reset se limita por throttle.
    """

    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "register"  # reutilizamos una tasa por email/h

    def post(self, request):
        email = (request.data.get("email") or "").strip().lower()

        try:
            user = User.objects.get(email__iexact=email)
        except User.DoesNotExist:
            # mimo: mismo mensaje de éxito, pero no se envía nada
            return Response({"detail": "Si el email existe, te enviamos un código."})

        # invalidar códigos anteriores sin usar del mismo usuario
        user.password_resets.filter(is_used=False).update(is_used=True, used_at=timezone.now())
        cache.delete(_attempts_key(email))

        reset = PasswordReset.objects.create(
            user=user,
            code=PasswordReset.generate_code(),
            expires_at=timezone.now()
            + timezone.timedelta(minutes=settings.PASSWORD_RESET_CODE_TTL_MINUTES),
        )

        try:
            subject = "KmSplit: tu código para recuperar la contraseña"
            body = (
                f"Hola {user.name}!\n\n"
                f"Tu código de recuperación es: {reset.code}\n\n"
                f"Tiene una validez de {settings.PASSWORD_RESET_CODE_TTL_MINUTES} minutos.\n\n"
                "Si no pediste recuperar tu contraseña, ignorá este mail."
            )
            if settings.BREVO_API_KEY:
                # Viaja por HTTPS (443) — el SMTP saliente suele estar
                # bloqueado en la red de Railway.
                send_brevo_email(
                    subject=subject,
                    body=body,
                    to_email=user.email,
                    from_email=settings.DEFAULT_FROM_EMAIL,
                    from_name=settings.DEFAULT_FROM_NAME,
                )
            else:
                send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [user.email])
        except Exception:
            # Un fallo del proveedor de email (credenciales, TLS, red...)
            # NO debe tumbar el endpoint ni revelar al usuario que la cuenta existe.
            # El error real queda en los logs del backend para poder diagnosticarlo.
            logger.exception(
                "No se pudo enviar el código de reset a %s (EMAIL_HOST=%s)",
                user.email,
                settings.EMAIL_HOST,
            )

        return Response({"detail": "Si el email existe, te enviamos un código."})


class PasswordResetVerifyView(APIView):
    """
    POST /api/auth/password-reset/verify/  body: {"email": "...", "code": "123456"}
    Valida que el código sea correcto, esté vigente y no se hayan agotado
    los intentos. Devuelve ok o un mensaje de error.
    """

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        email = (request.data.get("email") or "").strip().lower()
        code = (request.data.get("code") or "").strip()

        attempts = cache.get(_attempts_key(email), 0)
        if attempts >= settings.PASSWORD_RESET_MAX_ATTEMPTS:
            return Response(
                {"detail": "Demasiados intentos. Pedí un nuevo código."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        reset = _get_latest_valid_reset(email)
        if reset is None or reset.code != code:
            cache.set(_attempts_key(email), attempts + 1, timeout=settings.PASSWORD_RESET_CODE_TTL_MINUTES * 60)
            return Response(
                {"detail": "Código incorrecto o vencido."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        cache.delete(_attempts_key(email))
        return Response({"valid": True})


class PasswordResetConfirmView(APIView):
    """
    POST /api/auth/password-reset/confirm/  body:
    {"email": "...", "code": "123456", "new_password": "...", "confirm_password": "..."}
    Revisa el código una vez más y, si es válido, setea la nueva contraseña
    y consume el código (no se puede reutilizar).
    """

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        email = (request.data.get("email") or "").strip().lower()
        code = (request.data.get("code") or "").strip()
        new_password = request.data.get("new_password")
        confirm_password = request.data.get("confirm_password")

        reset = _get_latest_valid_reset(email)
        if reset is None or reset.code != code:
            return Response(
                {"detail": "Código incorrecto o vencido. Pedí uno nuevo."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not new_password or not confirm_password:
            return Response(
                {"detail": "Completá la nueva contraseña y su confirmación."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if new_password != confirm_password:
            return Response(
                {"detail": "Las contraseñas no coinciden."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            validate_password(new_password, user=reset.user)
        except DjangoValidationError as exc:
            return Response(
                {"detail": " ".join(exc.messages)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        reset.user.set_password(new_password)
        reset.user.save()

        reset.is_used = True
        reset.used_at = timezone.now()
        reset.save(update_fields=["is_used", "used_at"])

        # invalidar códigos residuales del mismo usuario
        reset.user.password_resets.filter(is_used=False).update(is_used=True, used_at=timezone.now())
        cache.delete(_attempts_key(email))

        return Response({"detail": "Contraseña actualizada. Ya podés iniciar sesión."})
