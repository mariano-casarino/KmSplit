from pathlib import Path
import json

from decouple import config
from datetime import timedelta

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = config('SECRET_KEY')

DEBUG = config('DEBUG', default=False, cast=bool)

AUTH_USER_MODEL = "accounts.User"

ADMIN_URL = config('ADMIN_URL', default='admin/')

# Application definition

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'corsheaders',
    'accounts',
    'core.apps.CoreConfig',
    'rest_framework_simplejwt.token_blacklist',
]

MIDDLEWARE = [
    'django.middleware.gzip.GZipMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'csp.middleware.CSPMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware', 
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'


# Database
# https://docs.djangoproject.com/en/5.2/ref/settings/#databases

from decouple import config

import dj_database_url

DATABASES = {
    'default': dj_database_url.config(
        default=config('DATABASE_URL'),
        conn_max_age=600,
    )
}

# Cache
# Con REDIS_URL seteada (producción / Railway) usa Redis: memoria compartida
# entre todos los workers de gunicorn, así el bloqueo de login, el throttling
# de DRF y los códigos de reset son GLOBALES (un atacante no puede rotar entre
# workers). Sin REDIS_URL (desarrollo local) cae a la cache en RAM del proceso,
# que para un solo worker de runserver alcanza.
REDIS_URL = config('REDIS_URL', default='')

if REDIS_URL:
    CACHES = {
        'default': {
            'BACKEND': 'django.core.cache.backends.redis.RedisCache',
            'LOCATION': REDIS_URL,
            'TIMEOUT': 300,
        }
    }
else:
    CACHES = {
        'default': {
            'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
            'TIMEOUT': 300,
        }
    }

# Password validation
# https://docs.djangoproject.com/en/5.2/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]


# Internationalization
# https://docs.djangoproject.com/en/5.2/topics/i18n/

LANGUAGE_CODE = 'es'

TIME_ZONE = 'America/Argentina/Cordoba'

USE_I18N = True

USE_TZ = True


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/5.2/howto/static-files/

STATIC_URL = 'static/'

STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'

_csrf_trusted = config('CSRF_TRUSTED_ORIGINS', default='')
CSRF_TRUSTED_ORIGINS = _csrf_trusted.split(',') if _csrf_trusted else []

# Default primary key field type
# https://docs.djangoproject.com/en/5.2/ref/settings/#default-auto-field

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

CORS_ALLOWED_ORIGINS = config('CORS_ALLOWED_ORIGINS').split (',')
ENVIRONMENT = config('ENVIRONMENT', default='development')

ALLOWED_HOSTS = config('ALLOWED_HOSTS').split(',')
# En producción el frontend proxyea /api desde Vercel (mismo origen). El
# navegador habla con kmsplit.vercel.app y Vercel reenvía a Railway con el
# Host de Vercel, así que ese dominio tiene que estar siempre permitido.
VERCEL_HOST = 'kmsplit.vercel.app'
if VERCEL_HOST not in ALLOWED_HOSTS:
    ALLOWED_HOSTS.append(VERCEL_HOST)
COOKIE_SECURE = config('COOKIE_SECURE', default=(ENVIRONMENT == 'production'), cast=bool)
CORS_ALLOW_CREDENTIALS = True
# En producción Vercel proxyea /api al mismo origen (kmsplit.vercel.app), así
# que las requests son same-site y Lax es suficiente.  None cause problemas
# con Safari mobile (ITP las rechaza o limita a 24 h).
COOKIE_SAMESITE = config(
    'COOKIE_SAMESITE',
    default='Lax',
)

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    # Sin throttle global: cada request pagaba 2 operaciones a Redis (anon +
    # user). Solo se throttlea login/register (rate limit anti-brute-force),
    # que se declaran como ScopedRateThrottle en esas vistas.
    "DEFAULT_THROTTLE_RATES": {
        "login": "15/minute",
        "register": "3/hour",
    },
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=2),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    # Firma atada al deploy: Railway inyecta RAILWAY_DEPLOYMENT_ID, único por
    # cada deploy. Al cambiar la firma, todo JWT emitido antes queda inválido
    # y TODOS los usuarios deben volver a ingresar tras cada deploy (evita las
    # sesiones "zombie" que quedan con datos/dashboard cacheados viejos).
    # En desarrollo (sin esa variable) la firma es estable y la sesión sobrevive.
    "SIGNING_KEY": f"{config('SECRET_KEY')}:{config('RAILWAY_DEPLOYMENT_ID', default='local')}",
}

