/**
 * One-shot copy from the old MySQL database into MongoDB.
 * Does not delete MySQL rows. Re-runs update the same ids.
 *
 *   npm install mysql2
 *   node scripts/migrate-from-mysql.mjs
 */
import mysql from 'mysql2/promise';
import {closeDatabase} from '../src/db.js';
import {upsertOne} from '../src/domain/store.js';

const TABLES = [
  'profiles',
  'organizations',
  'memberships',
  'organization_culture_versions',
  'dna_catalog_entries',
  'vacancies',
  'persons',
  'applications',
  'application_status_events',
  'survey_templates',
  'survey_versions',
  'survey_sections',
  'survey_questions',
  'survey_options',
  'survey_sessions',
  'survey_answers',
  'public_survey_links',
  'culture_perception_results',
  'affinity_evaluations',
  'evaluation_reports',
  'activation_invites',
  'activity_events',
  'audit_logs',
  'deals',
  'sales',
  'legacy_role_map',
  'legacy_company_status_map',
];

const KEY = {
  legacy_role_map: 'firestore_role',
  legacy_company_status_map: 'firestore_status',
};

function env(name, fallback = '') {
  return String(process.env[name] ?? fallback).trim();
}

const connection = await mysql.createConnection({
  host: env('MYSQL_HOST', '127.0.0.1'),
  port: Number(env('MYSQL_PORT', '3306')),
  database: env('MYSQL_DATABASE', 'talex'),
  user: env('MYSQL_USER', 'talex'),
  password: env('MYSQL_PASSWORD', ''),
});

const report = [];
for (const table of TABLES) {
  const key = KEY[table] || 'id';
  const [rows] = await connection.query(`SELECT * FROM \`${table}\``);
  let migrated = 0;
  for (const row of rows) {
    const filter = {[key]: row[key]};
    const {[key]: keyValue, ...rest} = row;
    await upsertOne(table, filter, rest, {[key]: keyValue});
    migrated += 1;
  }
  report.push({table, read: rows.length, migrated});
  console.log(`${table} ${migrated}`);
}

await connection.end();
await closeDatabase();
console.log(JSON.stringify({ok: true, report}, null, 2));
