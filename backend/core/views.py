from django.core.cache import cache
from django.db import connection
from django.http import JsonResponse
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied

from .models import FuelLoad, Group, GroupMembership, Settlement, Trip, Vehicle
from .permissions import CanEditFuelLoad, CanEditTrip, get_membership
from .serializers import (
    FuelLoadSerializer,
    GroupMembershipSerializer,
    GroupSerializer,
    JoinGroupSerializer,
    SettlementSerializer,
    TripSerializer,
    VehicleSerializer,
)
from . import services


def health_check(request):
    """GET /api/health/ — sin auth. Lo usan los pings de keep-alive
    (UptimeRobot o el cron de Vercel) para mantener el container despierto,
    y verifica que la base de datos responda."""
    try:
        connection.ensure_connection()
        return JsonResponse({"status": "ok"})
    except Exception as exc:
        return JsonResponse({"status": "error", "detail": str(exc)}, status=503)


class GroupViewSet(viewsets.ModelViewSet):
    serializer_class = GroupSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Group.objects.filter(
            members__user=self.request.user, members__is_active=True
        ).distinct()

    @action(detail=False, methods=["post"])
    def join(self, request):
        """POST /api/groups/join/  body: {"invite_code": "A3F91B2C"}"""
        serializer = JoinGroupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        group = serializer.group

        membership, created = GroupMembership.objects.get_or_create(
            group=group, user=request.user, defaults={"role": "member"}
        )
        if not created and not membership.is_active:
            # ya había sido miembro y fue dado de baja -> lo reactiva como member
            membership.is_active = True
            membership.removed_at = None
            membership.save()

        for vehicle in group.vehicles.all():
            services.invalidate_vehicle_dashboard(vehicle.id)

        return Response(GroupSerializer(group).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"])
    def leave(self, request, pk=None):
        """POST /api/groups/{pk}/leave/ — el usuario abandona el grupo."""
        group = self.get_object()
        membership = get_membership(request.user, group)
        if membership is None:
            return Response(
                {"detail": "No sos miembro de este grupo."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if membership.role == "owner":
            successor = (
                group.members.filter(is_active=True)
                .exclude(user=request.user)
                .order_by("joined_at")
                .first()
            )
            if successor is None:
                # el dueño era el único integrante -> no queda nadie para hacerse
                # cargo, así que el grupo se elimina (y sus vehículos con él)
                group.delete()
                return Response(
                    {"detail": "Eras el único integrante, así que el grupo se eliminó."},
                    status=status.HTTP_200_OK,
                )
            # si había más integrantes, el más antiguo pasa a ser dueño
            successor.role = "owner"
            successor.save(update_fields=["role"])

        membership.is_active = False
        membership.removed_at = timezone.now()
        membership.save(update_fields=["is_active", "removed_at"])

        for vehicle in group.vehicles.all():
            services.invalidate_vehicle_dashboard(vehicle.id)

        return Response({"detail": "Saliste del grupo."})

    @action(detail=True, methods=["patch"], url_path="members/(?P<user_id>[^/.]+)")
    def update_member(self, request, pk=None, user_id=None):
        group = self.get_object()
        acting_membership = get_membership(request.user, group)
        if acting_membership is None or acting_membership.role not in ("owner", "admin"):
            return Response(
                {"detail": "No tenés permiso para modificar miembros de este grupo"},
                status=status.HTTP_403_FORBIDDEN,
            )

        target = GroupMembership.objects.filter(group=group, user_id=user_id, is_active=True).first()
        if target is None:
            return Response({"detail": "Miembro no encontrado"}, status=status.HTTP_404_NOT_FOUND)

        new_role = request.data.get("role")
        if new_role:
            if new_role not in ("admin", "member"):
                return Response({"detail": "Rol inválido"}, status=status.HTTP_400_BAD_REQUEST)

            if acting_membership.role == "admin":
                # un admin solo puede promover a un member a admin -- no
                # puede tocar a otro admin ni degradar a nadie
                if target.role != "member" or new_role != "admin":
                    return Response(
                        {"detail": "Como admin, solo podés promover a un member a admin"},
                        status=status.HTTP_403_FORBIDDEN,
                    )
            # si es owner, puede poner cualquiera de los dos roles sin restricción

            target.role = new_role

        if request.data.get("remove"):
            if acting_membership.role == "admin" and target.role != "member":
                return Response(
                    {"detail": "Como admin, solo podés dar de baja a members"},
                    status=status.HTTP_403_FORBIDDEN,
                )
            target.is_active = False
            target.removed_at = timezone.now()

        target.save()
        for vehicle in group.vehicles.all():
            services.invalidate_vehicle_dashboard(vehicle.id)
        return Response(GroupMembershipSerializer(target).data)


class VehicleViewSet(viewsets.ModelViewSet):
    serializer_class = VehicleSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Vehicle.objects.filter(
            group__members__user=self.request.user, group__members__is_active=True
        ).distinct()

    @action(detail=True, methods=["get"], url_path="dashboard")
    def dashboard(self, request, pk=None):
        """GET /api/vehicles/{id}/dashboard/

        Devuelve vehicle + group + trips + fuel_loads + settlements en 1
        sola request. Optimiza las 4-5 requests que summary/history/etc.
        hacían por separado (evita round-trips + serialización)."""
        vehicle = self.get_object()

        cache_key = services.dashboard_cache_key(vehicle.id)
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        group = Group.objects.filter(
            members__user=request.user, members__is_active=True
        ).distinct().select_related().first()
        # Si el vehicle pertenece a otro grupo del user, usar ese
        if vehicle.group_id:
            group = Group.objects.filter(id=vehicle.group_id).prefetch_related(
                "members", "members__user"
            ).first()

        trips = Trip.objects.filter(vehicle=vehicle).select_related(
            "user", "settlement", "edited_by"
        ).order_by("-trip_date")
        fuel_loads = FuelLoad.objects.filter(vehicle=vehicle).select_related(
            "loaded_by"
        ).order_by("-load_date")
        settlements = Settlement.objects.filter(vehicle=vehicle).prefetch_related(
            "details", "details__user", "fuel_load", "fuel_load__loaded_by"
        ).order_by("-created_at")

        payload = {
            "vehicle": VehicleSerializer(vehicle).data,
            "group": GroupSerializer(group).data if group else None,
            "trips": TripSerializer(trips, many=True).data,
            "fuel_loads": FuelLoadSerializer(fuel_loads, many=True).data,
            "settlements": SettlementSerializer(settlements, many=True).data,
        }
        cache.set(cache_key, payload, timeout=services.DASHBOARD_CACHE_TTL)
        return Response(payload)

    def perform_create(self, serializer):
        group = serializer.validated_data["group"]
        membership = get_membership(self.request.user, group)
        if membership is None or membership.role not in ("owner", "admin"):
            raise PermissionDenied("Solo el owner o admin puede crear vehículos")
        serializer.save()

    def perform_update(self, serializer):
        # Editar los datos del vehículo (nombre, combustible, foto, km actuales)
        # es tarea del owner/admin. Los members pueden ver pero no modificar.
        membership = get_membership(
            self.request.user, serializer.instance.group
        )
        if membership is None or membership.role not in ("owner", "admin"):
            raise PermissionDenied(
                "Necesitás ser administrador para modificar los datos del vehículo."
            )
        serializer.save()


class TripViewSet(viewsets.ModelViewSet):
    serializer_class = TripSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "post", "patch", "head", "options"]  # sin delete: no se borran viajes

    def get_queryset(self):
        qs = Trip.objects.filter(
            vehicle__group__members__user=self.request.user,
            vehicle__group__members__is_active=True,
        ).distinct()
        vehicle_id = self.request.query_params.get("vehicle")
        if vehicle_id:
            qs = qs.filter(vehicle_id=vehicle_id)
        return qs.order_by("-trip_date")

    def perform_create(self, serializer):
        trip = serializer.save(user=self.request.user)
        services.assign_and_recalculate_trip(trip)
        services.invalidate_vehicle_dashboard(trip.vehicle_id)

    def perform_update(self, serializer):
        trip = serializer.save(edited_by=self.request.user)
        services.assign_and_recalculate_trip(trip)
        services.invalidate_vehicle_dashboard(trip.vehicle_id)

    def get_permissions(self):
        if self.action in ("update", "partial_update"):
            return [permissions.IsAuthenticated(), CanEditTrip()]
        return [permissions.IsAuthenticated()]


class FuelLoadViewSet(viewsets.ModelViewSet):
    serializer_class = FuelLoadSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        qs = FuelLoad.objects.filter(
            vehicle__group__members__user=self.request.user,
            vehicle__group__members__is_active=True,
        ).distinct()
        vehicle_id = self.request.query_params.get("vehicle")
        if vehicle_id:
            qs = qs.filter(vehicle_id=vehicle_id)
        return qs.order_by("-load_date")

    def perform_create(self, serializer):
        fuel_load = serializer.save(loaded_by=self.request.user)
        services.create_settlement_for_fuel_load(fuel_load)
        services.invalidate_vehicle_dashboard(fuel_load.vehicle_id)
        return fuel_load

    def perform_update(self, serializer):
        fuel_load = serializer.save()
        services.sync_settlement_for_fuel_load(fuel_load)
        services.invalidate_vehicle_dashboard(fuel_load.vehicle_id)
        return fuel_load

    def perform_destroy(self, instance):
        services.delete_settlement_for_fuel_load(instance)
        services.invalidate_vehicle_dashboard(instance.vehicle_id)
        instance.delete()

    def get_permissions(self):
        if self.action in ("update", "partial_update", "destroy"):
            return [permissions.IsAuthenticated(), CanEditFuelLoad()]
        return [permissions.IsAuthenticated()]


class SettlementViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = SettlementSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = Settlement.objects.filter(
            vehicle__group__members__user=self.request.user,
            vehicle__group__members__is_active=True,
        ).distinct()
        vehicle_id = self.request.query_params.get("vehicle")
        if vehicle_id:
            qs = qs.filter(vehicle_id=vehicle_id)
        return qs.order_by("-created_at")

    @action(detail=True, methods=["patch"])
    def mark_status(self, request, pk=None):
        """PATCH /api/settlements/{id}/mark_status/  body: {"status": "pagado"}"""
        settlement = self.get_object()
        membership = get_membership(request.user, settlement.vehicle.group)
        if membership is None or membership.role not in ("owner", "admin"):
            return Response(
                {"detail": "Solo el owner o admin puede cambiar el estado"},
                status=status.HTTP_403_FORBIDDEN,
            )
        new_status = request.data.get("status")
        if new_status not in ("pendiente", "pagado"):
            return Response({"detail": "Estado inválido"}, status=status.HTTP_400_BAD_REQUEST)
        settlement.status = new_status
        settlement.status_updated_by = request.user
        settlement.save()
        services.invalidate_vehicle_dashboard(settlement.vehicle_id)
        return Response(SettlementSerializer(settlement).data)
