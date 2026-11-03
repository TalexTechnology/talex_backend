import {connectDatabase, collection, driverOptions} from '../db.js';
import {findOne, insertOne} from '../domain/store.js';
import {randomToken, sha256Hex} from '../domain/crypto.js';
import {ApiError} from '../http.js';

export async function createShareKey(organizationId) {
  const token = randomToken();
  await insertOne('culture_share_keys', {
    token_hash: sha256Hex(token), organization_id: organizationId,
    expires_at: new Date(Date.now() + 30 * 86400000),
  });
  return token;
}

// Solo el contacto que acaba de registrar la empresa recibe esta clave.
export async function confirmCultureShared(organizationId, body) {
  const token = body?.shareToken;
  if (typeof token !== 'string' || token.length > 100) throw new ApiError(403, 'invalid_share_key');
  const key = await findOne('culture_share_keys', {
    organization_id: organizationId, token_hash: sha256Hex(token), expires_at: {$gt: new Date()},
  });
  if (!key) throw new ApiError(403, 'invalid_share_key');
  await connectDatabase();
  await collection('culture_sharing').updateOne(
    {organization_id: organizationId},
    {$setOnInsert: {organization_id: organizationId, confirmed_at: new Date()}},
    {...driverOptions(), upsert: true},
  );
  return {success: true};
}

export function trackingIdentity(organizationId, body) {
  const validId = (value) => typeof value === 'string' && /^[a-zA-Z0-9-]{20,80}$/.test(value);
  if (!validId(body?.visitorId) || !validId(body?.visitId)) throw new ApiError(400, 'invalid_visit');
  if (!['opened', 'started'].includes(body.event)) throw new ApiError(400, 'invalid_event');
  return {
    id: sha256Hex(`${organizationId}:${body.visitId}`),
    visitor_hash: sha256Hex(`${organizationId}:${body.visitorId}`),
  };
}

export async function trackCultureVisit(organizationId, body) {
  const identity = trackingIdentity(organizationId, body);
  const organization = await findOne('organizations', {id: organizationId});
  if (!organization) throw new ApiError(404, 'company_not_found');
  await connectDatabase();
  const now = new Date();
  // Una apertura por carga de página, incluso si hay reintentos de red.
  await collection('culture_visits').updateOne(
    {id: identity.id},
    {$setOnInsert: {...identity, organization_id: organizationId, opened_at: now}},
    {...driverOptions(), upsert: true},
  );
  if (body.event === 'started') {
    await collection('culture_visits').updateOne(
      {id: identity.id, started_at: {$exists: false}},
      {$set: {started_at: now}}, driverOptions(),
    );
  }
  return {success: true};
}

export async function cultureTrackingByOrganization(organizationIds) {
  await connectDatabase();
  const [visits, sharing, completions] = await Promise.all([
    collection('culture_visits').aggregate([
      {$match: {organization_id: {$in: organizationIds}}},
      {$group: {
        _id: {organization: '$organization_id', visitor: '$visitor_hash'},
        visits: {$sum: 1},
        started: {$sum: {$cond: [{$ifNull: ['$started_at', false]}, 1, 0]}},
        firstVisitAt: {$min: '$opened_at'}, lastVisitAt: {$max: '$opened_at'},
      }},
      {$group: {
        _id: '$_id.organization', visits: {$sum: '$visits'}, uniqueVisitors: {$sum: 1},
        startedVisits: {$sum: '$started'},
        firstVisitAt: {$min: '$firstVisitAt'}, lastVisitAt: {$max: '$lastVisitAt'},
      }},
    ], driverOptions()).toArray(),
    collection('culture_sharing').find({organization_id: {$in: organizationIds}}, driverOptions()).toArray(),
    collection('survey_sessions').aggregate([
      {$match: {organization_id: {$in: organizationIds}, purpose: 'culture_perception', status: 'completed'}},
      {$group: {_id: '$organization_id', count: {$sum: 1}}},
    ], driverOptions()).toArray(),
  ]);
  const confirmed = new Map(sharing.map((row) => [row.organization_id, row.confirmed_at?.toISOString() ?? null]));
  const byOrg = new Map(visits.map((row) => [row._id, row]));
  const completed = new Map(completions.map((row) => [row._id, row.count]));
  return new Map(organizationIds.map((id) => {
    const row = byOrg.get(id);
    return [id, {
      visits: row?.visits || 0, uniqueVisitors: row?.uniqueVisitors || 0,
      startedVisits: row?.startedVisits || 0,
      firstVisitAt: row?.firstVisitAt?.toISOString() ?? null,
      lastVisitAt: row?.lastVisitAt?.toISOString() ?? null,
      sharedConfirmedAt: confirmed.get(id) ?? null,
      completedResponses: completed.get(id) || 0,
    }];
  }));
}
