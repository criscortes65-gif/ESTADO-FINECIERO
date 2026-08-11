# Gestion Financiera

Aplicacion web para el control de finanzas personales, orientada a personas que reciben ingresos de forma periodica (semanal, bisemanal, quincenal o mensual). Permite administrar cuentas bancarias, registrar ingresos y gastos, crear presupuestos por categoria y llevar un control detallado del ahorro por cada ciclo de cobro.

| | |
|---|---|
| **Backend** | Node.js + Express |
| **Base de Datos** | PostgreSQL |
| **Autenticacion** | Email + contrasena propia de la app (JWT en cookie) |
| **Interfaz** | HTML5, CSS3, JavaScript (una sola pagina, sin frameworks) |
| **Graficas** | Chart.js 4.4.1 |

## Funcionalidades Principales

- **Cuentas Bancarias.** Registro de cuentas con saldo, tipo, icono y color personalizable.
- **Ingresos.** Registro de fuentes de ingreso con frecuencia de cobro detectada automaticamente.
- **Gastos y Facturas.** Control de facturas fijas con vencimiento, estado de pago y alertas.
- **Gastos del Periodo.** Al pagar una factura, se copia automaticamente al periodo y alimenta el presupuesto.
- **Presupuesto Doble.** Presupuesto Principal y Presupuesto Negocio, independientes entre si.
- **Sistema de Cobros.** El presupuesto se reinicia con cada cobro y guarda historial de ingreso, gasto y ahorro.
- **Graficas Interactivas.** Pastel de distribucion de gastos y barras comparando Cobro 1, Cobro 2 y Mes.
- **Calculadora Integrada.** Calculadora flotante disponible en toda la aplicacion.
- **Multiusuario con datos privados.** Cada cuenta ve unicamente sus propias cuentas, ingresos, gastos, presupuestos e historial.
- **Gestion de Usuarios.** Un administrador (definido por `ADMIN_EMAIL`) puede ver, crear, activar/desactivar y cambiar el rol de otras cuentas.
- **Modo Demo.** Pantalla de inicio con una cuenta demo compartida y de ejemplo, para explorar la aplicacion sin registrarse.

## Arquitectura

| Componente | Tecnologia |
|---|---|
| Servidor / API REST | Node.js + Express (`server.js`) |
| Base de datos | PostgreSQL (esquema en `schema.sql`, aplicado automaticamente al arrancar) |
| Autenticacion | `bcryptjs` (hash de contrasenas) + `jsonwebtoken` (sesion en cookie httpOnly) |
| Frontend | `public/index.html` — una sola pagina que consume la API REST con `fetch()` |

### Tablas de la base de datos

| Tabla | Contenido |
|---|---|
| `usuarios` | Cuentas de acceso (email, contrasena, rol, activo) |
| `cuentas` | Cuentas bancarias |
| `ingresos` | Fuentes de ingreso |
| `gastos` | Facturas fijas recurrentes |
| `gastos_periodo` | Gastos del ciclo actual |
| `historial_periodo` | Historial de cobros cerrados |
| `presupuestos` | Presupuestos (principal y negocio) |
| `transferencias` | Movimientos entre cuentas |

Cada tabla (excepto `usuarios`) tiene una columna `usuario_id`; todas las consultas del servidor filtran por el usuario de la sesion y las de edicion/borrado exigen que la fila pertenezca a ese usuario, asi que ninguna cuenta puede ver ni modificar los datos de otra.

## Multiusuario y Modo Demo

Al abrir la aplicacion aparece una pantalla de inicio con dos opciones:

- **Ver Demo.** Entra a una cuenta demo compartida (`demo@gestionfinanciera.app`) con datos de ejemplo, sin necesidad de crear una cuenta. Cualquier visitante puede usar el boton "Reiniciar" en el encabezado si otro visitante la dejo desordenada.
- **Entrar con mi cuenta.** Formulario de inicio de sesion / registro con email y contrasena. La sesion se guarda en una cookie httpOnly (30 dias) para no tener que volver a iniciar sesion en cada visita.

## Guia de Instalacion (local)

Requiere Node.js 18+ y PostgreSQL.

1. **Clonar el repositorio e instalar dependencias.**
   ```bash
   npm install
   ```
2. **Crear una base de datos PostgreSQL.** Localmente, o con un proveedor gratuito como [Neon](https://neon.tech) o [Supabase](https://supabase.com) — cualquiera que te de una cadena de conexion `postgres://usuario:password@host:puerto/basededatos` sirve, el codigo no depende de ningun proveedor en particular.
3. **Configurar variables de entorno.** Copiar `.env.example` a `.env` y completar:
   - `DATABASE_URL` — cadena de conexion de PostgreSQL.
   - `JWT_SECRET` — cualquier cadena larga y aleatoria (por ejemplo `openssl rand -hex 32`).
   - `ADMIN_EMAIL` — el email que quieras que sea administrador automaticamente al registrarse.
   - `PORT` — opcional, `3000` por defecto.
4. **Arrancar el servidor.**
   ```bash
   npm start
   ```
   El esquema de la base de datos se crea automaticamente la primera vez que arranca. Abrir `http://localhost:3000`.

## Despliegue

Cualquier hosting que corra Node.js sirve (Render, Railway, Fly.io, un VPS propio, etc.). Pasos generales:

1. Subir el repositorio (sin el archivo `.env` — nunca se commitea, ver `.gitignore`).
2. Configurar las mismas variables de entorno del paso 3 anterior en el panel del hosting (`DATABASE_URL`, `JWT_SECRET`, `ADMIN_EMAIL`, y opcionalmente `PORT`).
3. Comando de arranque: `npm start`.

**Nunca pongas `DATABASE_URL` ni `JWT_SECRET` directamente en el codigo fuente ni los subas a git** — van solo como variables de entorno del hosting. Si alguna vez uno de estos valores se pega en un chat, un commit o un documento, considéralo expuesto y genera uno nuevo.

## Estructura del Proyecto

- `server.js` — Servidor Express: autenticacion, API REST para cuentas/ingresos/gastos/transferencias/presupuestos/usuarios, calculo de resumenes financieros, modo demo.
- `db.js` — Conexion a PostgreSQL y aplicacion automatica de `schema.sql` al arrancar.
- `schema.sql` — Definicion de las tablas.
- `public/index.html` — Interfaz de usuario de una sola pagina (dashboard, cuentas, ingresos, gastos, periodo, presupuesto, transferencias, usuarios) con graficas Chart.js y calculadora flotante.
