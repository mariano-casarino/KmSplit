"""Recomprime las fotos que ya están guardadas en la base.

Las fotos se guardan como data URI base64 y viajan DENTRO de cada respuesta de
la API: el avatar del usuario va en /auth/me, en su grupo y en el dashboard de
cada vehículo. Con la compresión original del frontend (1200px, calidad 0.82),
un /auth/me llegó a pesar 232 KB y el dashboard de un vehículo 694 KB, casi
todo fotos que esa pantalla ni siquiera dibuja. gzip no ayuda: base64 de JPEG
es lo peor que hay para comprimir.

Este comando pasa cada foto por los mismos límites que hoy usa el frontend
(ver frontend/src/app/shared/utils/image.util.ts), así que las fotos viejas
quedan con el mismo tamaño que las nuevas.

Uso:
    python manage.py recompress_images --dry-run   # solo informa
    python manage.py recompress_images            # aplica
"""

import base64
import binascii
import io

from django.core.management.base import BaseCommand

from PIL import Image, ImageOps

# mismo criterio que IMAGE_PRESETS del frontend
PRESETS = {
    "avatar": (320, 72),
    "grupo": (480, 72),
    "vehiculo": (900, 72),
}

# no tiene sentido re-codificar una imagen que ya es chica: cada re-codificación
# es una pérdida de calidad gratis
MIN_SAVING = 0.10

# imágenes que no nos interesa toquetar (no son data URI, son URLs)
SKIP_PREFIXES = ("http://", "https://")


def recompress(data_uri: str, max_size: int, quality: int):
    """Devuelve un data URI JPEG más chico, o None si no se puede/compute."""
    if not data_uri or not data_uri.startswith("data:image/"):
        return None
    header, _, payload = data_uri.partition(",")
    if not payload:
        return None
    try:
        raw = base64.b64decode(payload, validate=False)
    except (binascii.Error, ValueError):
        return None

    try:
        with Image.open(io.BytesIO(raw)) as img:
            # las fotos de celular vienen con EXIF de rotación: sin esto
            # quedan giradas
            img = ImageOps.exif_transpose(img)
            # el alpha se compone sobre blanco: al pasar a JPEG el negro
            # transparente queda negro
            if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
                rgba = img.convert("RGBA")
                fondo = Image.new("RGB", rgba.size, (255, 255, 255))
                fondo.paste(rgba, mask=rgba.split()[-1])
                img = fondo
            else:
                img = img.convert("RGB")

            # thumbnail nunca escala hacia arriba
            img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)

            buffer = io.BytesIO()
            img.save(buffer, format="JPEG", quality=quality, optimize=True, progressive=True)
            encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    except (OSError, ValueError):
        return None

    return f"data:image/jpeg;base64,{encoded}"


class Command(BaseCommand):
    help = "Recomprime las fotos (avatares y fotos de vehículo) guardadas como data URI."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Informa cuánto se ahorraría sin tocar la base.",
        )

    def handle(self, *args, **options):
        from accounts.models import User
        from core.models import Group, Vehicle

        dry_run = options["dry_run"]
        targets = [
            ("avatar de usuario", User.objects.all(), "avatar_url", "avatar"),
            ("avatar de grupo", Group.objects.all(), "avatar_url", "grupo"),
            ("foto de vehículo", Vehicle.objects.all(), "photo_url", "vehiculo"),
        ]

        antes = despues = 0
        reducidas = saltadas = fallidas = 0

        for etiqueta, queryset, campo, preset in targets:
            (max_size, quality) = PRESETS[preset]
            for obj in queryset.only("id", campo):
                actual = getattr(obj, campo) or ""
                if not actual:
                    continue
                if actual.startswith(SKIP_PREFIXES):
                    saltadas += 1
                    continue

                nueva = recompress(actual, max_size, quality)
                if nueva is None:
                    fallidas += 1
                    self.stderr.write(
                        self.style.WARNING(f"  {etiqueta} id={obj.id}: no se pudo leer, se deja como está")
                    )
                    continue

                antes += len(actual)
                if len(nueva) > len(actual) * (1 - MIN_SAVING):
                    # ya está bien liviana
                    despues += len(actual)
                    saltadas += 1
                    continue

                despues += len(nueva)
                reducidas += 1
                if not dry_run:
                    setattr(obj, campo, nueva)
                    obj.save(update_fields=[campo])

        verb = "Se reducirían" if dry_run else "Se redujeron"
        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS(f"{verb} {reducidas} foto(s)."))
        if antes:
            self.stdout.write(
                f"  peso total: {antes:,} B -> {despues:,} B  "
                f"({antes / 1024:.0f} KiB -> {despues / 1024:.0f} KiB, "
                f"{(1 - despues / antes) * 100:.1f}% menos)"
            )
        else:
            self.stdout.write("  no había fotos guardadas.")
        self.stdout.write(f"  sin cambios: {saltadas}   ilegibles: {fallidas}")
        if dry_run and reducidas:
            self.stdout.write(
                self.style.WARNING("Era un --dry-run: nada se guardó. Corré sin la flag para aplicar.")
            )
