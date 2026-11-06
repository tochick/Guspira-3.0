# Guspira Events · plataforma web

> **Demo online:** https://tochick.github.io/Guspira-3.0/ (GitHub Pages, carpeta `docs/`).
> Se abre desde cualquier móvil; guarda los datos en ese navegador y simula Spotify. Contraseña del panel en la demo: `guspira2026`.
>
> Para activarla la primera vez: **Settings → Pages → Build and deployment → Source: «GitHub Actions»** (el flujo `pages.yml` publica la carpeta `docs/`). También funciona «Deploy from a branch» con `main` / `docs`.
> Si cambias el código, regenera la demo con `node demo/build-demo.cjs` y sube también la carpeta `docs/`.

## Novedades de la versión profesional

- **Contacto** (`/contacto`): formulario con tipo de celebración, fecha, invitados y servicios. Los mensajes llegan a **Admin → Mensajes**.
- **Datos de la empresa** (Admin → Ajustes): nombre, razón social, CIF, teléfono, WhatsApp, correo, Instagram, zona y condiciones del presupuesto. Aparecen en el pie, en contacto, en los presupuestos y en el botón flotante de WhatsApp.
- **Resumen del panel**: próximos eventos, canciones por revisar, presupuestos y mensajes nuevos, importes en curso y aceptados, y actividad reciente.
- **Paquetes de pirotecnia** editables (Admin → Catálogo) y **preguntas frecuentes** en la página de pirotecnia.
- **Aceptación online** del presupuesto por parte del cliente, con condiciones y fecha de validez.
- **Privacidad** (`/privacidad`) y casilla de aceptación obligatoria en los formularios. El texto es una plantilla: revísalo con tu asesor.
- Cuenta atrás en la página de cada evento, buscador de peticiones y botón para copiar la lista aprobada para el DJ.

## Pantalla del evento y animaciones

- **Pantalla para proyectar** (botón en la ficha de cada evento): QR gigante, código si lo hay, «Ahora suena», las canciones más pedidas reordenándose en directo y un aviso con chispas cada vez que llega una petición. Pensada para una tele o un proyector en el salón.
- **Ahora suena** para los invitados, con ecualizador animado (se puede desactivar por evento).
- **Animaciones**: logo con pirotecnia, brasas doradas en la portada, marquesina de celebraciones, apariciones al hacer scroll, brillo dorado en títulos y botones, foco de luz en tarjetas, cuenta atrás en directo, corazones al votar, estallidos al enviar o aceptar, totales que cuentan hasta su valor, vista previa animada del espectáculo de pirotecnia y sello de «Aceptado».
- **Ensayo del espectáculo** en la página de pirotecnia: reproduce los efectos elegidos momento a momento (entrada, primer baile…) y termina con fuegos artificiales.
- **Fuegos artificiales** cuando la cuenta atrás del evento llega a cero y cuando una canción se convierte en la nueva número 1 en la pantalla del evento.
- **Colores según la celebración**: rosa y azul en babyshowers, dorado y blanco en bodas, multicolor en cumpleaños y fiestas.
- Separadores dorados art déco que se dibujan, esquinas doradas, títulos que se revelan, destello dorado al cambiar de página, tarjetas con inclinación 3D (ratón), carga con siluetas y casillas y campos animados.
- Todo respeta la opción del sistema «reducir movimiento» y las animaciones se pausan cuando no están en pantalla.

## Herramientas de gestión

- **Agenda** mensual en el resumen del panel con los eventos de canciones y las reservas de pirotecnia (aceptadas y en curso).
- **Disponibilidad** orientativa al elegir fecha en el formulario de pirotecnia (solo cuenta reservas aceptadas, sin datos personales).
- **Guion del espectáculo** en el presupuesto, ordenado por momentos (entrada, primer baile, tarta…).
- **Copiar tabla para Excel** en presupuestos y mensajes, **duplicar eventos** y **compartir por WhatsApp** el enlace del evento.

## Contenido de la portada e idiomas

