# FL Liga Mobile (iOS + Android)

Aplicación móvil multiplataforma para usuarios finales con enfoque en:

- Ver ligas públicas por cliente
- Ver fixture por categoría
- Ver partidos y marcador en vivo
- Recibir actualizaciones en tiempo real vía `socket.io`
- Ver eventos y tabla de goles
- Ver pestaña de `Highlights` (videos de jugadas/goles)

## Stack usado (moderno y rápido)

- Expo SDK 55 + React Native 0.83 + TypeScript
- React Query para caché/estado remoto
- Socket.IO Client para realtime

## Configuración

1. Instalar dependencias:

```bash
npm install
```

2. Configurar URL del backend (obligatorio para preview/production):

```bash
EXPO_PUBLIC_API_URL=https://fl-liga-backend.onrender.com
```

Opcional para habilitar el botón de descarga Android dentro de la app:

```bash
EXPO_PUBLIC_ANDROID_APK_URL=https://tu-dominio.com/android/fl-liga.apk
```

> Si no defines variable, usa fallback:
> - Android emulador: `http://10.0.2.2:4000`
> - iOS simulador: `http://localhost:4000`

### Importante sobre MongoDB

- La app **NO** se conecta directo a MongoDB.
- La app se conecta al **backend** (`HTTP + Socket.IO`), y ese backend es quien lee/escribe en Mongo.
- Esto es lo correcto para seguridad, escalabilidad y control de permisos.

3. Ejecutar app:

```bash
npm run start
npm run android
npm run ios
```

## Realtime

El móvil escucha `live:update` contra el mismo backend que usa web. Si admin/super admin actualizan live en web, el mobile se refresca en segundos automáticamente.

## Highlights de video

Se habilitó consumo público de `highlightVideos` en el endpoint de fixture público para que web/mobile puedan mostrarlos.

### Próximo paso recomendado

Crear una pestaña dedicada en Admin (web) para cargar highlights por partido (no solo desde historial), con:

- Validación de formato y tamaño
- Etiqueta por tipo (`Gol`, `Atajada`, `Jugada`)
- Orden manual de videos
- Publicado/oculto para portal público

## Roadmap sugerido (alto tráfico)

1. Paginación y lazy loading de eventos
2. Compresión de imágenes/logos
3. EAS Build + perfiles `preview` y `production`
4. Crash/Error monitoring (Sentry)
5. CDN para videos (Cloudflare R2 / Mux / Cloudinary)
6. Push notifications para goles

## EAS Build (iOS/Android)

Archivo listo: `eas.json` con perfiles:

- `development`: cliente dev interno
- `preview`: build interna para QA
- `production`: build de tienda

Comandos:

```bash
npx eas login
npx eas build --platform android --profile preview
npx eas build --platform ios --profile preview
npx eas build --platform android --profile production
npx eas build --platform ios --profile production
```

## Carpeta para APK Android

Se dejó preparada la carpeta local:

- android-builds/

Úsala para guardar temporalmente los archivos generados como:

- fl-liga-preview.apk
- fl-liga-production.apk
