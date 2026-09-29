# Guía de desarrollo

Cómo levantar el proyecto, correr los tests y entender la estructura.
Para el contexto del producto mirá el [README](README.md); para el historial de
versiones, el [CHANGELOG](CHANGELOG.md).

## Requisitos

- Docker Desktop con WSL2 (Windows) o Docker Engine (Linux/macOS)
- Node.js 20+ y npm 10+ (solo para el frontend si no usás Docker)
- Python 3.12 (solo para el backend si no usás Docker)

## Levantar todo

```bash
docker compose up --build
```

| Servicio | URL |
| --- | --- |
| Frontend | http://localhost:4200 |
| Backend (API) | http://localhost:8000 |
| PostgreSQL | `localhost:5432` |
| Redis | `localhost:6379` |

La base y el `.env` se crean solos la primera vez. Si cambiaste credenciales
después de haber levantado el proyecto, hay que borrar el volumen:

```bash
docker compose down -v
docker compose up --build
```

## Configuración

El backend lee la configuración de `backend/.env` (copiá `backend/.env.example`).
Las variables que importan:

| Variable | Para qué |
| --- | --- |
| `SECRET_KEY` | firma de los JWT. Cambiarla reinicia todas las sesiones |
| `POSTGRES_*` | conexión a la base |
| `REDIS_URL` | cache del dashboard y throttle |
| `CORS_ALLOWED_ORIGINS` | orígenes permitidos, separados por coma |
| `RAILWAY_DEPLOYMENT_ID` | ata la firma de los JWT al deploy, para que un deploy invalide las sesiones |

## Migraciones

Las migraciones se aplican solas en cada deploy (el `CMD` del `Dockerfile` corre
`migrate` antes de gunicorn). Para desarrollo:

```bash
docker compose exec backend python manage.py makemigrations
docker compose exec backend python manage.py migrate
```

## Tests

Los dos lados se corren **a mano antes de mergear a `main`**: no hay CI.

```bash
# Backend: 148 tests
docker compose exec backend python -m pytest -q

# Frontend: 85 tests
cd frontend && npm test
```

Para correr un solo archivo o un caso:

```bash
docker compose exec backend python -m pytest -q core/tests/test_dashboard_cache.py
docker compose exec backend python -m pytest -q core/tests/test_api_permissions.py -k fuel_load
```

## Frontend sin Docker

```bash
cd frontend
npm install
npx ng serve        # http://localhost:4200
npx ng build        # build de producción
npm test            # ng test --watch=false
```

## Estructura

```text
KmSplit/
├── backend/
│   ├── accounts/          # User custom, recuperación de contraseña
│   ├── core/              # grupos, vehículos, viajes, cargas, liquidaciones, avisos
│   │   ├── models.py      # dominio
│   │   ├── serializers.py # validaciones (odómetro nunca en retroceso)
│   │   ├── services.py    # recálculo de liquidaciones, cache, avisos
│   │   ├── views.py       # API + permisos por rol
│   │   ├── tests/         # pytest
│   │   └── migrations/    # historial del esquema
│   ├── config/            # settings, urls, wsgi
│   └── Dockerfile
├── frontend/
│   └── src/app/
│       ├── core/          # modelos, servicios, guards, interceptor, utils
│       ├── features/      # una carpeta por pantalla
│       ├── shared/        # componentes reutilizables (avatar, campana, diálogos)
│       └── styles.scss    # paleta en variables CSS y estilos globales
├── docs/schema.dbml       # esquema relacional (espejo de los models)
├── docker-compose.yml
├── CHANGELOG.md
└── README.md
```

## Deploy

- `develop` → trabajo. `main` → producción: **cada push a `main` dispara el
  deploy** (frontend en Vercel, backend en Railway, ambos por integración con
  GitHub).
- Las migraciones se aplican solas al arrancar el backend.
- No hay pipeline de tests: corré las dos suites antes de mergear.

```bash
git checkout develop && git pull
# ... trabajo y commits ...
git checkout main && git merge develop
git push origin main
```

## Convenciones

- Todo el texto de la interfaz en español Argentina.
- Mobile-first: la app se diseña para el celular y en desktop se muestra
  centrada, en una columna. Para desktop, el punto de corte es `768px` en
  `styles.scss`.
- Los estilos son SCSS con variables CSS globales; no hay framework de CSS.
- Los permisos se resuelven por rol del grupo: `owner` > `admin` > `member`.
- Cada cambio de negocio suma su test: la lógica de reparto es la que sostiene
  la app.
