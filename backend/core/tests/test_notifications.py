import pytest
from rest_framework.test import APIClient

from core.models import Notification

pytestmark = pytest.mark.django_db


def auth_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


class TestTripNotifications:
    def test_trip_created_notifies_other_members_but_not_creator(self, family, vehicle):
        client = auth_client(family["owner"])
        response = client.post("/api/trips/", {
            "vehicle": vehicle.id, "trip_date": "2026-07-02",
            "start_km": 1000, "end_km": 1045,
        })
        assert response.status_code == 201

        owner_notifs = Notification.objects.filter(recipient=family["owner"])
        admins = Notification.objects.filter(recipient=family["admin"])
        members = Notification.objects.filter(recipient=family["member"])

        assert owner_notifs.count() == 0
        assert admins.count() == 1
        assert members.count() == 1

        n = admins.first()
        assert n.kind == "trip"
        assert n.actor == family["owner"]
        assert "45 km" in n.message
        assert n.link == f"/vehiculo/{vehicle.id}/historial"

    def test_dont_notify_inactive_members(self, family, vehicle):
        family["member"].memberships.update(is_active=False)
        client = auth_client(family["owner"])
        response = client.post("/api/trips/", {
            "vehicle": vehicle.id, "trip_date": "2026-07-02",
            "start_km": 1000, "end_km": 1010,
        })
        assert response.status_code == 201
        assert Notification.objects.filter(recipient=family["member"]).count() == 0
        assert Notification.objects.filter(recipient=family["admin"]).count() == 1


class TestFuelLoadNotifications:
    def test_fuel_load_notifies_other_members(self, family, vehicle):
        client = auth_client(family["admin"])
        response = client.post("/api/fuel-loads/", {
            "vehicle": vehicle.id, "load_date": "2026-07-02",
            "odometer_km": 1100, "amount": "12500.50",
        })
        assert response.status_code == 201

        admins = Notification.objects.filter(recipient=family["admin"])
        owners = Notification.objects.filter(recipient=family["owner"])
        members = Notification.objects.filter(recipient=family["member"])

        assert admins.count() == 0
        assert owners.count() == 1
        assert members.count() == 1

        n = owners.first()
        assert n.kind == "fuel"
        assert "12500.50" in n.message
        assert n.link == f"/vehiculo/{vehicle.id}/resumen"

    def test_solo_actor_gets_no_notifications(self, family, vehicle):
        family["admin"].memberships.update(is_active=False)
        family["member"].memberships.update(is_active=False)
        client = auth_client(family["owner"])
        response = client.post("/api/trips/", {
            "vehicle": vehicle.id, "trip_date": "2026-07-02",
            "start_km": 1000, "end_km": 1010,
        })
        assert response.status_code == 201
        assert Notification.objects.count() == 0


class TestNotificationAPI:
    def _notification(self, recipient, actor, **kwargs):
        return Notification.objects.create(
            recipient=recipient, actor=actor, kind="trip",
            message="Viaje de prueba", link="/vehiculo/1/historial", **kwargs,
        )

    def test_unread_count_scoped_to_user(self, family, vehicle):
        self._notification(family["owner"], family["member"])
        self._notification(family["owner"], family["admin"])
        self._notification(family["admin"], family["owner"])

        client = auth_client(family["owner"])
        response = client.get("/api/notifications/unread_count/")
        assert response.status_code == 200
        assert response.data == {"count": 2}

    def test_list_only_returns_own_notifications_ordered_by_newest(self, family, vehicle):
        from django.utils import timezone
        from datetime import timedelta

        old = self._notification(family["owner"], family["member"])
        Notification.objects.filter(pk=old.pk).update(
            created_at=timezone.now() - timedelta(hours=2)
        )
        new = self._notification(family["owner"], family["member"])
        self._notification(family["admin"], family["owner"])  # ajena: no debe salir

        client = auth_client(family["owner"])
        response = client.get("/api/notifications/")
        assert response.status_code == 200
        ids = [n["id"] for n in response.data]
        assert ids == [new.id, old.id]

    def test_mark_read_only_changes_requested_one(self, family, vehicle):
        a = self._notification(family["owner"], family["member"])
        b = self._notification(family["owner"], family["member"])
        client = auth_client(family["owner"])

        response = client.post(f"/api/notifications/{a.id}/read/")
        assert response.status_code == 204
        a.refresh_from_db()
        b.refresh_from_db()
        assert a.is_read is True
        assert b.is_read is False

    def test_mark_read_cant_touch_others_notification(self, family, vehicle):
        other = self._notification(family["admin"], family["member"])
        client = auth_client(family["owner"])
        response = client.post(f"/api/notifications/{other.id}/read/")
        assert response.status_code == 404
        other.refresh_from_db()
        assert other.is_read is False

    def test_mark_all_read(self, family, vehicle):
        self._notification(family["owner"], family["member"])
        self._notification(family["owner"], family["admin"])
        client = auth_client(family["owner"])

        response = client.post("/api/notifications/read_all/")
        assert response.status_code == 204
        assert Notification.objects.filter(recipient=family["owner"], is_read=False).count() == 0