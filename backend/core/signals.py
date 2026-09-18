"""Señales que vuelcan viajes y cargas al backup de Google Sheets."""

from django.db import transaction
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from .models import FuelLoad, Trip
from .sheets_sync import fuel_payload, notify_sheets, trip_payload


@receiver(post_save, sender=Trip)
def trip_saved(sender, instance, created, **kwargs):
    payload = trip_payload(instance, "crear" if created else "editar")
    transaction.on_commit(lambda: notify_sheets(payload))


@receiver(post_delete, sender=Trip)
def trip_deleted(sender, instance, **kwargs):
    payload = trip_payload(instance, "eliminar")
    transaction.on_commit(lambda: notify_sheets(payload))


@receiver(post_save, sender=FuelLoad)
def fuel_load_saved(sender, instance, created, **kwargs):
    payload = fuel_payload(instance, "crear" if created else "editar")
    transaction.on_commit(lambda: notify_sheets(payload))


@receiver(post_delete, sender=FuelLoad)
def fuel_load_deleted(sender, instance, **kwargs):
    payload = fuel_payload(instance, "eliminar")
    transaction.on_commit(lambda: notify_sheets(payload))