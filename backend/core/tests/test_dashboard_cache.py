import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from core import services

pytestmark = pytest.mark.django_db


def auth_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def test_dashboard_caches_payload_after_first_request(family, vehicle):
    client = auth_client(family["owner"])
    first = client.get(f"/api/vehicles/{vehicle.id}/dashboard/")
    assert first.status_code == 200

    key = services.dashboard_cache_key(vehicle.id)
    assert cache.get(key) is not None


def test_dashboard_invalidate_on_trip_create(family, vehicle):
    client = auth_client(family["owner"])
    client.get(f"/api/vehicles/{vehicle.id}/dashboard/")
    key = services.dashboard_cache_key(vehicle.id)
    assert cache.get(key) is not None

    client.post(
        f"/api/trips/",
        {
            "vehicle": vehicle.id,
            "trip_date": "2026-09-01",
            "start_km": 100,
            "end_km": 200,
        },
        format="json",
    )
    assert cache.get(key) is None


def test_dashboard_invalidate_on_fuel_load_create(family, vehicle):
    client = auth_client(family["owner"])
    client.get(f"/api/vehicles/{vehicle.id}/dashboard/")
    key = services.dashboard_cache_key(vehicle.id)
    assert cache.get(key) is not None

    client.post(
        "/api/fuel-loads/",
        {
            "vehicle": vehicle.id,
            "load_date": "2026-09-01",
            "odometer_km": 5000,
            "amount": 1000,
            "liters": 20,
        },
        format="json",
    )
    assert cache.get(key) is None


def test_dashboard_reflects_the_new_date_after_editing_a_fuel_load(family, vehicle):
    """El resumen/historial leen la fecha de la carga del dashboard: si la cache
    no se invalida al editarla, se sigue viendo la fecha vieja."""
    client = auth_client(family["owner"])
    created = client.post(
        "/api/fuel-loads/",
        {
            "vehicle": vehicle.id,
            "load_date": "2026-09-01",
            "odometer_km": 5000,
            "amount": 1000,
            "liters": 20,
        },
        format="json",
    )
    fuel_load_id = created.data["id"]

    # el usuario ya tenía el dashboard cacheado de antes de editar
    warm = client.get(f"/api/vehicles/{vehicle.id}/dashboard/")
    assert warm.data["fuel_loads"][0]["load_date"] == "2026-09-01"

    patched = client.patch(
        f"/api/fuel-loads/{fuel_load_id}/",
        {"load_date": "2026-09-05", "odometer_km": 5000, "amount": 1000},
        format="json",
    )
    assert patched.status_code == 200, patched.data

    after = client.get(f"/api/vehicles/{vehicle.id}/dashboard/")
    assert after.data["fuel_loads"][0]["load_date"] == "2026-09-05"


def test_dashboard_is_never_cacheable_by_a_shared_cache(family, vehicle):
    """El payload depende de quién pregunta (get_object() filtra por
    pertenencia al grupo): si un proxy/CDN lo guardara, un usuario podría ver
    los datos de otro. Por eso `private`."""
    client = auth_client(family["owner"])
    response = client.get(f"/api/vehicles/{vehicle.id}/dashboard/")
    assert response.status_code == 200
    assert response["Cache-Control"] == "private, no-cache"


def test_dashboard_answers_304_when_nothing_changed(family, vehicle):
    """Con `no-cache` + ETag, la segunda visita no descarga el payload: pide
    revalidación y recibe 304 sin cuerpo."""
    client = auth_client(family["owner"])
    first = client.get(f"/api/vehicles/{vehicle.id}/dashboard/")
    etag = first["ETag"]
    assert etag, "ConditionalGetMiddleware debería agregar el ETag"

    second = client.get(
        f"/api/vehicles/{vehicle.id}/dashboard/",
        HTTP_IF_NONE_MATCH=etag,
    )
    assert second.status_code == 304
    assert not second.content


def test_dashboard_sends_full_payload_when_it_changed(family, vehicle):
    """Si el ETag no cambió porque el contenido tampoco, 304; pero apenas se
    agrega un viaje el ETag tiene que ser distinto y volver 200."""
    client = auth_client(family["owner"])
    warm = client.get(f"/api/vehicles/{vehicle.id}/dashboard/")
    warm_etag = warm["ETag"]

    assert (
        client.get(
            f"/api/vehicles/{vehicle.id}/dashboard/",
            HTTP_IF_NONE_MATCH=warm_etag,
        ).status_code
        == 304
    )

    created = client.post(
        "/api/trips/",
        {
            "vehicle": vehicle.id,
            "trip_date": "2026-09-01",
            "start_km": 100,
            "end_km": 200,
        },
        format="json",
    )
    assert created.status_code == 201, created.data

    # el POST invalidó la cache de Django, así que el payload se rearma: el
    # ETag anterior ya no sirve y tiene que bajar el cuerpo entero.
    changed = client.get(
        f"/api/vehicles/{vehicle.id}/dashboard/",
        HTTP_IF_NONE_MATCH=warm_etag,
    )
    assert changed.status_code == 200
    assert changed["ETag"] != warm_etag
    assert len(changed.data["trips"]) == 1