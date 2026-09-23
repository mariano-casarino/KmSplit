from django.db import migrations


def backfill_first_name(apps, schema_editor):
    """Los usuarios creados antes del campo first_name guardaron su nombre real
    en 'name'. Recuperamos ese valor como first_name si está vacío."""
    User = apps.get_model("accounts", "User")
    for user in User.objects.filter(first_name="").exclude(name=""):
        user.first_name = user.name
        user.save(update_fields=["first_name"])


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0005_user_avatar_url"),
    ]

    operations = [
        migrations.RunPython(backfill_first_name, migrations.RunPython.noop),
    ]