- **Galería de fotos** (Admin → Contenido): sube fotos arrastrándolas; se optimizan en el navegador y se guardan en `data/gallery`. En la portada aparecen en mosaico («Momentos que brillan») con visor a pantalla completa, flechas, teclado y deslizamiento con el dedo.
- **Opiniones de clientes** (Admin → Contenido): añade solo opiniones reales y con permiso. Se muestran en un carrusel con estrellas. Si no hay fotos u opiniones, esas secciones no aparecen.
- **Español / inglés** en la página del evento y en la pantalla para proyectar (botón ES/EN; por defecto, el idioma del móvil del invitado).

## Puesta en marcha

```bash
cd guspira
cp .env.example .env   # opcional
node server.cjs        # http://127.0.0.1:4321
```

Abre `/admin` la primera vez para crear la contraseña de administración.

## Eventos y accesos

Cada evento se crea en **Admin → Eventos y canciones** y combina dos opciones:

| Visibilidad | Acceso | Resultado |
|---|---|---|
| En portada | Libre | Aparece en la página principal y cualquiera puede pedir canciones. |
| En portada | Con código | Aparece en la portada con candado; se pide el código del evento. |
| Privado | Libre | No aparece en la portada; solo se entra con el enlace secreto o el QR. |
| Privado | Con código | Hace falta el enlace/QR **y** el código. |

En la ficha de cada evento tienes el enlace, el **QR** (descargable en PNG o como tarjeta para imprimir), el botón para regenerar el enlace privado (invalida el anterior) y opciones como máximo de canciones por invitado, ocultar la lista a los invitados, bloquear canciones explícitas o enviar automáticamente a la cola de Spotify al aprobar. Cambiar el código expulsa a quien entró con el código anterior.

## Conectar Spotify (solo con el Client ID)

No hace falta el Client Secret: la conexión usa el método oficial de Spotify para apps sin secreto (OAuth «Authorization Code con PKCE»).

1. Crea una app en <https://developer.spotify.com/dashboard> (marca «Web API»).
2. En «Redirect URIs» añade la dirección que muestra **Admin → Ajustes → Conecta tu Spotify** (`PUBLIC_URL/api/spotify/callback`). Spotify solo admite `https://` o `http://127.0.0.1` (no `localhost`).
3. Pega el **Client ID** (32 caracteres) y pulsa **Guardar Client ID**.
4. En «User Management» de la app, añade el correo de la cuenta de Spotify que vas a conectar (necesario mientras la app esté en modo desarrollo).
5. Pulsa **Conectar Spotify** y autoriza.

Con la cuenta conectada, los invitados buscan canciones (a través de tu cuenta; ellos no necesitan Spotify), puedes mandar las aprobadas a la cola (requiere Premium y Spotify abierto) y **exportar la lista** desde la ficha del evento con **Exportar a Spotify**: eliges qué canciones (aprobadas o también pendientes), si se crea una playlist nueva o se actualiza la del evento, y si es pública. Las canciones escritas a mano se buscan en Spotify automáticamente y te avisa de las que no encuentre.

Si prefieres usar también el Client Secret (opcional), ponlo en la variable `SPOTIFY_CLIENT_SECRET`: entonces la búsqueda de invitados funciona aunque no haya cuenta conectada.

## Pirotecnia

En **Admin → Catálogo pirotecnia** se editan productos, precios, cantidades mínimas y máximas, colores (con recargo), duraciones (multiplican el precio), montaje, kilometraje, IVA y descuentos por volumen. Los precios incluidos son **de ejemplo**. El servidor siempre recalcula el presupuesto con sus propios precios.

Las solicitudes llegan a **Admin → Presupuestos**, donde se cambia su estado (nuevo, contactado, aceptado, descartado), se añaden notas internas y se responde por correo o teléfono.

## Publicación

Necesita un servidor que ejecute Node (VPS, Render, Railway, Fly.io…); no funciona en GitHub Pages porque tiene API y datos. Variables útiles:

- `PUBLIC_URL=https://tudominio.com` (enlaces, QR, cookies seguras y Redirect URI de Spotify)
- `HOST=0.0.0.0`, `PORT` y `TRUST_PROXY=1` si va detrás de un proxy HTTPS
- `GUSPIRA_DATA_DIR` en un disco persistente, y haz copias de `db.json`

## Pruebas

```bash
node test.cjs
```

Prueban de extremo a extremo la API con un Spotify simulado: accesos, códigos, enlaces privados, peticiones, votos, límites, cola, playlist, presupuestos y catálogo.
