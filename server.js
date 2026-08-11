require('dotenv').config();

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool, ensureSchema } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('Falta la variable de entorno JWT_SECRET.');
}
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase();
const DEMO_EMAIL = 'demo@gestionfinanciera.app';
const DEMO_NOMBRE = 'Cuenta Demo';

const CATEGORIAS_DEFECTO = [
  'Vivienda', 'Servicios', 'Alimentacion', 'Transporte',
  'Salud', 'Entretenimiento', 'Educacion', 'Ahorro',
  'Tarjetas', 'Prestamos', 'Telefono', 'Internet', 'Otros'
];

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
//  HELPERS
// ============================================================
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}

function setAuthCookie(res, payload) {
  res.cookie('token', signToken(payload), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
}

function toProfile(u) {
  return {
    id: u.id,
    email: u.email,
    nombre: u.nombre,
    rol: u.rol,
    isAdmin: u.rol === 'admin',
    isDemo: u.rol === 'demo'
  };
}

let demoUserIdCache = null;
async function getOrCreateDemoUser() {
  if (demoUserIdCache) return demoUserIdCache;
  const existing = await pool.query('SELECT id FROM usuarios WHERE email = $1', [DEMO_EMAIL]);
  if (existing.rows.length) {
    demoUserIdCache = existing.rows[0].id;
    return demoUserIdCache;
  }
  const randomPassword = await bcrypt.hash(require('crypto').randomBytes(24).toString('hex'), 10);
  const inserted = await pool.query(
    'INSERT INTO usuarios (email, password_hash, nombre, rol, activo) VALUES ($1,$2,$3,$4,true) RETURNING id',
    [DEMO_EMAIL, randomPassword, DEMO_NOMBRE, 'demo']
  );
  demoUserIdCache = inserted.rows[0].id;
  return demoUserIdCache;
}

// Requiere sesion valida (real o demo). Deja el perfil en req.user.
async function authRequired(req, res, next) {
  try {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ success: false, error: 'No has iniciado sesion' });
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ success: false, error: 'Sesion invalida o expirada' });
    }
    const result = await pool.query('SELECT * FROM usuarios WHERE id = $1', [payload.sub]);
    const u = result.rows[0];
    if (!u) return res.status(401).json({ success: false, error: 'Usuario no encontrado' });
    if (!u.activo) return res.status(403).json({ success: false, error: 'Usuario desactivado. Contacte al administrador.' });
    req.user = toProfile(u);
    next();
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

function adminRequired(req, res, next) {
  if (!req.user.isAdmin) return res.status(403).json({ success: false, error: 'Solo administradores' });
  next();
}

// Envuelve un handler async para no repetir try/catch en cada ruta.
function h(fn) {
  return (req, res) => fn(req, res).catch((e) => res.status(500).json({ success: false, error: e.message }));
}

// ============================================================
//  AUTENTICACION
// ============================================================
app.post('/api/auth/signup', h(async (req, res) => {
  const { email, password, nombre } = req.body || {};
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ success: false, error: 'Email y contrasena (minimo 6 caracteres) son requeridos' });
  }
  const emailNorm = String(email).trim().toLowerCase();
  const existing = await pool.query('SELECT id FROM usuarios WHERE email = $1', [emailNorm]);
  if (existing.rows.length) return res.status(409).json({ success: false, error: 'Ya existe una cuenta con ese email' });

  const hash = await bcrypt.hash(password, 10);
  const rol = emailNorm === ADMIN_EMAIL ? 'admin' : 'cliente';
  const inserted = await pool.query(
    'INSERT INTO usuarios (email, password_hash, nombre, rol, activo) VALUES ($1,$2,$3,$4,true) RETURNING *',
    [emailNorm, hash, nombre || emailNorm.split('@')[0], rol]
  );
  const u = inserted.rows[0];
  setAuthCookie(res, { sub: u.id });
  res.json({ success: true, profile: toProfile(u) });
}));

