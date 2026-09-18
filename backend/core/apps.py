from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'core'

    def ready(self):
        # pylint: disable=import-outside-toplevel, unused-import
        from . import signals  # noqa: F401
