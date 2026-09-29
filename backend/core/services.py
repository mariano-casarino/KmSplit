from decimal import ROUND_HALF_UP, Decimal

from django.core.cache import cache

from .models import FuelLoad, GroupMembership, Notification, Settlement, SettlementDetail, Trip

DASHBOARD_CACHE_TTL = 300


def dashboard_cache_key(vehicle_id):
    return f"dashboard:vehicle:{vehicle_id}"


def invalidate_vehicle_dashboard(vehicle_id):
    """Invalida la cache del payload del dashboard cuando cambian sus datos
    (viajes, cargas, liquidaciones o miembros del grupo)."""
    cache.delete(dashboard_cache_key(vehicle_id))


def notify_members(actor, vehicle, kind, message, link="", record_id=None):
    """Crea una Notification para todos los integrantes ACTIVOS del grupo del
    vehículo, salvo el actor. No se notifica al propio autor (ya vio la
    acción) ni a miembros dados de baja. No hace nada si el actor es el único
    integrante.

    `record_id` guarda el id del viaje/carga que originó el aviso para que el
    frontend pueda abrir ese registro puntual y resaltarlo.
    """
    members = (
        GroupMembership.objects.filter(group_id=vehicle.group_id, is_active=True)
        .exclude(user=actor)
        .select_related("user")
    )
    notifications = [
        Notification(
            recipient=m.user,
            actor=actor,
            vehicle=vehicle,
            kind=kind,
            message=message,
            link=link,
            record_id=record_id,
        )
        for m in members
    ]
    if notifications:
        Notification.objects.bulk_create(notifications)


def _quantize(value):
    return Decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def find_settlement_for_trip(trip):
    """
    Devuelve el Settlement existente cuyo rango de km contiene por completo a
    este viaje, o None si el viaje todavía cae en el período abierto (sin
    liquidar) o no encaja en ningún período conocido.
    """
    return Settlement.objects.filter(
        vehicle=trip.vehicle,
        period_start_km__lte=trip.start_km,
        period_end_km__gte=trip.end_km,
    ).first()


def recalculate_settlement(settlement):
    """
    Recalcula desde cero el reparto de un settlement: vuelve a sumar los km de
    cada integrante, recalcula km_sin_asignar, y regenera los SettlementDetail.
    Se usa tanto al crear un settlement nuevo como al editar/agregar un viaje
    que cae dentro de un período ya liquidado.

    Cada viaje se **prorratea** contra el rango del período: si un viaje cruza
    el límite de una liquidación (p. ej. viaje 200→400 km con cargas en 300 y
    400), aporta solo la parte que cae dentro de ESTE settlement (200→300 para
    la primera, 300→400 para la segunda). Así una carga siempre captura la parte
    del viaje que le corresponde, sin depender de a qué settlement apunta el FK.
    """
    vehicle = settlement.vehicle
    period_start = settlement.period_start_km
    period_end = settlement.period_end_km
    period_total_km = period_end - period_start

    # Viajes del vehículo que SOLAPAN el período (independiente del FK
    # settlement), con el km recortado al rango de esta liquidación.
    overlapping_trips = Trip.objects.filter(
        vehicle=vehicle,
        start_km__lt=period_end,
        end_km__gt=period_start,
    )

    registered_by_user = {}
    registered_km_total = 0
    for trip in overlapping_trips:
        clip_start = max(trip.start_km, period_start)
        clip_end = min(trip.end_km, period_end)
        clipped = clip_end - clip_start
        if clipped <= 0:
            continue
        registered_by_user[trip.user_id] = registered_by_user.get(trip.user_id, 0) + clipped
        registered_km_total += clipped

    # clamp a 0: si hay viajes superpuestos que suman más que el período real,
    # no dejamos que unassigned_km quede negativo. La prevención de solapamiento
    # se hace en TripSerializer.validate; esto es solo una red de seguridad.
    unassigned_km = max(period_total_km - registered_km_total, 0)

    settlement.unassigned_km = unassigned_km
    settlement.save(update_fields=["unassigned_km"])

    active_memberships = list(
        GroupMembership.objects.filter(group=vehicle.group, is_active=True)
    )

    if vehicle.split_unassigned_km_all_members:
        split_user_ids = {m.user_id for m in active_memberships}
    else:
        # solo entre quienes efectivamente manejaron en este período
        split_user_ids = set(registered_by_user.keys())

    share_count = len(split_user_ids) or 1  # evita división por cero
    unassigned_share = Decimal(unassigned_km) / Decimal(share_count)

    settlement.details.all().delete()

    details = []
    for membership in active_memberships:
        registered_km = registered_by_user.get(membership.user_id, 0)
        share = unassigned_share if membership.user_id in split_user_ids else Decimal("0")
        km_driven = Decimal(registered_km) + share

        if period_total_km > 0:
            percentage = (km_driven / Decimal(period_total_km)) * Decimal("100")
        else:
            percentage = Decimal("0")

        amount_owed = (percentage / Decimal("100")) * settlement.total_amount

        details.append(
            SettlementDetail(
                settlement=settlement,
                user_id=membership.user_id,
                registered_km=registered_km,
                unassigned_km_share=_quantize(share),
                km_driven=_quantize(km_driven),
                percentage=_quantize(percentage),
                amount_owed=_quantize(amount_owed),
            )
        )

    SettlementDetail.objects.bulk_create(details)
    return settlement


