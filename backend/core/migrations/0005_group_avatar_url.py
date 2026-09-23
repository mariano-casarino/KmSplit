from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0004_settlement_settlement_vehicle_km_idx"),
    ]

    operations = [
        migrations.AddField(
            model_name="group",
            name="avatar_url",
            field=models.TextField(blank=True, default=""),
        ),
    ]