app.post('/api/auth/login', h(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ success: false, error: 'Email y contrasena son requeridos' });
  const emailNorm = String(email).trim().toLowerCase();
  const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [emailNorm]);
  const u = result.rows[0];
  if (!u) return res.status(401).json({ success: false, error: 'Email o contrasena incorrectos' });
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) return res.status(401).json({ success: false, error: 'Email o contrasena incorrectos' });
  if (!u.activo) return res.status(403).json({ success: false, error: 'Usuario desactivado. Contacte al administrador.' });
  setAuthCookie(res, { sub: u.id });
  res.json({ success: true, profile: toProfile(u) });
}));

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

app.get('/api/auth/me', authRequired, (req, res) => {
  res.json({ success: true, profile: req.user });
});

// ============================================================
//  MODO DEMO - cuenta compartida, sin necesidad de registrarse
// ============================================================
app.post('/api/demo/enter', h(async (req, res) => {
  const demoId = await getOrCreateDemoUser();
  const cuentas = await pool.query('SELECT id FROM cuentas WHERE usuario_id = $1', [demoId]);
  if (!cuentas.rows.length) await seedDemoData(demoId);
  setAuthCookie(res, { sub: demoId });
  const u = (await pool.query('SELECT * FROM usuarios WHERE id = $1', [demoId])).rows[0];
  res.json({ success: true, profile: toProfile(u) });
}));

app.post('/api/demo/reset', authRequired, h(async (req, res) => {
  if (!req.user.isDemo) return res.status(403).json({ success: false, error: 'Solo disponible en modo demo' });
  await limpiarDemo(req.user.id);
  await seedDemoData(req.user.id);
  res.json({ success: true, message: 'Demo reiniciada con datos de ejemplo' });
}));

async function limpiarDemo(demoId) {
  const tablas = ['transferencias', 'gastos_periodo', 'historial_periodo', 'presupuestos', 'gastos', 'ingresos', 'cuentas'];
  for (const t of tablas) {
    await pool.query(`DELETE FROM ${t} WHERE usuario_id = $1`, [demoId]);
  }
}

