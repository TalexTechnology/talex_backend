import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

function loadEnvFile(path) {
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index < 1) continue;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // Optional local file.
  }
}

loadEnvFile(resolve(process.cwd(), '.env'));
loadEnvFile(resolve(process.cwd(), '../.env'));

function env(name, fallback = '') {
  return String(process.env[name] ?? fallback).trim();
}

export const config = {
  port: Number(env('PORT', '8080')),
  corsOrigin: env('CORS_ORIGIN', 'http://localhost:5000'),
  firebaseProjectId: env('FIREBASE_PROJECT_ID', 'talex-platform'),
  localSuperadminEmails: env(
    'LOCAL_SUPERADMIN_EMAILS',
    'talex.admin@talex.com.co',
  )
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
  mongodbUri: env('MONGODB_URI', ''),
  mongodbDatabase: env('MONGODB_DB', 'talex'),
  publicSurveyBase: env('PUBLIC_SURVEY_BASE', 'https://platform.talex.com.co'),
  cultureReportThreshold: Number(env('CULTURE_REPORT_THRESHOLD', '0')),
  smtp: {
    host: env('SMTP_HOST', ''),
    user: env('SMTP_USER', ''),
    pass: env('SMTP_PASS', ''),
    from: env('SMTP_FROM', ''),
    port: Number(env('SMTP_PORT', '587')),
  },
};
