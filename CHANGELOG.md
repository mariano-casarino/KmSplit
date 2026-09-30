# Changelog

Todas las novedades relevantes del proyecto, siguiendo el formato de
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el versionado
semántico.

Las fechas son las del tag de cada versión. El detalle fino de cada cambio está
en el historial de Git.

## [No publicado]

### Agregado

- **Mail de bienvenida** para cada usuario nuevo (registro por email o alta con
  Google): agradece, explica los tres pasos para arrancar (crear el grupo,
  cargar viajes y cargas, ver la liquidación) y recuerda los dos extras: la
  campana y poder agregar la app a la pantalla de inicio.
- `FRONTEND_URL` en el backend: los emails arman sus links con la URL pública
  del frontend (en producción, la de Vercel).
- **Comando `recompress_images`** para las fotos que ya están guardadas: las
  vuelve a pasar por los presets (`--dry-run` para ver el ahorro antes de
  tocar nada). También avisa qué foto no se pudo procesar y sigue con las demás.
- El backend **rechaza data URIs de más de 256 KiB**: es el techo que puede
  romper un request, y la causa raíz de que una pantalla de detalle bajara
  ~700 KB.

### Cambiado

- **Las fotos se guardan comprimidas y con tamaño fijo** según para qué se usan:
  avatar 320 px/40 KiB, foto de grupo 480 px/80 KiB, foto de vehículo
  900 px/180 KiB. Antes se guardaba la foto tal cual la sacaba del teléfono y
  viajaba completa dentro de cada respuesta de la API, así que el avatar
  (que viene en `/auth/me`, en el grupo y en cada miembro del dashboard) se
  descargaba una y otra vez en todas las pantallas. Con el recorte, el payload
  del dashboard de un vehículo bajó de ~694 KB a ~90 KB.
- **`ChangeDetectionStrategy.OnPush` en todas las vistas**, con los cálculos
  caros del historial, el resumen y el selector de grupos pasados a `computed`
  (el índice de km sin registrar, los nombres de los miembros, los contadores
  por período y la cantidad de integrantes se calculaban en cada pasada de
  change detection, y el template los pedía varias veces cada una).
- El historial y el resumen dejar de armar dos requests en serie: el grupo se
  encadena al vehículo en un solo `switchMap` en vez de pedirlo recién después
  de que llegara el vehículo.
- El selector de grupos **lee el "último acceso" del `localStorage` una sola
  vez** (hacía un `getItem` + `JSON.parse` por grupo en cada render) y precalcula
  la cantidad de integrantes activos.
- El `avatar` compartido ahora usa inputs de señal: las iniciales y el color
  **se quedaban con los del primer render** aunque cambiaran los datos.
- El dashboard **responde 304 sin cuerpo** si no cambió (ETag + `private,
  no-cache`): al ir del resumen al historial y volver, ya no se descarga el
  payload entero. `private` porque la respuesta es por usuario.
- **Los emails ahora salen en HTML maquetado** (tabla + estilos inline, la
  paleta de la app), no solo en texto plano: el código de recuperación va en
  una caja destacada con el link a la pantalla, y el botón tiene fallback VML
  para Outlook. El texto plano se sigue mandando como respaldo.
- El asunto del mail de recuperación ahora incluye el código, así se ve sin
  abrir el mail.
- Un único punto de envío (`core.mail.send_app_email`) elige Brevo o SMTP y
  **nunca rompe el endpoint**: si el proveedor falla, el alta de usuario o el
  pedido de código se completan igual.

### Corregido

- La pantalla de administration pedía el grupo en un segundo round-trip después
  de recibir el vehículo, dejando el spinner más tiempo del necesario.
- La tab activa de la barra inferior se actualizaba por casualidad (leía
  `router.url`, que no es reactivo); ahora sigue a la navegación.

## [Publicado]

## [1.0.1] — 2026-09-29

### Agregado

- **Documentación**: guía de desarrollo (`DEVELOPMENT.md`), este changelog, el
  esquema relacional como código (`docs/schema.dbml`) y el README al día con el
  stack real, el deploy y las funcionalidades.

### Cambiado

- **La app deja de ser solo mobile**: en pantallas de ≥768px la columna queda
  centrada con marco y sombra, la barra de navegación gana esquinas superiores y
  sombra, y se agrega foco visible para navegar por teclado.

## [1.0.0] — 2026-09-29

Primera versión estable: el circuito completo de la app (registro, viajes,
cargas, liquidaciones, historial y avisos) con la lógica de reparto cerrada y
cubierta por tests.

### Agregado

- **Notificaciones dentro de la app.** Avisos para el resto del grupo cuando
  alguien registra un viaje o una carga.
- **Campana con badge** y polling cada 60 segundos, panel con las 3 últimas,
  "ver todas", marcar leída y marcar todas como leídas.
- **Vista `/notificaciones`** paginada por tandas de 25, con volver y refrescar.
- Cada aviso **abre y resalta el registro exacto** que lo originó (viaje o
  carga). Para los avisos anteriores a la migración `0007`, que no guardaban el
  id, se resuelve por tipo y fecha (`trip@2026-09-01`).
- `Notification.record_id` y `vehicle_id` en la API; la lista acepta
  `limit` (tope 100) y `offset`.
- **Login con Google**: verificación del `id_token` en el backend, vinculación
  por email y sincronización de la foto de Google. En mobile usa el flujo OAuth
  con nonce en vez de Google Identity Services.
- **Recuperación de contraseña** con código de 6 dígitos por email (Brevo).
- **Perfil editable**: nombre, apellido, cambio de contraseña y cierre de
  sesión con confirmación.
- **Fotos**: avatar de perfil, foto del grupo con editor propio y foto del
  vehículo. Los integrantes exponen su foto en el admin y en la liquidación.
