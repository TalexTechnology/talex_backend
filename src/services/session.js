import {randomUUID} from 'node:crypto';
import {config} from '../config.js';
import {findOne, insertOne, updateOne} from '../domain/store.js';

function shouldElevate(email) {
  return config.localSuperadminEmails.includes(String(email || '').toLowerCase());
}

export async function upsertProfile({uid, email, displayName}) {
  const normalized = String(email || `${uid}@talex.local`).toLowerCase();
  const elevate = shouldElevate(normalized);
  const byUid = await findOne('profiles', {firebase_uid: uid});
  const existing = byUid || (await findOne('profiles', {email: normalized}));
  if (existing) {
    return updateOne('profiles', {id: existing.id}, {
      firebase_uid: existing.firebase_uid || uid,
      email: normalized,
      display_name: displayName || existing.display_name || null,
      is_superadmin: elevate,
      updated_at: new Date(),
    });
  }
  const id = randomUUID();
  return insertOne('profiles', {
    id,
    firebase_uid: uid,
    email: normalized,
    display_name: displayName || null,
    is_superadmin: elevate,
    is_active: true,
    must_change_password: false,
    must_review_company_dna: false,
    document_number: null,
    created_at: new Date(),
    updated_at: new Date(),
  });
}