async function seedDemoData(demoId) {
  const cuenta1 = await pool.query(
    `INSERT INTO cuentas (usuario_id, nombre, saldo, icono, color, tipo) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [demoId, 'Cuenta Principal', 1250.50, '🏦', '#4f46e5', 'corriente']
  );
  await pool.query(
    `INSERT INTO cuentas (usuario_id, nombre, saldo, icono, color, tipo) VALUES ($1,$2,$3,$4,$5,$6)`,
    [demoId, 'Ahorros', 3400, '🐷', '#10b981', 'ahorro']
  );
  const cuentaId1 = cuenta1.rows[0].id;

  await pool.query(
    `INSERT INTO ingresos (usuario_id, nombre, monto, frecuencia, dia_cobro, cuenta_destino_id, activo_recurrente)
     VALUES ($1,$2,$3,$4,$5,$6,true)`,
    [demoId, 'Salario', 900, 'Bisemanal', 15, cuentaId1]
  );

  const gastosDemo = [
    ['Renta', 450, 1, 'Vivienda'],
    ['Luz', 60, 10, 'Servicios'],
    ['Internet', 40, 12, 'Internet'],
    ['Supermercado', 180, 20, 'Alimentacion'],
    ['Telefono', 35, 18, 'Telefono']
  ];
  for (const [nombre, monto, dia_vence, categoria] of gastosDemo) {
    await pool.query(
      `INSERT INTO gastos (usuario_id, nombre, monto, dia_vence, categoria, cuenta_id, pagado, recurrente)
       VALUES ($1,$2,$3,$4,$5,$6,false,true)`,
      [demoId, nombre, monto, dia_vence, categoria, cuentaId1]
    );
  }

  const presupuestosDemo = { Vivienda: 500, Servicios: 80, Internet: 50, Alimentacion: 220, Telefono: 50 };
  for (const [categoria, monto] of Object.entries(presupuestosDemo)) {
    await pool.query(
      `INSERT INTO presupuestos (usuario_id, categoria, monto, tipo) VALUES ($1,$2,$3,'main')`,
      [demoId, categoria, monto]
    );
  }
}

// ============================================================
//  USUARIOS (solo admin)
// ============================================================
app.get('/api/usuarios', authRequired, adminRequired, h(async (req, res) => {
  const result = await pool.query(
    `SELECT id, email, nombre, rol, activo, fecha_registro FROM usuarios WHERE rol != 'demo' ORDER BY fecha_registro`
  );
  res.json({ success: true, usuarios: result.rows });
}));

app.post('/api/usuarios', authRequired, adminRequired, h(async (req, res) => {
  const { email, password, nombre, rol, activo } = req.body || {};
  if (!email || !password) return res.status(400).json({ success: false, error: 'Email y contrasena son requeridos' });
  const emailNorm = String(email).trim().toLowerCase();
  const existing = await pool.query('SELECT id FROM usuarios WHERE email = $1', [emailNorm]);
  if (existing.rows.length) return res.status(409).json({ success: false, error: 'El usuario ya existe' });
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    'INSERT INTO usuarios (email, password_hash, nombre, rol, activo) VALUES ($1,$2,$3,$4,$5)',
    [emailNorm, hash, nombre || emailNorm.split('@')[0], rol || 'cliente', activo !== false]
  );
  res.json({ success: true });
}));

app.put('/api/usuarios/:id', authRequired, adminRequired, h(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const target = (await pool.query('SELECT * FROM usuarios WHERE id = $1', [id])).rows[0];
  if (!target) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
  if (target.email === ADMIN_EMAIL && (req.body.activo === false || (req.body.rol && req.body.rol !== 'admin'))) {
    return res.status(400).json({ success: false, error: 'No se puede desactivar ni cambiar el rol del administrador principal' });
  }
  const nombre = req.body.nombre !== undefined ? req.body.nombre : target.nombre;
  const rol = req.body.rol !== undefined ? req.body.rol : target.rol;
  const activo = req.body.activo !== undefined ? !!req.body.activo : target.activo;
  await pool.query('UPDATE usuarios SET nombre=$1, rol=$2, activo=$3 WHERE id=$4', [nombre, rol, activo, id]);
  res.json({ success: true });
}));

app.delete('/api/usuarios/:id', authRequired, adminRequired, h(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const target = (await pool.query('SELECT * FROM usuarios WHERE id = $1', [id])).rows[0];
  if (!target) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
  if (target.email === ADMIN_EMAIL) return res.status(400).json({ success: false, error: 'No se puede eliminar el administrador principal' });
  await pool.query('DELETE FROM usuarios WHERE id = $1', [id]);
  res.json({ success: true });
}));

// ============================================================
//  CATEGORIAS
// ============================================================
app.get('/api/categorias', (req, res) => {
  res.json({ success: true, categorias: CATEGORIAS_DEFECTO });
});

// ============================================================
//  CUENTAS
// ============================================================
app.get('/api/cuentas', authRequired, h(async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM cuentas WHERE usuario_id = $1 AND activo = true ORDER BY fecha_creacion',
    [req.user.id]
  );
  const total = result.rows.reduce((s, c) => s + (parseFloat(c.saldo) || 0), 0);
  res.json({ success: true, cuentas: result.rows, total });
}));

app.post('/api/cuentas', authRequired, h(async (req, res) => {
  const d = req.body || {};
  const result = await pool.query(
    `INSERT INTO cuentas (usuario_id, nombre, saldo, icono, color, tipo, notas)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [req.user.id, d.nombre || '', parseFloat(d.saldo) || 0, d.icono || '🏦', d.color || '#4f46e5', d.tipo || 'corriente', d.notas || '']
  );
  res.json({ success: true, id: result.rows[0].id });
}));