- **Apodo opcional** en el registro, visible en toda la app.
- **Respaldo automático a Google Sheets** vía Apps Script (viajes a "Registro",
  cargas a "Resumen semanal"), limitado a un grupo.
- **PWA**: manifest, metadatos e ícono para agregar a la pantalla de inicio en
  iOS.
- Backup a Sheets, recordarme con sesión de 7 días deslizantes y
  auto-redirect al último vehículo al cerrar sesión.
- Historial por km, detección de huecos por solapamiento de rangos, y botón
  "Cargar viaje" con el km inicial precargado en "Km sin registrar".
- Endpoint `/api/health/` con estado de base de datos y Redis (keep-alive).

### Cambiado

- El botón de **guardar una edición** se pone verde durante 1s con el texto
  "Cambio guardado" y recién ahí vuelve a la pantalla desde la que se editaba
  (antes en viajes volvía de inmediato).
- El **perfil vuelve a la pantalla exacta** desde la que se abrió, en lugar de
  caer al selector de grupos.
- El header pasó a un grid `1fr auto 1fr`: el título queda centrado aunque la
  campana y el perfil sean más anchos que el botón de volver, y se recorta con
  "..." en vez de empujar los íconos.
- El selector de grupos ya no muestra la campana (las notificaciones son del
  grupo, no del selector).
- El engranaje de configuración bajó a la fila de datos del vehículo, para dejar
  el header solo con campana y perfil.
- El dashboard consolidado (`/vehicles/{id}/dashboard/`) reemplaza 5 requests
  por uno, con cache en Redis e invalidación automática.
- Sesión persistente en mobile: `SameSite=Lax`, refresh compartido y
  double-write del refresh token para la PWA en iOS.
- Se quitó el throttle global de DRF (2 operaciones de Redis menos por request).
- Los JWT se invalidan en cada deploy (firma atada a `RAILWAY_DEPLOYMENT_ID`).
- Los colores de los gráficos del resumen son los mismos del avatar de cada
  integrante, estables por id de usuario.

### Corregido

- Un formulario inválido ya no hacía nada en silencio: avisa qué campo falta
  (incluida la fecha de la carga, que no tenía mensaje de error).
- Editar un viaje recalcula las liquidaciones que solapan su rango de km.
- El botón de Google siempre termina el flujo (notificaciones de GIS y timeout
  de seguridad).
- El login no falla si la cookie de refresh no se puede setear, y la API se
  sirve desde el mismo origen (proxy `/api` en Vercel) para que funcione en
  móvil.
- El detalle de liquidación abierto desde el resumen vuelve al resumen; el
  historial y el resumen comparten la navegación de registros.
- Se detecta mejor la detección de huecos y el rango de km recorrida.
- Estilos en Safari, ícono de foto del grupo y botones de integrante en
  pantallas angostas.

### Verificación

- 148 tests de backend (pytest) y 85 de frontend (Vitest) en verde.
- Migración `0007_notification_record_id` aplicada en el deploy (el `CMD` del
  `Dockerfile` corre `migrate` antes de gunicorn).

## [0.2.1-beta] — 2026-08-31

### Agregado

- Recuperación de contraseña con código de 6 dígitos y envío por email.
- Recordarme con sesión de 7 días deslizantes y persistencia de sesión en iOS.
- Selector por grupo con abandono robusto, recordar el último vehículo y
  "último acceso" en la lista de grupos.
- Foto del vehículo desde la galería, avatar con la foto del auto y foto en los
  integrantes.
- Permisos de edición en configuración y edición de los km actuales.
- Sección "Liquidación" en la carga con las últimas liquidaciones, editar y
  eliminar la última carga, y confirmación verde al guardar.
- PWA instalable y formato argentino para km y montos.

### Corregido

- Envío de email por API de Brevo (HTTPS) para eludir el bloqueo SMTP de
  Railway, forzado a IPv4 y sin tumbar el endpoint si falla.
- Login con el mismo origen que la API, sesión y estilo de sesión.
- Detección de huecos y rango de km recorrida.

## [0.2.0-beta] — 2026-08-27

### Agregado

- Deploy funcional: variables de entorno, configuración de producción, rutas
  de la API y proxy `/api` en Vercel.
- Seguridad: rate limiting, bloqueo de cuenta, cookies httpOnly y refresh
  token en cookies httpOnly.
- Lógica de liquidación con sus pruebas, formato de km y montos, y detección de
  rangos.

## [0.1.0-alpha] — 2026-08-12

MVP completo y desplegable.

### Agregado

- Modelos de negocio (`accounts` y `core`), admin de Django y endpoints
  probados con Postman.
- Autenticación de usuarios y correlación con los vehículos ya cargados en el
  backend.
- Crear y unirse a un grupo, crear vehículo y panel de administración del
  grupo.
- Menú del vehículo, registro de viaje con atajo de km y registro de carga.
- Resumen con últimos registros y gráfico de uso por integrante.
- Historial semanal y completo, con edición de viaje integrada.
- Detalle de liquidación y botón de volver estilo iOS.
- Tests automáticos de lógica de negocio y permisos de usuarios.

[1.0.1]: https://github.com/mariano-casarino/KmSplit/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/mariano-casarino/KmSplit/compare/v0.2.1-beta...v1.0.0
[0.2.1-beta]: https://github.com/mariano-casarino/KmSplit/compare/v0.2.0-beta...v0.2.1-beta
[0.2.0-beta]: https://github.com/mariano-casarino/KmSplit/compare/v0.1.0-alpha...v0.2.0-beta
[0.1.0-alpha]: https://github.com/mariano-casarino/KmSplit/releases/tag/v0.1.0-alpha
