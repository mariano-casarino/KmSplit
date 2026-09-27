from django.contrib import admin

from .models import (
    FuelLoad,
    Group,
    GroupInvitation,
    GroupMembership,
    Notification,
    Settlement,
    SettlementDetail,
    Trip,
    Vehicle,
)


class GroupMembershipInline(admin.TabularInline):
    model = GroupMembership
    extra = 0


@admin.register(Group)
class GroupAdmin(admin.ModelAdmin):
    list_display = ("name", "invite_code", "created_by", "created_at")
    inlines = [GroupMembershipInline]


@admin.register(GroupInvitation)
class GroupInvitationAdmin(admin.ModelAdmin):
    list_display = ("email", "group", "status", "invited_by", "expires_at")
    list_filter = ("status",)


@admin.register(Vehicle)
class VehicleAdmin(admin.ModelAdmin):
    list_display = ("name", "group", "fuel_type", "current_km", "split_unassigned_km_all_members")
    list_filter = ("group", "fuel_type")


@admin.register(Trip)
class TripAdmin(admin.ModelAdmin):
    list_display = ("vehicle", "user", "trip_date", "start_km", "end_km", "km_traveled", "settlement")
    list_filter = ("vehicle", "user")
    date_hierarchy = "trip_date"


@admin.register(FuelLoad)
class FuelLoadAdmin(admin.ModelAdmin):
    list_display = ("vehicle", "loaded_by", "load_date", "odometer_km", "amount")
    list_filter = ("vehicle",)
    date_hierarchy = "load_date"


class SettlementDetailInline(admin.TabularInline):
    model = SettlementDetail
    extra = 0


@admin.register(Settlement)
class SettlementAdmin(admin.ModelAdmin):
    list_display = (
        "vehicle",
        "period_start_km",
        "period_end_km",
        "total_amount",
        "unassigned_km",
        "status",
    )
    list_filter = ("vehicle", "status")
    inlines = [SettlementDetailInline]


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("recipient", "kind", "actor", "message", "is_read", "created_at")
    list_filter = ("kind", "is_read", "recipient")
