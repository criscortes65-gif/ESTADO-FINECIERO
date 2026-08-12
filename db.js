const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');

// NUMERIC llega como string por defecto en node-postgres; lo convertimos a
// number para no tener que hacerlo a mano en cada consulta.
types.setTypeParser(1700, (val) => (val === null ? null : parseFloat(val)));

if (!process.env.DATABASE_URL) {
  throw new Error('Falta la variable de entorno DATABASE_URL (cadena de conexion de PostgreSQL).');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false }
});

async function ensureSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  const migrations = fs.readFileSync(path.join(__dirname, 'migrations.sql'), 'utf8');
  await pool.query(migrations);
}

module.exports = { pool, ensureSchema };
