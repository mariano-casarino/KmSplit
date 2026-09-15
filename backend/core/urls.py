from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import FuelLoadViewSet, GroupViewSet, SettlementViewSet, TripViewSet, VehicleViewSet, health_check

router = DefaultRouter()
router.register("groups", GroupViewSet, basename="group")
router.register("vehicles", VehicleViewSet, basename="vehicle")
router.register("trips", TripViewSet, basename="trip")
router.register("fuel-loads", FuelLoadViewSet, basename="fuel-load")
router.register("settlements", SettlementViewSet, basename="settlement")

urlpatterns = [
    path("health/", health_check, name="health"),
    *router.urls,
]
