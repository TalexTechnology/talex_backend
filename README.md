# TaleX Backend

API HTTP de TaleX. Flutter **nunca** habla con MySQL: solo llama a esta API. Firebase se queda para login e invitaciones. Lo operativo (empresas, vacantes, candidatos, encuestas) vive en MySQL.

```
Flutter  →  esta API  →  MySQL (Colombia Hosting / local)
         →  Firebase Auth / Functions / Storage
```

## Rutas

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/health` | Ping a MySQL. Sin token. |
| `POST` | `/v1/rpc/:nombre` | Casos de uso (sesión, empresas, encuestas). |
| `*` | `/v1/data/:tabla` | Lectura/escritura de tablas con tenancy. |

Todas las rutas salvo `/health` y `OPTIONS` piden `Authorization: Bearer <Firebase ID token>`.

## Local

```bash
cp .env.example .env
npm install
npm run dev
```

La API queda en `http://127.0.0.1:8080`. Flutter local usa `--dart-define=TALEX_API_URL=http://127.0.0.1:8080`.

## Vercel

El handler serverless está en `api/index.js`. Todas las rutas se reescriben ahí.

1. Conecta el repo `TalexTechnology/talex_backend` a Vercel.
2. En **Settings → Environment Variables** carga las mismas claves de `.env.example` (nunca el archivo `.env`).
3. En cPanel → **Remote MySQL** agrega `%`. Las funciones de Vercel cambian de IP.
4. `FIREBASE_SERVICE_ACCOUNT` es el JSON de la service account de Firebase, en una sola línea.
5. Health check: `https://TU-PROYECTO.vercel.app/health` debe devolver `{"ok":true,"database":"mysql"}`.

Flutter en producción:

```text
--dart-define=TALEX_API_URL=https://TU-PROYECTO.vercel.app
```

## Superadmin

Solo `talex.admin@talex.com.co` (variable `LOCAL_SUPERADMIN_EMAILS`).

## Relación con el frontend

El Flutter web sigue en [talex_platform](https://github.com/TalexTechnology/talex_platform) y se publica por FTP a Colombia Hosting. Este repo es solo el backend.
