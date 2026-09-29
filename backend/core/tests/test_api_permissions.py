from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from core.models import FuelLoad, Trip

pytestmark = pytest.mark.django_db


def auth_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


class TestVehiclePermissions:
    def test_member_cannot_create_vehicle(self, family):
        client = auth_client(family["member"])
        response = client.post("/api/vehicles/", {
            "group": family["group"].id, "name": "Auto no autorizado",
        })
        assert response.status_code == 403

    def test_admin_can_create_vehicle(self, family):
        client = auth_client(family["admin"])
        response = client.post("/api/vehicles/", {
            "group": family["group"].id, "name": "Auto de la oficina", "current_km": 500,
        })
        assert response.status_code == 201

    def test_member_cannot_update_vehicle(self, family, vehicle):
        client = auth_client(family["member"])
        response = client.patch(f"/api/vehicles/{vehicle.id}/", {"name": "Nuevo nombre"})
        assert response.status_code == 403

    def test_admin_can_update_vehicle(self, family, vehicle):
        client = auth_client(family["admin"])
        response = client.patch(f"/api/vehicles/{vehicle.id}/", {"name": "Auto nuevo"})
        assert response.status_code == 200
        assert response.data["name"] == "Auto nuevo"

    def test_owner_can_update_km(self, family, vehicle):
        client = auth_client(family["owner"])
        response = client.patch(f"/api/vehicles/{vehicle.id}/", {"current_km": 5000})
        assert response.status_code == 200
        assert response.data["current_km"] == 5000


class TestTripPermissions:
    def test_member_cannot_edit_others_trip(self, family, vehicle):
        trip = Trip.objects.create(
            vehicle=vehicle, user=family["owner"], trip_date="2026-07-01",
            start_km=1000, end_km=1010,
        )
        client = auth_client(family["member"])
        response = client.patch(f"/api/trips/{trip.id}/", {"end_km": 1020})
        assert response.status_code == 403

    def test_admin_can_edit_others_trip(self, family, vehicle):
        trip = Trip.objects.create(
            vehicle=vehicle, user=family["owner"], trip_date="2026-07-01",
            start_km=1000, end_km=1010,
        )
        client = auth_client(family["admin"])
        response = client.patch(f"/api/trips/{trip.id}/", {"end_km": 1020})
        assert response.status_code == 200

    def test_member_can_edit_own_trip(self, family, vehicle):
        trip = Trip.objects.create(
            vehicle=vehicle, user=family["member"], trip_date="2026-07-01",
            start_km=1000, end_km=1010,
        )
        client = auth_client(family["member"])
        response = client.patch(f"/api/trips/{trip.id}/", {"end_km": 1020})
        assert response.status_code == 200

    def test_overlapping_trip_is_rejected(self, family, vehicle):
        Trip.objects.create(
            vehicle=vehicle, user=family["owner"], trip_date="2026-07-01",
            start_km=1000, end_km=1050,
        )
        client = auth_client(family["admin"])
        response = client.post("/api/trips/", {
            "vehicle": vehicle.id, "trip_date": "2026-07-01",
            "start_km": 1030, "end_km": 1070,
        })
        assert response.status_code == 400
        assert "superponen" in str(response.data)

    def test_end_km_must_be_greater_than_start_km(self, family, vehicle):
        client = auth_client(family["owner"])
        response = client.post("/api/trips/", {
            "vehicle": vehicle.id, "trip_date": "2026-07-01",
            "start_km": 1050, "end_km": 1000,
        })
        assert response.status_code == 400


class TestGroupRoles:
    def test_owner_can_promote_member(self, family):
        client = auth_client(family["owner"])
        response = client.patch(
            f"/api/groups/{family['group'].id}/members/{family['member'].id}/",
            {"role": "admin"},
        )
        assert response.status_code == 200
        assert response.data["role"] == "admin"

    def test_member_cannot_self_promote(self, family):
        client = auth_client(family["member"])
        response = client.patch(
            f"/api/groups/{family['group'].id}/members/{family['member'].id}/",
            {"role": "admin"},
        )
        assert response.status_code == 403

    def test_admin_can_promote_member_to_admin(self, family):
        client = auth_client(family["admin"])  
        response = client.patch(
            f"/api/groups/{family['group'].id}/members/{family['member'].id}/",
            {"role": "admin"},
        )
        assert response.status_code == 200
        assert response.data["role"] == "admin"

    def test_admin_cannot_demote_another_admin(self, family, make_user):
        from core.models import GroupMembership

        other_admin = make_user("Marian", "marian@test.com")
        GroupMembership.objects.create(group=family["group"], user=other_admin, role="admin")

        client = auth_client(family["admin"])  # Cami
        response = client.patch(
            f"/api/groups/{family['group'].id}/members/{other_admin.id}/",
            {"role": "member"},
        )
        assert response.status_code == 403

    def test_admin_can_remove_a_member(self, family):
        client = auth_client(family["admin"])
        response = client.patch(
            f"/api/groups/{family['group'].id}/members/{family['member'].id}/",
            {"remove": True},
        )
        assert response.status_code == 200

    def test_admin_cannot_remove_another_admin(self, family, make_user):
        from core.models import GroupMembership

        other_admin = make_user("Marian", "marian2@test.com")
        GroupMembership.objects.create(group=family["group"], user=other_admin, role="admin")

        client = auth_client(family["admin"])
        response = client.patch(
            f"/api/groups/{family['group'].id}/members/{other_admin.id}/",
            {"remove": True},
        )
        assert response.status_code == 403

