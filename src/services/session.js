import {randomUUID} from 'node:crypto';
import {config} from '../config.js';
import {query, queryOne} from '../db.js';

function shouldElevate(email) {
  return config.localSuperadminEmails.includes(String(email || '').toLowerCase());
}

export async function upsertProfile({uid, email, displayName}) {
  const normalized = String(email || `${uid}@talex.local`).toLowerCase();
  const elevate = shouldElevate(normalized) ? 1 : 0;
  const existing = await queryOne(
    `SELECT * FROM profiles
     WHERE firebase_uid = :uid OR email = :email
     ORDER BY CASE WHEN firebase_uid = :uidMatch THEN 0 ELSE 1 END
     LIMIT 1`,
    {uid, uidMatch: uid, email: normalized},
  );
  if (existing) {
    await query(
      `UPDATE profiles
       SET firebase_uid = COALESCE(firebase_uid, :uid),
           email = :email,
           display_name = COALESCE(:displayName, display_name),
           is_superadmin = :elevate
       WHERE id = :id`,
      {
        id: existing.id,
        uid,
        email: normalized,
        displayName: displayName || null,
        elevate,
      },
    );
    return queryOne('SELECT * FROM profiles WHERE id = :id', {id: existing.id});
  }
  const id = randomUUID();
  await query(
    `INSERT INTO profiles (id, firebase_uid, email, display_name, is_superadmin)
     VALUES (:id, :uid, :email, :displayName, :elevate)`,
    {
      id,
      uid,
      email: normalized,
      displayName: displayName || null,
      elevate,
    },
  );
  return queryOne('SELECT * FROM profiles WHERE id = :id', {id});
}
