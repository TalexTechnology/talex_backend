# TaleX Backend

API HTTP de TaleX. Flutter **nunca** habla con la base de datos: solo llama a esta API. Firebase se queda para login e invitaciones. Lo operativo (empresas, vacantes, candidatos, encuestas, leads) vive en MongoDB Atlas.

```
Flutter  →  esta API (Vercel)  →  MongoDB Atlas
         →  Firebase Auth / Functions / Storage
```

Producción: `https://talex-backend.vercel.app`. Flutter en `platform.talex.com.co` ya apunta ahí (`TALEX_API_URL`).

## Rutas

| Método | Ruta | Qué hace |
|---|---|---|
<<<<<<< Updated upstream
| `GET` | `/health` | Ping a MongoDB. Sin token. |
=======
| `GET` | `/health` | Ping a MongoDB Atlas. Sin token. |
| `POST` | `/api/mi-cultura` | Guarda un lead, crea la empresa prospecto y envía el correo con el link de cultura. Sin token. |
| `GET` | `/cultura/:orgId` | Redirige a `platform.talex.com.co/cultura/:orgId`. Sin token. |
| `GET`/`POST` | `/api/cultura/:orgId` | Banco y respuestas de esa empresa. Sin token. |
| `POST` | `/v1/rpc/:nombre` | Casos de uso (sesión, empresas, encuestas). |
| `*` | `/v1/data/:tabla` | Lectura/escritura de colecciones con tenancy. |

Todas las rutas salvo `/health`, `POST /api/mi-cultura` y `OPTIONS` piden `Authorization: Bearer <Firebase ID token>`. Los leads se listan en `GET /v1/data/culture_leads` (solo superadmin).

## Local
```bash
cp .env.example .env
npm install
npm run dev
```

La API queda en `http://127.0.0.1:8080`. Flutter local usa `--dart-define=TALEX_API_URL=http://127.0.0.1:8080`.

<<<<<<< Updated upstream
## MongoDB

La base es MongoDB Atlas. La variable es `MONGODB_URI`. No va en git.

`GET /health` responde `{"ok":true,"database":"mongodb"}`.

En Vercel (tale-x → talex-backend → Settings → Environment Variables) carga `MONGODB_URI`, `MONGODB_DB=talex`, `FIREBASE_PROJECT_ID` y `FIREBASE_SERVICE_ACCOUNT`. Un push a `main` publica el backend.
=======
Variables locales (las mismas de Vercel Production, nunca hardcodeadas):

`MONGODB_URI`, `MONGODB_DB=talex`, `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT`, `LOCAL_SUPERADMIN_EMAILS`.

La landing `/micultura` llama a `POST /api/mi-cultura` sin login. Para probarla en local:

```bash
curl -X POST http://127.0.0.1:8080/api/mi-cultura ^
  -H "Content-Type: application/json" ^
  -d "{\"nombreEmpresa\":\"Empresa Demo\",\"rangoEmpleados\":\"11 – 50\",\"culturaPercibida\":[\"Colaborativa\"],\"comentarioCultura\":\"\",\"correo\":\"demo@empresa.com\",\"consentimiento\":{\"aceptaTerminosYPolitica\":true,\"autorizaTratamientoDatos\":true},\"origen\":{\"utmSource\":\"web\",\"utmMedium\":\"landing\"}}"
```

## Vercel

La API de producción corre en Vercel. Variables en Production (nunca el archivo `.env`):

`MONGODB_URI`, `MONGODB_DB=talex`, `FIREBASE_PROJECT_ID=talex-platform`, `FIREBASE_SERVICE_ACCOUNT` (JSON en una sola línea), `LOCAL_SUPERADMIN_EMAILS`, `PUBLIC_SURVEY_BASE=https://platform.talex.com.co`.

Health check: `https://talex-backend.vercel.app/health` debe devolver `{"ok":true,"database":"mongodb"}`.
>>>>>>> Stashed changes

Flutter en ese entorno:

```text
--dart-define=TALEX_API_URL=https://talex-backend.vercel.app
```

Los identificadores siguen siendo UUID. Cada tabla SQL quedó como una colección con el mismo nombre. El catálogo de encuestas se siembra al conectar.

## Superadmin

Solo `talex.admin@talex.com.co` (variable `LOCAL_SUPERADMIN_EMAILS`).

## Relación con el frontend

El Flutter web sigue en [talex_platform](https://github.com/TalexTechnology/talex_platform) y se publica por FTP a Colombia Hosting. Este repo es solo el backend.
