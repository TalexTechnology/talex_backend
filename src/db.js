import mysql from 'mysql2/promise';
import {config} from './config.js';

export const pool = mysql.createPool({
  host: config.mysql.host,
  port: config.mysql.port,
  database: config.mysql.database,
  user: config.mysql.user,
  password: config.mysql.password,
  waitForConnections: true,
  connectionLimit: process.env.VERCEL ? 4 : 10,
  namedPlaceholders: true,
  timezone: 'Z',
});

export async function query(sql, params = {}) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (error) {
    throw mysqlError(error);
  }
}

export async function pingDatabase() {
  await query('SELECT 1 AS ok');
}

function mysqlError(error) {
  const code = error.code || '';
  if (code === 'ECONNREFUSED') {
    return Object.assign(new Error('mysql_unreachable'), {
      status: 503,
      code: 'mysql_unreachable',
    });
  }
  if (code === 'ER_ACCESS_DENIED_ERROR' || code === 'ER_DBACCESS_DENIED_ERROR') {
    return Object.assign(new Error('mysql_access_denied'), {
      status: 503,
      code: 'mysql_access_denied',
    });
  }
  if (code === 'ER_BAD_DB_ERROR') {
    return Object.assign(new Error('mysql_database_missing'), {
      status: 503,
      code: 'mysql_database_missing',
    });
  }
  return Object.assign(error, {
    status: error.status || 500,
    code: error.code || 'mysql_error',
    message: error.message,
  });
}

export async function queryOne(sql, params = {}) {
  const rows = await query(sql, params);
  return Array.isArray(rows) ? rows[0] ?? null : null;
}
