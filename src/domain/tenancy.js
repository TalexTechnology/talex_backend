import {findMany, findOne} from './store.js';
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

async function resolveId(collection, value, firebaseField) {
  if (!value) return null;
  if (isUuid(value)) {
    const byId = await findOne(collection, {id: value});
    if (byId) return byId.id;
  }
  const row = await findOne(collection, {[firebaseField]: value});
  return row?.id ?? null;
}

export function resolveOrganizationId(value) {
  return resolveId('organizations', value, 'firebase_id');
}

export function resolveVacancyId(value) {
  return resolveId('vacancies', value, 'firebase_id');
}

export function resolveApplicationId(value) {
  return resolveId('applications', value, 'firebase_candidate_id');
}

export function assertSignedIn(actor) {
  if (!actor?.profile?.id) throw new ApiError(401, 'need_sign_in');
}

export function canWriteOrg(actor, organizationId) {
  if (actor.isSuperadmin) return true;
  return actor.membership?.organization_id === organizationId;
}

export async function ownsApplication(actor, applicationId) {
  const application = await findOne('applications', {id: applicationId});
  if (!application) return false;
  const persons = await findMany('persons', {
    $or: [{linked_profile_id: actor.profile.id}, {email: actor.profile.email}],
  }, {limit: 20});
  return persons.some((person) => person.id === application.person_id);
}

export function assertCanWriteOrg(actor, organizationId) {
  if (!canWriteOrg(actor, organizationId)) {
    throw new ApiError(403, 'permission_denied');
  }
}

export function assertBankManager(actor) {
  if (!actor.isSuperadmin) throw new ApiError(403, 'permission_denied');
}

export async function activeMembership(profileId) {
  const memberships = await findMany(
    'memberships',
    {profile_id: profileId, is_active: true},
    {sort: {created_at: 1}, limit: 1},
  );
  const membership = memberships[0];
  if (!membership) return null;
  const organization = await findOne('organizations', {id: membership.organization_id});
  return {
    organization_id: membership.organization_id,
    role: membership.role,
    legacy_role: membership.legacy_role,
    organization_name: organization?.name ?? null,
    organization_firebase_id: organization?.firebase_id ?? null,
  };
}
