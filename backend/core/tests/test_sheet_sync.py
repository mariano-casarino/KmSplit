from datetime import date
from unittest.mock import patch

from core.models import FuelLoad, Trip
from core.sheets_sync import (
    _persona_for,
    _post,
    fuel_payload,
    group_is_synced,
    notify_sheets,
    trip_payload,
    week_bounds,
    week_number,
)


def test_week_bounds_jueves_a_miercoles():
    # domingo 20/09/2026 -> semana del jueves 17/09 al miércoles 23/09
    assert week_bounds(date(2026, 9, 20)) == (date(2026, 9, 17), date(2026, 9, 23))


def test_week_bounds_inicio_exacto_en_jueves():
    # jueves 17/09 arranca su propia semana
    assert week_bounds(date(2026, 9, 17)) == (date(2026, 9, 17), date(2026, 9, 23))


def test_week_bounds_miercoles_pertenece_a_semana_anterior():
    # miércoles 16/09 pertenece a la semana del jueves 10/09
    assert week_bounds(date(2026, 9, 16)) == (date(2026, 9, 10), date(2026, 9, 16))


def test_week_number_formato_aaaa_nn():
    assert week_number(date(2026, 9, 20)) == "2026-38"


def test_week_number_cambio_de_anio():
    # viernes 01/01/2021 -> jueves 31/12/2020 (ISO 2020-W53)
    assert week_number(date(2021, 1, 1)) == "2020-53"


def test_persona_usa_mapeo_configurado(family, settings):
    owner = family["owner"]
    settings.SHEETS_USER_MAP = {str(owner.pk): "Marian"}
    assert _persona_for(owner) == "Marian"


def test_persona_usa_mapeo_por_email(family, settings):
    owner = family["owner"]
    settings.SHEETS_USER_MAP = {owner.email: "Marian"}
    assert _persona_for(owner) == "Marian"


def test_persona_usa_mapeo_por_nombre(family, settings):
    settings.SHEETS_USER_MAP = {"Mariano": "Marian"}
    assert _persona_for(family["owner"]) == "Marian"


def test_persona_cae_al_nombre_de_cuenta(family, settings):
    settings.SHEETS_USER_MAP = {}
    assert _persona_for(family["owner"]) == "Mariano"


def test_trip_payload(vehicle, family, settings):
    settings.SHEETS_USER_MAP = {str(family["owner"].pk): "Marian"}
    trip = Trip.objects.create(
        vehicle=vehicle,
        user=family["owner"],
        trip_date=date(2026, 9, 20),
        start_km=1000,
        end_km=1100,
    )
    payload = trip_payload(trip, "crear")

    assert payload["tipo"] == "viaje"
    assert payload["accion"] == "crear"
    assert payload["persona"] == "Marian"
    assert payload["km_inicial"] == 1000
    assert payload["km_final"] == 1100
    assert payload["numero_semana"] == "2026-38"
    assert payload["semana_inicio"] == "2026-09-17"
    assert payload["semana_fin"] == "2026-09-23"


def test_fuel_payload_monto_como_string(vehicle, family):
    fuel = FuelLoad.objects.create(
        vehicle=vehicle,
        loaded_by=family["owner"],
        load_date=date(2026, 9, 17),
        odometer_km=1200,
        amount="4500.50",
    )
    payload = fuel_payload(fuel, "crear")

    assert payload["tipo"] == "carga"
    assert payload["odometro"] == 1200
    assert payload["monto"] == "4500.50"
    assert payload["numero_semana"] == "2026-38"


def test_notify_no_hace_nada_si_esta_deshabilitado(settings):
    settings.SHEETS_SYNC_ENABLED = False
    settings.SHEETS_WEBHOOK_URL = "https://example.com/hook"
    with patch("core.sheets_sync.request.urlopen") as mock_urlopen:
        notify_sheets({"tipo": "viaje"})
    mock_urlopen.assert_not_called()