# ============================================================
# Login con Google
# GOOGLE_CLIENT_ID: identificador de la "Web application" OAuth creada en
# https://console.cloud.google.com/apis/credentials. Vacío = botón oculto y
# endpoint deshabilitado (comportamiento por default en desarrollo).
# ============================================================
GOOGLE_CLIENT_ID = config("GOOGLE_CLIENT_ID", default="")
# Tolerancia de reloj (segundos) al verificar el id_token de Google. El token
# nace con "nbf" = hora real y la librería solo aguanta 5s por defecto; los
# contenedores de Docker suelen tener el reloj corrido unos segundos y eso
# rompía el login ("Token used too early"). 60s no abre ninguna ventana de
# abuso aprovechable (el token expira en 1 h).
GOOGLE_CLOCK_SKEW_SECONDS = config("GOOGLE_CLOCK_SKEW_SECONDS", default=60, cast=int)


# Correo (recuperación de contraseña)
# En desarrollo (sin EMAIL_HOST_USER) se usa el backend de consola, que
# imprime el mail en los logs del backend — así funciona sin un SMTP real.
EMAIL_BACKEND = "core.mail.SmtpEmailBackend"
DEFAULT_FROM_EMAIL = config("DEFAULT_FROM_EMAIL", default="noreply@kmsplit.app")
DEFAULT_FROM_NAME = config("DEFAULT_FROM_NAME", default="KmSplit")
EMAIL_HOST = config("EMAIL_HOST", default="")
EMAIL_PORT = config("EMAIL_PORT", default=587, cast=int)
EMAIL_HOST_USER = config("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = config("EMAIL_HOST_PASSWORD", default="")
EMAIL_USE_TLS = config("EMAIL_USE_TLS", default=True, cast=bool)
EMAIL_USE_SSL = config("EMAIL_USE_SSL", default=False, cast=bool)
# Timeout (segundos) para la conexión SMTP. Evita que un servidor de correo
# inalcanzable cuelgue el worker de Gunicorn hasta su timeout de 30s.
EMAIL_TIMEOUT = config("EMAIL_TIMEOUT", default=10, cast=int)
# Camino recomendado para producción: el SMTP saliente (587/465) suele estar
# bloqueado en Railway; la API REST de Brevo viaja por HTTPS (443) y funciona.
BREVO_API_KEY = config("BREVO_API_KEY", default="")

if not EMAIL_HOST_USER:
    # sin credenciales configuradas, imprimir en consola (útil en dev)
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"

# Duración del código de recuperación, en minutos
PASSWORD_RESET_CODE_TTL_MINUTES = config("PASSWORD_RESET_CODE_TTL_MINUTES", default=15, cast=int)
# Intentos máximos de verificación de código antes de invalidarlo
PASSWORD_RESET_MAX_ATTEMPTS = config("PASSWORD_RESET_MAX_ATTEMPTS", default=5, cast=int)

CSP_DEFAULT_SRC = ("'self'",)
CSP_SCRIPT_SRC = ("'self'",)
CSP_STYLE_SRC = ("'self'", "'unsafe-inline'")  # la API navegable de DRF usa algo de CSS inline
CSP_IMG_SRC = ("'self'", "data:")
CSP_FONT_SRC = ("'self'",)

if ENVIRONMENT == 'production':
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

# ============================================================
# Backup automático a Google Sheets (Apps Script webhook)
# SHEETS_USER_MAP: JSON que mapea la cuenta al nombre de la hoja:
#   {"<email>": "Nombre en la hoja"}  (también acepta el id o el nombre)
#   Ej: {"mariano@gmail.com": "Marian", "juan@x.com": "juan"}
# ============================================================
SHEETS_SYNC_ENABLED = config("SHEETS_SYNC_ENABLED", default=False, cast=bool)
SHEETS_WEBHOOK_URL = config("SHEETS_WEBHOOK_URL", default="")
SHEETS_WEBHOOK_SECRET = config("SHEETS_WEBHOOK_SECRET", default="")
SHEETS_USER_MAP = config("SHEETS_USER_MAP", default="{}", cast=lambda v: json.loads(v))
# Solo se sincroniza este grupo (por nombre exacto). Vacío = todos.
SHEETS_GROUP_NAME = config("SHEETS_GROUP_NAME", default="")