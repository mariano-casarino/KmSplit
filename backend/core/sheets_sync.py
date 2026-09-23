"""Backup automático a Google Sheets vía Apps Script webhook.

Cada alta/modificación/baja de un viaje o carga dispara un POST best-effort
(no bloquea ni rompe la app) hacia el script desplegado, que vuelca los datos
en las hojas "Registro" y "Resumen semanal". Se configura por env:

    SHEETS_SYNC_ENABLED   (bool, default False)
    SHEETS_WEBHOOK_URL    URL del web app desplegado en Apps Script
    SHEETS_WEBHOOK_SECRET token que el script valida como autenticación
    SHEETS_USER_MAP       JSON, mapea cuenta -> "Nombre en la hoja Registro"
                          (la clave puede ser email, id o nombre)
    SHEETS_GROUP_NAME     solo se sincroniza este grupo (vacío = todos)
"""

import json
import threading
from datetime import date, datetime, timedelta
from urllib import request

from django.conf import settings

# Jueves = día en que empieza la semana (lunes es 0 en Python)
_THURSDAY = 3


def _as_date(value) -> date:
    """Normaliza date/datetime/str (el atributo puede quedar sin convertir)."""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value))


def week_bounds(d: date) -> tuple[date, date]:
    """Límites [jueves, miércoles] de la semana que contiene la fecha d."""
    d = _as_date(d)
    days_since_thursday = (d.weekday() - _THURSDAY) % 7
    week_start = d - timedelta(days=days_since_thursday)
    return week_start, week_start + timedelta(days=6)


def week_number(d: date) -> str:
    """Número de semana como 'AAAA-NN', usando el jueves de esa semana.

    Ej: domingo 20/09/2026 cae en la semana cuyo jueves es el 17/09
    (ISO 2026-W38) -> devuelve '2026-38'. Mantener este formato consistente
    con lo que la planilla espera en su columna 'Semana'.
    """
    week_start, _ = week_bounds(d)
    iso_year, iso_week, _ = week_start.isocalendar()
    return f"{iso_year}-{iso_week:02d}"


def group_is_synced(vehicle) -> bool:
    """True si el vehículo pertenece al grupo que se vuelca a la planilla.

    Configurá SHEETS_GROUP_NAME con el nombre exacto (ej "Familia Casarino").
    Vacío = se vuelcan TODOS los grupos."""
    target = getattr(settings, "SHEETS_GROUP_NAME", "")
    if not target:
        return True
    return vehicle.group.name.strip().casefold() == target.strip().casefold()


def _persona_for(user) -> str:
    """Nombre que se usa en la hoja 'Registro' (columna Persona).

    Prioridad: mapeo de SHEETS_USER_MAP -> nombre público -> 'usuario-<id>'.
    El mapeo puede tener como clave el id, el email o el nombre de la cuenta,
    lo que te resulte más fácil de completar."""
    raw_map = getattr(settings, "SHEETS_USER_MAP", {}) or {}
    for key in (str(user.pk), user.email, user.name):
        if key and raw_map.get(key):
            return raw_map[key]
    return user.name or f"usuario-{user.pk}"


def trip_payload(trip, action: str) -> dict:
    trip_date = _as_date(trip.trip_date)
    week_start, week_end = week_bounds(trip_date)
    return {
        "tipo": "viaje",
        "accion": action,  # 'crear' | 'editar' | 'eliminar'
        "viaje_id": trip.pk,
        "grupo": trip.vehicle.group.name,
        "vehiculo": trip.vehicle.name,
        "fecha": trip_date.isoformat(),
        "persona": _persona_for(trip.user),
        "km_inicial": trip.start_km,
        "km_final": trip.end_km,
        "numero_semana": week_number(trip_date),
        "semana_inicio": week_start.isoformat(),
        "semana_fin": week_end.isoformat(),
    }


def fuel_payload(fuel_load, action: str) -> dict:
    load_date = _as_date(fuel_load.load_date)
    week_start, week_end = week_bounds(load_date)
    return {
        "tipo": "carga",
        "accion": action,  # 'crear' | 'editar' | 'eliminar'
        "carga_id": fuel_load.pk,
        "grupo": fuel_load.vehicle.group.name,
        "vehiculo": fuel_load.vehicle.name,
        "persona": _persona_for(fuel_load.loaded_by),
        "fecha": load_date.isoformat(),
        "odometro": fuel_load.odometer_km,
        # str para no perder decimales en el JSON (Decimal no es serializable)
        "monto": str(fuel_load.amount),
        "numero_semana": week_number(load_date),
        "semana_inicio": week_start.isoformat(),
        "semana_fin": week_end.isoformat(),
    }


def notify_sheets(payload: dict) -> None:
    """POST asíncrono al webhook. Nunca lanza excepciones ni bloquea."""
    if not getattr(settings, "SHEETS_SYNC_ENABLED", False):
        return
    url = getattr(settings, "SHEETS_WEBHOOK_URL", "")
    secret = getattr(settings, "SHEETS_WEBHOOK_SECRET", "")
    if not url:
        return
    threading.Thread(target=_post, args=(url, secret, payload), daemon=True).start()


def _post(url: str, secret: str, payload: dict) -> None:
    try:
        # El token viaja en el body: Apps Script no expone headers custom a doPost.
        body = dict(payload)
        body["token"] = secret
        data = json.dumps(body).encode("utf-8")
        req = request.Request(
            url,
            data=data,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with request.urlopen(req, timeout=5) as resp:
            resp.read()
    except Exception:  # noqa: BLE001 - el backup nunca debe derribar la app
        pass