def test_notify_no_hace_nada_sin_url(settings):
    settings.SHEETS_SYNC_ENABLED = True
    settings.SHEETS_WEBHOOK_URL = ""
    with patch("core.sheets_sync.request.urlopen") as mock_urlopen:
        notify_sheets({"tipo": "viaje"})
    mock_urlopen.assert_not_called()


def test_post_envia_token_y_json():
    with patch("core.sheets_sync.request.urlopen") as mock_urlopen:
        _post("https://example.com/hook", "secreto", {"tipo": "viaje"})

    request = mock_urlopen.call_args.args[0]
    assert request.method == "POST"
    assert b'"token": "secreto"' in request.data
    assert b'"tipo": "viaje"' in request.data


def test_post_traga_errores_de_red():
    with patch("core.sheets_sync.request.urlopen", side_effect=OSError("sin red")):
        _post("https://example.com/hook", "secreto", {"tipo": "viaje"})


def test_signal_de_viaje_dispara_notify(
    vehicle, family, django_capture_on_commit_callbacks, settings
):
    # fijo el filtro de grupo para no depender de SHEETS_GROUP_NAME del .env
    settings.SHEETS_GROUP_NAME = "Familia Test"
    with patch("core.signals.notify_sheets") as mock_notify:
        with django_capture_on_commit_callbacks(execute=True):
            Trip.objects.create(
                vehicle=vehicle,
                user=family["owner"],
                trip_date=date(2026, 9, 20),
                start_km=1000,
                end_km=1100,
            )
    mock_notify.assert_called_once()
    assert mock_notify.call_args.args[0]["accion"] == "crear"


def test_signal_de_carga_eliminada_dispara_notify(
    vehicle, family, django_capture_on_commit_callbacks, settings
):
    # fijo el filtro de grupo para no depender de SHEETS_GROUP_NAME del .env
    settings.SHEETS_GROUP_NAME = "Familia Test"
    fuel = FuelLoad.objects.create(
        vehicle=vehicle,
        loaded_by=family["owner"],
        load_date=date(2026, 9, 17),
        odometer_km=1200,
        amount="4500.50",
    )
    with patch("core.signals.notify_sheets") as mock_notify:
        with django_capture_on_commit_callbacks(execute=True):
            fuel.delete()
    mock_notify.assert_called_once()
    assert mock_notify.call_args.args[0]["accion"] == "eliminar"


def test_group_is_synced_sin_filtro_acepta_todo(vehicle, settings):
    settings.SHEETS_GROUP_NAME = ""
    assert group_is_synced(vehicle) is True


def test_group_is_synced_coincide_ignorando_mayusculas(vehicle, settings):
    settings.SHEETS_GROUP_NAME = "familia TEST"
    assert group_is_synced(vehicle) is True


def test_group_is_synced_otro_grupo(vehicle, settings):
    settings.SHEETS_GROUP_NAME = "Familia Casarino"
    assert group_is_synced(vehicle) is False


def test_signal_ignora_viaje_de_otro_grupo(
    vehicle, family, settings, django_capture_on_commit_callbacks
):
    settings.SHEETS_GROUP_NAME = "Familia Casarino"
    with patch("core.signals.notify_sheets") as mock_notify:
        with django_capture_on_commit_callbacks(execute=True):
            Trip.objects.create(
                vehicle=vehicle,
                user=family["owner"],
                trip_date=date(2026, 9, 20),
                start_km=1000,
                end_km=1100,
            )
    mock_notify.assert_not_called()


def test_signal_envia_viaje_del_grupo_configurado(
    vehicle, family, settings, django_capture_on_commit_callbacks
):
    settings.SHEETS_GROUP_NAME = "Familia Test"
    with patch("core.signals.notify_sheets") as mock_notify:
        with django_capture_on_commit_callbacks(execute=True):
            Trip.objects.create(
                vehicle=vehicle,
                user=family["owner"],
                trip_date=date(2026, 9, 20),
                start_km=1000,
                end_km=1100,
            )
    mock_notify.assert_called_once()
    assert mock_notify.call_args.args[0]["grupo"] == "Familia Test"