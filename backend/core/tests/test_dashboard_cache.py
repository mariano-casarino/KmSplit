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