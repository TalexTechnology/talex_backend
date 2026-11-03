import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';

// Solo se usan las credenciales para una base temporal, nunca para la base real.
const envPath = process.env.TALEX_TEST_ENV_FILE;
if (envPath) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
}
process.env.MONGODB_DB = `test_culture_tracking_${randomUUID().replaceAll('-', '')}`;
process.env.SMTP_HOST = '';
const {normalizeLead, createCultureLead} = await import('../src/application/culture-leads.js');
const {trackingIdentity, trackCultureVisit, cultureTrackingByOrganization, confirmCultureShared} = await import('../src/application/culture-tracking.js');
const {cultureLeadsByOrganization} = await import('../src/application/leads.js');
const {connectDatabase, closeDatabase, collection} = await import('../src/db.js');
const {findOne} = await import('../src/domain/store.js');
const valid = {
  nombreEmpresa: 'Empresa de prueba', nombre: 'Contacto de prueba', numeroEmpleados: 35,
  culturaPercibida: ['Colaborativa'], correo: 'tracking@example.test',
  consentimiento: {aceptaTerminosYPolitica: true, autorizaTratamientoDatos: true},
};
assert.equal(normalizeLead(valid).employeeCount, 35);
for (const bad of [0, -1, 1.5, true, {}, '1e2', '1 – 50', 1000001]) {
  assert.throws(() => normalizeLead({...valid, numeroEmpleados: bad}));
}
const legacy = {...valid, numeroEmpleados: undefined, rangoEmpleados: '1 – 50'};
assert.equal(normalizeLead(legacy).employeeCount, null);
const identity = trackingIdentity('a', {visitorId: randomUUID(), visitId: randomUUID(), event: 'opened'});
assert.equal(identity.id.length, 64);
assert.throws(() => trackingIdentity('a', {visitorId: 'bad', visitId: 'bad', event: 'opened'}));
console.log('PASS headcount validation and anonymous identifiers');

if (!process.env.MONGODB_URI) {
  console.log('SKIP Mongo integration: MONGODB_URI not configured');
  process.exit(0);
}
let db;
try {
  db = await connectDatabase();
  assert.ok(db.databaseName.startsWith('test_culture_tracking_'));
  const lead = await createCultureLead(valid, {baseUrl: 'https://platform.talex.com.co'});
  const org = await findOne('organizations', {id: lead.organizationId});
  assert.equal(org.employee_count, 35);
  assert.equal(lead.lead.employee_count, 35);
  assert.ok(lead.shareToken);
  const visitorId = randomUUID();
  const first = {visitorId, visitId: randomUUID(), event: 'opened'};
  await trackCultureVisit(org.id, first);
  await trackCultureVisit(org.id, first); // Reintento: una sola visita.
  await trackCultureVisit(org.id, {...first, event: 'started'});
  await trackCultureVisit(org.id, {...first, event: 'started'});
  await trackCultureVisit(org.id, {visitorId, visitId: randomUUID(), event: 'opened'});
  await trackCultureVisit(org.id, {visitorId: randomUUID(), visitId: randomUUID(), event: 'started'});
  await assert.rejects(confirmCultureShared(org.id, {shareToken: 'incorrect'}), {status: 403});
  await assert.rejects(confirmCultureShared('other-company', {shareToken: lead.shareToken}), {status: 403});
  await confirmCultureShared(org.id, {shareToken: lead.shareToken});
  await confirmCultureShared(org.id, {shareToken: lead.shareToken});
  await collection('survey_sessions').insertMany(Array.from({length: 5001}, () => ({
    id: randomUUID(), organization_id: org.id, purpose: 'culture_perception', status: 'completed',
  })));
  const stats = (await cultureTrackingByOrganization([org.id])).get(org.id);
  assert.equal(stats.visits, 3);
  assert.equal(stats.uniqueVisitors, 2);
  assert.equal(stats.startedVisits, 2);
  assert.equal(stats.completedResponses, 5001);
  assert.ok(stats.sharedConfirmedAt);
  const actor = {isSuperadmin: true, profile: {id: 'test-admin'}};
  const report = await cultureLeadsByOrganization(actor, {});
  assert.equal(report.organizations[0].surveyRespondents, 5001);
  assert.equal(report.organizations[0].tracking.uniqueVisitors, 2);
  await assert.rejects(cultureLeadsByOrganization({profile: {id: 'outsider'}}, {}), {status: 403});
  console.log('PASS Mongo persistence, retries, browser deduplication, sharing permissions, exact totals and tenant isolation');
} finally {
  if (db?.databaseName.startsWith('test_culture_tracking_')) await db.dropDatabase();
  await closeDatabase();
}
