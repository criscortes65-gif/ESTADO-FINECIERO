-- Gestion Financiera - esquema de base de datos (PostgreSQL)
-- Se aplica automaticamente al arrancar el servidor (ver db.js), asi que
-- normalmente no hace falta ejecutarlo a mano.

CREATE TABLE IF NOT EXISTS usuarios (
  id             SERIAL PRIMARY KEY,
  email          TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  nombre         TEXT NOT NULL,
  rol            TEXT NOT NULL DEFAULT 'cliente', -- 'admin' | 'cliente' | 'demo'
  activo         BOOLEAN NOT NULL DEFAULT TRUE,
  fecha_registro TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cuentas (
  id              SERIAL PRIMARY KEY,
  usuario_id      INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nombre          TEXT NOT NULL,
  saldo           NUMERIC(14,2) NOT NULL DEFAULT 0,
  icono           TEXT NOT NULL DEFAULT '🏦',
  color           TEXT NOT NULL DEFAULT '#4f46e5',
  tipo            TEXT NOT NULL DEFAULT 'corriente',
  notas           TEXT NOT NULL DEFAULT '',
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  fecha_creacion  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ingresos (
  id                 SERIAL PRIMARY KEY,
  usuario_id         INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nombre             TEXT NOT NULL,
  monto              NUMERIC(14,2) NOT NULL DEFAULT 0,
  frecuencia         TEXT NOT NULL DEFAULT 'Mensual',
  dia_cobro          INTEGER NOT NULL DEFAULT 1,
  cuenta_destino_id  INTEGER REFERENCES cuentas(id) ON DELETE SET NULL,
  activo_recurrente  BOOLEAN NOT NULL DEFAULT TRUE,
  notas              TEXT NOT NULL DEFAULT '',
  activo             BOOLEAN NOT NULL DEFAULT TRUE,
  fecha_creacion     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gastos (
  id              SERIAL PRIMARY KEY,
  usuario_id      INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nombre          TEXT NOT NULL,
  monto           NUMERIC(14,2) NOT NULL DEFAULT 0,
  dia_vence       INTEGER NOT NULL DEFAULT 1,
  categoria       TEXT NOT NULL DEFAULT 'Otros',
  cuenta_id       INTEGER REFERENCES cuentas(id) ON DELETE SET NULL,
  pagado          BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_pago      DATE,
  recurrente      BOOLEAN NOT NULL DEFAULT TRUE,
  notas           TEXT NOT NULL DEFAULT '',
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  fecha_creacion  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gastos_periodo (
  id              SERIAL PRIMARY KEY,
  usuario_id      INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  gasto_id        INTEGER REFERENCES gastos(id) ON DELETE SET NULL,
  nombre          TEXT NOT NULL,
  monto           NUMERIC(14,2) NOT NULL DEFAULT 0,
  categoria       TEXT NOT NULL DEFAULT 'Otros',
  cuenta_id       INTEGER REFERENCES cuentas(id) ON DELETE SET NULL,
  notas           TEXT NOT NULL DEFAULT '',
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_creacion  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS historial_periodo (
  id               SERIAL PRIMARY KEY,
  usuario_id       INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  fecha_inicio     DATE NOT NULL,
  fecha_fin        DATE NOT NULL,
  total            NUMERIC(14,2) NOT NULL DEFAULT 0,
  cantidad_gastos  INTEGER NOT NULL DEFAULT 0,
  por_categoria    JSONB NOT NULL DEFAULT '{}',
  ingreso_cobro    NUMERIC(14,2) NOT NULL DEFAULT 0,
  ahorro           NUMERIC(14,2) NOT NULL DEFAULT 0,
  numero_cobro     INTEGER NOT NULL DEFAULT 1,
  fecha_cierre     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS presupuestos (
  id              SERIAL PRIMARY KEY,
  usuario_id      INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  categoria       TEXT NOT NULL,
  monto           NUMERIC(14,2) NOT NULL DEFAULT 0,
  tipo            TEXT NOT NULL DEFAULT 'main', -- 'main' | 'negocio'
  fecha_creacion  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (usuario_id, categoria, tipo)
);

CREATE TABLE IF NOT EXISTS transferencias (
  id                SERIAL PRIMARY KEY,
  usuario_id        INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  fecha             DATE NOT NULL DEFAULT CURRENT_DATE,
  tipo              TEXT NOT NULL, -- 'ingreso' | 'gasto' | 'transferencia'
  desde_cuenta_id   INTEGER REFERENCES cuentas(id) ON DELETE SET NULL,
  hacia_cuenta_id   INTEGER REFERENCES cuentas(id) ON DELETE SET NULL,
  monto             NUMERIC(14,2) NOT NULL DEFAULT 0,
  categoria         TEXT NOT NULL DEFAULT '',
  descripcion       TEXT NOT NULL DEFAULT '',
  referencia_id     INTEGER,
  fecha_registro    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cuentas_usuario           ON cuentas(usuario_id);
CREATE INDEX IF NOT EXISTS idx_ingresos_usuario           ON ingresos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_gastos_usuario              ON gastos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_gastos_periodo_usuario       ON gastos_periodo(usuario_id);
CREATE INDEX IF NOT EXISTS idx_historial_periodo_usuario    ON historial_periodo(usuario_id);
CREATE INDEX IF NOT EXISTS idx_presupuestos_usuario          ON presupuestos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_transferencias_usuario        ON transferencias(usuario_id);
