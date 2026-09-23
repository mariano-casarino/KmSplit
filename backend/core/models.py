import uuid

from django.conf import settings
from django.db import models


def generate_invite_code():
    """Código corto para unirse a un grupo (ej: 'A3F91B2C')."""
    return uuid.uuid4().hex[:8].upper()


class Group(models.Model):
    """
    Un grupo familiar/empresarial que comparte uno o más vehículos.
    Nota: no confundir con django.contrib.auth.models.Group (grupos de permisos
    de Django, que aparecen aparte en el admin) — este es nuestro modelo de negocio.
    """

    name = models.CharField(max_length=150)
    # Foto del grupo como data URI (base64), igual que el avatar del usuario y
    # la foto del vehículo. Vacío = sin foto: la app muestra las iniciales+color.
    avatar_url = models.TextField(blank=True, default="")
    invite_code = models.CharField(max_length=12, unique=True, default=generate_invite_code)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="groups_created"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class GroupInvitation(models.Model):
    STATUS_CHOICES = [
        ("pendiente", "Pendiente"),
        ("aceptada", "Aceptada"),
        ("expirada", "Expirada"),
    ]

    group = models.ForeignKey(Group, on_delete=models.CASCADE, related_name="invitations")
    email = models.EmailField()
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="invitations_sent"
    )
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="pendiente")
    token = models.CharField(max_length=64, unique=True, default=uuid.uuid4)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    def __str__(self):
        return f"Invitación a {self.email} - {self.group.name}"


class GroupMembership(models.Model):
    ROLE_CHOICES = [
        ("owner", "Owner"),
        ("admin", "Admin"),
        ("member", "Member"),
    ]

    group = models.ForeignKey(Group, on_delete=models.CASCADE, related_name="members")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="memberships"
    )
    role = models.CharField(max_length=10, choices=ROLE_CHOICES, default="member")
    is_active = models.BooleanField(
        default=True, help_text="False = removido del grupo, se conserva para trazabilidad"
    )
    joined_at = models.DateTimeField(auto_now_add=True)
    removed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["group", "user"], name="unique_group_user")
        ]

    def __str__(self):
        return f"{self.user} en {self.group} ({self.role})"


class Vehicle(models.Model):
    FUEL_TYPE_CHOICES = [
        ("nafta", "Nafta"),
        ("diesel", "Diésel"),
        ("gnc", "GNC"),
        ("electrico", "Eléctrico"),
    ]

    group = models.ForeignKey(Group, on_delete=models.CASCADE, related_name="vehicles")
    name = models.CharField(max_length=150)
    fuel_type = models.CharField(max_length=20, choices=FUEL_TYPE_CHOICES, blank=True)
    photo_url = models.TextField(blank=True)
    current_km = models.PositiveIntegerField(
        default=0, help_text="Cache del último km conocido, base para el atajo de 3 dígitos"
    )
    split_unassigned_km_all_members = models.BooleanField(
        default=True,
        help_text=(
            "True = reparte los km sin asignar entre todos los miembros activos. "
            "False = solo entre quienes registraron km en ese período."
        ),
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class FuelLoad(models.Model):
    vehicle = models.ForeignKey(Vehicle, on_delete=models.CASCADE, related_name="fuel_loads")
    loaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="fuel_loads"
    )
    load_date = models.DateField()
    odometer_km = models.PositiveIntegerField()
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    liters = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["vehicle", "load_date"])]

    def __str__(self):
        return f"Carga {self.vehicle.name} - {self.load_date} - ${self.amount}"


class Settlement(models.Model):
    """
    Liquidación disparada por una carga de combustible: reparte el gasto
    entre los integrantes según km recorridos en ese período.
    """

    STATUS_CHOICES = [
        ("pendiente", "Pendiente"),
        ("pagado", "Pagado"),
    ]

    vehicle = models.ForeignKey(Vehicle, on_delete=models.CASCADE, related_name="settlements")
    fuel_load = models.OneToOneField(
        FuelLoad,
        on_delete=models.PROTECT,
        related_name="settlement",
        help_text="Cada carga dispara exactamente una liquidación",
    )
    period_start_km = models.PositiveIntegerField()
    period_end_km = models.PositiveIntegerField()
    total_amount = models.DecimalField(max_digits=12, decimal_places=2)
    unassigned_km = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="pendiente")
    status_updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="settlements_updated",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(
                fields=["vehicle", "period_start_km", "period_end_km"],
                name="settlement_vehicle_km_idx",
            )
        ]

    def __str__(self):
        return f"Liquidación {self.vehicle.name} ({self.period_start_km}-{self.period_end_km} km)"


class Trip(models.Model):
    vehicle = models.ForeignKey(Vehicle, on_delete=models.CASCADE, related_name="trips")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="trips"
    )
    settlement = models.ForeignKey(
        Settlement,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="trips",
        help_text="Null hasta que se liquide el período al que pertenece",
    )
    trip_date = models.DateField()
    start_km = models.PositiveIntegerField()
    end_km = models.PositiveIntegerField()
    km_traveled = models.PositiveIntegerField(editable=False)
    edited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="trips_edited",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["vehicle", "trip_date"]),
            models.Index(fields=["vehicle", "start_km", "end_km"]),
        ]

    def save(self, *args, **kwargs):
        self.km_traveled = self.end_km - self.start_km
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.user} - {self.trip_date} - {self.km_traveled} km"


class SettlementDetail(models.Model):
    settlement = models.ForeignKey(Settlement, on_delete=models.CASCADE, related_name="details")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="settlement_details"
    )
    registered_km = models.PositiveIntegerField(help_text="Km que esa persona realmente cargó")
    unassigned_km_share = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        default=0,
        help_text='Porción de km sin asignar repartida equitativamente (puede tener decimales)',
    )
    km_driven = models.DecimalField(
        max_digits=8, decimal_places=2, editable=False,
        help_text= 'registered_km + unassigned_km_share, usado para el %. Lo calcula core/services.py'
    )
    percentage = models.DecimalField(max_digits=5, decimal_places=2)
    amount_owed = models.DecimalField(max_digits=12, decimal_places=2)

    def __str__(self):
        return f"{self.user} debe ${self.amount_owed} en {self.settlement}"