def is_last_fuel_load(fuel_load: FuelLoad) -> bool:
    """True si esta carga es la más reciente del vehículo (no hay otra posterior)."""
    latest = FuelLoad.objects.filter(vehicle=fuel_load.vehicle).order_by("-id").first()
    return latest is not None and latest.id == fuel_load.id


def sync_settlement_for_fuel_load(fuel_load: FuelLoad):
    """Re-sincroniza la liquidación de una carga después de editarla.

    Solo tiene sentido para la carga MÁS RECIENTE (no hay posteriores que
    dependan de su checkpoint). Actualiza el rango y el monto del período y
    avanza el checkpoint del vehículo al nuevo odómetro."""
    settlement = Settlement.objects.filter(fuel_load=fuel_load).first()
    if settlement is None:
        return None

    vehicle = fuel_load.vehicle
    settlement.period_end_km = fuel_load.odometer_km
    settlement.total_amount = fuel_load.amount
    settlement.save(update_fields=["period_end_km", "total_amount"])

    vehicle.current_km = fuel_load.odometer_km
    vehicle.save(update_fields=["current_km"])

    recalculate_settlement(settlement)
    return settlement


def delete_settlement_for_fuel_load(fuel_load: FuelLoad):
    """Elimina la liquidación de una carga y revierte el checkpoint del vehículo.

    Solo tiene sentido para la carga MÁS RECIENTE: los viajes que apuntaban a
    esta liquidación vuelven a quedar "sueltos" y el km del vehículo retrocede
    al inicio de este período (al checkpoint previo a esta carga)."""
    settlement = (
        Settlement.objects.filter(fuel_load=fuel_load).select_related("vehicle").first()
    )
    if settlement is None:
        return

    Trip.objects.filter(settlement=settlement).update(settlement=None)

    vehicle = settlement.vehicle
    vehicle.current_km = settlement.period_start_km
    vehicle.save(update_fields=["current_km"])

    settlement.delete()


def create_settlement_for_fuel_load(fuel_load: FuelLoad) -> Settlement:
    """
    Se dispara al registrar una carga de combustible nueva. Cierra el período
    desde el último checkpoint conocido (vehicle.current_km) hasta el km de
    esta carga, y arma la liquidación completa.
    """
    vehicle = fuel_load.vehicle
    period_start_km = vehicle.current_km
    period_end_km = fuel_load.odometer_km

    settlement = Settlement.objects.create(
        vehicle=vehicle,
        fuel_load=fuel_load,
        period_start_km=period_start_km,
        period_end_km=period_end_km,
        total_amount=fuel_load.amount,
        unassigned_km=0,  # se recalcula abajo, placeholder inicial
    )

    # el checkpoint del vehículo avanza al km de esta carga, listo para el
    # próximo período
    vehicle.current_km = period_end_km
    vehicle.save(update_fields=["current_km"])

    recalculate_settlement(settlement)
    return settlement


def assign_and_recalculate_trip(trip: Trip) -> Trip:
    """
    Se llama después de crear o editar un Trip. Si el viaje encaja dentro de
    un settlement ya existente, lo asigna y dispara el recálculo de ese
    settlement (y del anterior, si el viaje se "mudó" de período al editarlo).

    IMPORTANTE: el recálculo NO depende del FK `settlement`, porque ese FK solo
    apunta al período que CONTIENE al viaje por completo. Si el viaje cruza un
    límite (arranca dentro de una liquidación y termina en la siguiente) o los
    períodos ya estaban cerrados cuando se cargó el viaje (FK = None aunque el
    rango caiga dentro de un período liquidado), el settlement igual puede
    SOLAPAR su rango y debe recalcularse (recalculate_settlement prorratea por
    solapamiento/clip). Por eso se recalculan TODOS los settlements del vehículo
    que solapan el rango del viaje, más el que apuntaba el FK antes de editar.
    """
    old_settlement = trip.settlement
    new_settlement = find_settlement_for_trip(trip)

    if old_settlement != new_settlement:
        trip.settlement = new_settlement
        trip.save(update_fields=["settlement"])

    # períodos afectados: el anterior FK + todos los que solapan el rango del
    # viaje ahora mismo (incluye al nuevo FK). recalculate_settlement trata el
    # HashSet, así que cada settlement se recalcula exactamente una vez.
    affected = set()
    if old_settlement:
        affected.add(old_settlement.id)
    if new_settlement:
        affected.add(new_settlement.id)

    affected.update(
        s.id
        for s in Settlement.objects.filter(
            vehicle=trip.vehicle,
            period_start_km__lt=trip.end_km,
            period_end_km__gt=trip.start_km,
        )
    )

    for settlement_id in affected:
        recalculate_settlement(Settlement.objects.get(pk=settlement_id))

    return trip