app.put('/api/cuentas/:id', authRequired, h(async (req, res) => {
  const d = req.body || {};
  const result = await pool.query(
    `UPDATE cuentas SET nombre=COALESCE($1,nombre), saldo=COALESCE($2,saldo), icono=COALESCE($3,icono),
     color=COALESCE($4,color), tipo=COALESCE($5,tipo), notas=COALESCE($6,notas)
     WHERE id=$7 AND usuario_id=$8`,
    [d.nombre, d.saldo !== undefined ? parseFloat(d.saldo) || 0 : null, d.icono, d.color, d.tipo, d.notas, req.params.id, req.user.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Cuenta no encontrada o no autorizada' });
  res.json({ success: true });
}));

app.delete('/api/cuentas/:id', authRequired, h(async (req, res) => {
  const result = await pool.query('UPDATE cuentas SET activo=false WHERE id=$1 AND usuario_id=$2', [req.params.id, req.user.id]);
  if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Cuenta no encontrada o no autorizada' });
  res.json({ success: true });
}));

// ============================================================
//  INGRESOS
// ============================================================
const FREC_COBROS_MES = { Semanal: 4, Bisemanal: 2, Quincenal: 2, Mensual: 1, Anual: 1 / 12, Unico: 0 };

app.get('/api/ingresos', authRequired, h(async (req, res) => {
  const result = await pool.query('SELECT * FROM ingresos WHERE usuario_id = $1 AND activo = true ORDER BY fecha_creacion', [req.user.id]);
  const totalMensual = result.rows.reduce((s, i) => {
    if (!i.activo_recurrente) return s;
    const m = parseFloat(i.monto) || 0;
    return s + m * (FREC_COBROS_MES[i.frecuencia] ?? 0);
  }, 0);
  res.json({ success: true, ingresos: result.rows, totalMensual });
}));

app.post('/api/ingresos', authRequired, h(async (req, res) => {
  const d = req.body || {};
  const result = await pool.query(
    `INSERT INTO ingresos (usuario_id, nombre, monto, frecuencia, dia_cobro, cuenta_destino_id, activo_recurrente, notas)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [req.user.id, d.nombre || '', parseFloat(d.monto) || 0, d.frecuencia || 'Mensual', parseInt(d.dia_cobro) || 1,
      d.cuenta_destino_id || null, d.activo_recurrente !== false, d.notas || '']
  );
  res.json({ success: true, id: result.rows[0].id });
}));

app.put('/api/ingresos/:id', authRequired, h(async (req, res) => {
  const d = req.body || {};
  const result = await pool.query(
    `UPDATE ingresos SET nombre=COALESCE($1,nombre), monto=COALESCE($2,monto), frecuencia=COALESCE($3,frecuencia),
     dia_cobro=COALESCE($4,dia_cobro), cuenta_destino_id=COALESCE($5,cuenta_destino_id),
     activo_recurrente=COALESCE($6,activo_recurrente), notas=COALESCE($7,notas)
     WHERE id=$8 AND usuario_id=$9`,
    [d.nombre, d.monto !== undefined ? parseFloat(d.monto) || 0 : null, d.frecuencia,
      d.dia_cobro !== undefined ? parseInt(d.dia_cobro) || 1 : null, d.cuenta_destino_id, d.activo_recurrente, d.notas,
      req.params.id, req.user.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Ingreso no encontrado o no autorizado' });
  res.json({ success: true });
}));

app.delete('/api/ingresos/:id', authRequired, h(async (req, res) => {
  const result = await pool.query('UPDATE ingresos SET activo=false WHERE id=$1 AND usuario_id=$2', [req.params.id, req.user.id]);
  if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Ingreso no encontrado o no autorizado' });
  res.json({ success: true });
}));

app.post('/api/ingresos/:id/recibido', authRequired, h(async (req, res) => {
  const ingreso = (await pool.query('SELECT * FROM ingresos WHERE id=$1 AND usuario_id=$2', [req.params.id, req.user.id])).rows[0];
  if (!ingreso) return res.status(404).json({ success: false, error: 'Ingreso no encontrado' });
  const d = req.body || {};
  const monto = parseFloat(d.monto) || parseFloat(ingreso.monto) || 0;
  const cuentaId = d.cuenta_destino_id || ingreso.cuenta_destino_id;

  if (cuentaId) {
    await pool.query('UPDATE cuentas SET saldo = saldo + $1 WHERE id=$2 AND usuario_id=$3', [monto, cuentaId, req.user.id]);
  }
  await pool.query(
    `INSERT INTO transferencias (usuario_id, fecha, tipo, hacia_cuenta_id, monto, categoria, descripcion, referencia_id)
     VALUES ($1,$2,'ingreso',$3,$4,'Ingreso',$5,$6)`,
    [req.user.id, d.fecha || new Date().toISOString().slice(0, 10), cuentaId || null, monto,
      ingreso.nombre + (d.notas ? ' - ' + d.notas : ''), ingreso.id]
  );
  res.json({ success: true });
}));

// ============================================================
//  GASTOS / FACTURAS
// ============================================================
app.get('/api/gastos', authRequired, h(async (req, res) => {
  const result = await pool.query('SELECT * FROM gastos WHERE usuario_id = $1 AND activo = true ORDER BY dia_vence', [req.user.id]);
  let totalFacturas = 0, totalPagado = 0, totalPendiente = 0;
  result.rows.forEach((g) => {
    const m = parseFloat(g.monto) || 0;
    totalFacturas += m;
    if (g.pagado) totalPagado += m; else totalPendiente += m;
  });
  res.json({ success: true, gastos: result.rows, totalFacturas, totalPagado, totalPendiente });
}));

app.post('/api/gastos', authRequired, h(async (req, res) => {
  const d = req.body || {};
  const result = await pool.query(
    `INSERT INTO gastos (usuario_id, nombre, monto, dia_vence, categoria, cuenta_id, pagado, fecha_pago, recurrente, notas)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [req.user.id, d.nombre || '', parseFloat(d.monto) || 0, parseInt(d.dia_vence) || 1, d.categoria || 'Otros',
      d.cuenta_id || null, !!d.pagado, d.fecha_pago || null, d.recurrente !== false, d.notas || '']
  );
  res.json({ success: true, id: result.rows[0].id });
}));

app.put('/api/gastos/:id', authRequired, h(async (req, res) => {
  const d = req.body || {};
  const result = await pool.query(
    `UPDATE gastos SET nombre=COALESCE($1,nombre), monto=COALESCE($2,monto), dia_vence=COALESCE($3,dia_vence),
     categoria=COALESCE($4,categoria), cuenta_id=COALESCE($5,cuenta_id), pagado=COALESCE($6,pagado),
     fecha_pago=COALESCE($7,fecha_pago), recurrente=COALESCE($8,recurrente), notas=COALESCE($9,notas)
     WHERE id=$10 AND usuario_id=$11`,
    [d.nombre, d.monto !== undefined ? parseFloat(d.monto) || 0 : null,
      d.dia_vence !== undefined ? parseInt(d.dia_vence) || 1 : null, d.categoria, d.cuenta_id, d.pagado,
      d.fecha_pago, d.recurrente, d.notas, req.params.id, req.user.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Gasto no encontrado o no autorizado' });
  res.json({ success: true });
}));

app.delete('/api/gastos/:id', authRequired, h(async (req, res) => {
  const result = await pool.query('UPDATE gastos SET activo=false WHERE id=$1 AND usuario_id=$2', [req.params.id, req.user.id]);
  if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Gasto no encontrado o no autorizado' });
  res.json({ success: true });
}));

app.post('/api/gastos/:id/pagado', authRequired, h(async (req, res) => {
  const gasto = (await pool.query('SELECT * FROM gastos WHERE id=$1 AND usuario_id=$2', [req.params.id, req.user.id])).rows[0];
  if (!gasto) return res.status(404).json({ success: false, error: 'Gasto no encontrado' });
  const pagado = !!req.body.pagado;
  const hoy = new Date().toISOString().slice(0, 10);

  await pool.query('UPDATE gastos SET pagado=$1, fecha_pago=$2 WHERE id=$3', [pagado, pagado ? hoy : null, gasto.id]);

  if (pagado) {
    if (gasto.cuenta_id) {
      await pool.query('UPDATE cuentas SET saldo = saldo - $1 WHERE id=$2 AND usuario_id=$3', [gasto.monto, gasto.cuenta_id, req.user.id]);
      await pool.query(
        `INSERT INTO transferencias (usuario_id, fecha, tipo, desde_cuenta_id, monto, categoria, descripcion, referencia_id)
         VALUES ($1,$2,'gasto',$3,$4,$5,$6,$7)`,
        [req.user.id, hoy, gasto.cuenta_id, gasto.monto, gasto.categoria || 'Otros', 'Pago: ' + gasto.nombre, gasto.id]
      );
    }
    await pool.query(
      `INSERT INTO gastos_periodo (usuario_id, gasto_id, nombre, monto, categoria, cuenta_id, notas, fecha)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [req.user.id, gasto.id, gasto.nombre, gasto.monto, gasto.categoria || 'Otros', gasto.cuenta_id, gasto.notas || '', hoy]
    );
  } else {
    await pool.query('UPDATE gastos_periodo SET activo=false WHERE gasto_id=$1 AND usuario_id=$2 AND activo=true', [gasto.id, req.user.id]);
  }
  res.json({ success: true });
}));

app.post('/api/gastos/resetear-mes', authRequired, h(async (req, res) => {
  const result = await pool.query(
    `UPDATE gastos SET pagado=false, fecha_pago=NULL WHERE usuario_id=$1 AND activo=true AND recurrente=true AND pagado=true`,
    [req.user.id]
  );
  res.json({ success: true, count: result.rowCount });
}));

// ============================================================
//  GASTOS DEL PERIODO
// ============================================================
app.get('/api/gastos-periodo', authRequired, h(async (req, res) => {
  const result = await pool.query('SELECT * FROM gastos_periodo WHERE usuario_id=$1 AND activo=true ORDER BY fecha DESC', [req.user.id]);
  const total = result.rows.reduce((s, g) => s + (parseFloat(g.monto) || 0), 0);
  res.json({ success: true, gastos: result.rows, total });
}));

app.post('/api/gastos-periodo', authRequired, h(async (req, res) => {
  const d = req.body || {};
  const result = await pool.query(
    `INSERT INTO gastos_periodo (usuario_id, nombre, monto, categoria, cuenta_id, notas)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [req.user.id, d.nombre || '', parseFloat(d.monto) || 0, d.categoria || 'Otros', d.cuenta_id || null, d.notas || '']
  );
  res.json({ success: true, id: result.rows[0].id });
}));

app.put('/api/gastos-periodo/:id', authRequired, h(async (req, res) => {
  const d = req.body || {};
  const result = await pool.query(
    `UPDATE gastos_periodo SET nombre=COALESCE($1,nombre), monto=COALESCE($2,monto), categoria=COALESCE($3,categoria),
     cuenta_id=COALESCE($4,cuenta_id), notas=COALESCE($5,notas) WHERE id=$6 AND usuario_id=$7`,
    [d.nombre, d.monto !== undefined ? parseFloat(d.monto) || 0 : null, d.categoria, d.cuenta_id, d.notas, req.params.id, req.user.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Gasto no encontrado o no autorizado' });
  res.json({ success: true });
}));

app.delete('/api/gastos-periodo/:id', authRequired, h(async (req, res) => {
  const result = await pool.query('UPDATE gastos_periodo SET activo=false WHERE id=$1 AND usuario_id=$2', [req.params.id, req.user.id]);
  if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Gasto no encontrado o no autorizado' });
  res.json({ success: true });
}));

// ============================================================
//  HISTORIAL DE PERIODOS / REGISTRAR COBRO
// ============================================================
app.get('/api/historial-periodo', authRequired, h(async (req, res) => {
  const result = await pool.query('SELECT * FROM historial_periodo WHERE usuario_id=$1 ORDER BY fecha_inicio DESC', [req.user.id]);
  res.json({ success: true, historial: result.rows });
}));

app.post('/api/periodo/reiniciar', authRequired, h(async (req, res) => {
  const ingreso = parseFloat(req.body.ingresoCobro) || 0;
  const gastos = (await pool.query('SELECT * FROM gastos_periodo WHERE usuario_id=$1 AND activo=true', [req.user.id])).rows;

  const cobrosExistentes = await pool.query('SELECT COUNT(*)::int AS n FROM historial_periodo WHERE usuario_id=$1', [req.user.id]);
  const numeroCobro = cobrosExistentes.rows[0].n + 1;

  if (gastos.length > 0) {
    const total = gastos.reduce((s, g) => s + (parseFloat(g.monto) || 0), 0);
    const porCategoria = {};
    gastos.forEach((g) => {
      const c = g.categoria || 'Otros';
      porCategoria[c] = (porCategoria[c] || 0) + (parseFloat(g.monto) || 0);
    });
    await pool.query(
      `INSERT INTO historial_periodo (usuario_id, fecha_inicio, fecha_fin, total, cantidad_gastos, por_categoria, ingreso_cobro, ahorro, numero_cobro)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [req.user.id, gastos[0].fecha, new Date().toISOString().slice(0, 10), total, gastos.length,
        JSON.stringify(porCategoria), ingreso, ingreso - total, numeroCobro]
    );
  }

  const archivados = await pool.query('UPDATE gastos_periodo SET activo=false WHERE usuario_id=$1 AND activo=true', [req.user.id]);
  await pool.query('UPDATE presupuestos SET monto=0 WHERE usuario_id=$1', [req.user.id]);

  res.json({ success: true, gastosArchivados: archivados.rowCount });
}));

// ============================================================
//  PRESUPUESTOS
// ============================================================
app.get('/api/presupuestos', authRequired, h(async (req, res) => {
  const result = await pool.query('SELECT * FROM presupuestos WHERE usuario_id=$1', [req.user.id]);
  res.json({ success: true, presupuestos: result.rows });
}));

app.post('/api/presupuestos', authRequired, h(async (req, res) => {
  const lista = Array.isArray(req.body) ? req.body : req.body.lista;
  if (!lista || !lista.length) return res.json({ success: true });
  for (const item of lista) {
    const monto = parseFloat(item.monto) || 0;
    const tipo = item.tipo || 'main';
    await pool.query(
      `INSERT INTO presupuestos (usuario_id, categoria, monto, tipo) VALUES ($1,$2,$3,$4)
       ON CONFLICT (usuario_id, categoria, tipo) DO UPDATE SET monto = EXCLUDED.monto`,
      [req.user.id, item.categoria, monto, tipo]
    );
  }
  res.json({ success: true });
}));

// ============================================================
//  TRANSFERENCIAS
// ============================================================
app.get('/api/transferencias', authRequired, h(async (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const result = await pool.query(
    'SELECT * FROM transferencias WHERE usuario_id=$1 ORDER BY fecha_registro DESC LIMIT $2',
    [req.user.id, limit]
  );
  res.json({ success: true, transferencias: result.rows });
}));

app.post('/api/transferencias', authRequired, h(async (req, res) => {
  const d = req.body || {};
  const monto = parseFloat(d.monto) || 0;
  if (monto <= 0) return res.status(400).json({ success: false, error: 'El monto debe ser mayor a 0' });
  if (!d.desde_cuenta_id || !d.hacia_cuenta_id) return res.status(400).json({ success: false, error: 'Seleccione las cuentas' });
  if (d.desde_cuenta_id === d.hacia_cuenta_id) return res.status(400).json({ success: false, error: 'Las cuentas deben ser diferentes' });

  const desde = await pool.query('UPDATE cuentas SET saldo = saldo - $1 WHERE id=$2 AND usuario_id=$3', [monto, d.desde_cuenta_id, req.user.id]);
  const hacia = await pool.query('UPDATE cuentas SET saldo = saldo + $1 WHERE id=$2 AND usuario_id=$3', [monto, d.hacia_cuenta_id, req.user.id]);
  if (desde.rowCount === 0 || hacia.rowCount === 0) {
    return res.status(403).json({ success: false, error: 'No autorizado para transferir entre estas cuentas' });
  }

  const result = await pool.query(
    `INSERT INTO transferencias (usuario_id, fecha, tipo, desde_cuenta_id, hacia_cuenta_id, monto, categoria, descripcion)
     VALUES ($1,$2,'transferencia',$3,$4,$5,'Transferencia',$6) RETURNING id`,
    [req.user.id, d.fecha || new Date().toISOString().slice(0, 10), d.desde_cuenta_id, d.hacia_cuenta_id, monto, d.descripcion || 'Transferencia entre cuentas']
  );
  res.json({ success: true, id: result.rows[0].id });
}));

// ============================================================
//  RESUMEN FINANCIERO
// ============================================================
app.get('/api/resumen', authRequired, h(async (req, res) => {
  const cuentas = (await pool.query('SELECT * FROM cuentas WHERE usuario_id=$1 AND activo=true', [req.user.id])).rows;
  const ingresos = (await pool.query('SELECT * FROM ingresos WHERE usuario_id=$1 AND activo=true', [req.user.id])).rows;
  const gastos = (await pool.query('SELECT * FROM gastos WHERE usuario_id=$1 AND activo=true', [req.user.id])).rows;

  const totalCuentas = cuentas.reduce((s, c) => s + (parseFloat(c.saldo) || 0), 0);
  const totalIngresos = ingresos.reduce((s, i) => {
    if (!i.activo_recurrente) return s;
    return s + (parseFloat(i.monto) || 0) * (FREC_COBROS_MES[i.frecuencia] ?? 0);
  }, 0);
  let totalFacturas = 0, totalPagado = 0, totalPendiente = 0;
  gastos.forEach((g) => {
    const m = parseFloat(g.monto) || 0;
    totalFacturas += m;
    if (g.pagado) totalPagado += m; else totalPendiente += m;
  });
  const balance = totalIngresos - totalFacturas;
  const porcentajeUso = totalIngresos > 0 ? (totalFacturas / totalIngresos) * 100 : 0;

  const diaHoy = new Date().getDate();
  const proximasVencer = gastos
    .filter((g) => !g.pagado)
    .map((g) => {
      const diaVence = parseInt(g.dia_vence) || 1;
      let diasFaltan = diaVence - diaHoy;
      if (diasFaltan < 0) diasFaltan += 30;
      return { id: g.id, nombre: g.nombre, monto: g.monto, dia_vence: diaVence, dias_faltan: diasFaltan, categoria: g.categoria };
    })
    .sort((a, b) => a.dias_faltan - b.dias_faltan)
    .slice(0, 10);

  res.json({
    success: true,
    resumen: {
      totalCuentas, totalIngresos, totalFacturas, totalPagado, totalPendiente, balance, porcentajeUso,
      proximasVencer, cuentas, fechaActualizacion: new Date().toISOString()
    }
  });
}));

// ============================================================
//  ARRANQUE
// ============================================================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;

ensureSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`Gestion Financiera escuchando en el puerto ${PORT}`));
  })
  .catch((e) => {
    console.error('No se pudo preparar la base de datos:', e);
    process.exit(1);
  });

module.exports = app;