class TestFuelLoadTriggersSettlement:
    def test_creating_fuel_load_via_api_creates_settlement(self, family, vehicle):
        Trip.objects.create(
            vehicle=vehicle, user=family["owner"], trip_date="2026-07-01",
            start_km=1000, end_km=1050,
        )
        client = auth_client(family["owner"])
        response = client.post("/api/fuel-loads/", {
            "vehicle": vehicle.id, "load_date": "2026-07-02",
            "odometer_km": 1100, "amount": "5000.00",
        })
        assert response.status_code == 201

        settlements = client.get(f"/api/settlements/?vehicle={vehicle.id}")
        assert settlements.status_code == 200
        assert len(settlements.data) == 1
        assert settlements.data[0]["unassigned_km"] == 50

    def test_fuel_load_odometer_cannot_be_lower_than_checkpoint(self, family, vehicle):
        # vehicle.current_km = 1000 (fixture); intentar cargar con 300 km da 400
        client = auth_client(family["owner"])
        response = client.post("/api/fuel-loads/", {
            "vehicle": vehicle.id, "load_date": "2026-07-02",
            "odometer_km": 300, "amount": "5000.00",
        })
        assert response.status_code == 400
        assert "odometer_km" in response.data
        assert "mayor" in response.data["odometer_km"][0]

    def test_fuel_load_odometer_must_be_greater_than_checkpoint(self, family, vehicle):
        client = auth_client(family["owner"])
        response = client.post("/api/fuel-loads/", {
            "vehicle": vehicle.id, "load_date": "2026-07-02",
            "odometer_km": 1000, "amount": "5000.00",  # == fixture current_km
        })
        assert response.status_code == 400

    def test_owner_can_edit_last_fuel_load(self, family, vehicle):
        client = auth_client(family["owner"])
        created = client.post("/api/fuel-loads/", {
            "vehicle": vehicle.id, "load_date": "2026-07-02",
            "odometer_km": 1100, "amount": "5000.00",
        })
        fuel_load_id = created.data["id"]

        response = client.patch(f"/api/fuel-loads/{fuel_load_id}/", {"amount": "6000.00"})
        assert response.status_code == 200
        assert response.data["amount"] == "6000.00"

        # la liquidación de esa carga refleja el nuevo monto y km actualizado
        settlements = client.get(f"/api/settlements/?vehicle={vehicle.id}")
        assert settlements.data[0]["total_amount"] == "6000.00"

    def test_member_cannot_edit_fuel_load(self, family, vehicle):
        client = auth_client(family["owner"])
        created = client.post("/api/fuel-loads/", {
            "vehicle": vehicle.id, "load_date": "2026-07-02",
            "odometer_km": 1100, "amount": "5000.00",
        })
        fuel_load_id = created.data["id"]

        response = auth_client(family["member"]).patch(
            f"/api/fuel-loads/{fuel_load_id}/", {"amount": "6000.00"}
        )
        assert response.status_code in (403, 404)

    def test_edit_last_fuel_load_allows_keeping_same_odometer(self, family, vehicle):
        """Al editar la última carga se permite mantener el mismo km del odómetro
        (se compara contra el inicio de su liquidación, no contra current_km)."""
        client = auth_client(family["owner"])
        created = client.post("/api/fuel-loads/", {
            "vehicle": vehicle.id, "load_date": "2026-07-02",
            "odometer_km": 1100, "amount": "5000.00",
        })
        fuel_load_id = created.data["id"]

        # PATCH enviando el mismo odómetro (1100 == current_km) => debe pasar
        response = client.patch(f"/api/fuel-loads/{fuel_load_id}/", {
            "odometer_km": 1100, "amount": "6000.00",
        })
        assert response.status_code == 200
        assert response.data["odometer_km"] == 1100

    def test_edit_last_fuel_load_saves_the_date(self, family, vehicle):
        """Editar la fecha de la carga tiene que quedar guardada (y reflejada
        en el GET following y en la liquidación)."""
        client = auth_client(family["owner"])
        created = client.post("/api/fuel-loads/", {
            "vehicle": vehicle.id, "load_date": "2026-07-02",
            "odometer_km": 1100, "amount": "5000.00",
        })
        fuel_load_id = created.data["id"]
        assert created.data["load_date"] == "2026-07-02"

        response = client.patch(
            f"/api/fuel-loads/{fuel_load_id}/",
            {"load_date": "2026-07-05", "odometer_km": 1100, "amount": "5000.00"},
        )
        assert response.status_code == 200, response.data
        assert response.data["load_date"] == "2026-07-05"

        # follow-up: tampoco es un problema de la respuesta sino de la DB
        fuel_load = FuelLoad.objects.get(pk=fuel_load_id)
        assert str(fuel_load.load_date) == "2026-07-05"

        reread = client.get(f"/api/fuel-loads/{fuel_load_id}/")
        assert reread.data["load_date"] == "2026-07-05"

    def test_edit_last_fuel_load_rejects_below_period_start(self, family, vehicle):
        """No se puede bajar el odómetro por debajo del inicio de la liquidación."""
        client = auth_client(family["owner"])
        created = client.post("/api/fuel-loads/", {
            "vehicle": vehicle.id, "load_date": "2026-07-02",
            "odometer_km": 1100, "amount": "5000.00",
        })
        fuel_load_id = created.data["id"]

        # period_start == 1000 (fixture current_km); bajar a 900 => rechazado
        response = client.patch(f"/api/fuel-loads/{fuel_load_id}/", {"odometer_km": 900})
        assert response.status_code == 400
        assert "odometer_km" in response.data
        assert "inicio" in response.data["odometer_km"][0]

    def test_cannot_edit_a_none_last_fuel_load(self, family, vehicle):
        client = auth_client(family["owner"])
        first = client.post("/api/fuel-loads/", {
            "vehicle": vehicle.id, "load_date": "2026-07-02",
            "odometer_km": 1100, "amount": "5000.00",
        })
        second = client.post("/api/fuel-loads/", {
            "vehicle": vehicle.id, "load_date": "2026-07-03",
            "odometer_km": 1200, "amount": "6000.00",
        })

        # editar la primera (ya no es la última) => prohibido
        response = client.patch(f"/api/fuel-loads/{first.data['id']}/", {"amount": "9999.00"})
        assert response.status_code in (403, 404)

        # editar la última => ok
        ok = client.patch(f"/api/fuel-loads/{second.data['id']}/", {"amount": "7777.00"})
        assert ok.status_code == 200
        assert ok.data["amount"] == "7777.00"

    def test_owner_can_delete_last_fuel_load_and_rolls_back_km(self, family, vehicle):
        client = auth_client(family["owner"])
        client.post("/api/fuel-loads/", {
            "vehicle": vehicle.id, "load_date": "2026-07-03",
            "odometer_km": 1200, "amount": "6000.00",
        })
        last = client.post("/api/fuel-loads/", {
            "vehicle": vehicle.id, "load_date": "2026-07-04",
            "odometer_km": 1300, "amount": "7000.00",
        })
        last_id = last.data["id"]

        # tras dos cargas, quedaron dos liquidaciones
        settlements_before = client.get(f"/api/settlements/?vehicle={vehicle.id}")
        assert len(settlements_before.data) == 2

        response = client.delete(f"/api/fuel-loads/{last_id}/")
        assert response.status_code == 204

        # vuelve a haber una sola liquidación y el checkpoint retrocede a 1200
        settlements_after = client.get(f"/api/settlements/?vehicle={vehicle.id}")
        assert len(settlements_after.data) == 1
        vehicle.refresh_from_db()
        assert vehicle.current_km == 1200

    def test_member_cannot_delete_fuel_load(self, family, vehicle):
        client = auth_client(family["owner"])
        created = client.post("/api/fuel-loads/", {
            "vehicle": vehicle.id, "load_date": "2026-07-02",
            "odometer_km": 1100, "amount": "5000.00",
        })
        response = auth_client(family["member"]).delete(
            f"/api/fuel-loads/{created.data['id']}/"
        )
        assert response.status_code in (403, 404)
