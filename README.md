# TaleX Backend

API HTTP de TaleX. Flutter nunca habla con la base: solo llama a esta API. Firebase se queda para login e invitaciones. Lo operativo (empresas, vacantes, candidatos, encuestas) vive en MongoDB.

```
Flutter  →  esta API  →  MongoDB Atlas
         →  Firebase Auth / Functions / Storage
```

## Rutas

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/health` | Ping a MongoDB. Sin token. |
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

## MongoDB

La base es MongoDB Atlas. La variable es `MONGODB_URI`. No va en git.

`GET /health` responde `{"ok":true,"database":"mongodb"}`.

En Vercel (tale-x → talex-backend → Settings → Environment Variables) carga `MONGODB_URI`, `MONGODB_DB=talex`, `FIREBASE_PROJECT_ID` y `FIREBASE_SERVICE_ACCOUNT`. Un push a `main` publica el backend.

Flutter en ese entorno:

```text
--dart-define=TALEX_API_URL=https://talex-backend.vercel.app
```

Los identificadores siguen siendo UUID. Cada tabla SQL quedó como una colección con el mismo nombre. El catálogo de encuestas se siembra al conectar.

## Superadmin

Solo `talex.admin@talex.com.co` (variable `LOCAL_SUPERADMIN_EMAILS`).

## Relación con el frontend

El Flutter web sigue en [talex_platform](https://github.com/TalexTechnology/talex_platform) y se publica por FTP a Colombia Hosting. Este repo es solo el backend.
