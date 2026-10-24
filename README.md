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

## cPanel (Colombia Hosting)

La API corre en el mismo servidor que MySQL. `MYSQL_HOST` es `127.0.0.1`. No hace falta Remote MySQL ni el comodín `%`.

La rama que el servidor ejecuta se llama `cpanel-live`. GitHub Actions la actualiza así:

- Un push a `main` publica `main`.
- Un pull request hacia `main` publica ese pull request.
- Al cerrar el pull request sin merge, la API vuelve a `main`.

cPanel tiene que seguir la rama `cpanel-live` y ejecutar `.cpanel.yml` en cada pull. Ese script copia el código a `~/talex-backend`, instala dependencias con el Node de cPanel y reinicia la app.

En **Setup Node.js App**, una sola vez:

| Campo | Valor |
|---|---|
| Node | 20 |
| Application root | `talex-backend` |
| Application startup file | `app.js` |
| Application URL | un subdominio propio, por ejemplo `api.talex.com.co` |

Variables de entorno (las mismas claves de `.env.example`, nunca el archivo `.env`):

`MYSQL_HOST=127.0.0.1`, `MYSQL_PORT=3306`, `MYSQL_DATABASE=talexcom_talex`, `MYSQL_USER=talexcom_talex_user`, `MYSQL_PASSWORD`, `FIREBASE_PROJECT_ID=talex-platform`, `FIREBASE_SERVICE_ACCOUNT` (el JSON en una sola línea).

Health check: `https://api.talex.com.co/health` debe devolver `{"ok":true,"database":"mysql"}`.

Flutter en ese entorno:

```text
--dart-define=TALEX_API_URL=https://api.talex.com.co
```

## Superadmin

Solo `talex.admin@talex.com.co` (variable `LOCAL_SUPERADMIN_EMAILS`).

## Relación con el frontend

El Flutter web sigue en [talex_platform](https://github.com/TalexTechnology/talex_platform) y se publica por FTP a Colombia Hosting. Este repo es solo el backend.
