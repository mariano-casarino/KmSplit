"""Señales que vuelcan viajes y cargas al backup de Google Sheets.

Solo se sincronizan los registros del grupo configurado en SHEETS_GROUP_NAME
(vacío = todos los grupos)."""

from django.db import transaction
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from .models import FuelLoad, Trip
from .sheets_sync import fuel_payload, group_is_synced, notify_sheets, trip_payload


def _synced(instance) -> bool:
    """Evita romper si el vehículo ya no existe (ej: borrado en cascada)."""
    try:
        return group_is_synced(instance.vehicle)
    except Exception:  # noqa: BLE001
        return False


@receiver(post_save, sender=Trip)
def trip_saved(sender, instance, created, **kwargs):
    if not _synced(instance):
        return
    payload = trip_payload(instance, "crear" if created else "editar")
    transaction.on_commit(lambda: notify_sheets(payload))


@receiver(post_delete, sender=Trip)
def trip_deleted(sender, instance, **kwargs):
    if not _synced(instance):
        return
    payload = trip_payload(instance, "eliminar")
    transaction.on_commit(lambda: notify_sheets(payload))


@receiver(post_save, sender=FuelLoad)
def fuel_load_saved(sender, instance, created, **kwargs):
    if not _synced(instance):
        return
    payload = fuel_payload(instance, "crear" if created else "editar")
    transaction.on_commit(lambda: notify_sheets(payload))


@receiver(post_delete, sender=FuelLoad)
def fuel_load_deleted(sender, instance, **kwargs):
    if not _synced(instance):
        return
    payload = fuel_payload(instance, "eliminar")
    transaction.on_commit(lambda: notify_sheets(payload))