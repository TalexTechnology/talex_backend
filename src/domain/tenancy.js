import {queryOne} from '../db.js';
import {ApiError} from '../http.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return UUID.test(String(value || ''));
}

export function publicEntityId(id, firebaseId) {
  const firebase = String(firebaseId || '').trim();
  return firebase || id;
}

export async function resolveOrganizationId(value) {
  if (!value) return null;
  if (isUuid(value)) {
    const row = await queryOne('SELECT id FROM organizations WHERE id = :id LIMIT 1', {
      id: value,
    });
    if (row) return row.id;
  }
  const row = await queryOne(
    'SELECT id FROM organizations WHERE firebase_id = :id LIMIT 1',
    {id: value},
  );
  return row?.id ?? null;
}

export async function resolveVacancyId(value) {
  if (!value) return null;
  if (isUuid(value)) {
    const row = await queryOne('SELECT id FROM vacancies WHERE id = :id LIMIT 1', {
      id: value,
    });
    if (row) return row.id;
  }
  const row = await queryOne(
    'SELECT id FROM vacancies WHERE firebase_id = :id LIMIT 1',
    {id: value},
  );
  return row?.id ?? null;
}

export async function resolveApplicationId(value) {
  if (!value) return null;
  if (isUuid(value)) {
    const row = await queryOne('SELECT id FROM applications WHERE id = :id LIMIT 1', {
      id: value,
    });
    if (row) return row.id;
  }
  const row = await queryOne(
    'SELECT id FROM applications WHERE firebase_candidate_id = :id LIMIT 1',
    {id: value},
  );
  return row?.id ?? null;
}

export function assertSignedIn(actor) {
  if (!actor?.profile?.id) throw new ApiError(401, 'need_sign_in');
}

export function canWriteOrg(actor, organizationId) {
  if (actor.isSuperadmin) return true;
  return actor.membership?.organization_id === organizationId;
}

export async function ownsApplication(actor, applicationId) {
  const row = await queryOne(
    `SELECT a.id
     FROM applications a
     JOIN persons p ON p.id = a.person_id
     WHERE a.id = :applicationId
       AND (p.linked_profile_id = :profileId OR p.email = :email)
     LIMIT 1`,
    {
      applicationId,
      profileId: actor.profile.id,
      email: actor.profile.email,
    },
  );
  return Boolean(row);
}

export function assertCanWriteOrg(actor, organizationId) {
  if (!canWriteOrg(actor, organizationId)) {
    throw new ApiError(403, 'permission_denied');
  }
}

export function assertBankManager(actor) {
  if (!actor.isSuperadmin) throw new ApiError(403, 'permission_denied');
}
