from rest_framework import serializers

from .models import (
    FuelLoad,
    Group,
    GroupMembership,
    Settlement,
    SettlementDetail,
    Trip,
    Vehicle,
)
from .validators import validate_image_data_uri


class GroupMembershipSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source="user.name", read_only=True)
    user_email = serializers.CharField(source="user.email", read_only=True)

    class Meta:
        model = GroupMembership
        fields = ["id", "user", "user_name", "user_email", "role", "is_active", "joined_at"]
        read_only_fields = ["id", "joined_at", "is_active"]


class GroupSerializer(serializers.ModelSerializer):
    members = GroupMembershipSerializer(many=True, read_only=True)

    class Meta:
        model = Group
        fields = ["id", "name", "invite_code", "created_by", "created_at", "members"]
        read_only_fields = ["id", "invite_code", "created_by", "created_at"]

    def create(self, validated_data):
        user = self.context["request"].user
        group = Group.objects.create(created_by=user, **validated_data)
        # quien crea el grupo queda como owner automáticamente
        GroupMembership.objects.create(group=group, user=user, role="owner")
        return group


class JoinGroupSerializer(serializers.Serializer):
    invite_code = serializers.CharField()

    def validate_invite_code(self, value):
        try:
            self.group = Group.objects.get(invite_code=value)
        except Group.DoesNotExist:
            raise serializers.ValidationError("Código de invitación inválido")
        return value


class VehicleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Vehicle
        fields = [
            "id", "group", "name", "fuel_type", "photo_url",
            "current_km", "split_unassigned_km_all_members", "created_at",
        ]
        read_only_fields = ["id", "created_at"]

    def validate_photo_url(self, value):
        """La foto del vehículo se guarda como data URI (base64). Vacío = sin
        foto. La validación vive en core.validators (se comparte con el avatar
        de perfil del usuario)."""
        return validate_image_data_uri(value)


class TripSerializer(serializers.ModelSerializer):
    class Meta:
        model = Trip
        fields = [
            "id", "vehicle", "user", "settlement", "trip_date",
            "start_km", "end_km", "km_traveled", "edited_by",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "user", "km_traveled", "settlement", "edited_by", "created_at", "updated_at"]

    def validate(self, data):
        vehicle = data.get("vehicle", getattr(self.instance, "vehicle", None))
        start_km = data.get("start_km", getattr(self.instance, "start_km", None))
        end_km = data.get("end_km", getattr(self.instance, "end_km", None))

        if start_km is not None and end_km is not None and end_km <= start_km:
            raise serializers.ValidationError("El km final debe ser mayor al km inicial")

        if vehicle and start_km is not None and end_km is not None:
            overlapping = Trip.objects.filter(
                vehicle=vehicle, start_km__lt=end_km, end_km__gt=start_km
            )
            if self.instance:
                overlapping = overlapping.exclude(pk=self.instance.pk)
            conflict = overlapping.select_related("user").first()
            if conflict:
                raise serializers.ValidationError(
                    f"Los km se superponen con un viaje de {conflict.user.name}"
                    f"({conflict.start_km}-{conflict.end_km} km). Revisá el historial."
                )
        
        return data


class FuelLoadSerializer(serializers.ModelSerializer):
    class Meta:
        model = FuelLoad
        fields = ["id", "vehicle", "loaded_by", "load_date", "odometer_km", "amount", "liters", "created_at"]
        read_only_fields = ["id", "loaded_by", "created_at"]

    def validate_odometer_km(self, value):
        """El odómetro de una carga nunca puede ir en retroceso.

        Al crear, la referencia es vehicle.current_km (el último checkpoint), así
        que el km debe ser mayor. Al editar la ÚLTIMA carga, la referencia pasa a
        ser el km de INICIO de su liquidación (period_start_km): así se permite
        mantener el mismo odómetro (al tocar solo el monto, por ejemplo) pero se
        sigue rechazando que baje por debajo del checkpoint previo a esa carga."""
        if value is None:
            return value

        vehicle = None
        if self.instance is not None:
            vehicle = self.instance.vehicle
        else:
            vehicle_id = self.initial_data.get("vehicle")
            if vehicle_id:
                vehicle = Vehicle.objects.filter(id=vehicle_id).first()

        if vehicle is None:
            return value

        base_km = vehicle.current_km
        message = f"El km del odómetro debe ser mayor al último registro ({base_km} km)."

        if self.instance is not None:
            settlement = Settlement.objects.filter(fuel_load=self.instance).first()
            if settlement is not None:
                base_km = settlement.period_start_km
                message = (
                    f"El km del odómetro no puede ser menor ni igual al inicio de "
                    f"esta liquidación ({base_km} km)."
                )

        if value <= base_km:
            raise serializers.ValidationError(message)
        return value


class SettlementDetailSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source="user.name", read_only=True)

    class Meta:
        model = SettlementDetail
        fields = [
            "id", "user", "user_name", "registered_km",
            "unassigned_km_share", "km_driven", "percentage", "amount_owed",
        ]


class SettlementSerializer(serializers.ModelSerializer):
    details = SettlementDetailSerializer(many=True, read_only=True)
    load_date = serializers.DateField(source="fuel_load.load_date", read_only=True)
    loaded_by_name = serializers.CharField(source="fuel_load.loaded_by.name", read_only=True)

    class Meta:
        model = Settlement
        fields = [
            "id", "vehicle", "fuel_load", "period_start_km", "period_end_km",
            "total_amount", "unassigned_km", "status", "status_updated_by",
            "created_at", "load_date", "loaded_by_name", "details",
        ]
        read_only_fields = fields
