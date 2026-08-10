# Gestion Financiera

Aplicacion web para el control de finanzas personales, orientada a personas que reciben ingresos de forma periodica (semanal, bisemanal, quincenal o mensual). Permite administrar cuentas bancarias, registrar ingresos y gastos, crear presupuestos por categoria y llevar un control detallado del ahorro por cada ciclo de cobro.

El sistema se adapta automaticamente a la frecuencia de cobro del usuario y ofrece un historial completo de cada periodo, permitiendo visualizar cuanto se gasta y cuanto se ahorra en cada cobro.

| | |
|---|---|
| **Plataforma** | Google Apps Script + Firebase Firestore |
| **Tipo** | Aplicacion Web Full-Stack |
| **Base de Datos** | Firebase Firestore (NoSQL) |
| **Autenticacion** | Google Sheets + OAuth2 |
| **Interfaz** | HTML5, CSS3, JavaScript |
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
- **Gestion de Usuarios.** Roles Administrador y Cliente gestionados por Google Sheets.
- **Multiusuario con datos privados.** Cada cuenta (cliente o admin) solo ve sus propias cuentas, ingresos, gastos, presupuestos e historial — nunca los de otro usuario.
- **Modo Demo.** Pantalla de inicio con una cuenta demo compartida y de ejemplo, para explorar la aplicacion antes de iniciar sesion con tu cuenta real.

## Multiusuario y Modo Demo

Cada documento de Firestore (cuentas, ingresos, gastos, gastos del periodo, historial, presupuestos, transferencias) queda marcado con el campo `usuario_id` del dueño. Todas las funciones de lectura filtran por ese campo y las de edicion/borrado verifican la propiedad antes de aplicar el cambio, asi que ninguna cuenta puede ver ni modificar los datos de otra.

Al abrir la aplicacion aparece primero una pantalla de inicio con dos opciones:

- **Ver Demo.** Entra a una cuenta demo compartida (`demo@gestionfinanciera.app`) con datos de ejemplo, sin necesidad de iniciar sesion. Cualquier visitante puede usar el boton "Reiniciar Demo" en el encabezado si otro visitante la dejo desordenada.
- **Entrar con mi cuenta.** Continua con el flujo normal (Google + hoja de Usuarios) hacia los datos privados de esa cuenta.

## Arquitectura del Sistema

| Componente | Tecnologia | Funcion |
|---|---|---|
| Frontend | HTML/CSS/JS | Interfaz de usuario |
| Backend | Google Apps Script | Logica de negocio |
| Base de Datos | Firebase Firestore | Almacenamiento de datos |
| Autenticacion | Google Sheets + OAuth2 | Control de usuarios |
| Graficas | Chart.js | Visualizacion de datos |

### Colecciones de Base de Datos (Firestore)

| Coleccion | Contenido |
|---|---|
| `cuentas` | Cuentas bancarias |
| `ingresos` | Fuentes de ingreso |
| `gastos` | Facturas fijas recurrentes |
| `gastos_periodo` | Gastos del ciclo actual |
| `historial_periodo` | Historial de cobros cerrados |
| `presupuestos` | Presupuestos (principal y negocio) |
| `transferencias` | Movimientos entre cuentas |
| `categorias` | Categorias de gastos |

## Flujo de Trabajo del Sistema

1. **Registro de Ingreso.** El usuario registra su ingreso con monto y frecuencia. La app detecta cuantos cobros habra por mes.
2. **Registro de Facturas.** Se registran las facturas fijas con fecha de vencimiento y monto.
3. **Pago de Facturas.** Al marcar una factura como pagada, se copia a Gastos del Periodo y se descuenta del saldo.
4. **Presupuesto.** Los gastos del periodo alimentan el presupuesto por categoria.
5. **Registrar Cobro.** Al nuevo cobro, el sistema guarda el periodo en historial (ingreso, gasto, ahorro) y reinicia el presupuesto.
6. **Analisis.** El historial y las graficas comparan Cobro 1, Cobro 2 y el mes completo.

## Guia de Instalacion

1. **Crear proyecto en Google Apps Script.** Ir a [script.google.com](https://script.google.com) y crear un nuevo proyecto.
2. **Crear proyecto en Firebase.** Ir a [console.firebase.google.com](https://console.firebase.google.com), crear un proyecto y activar Firestore Database.
3. **Generar credenciales.** En Firebase: *Configuracion del proyecto > Cuentas de servicio > Generar nueva clave privada*. Se descarga un archivo JSON.
4. **Configurar `Code.gs`.** Copiar el codigo de `Code.gs` y completar los datos del `CONFIG` con: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (del JSON), `USERS_SPREADSHEET_ID` y `ADMIN_EMAIL`.
5. **Agregar libreria OAuth2.** En el editor: *Bibliotecas > agregar el ID* `1B7FSrk5Zi6L1rSxxTDgDEUsPzlukDsi4KGuTMorsTQHhGBzBkMun4iDF`.
6. **Crear `Index.html`.** Crear un archivo HTML llamado `Index` y pegar el codigo de `Index.html`.
7. **Desplegar como Web App.** *Implementar > Nueva implementacion > Aplicacion web*. Configurar acceso y copiar la URL.
8. **Inicializar.** Abrir la URL y presionar el boton de configuracion para inicializar la hoja de usuarios.

## Estructura del Proyecto

- `Code.gs` — Backend en Google Apps Script: autenticacion via Google Sheets, CRUD de cuentas/ingresos/gastos/transferencias/presupuestos contra Firebase Firestore (via cuenta de servicio OAuth2), calculo de resumenes financieros y manejo de periodos de cobro.
- `Index.html` — Interfaz de usuario de una sola pagina (dashboard, cuentas, ingresos, gastos, periodo, presupuesto, transferencias, usuarios) con graficas Chart.js y calculadora flotante.
