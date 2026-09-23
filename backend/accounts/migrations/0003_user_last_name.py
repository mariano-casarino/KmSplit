from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0002_passwordreset"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="last_name",
            field=models.CharField(blank=True, default="", max_length=150),
        ),
    ]