import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

process.env.MONGODB_DB = `test_culture_delivery_${randomUUID().replaceAll('-', '')}`;
process.env.SMTP_HOST = '';
const {cultureShareEmail, cultureReportPdfEmail, cultureReportReadyEmail} = await import('../src/mail.js');
const {createCultureLead} = await import('../src/application/culture-leads.js');
const {maybeReleaseCultureReport} = await import('../src/application/culture-report.js');
const {releaseDueCultureReports} = await import('../src/application/culture-report-auto.js');
const {getCultureSurvey, submitCultureSurvey} = await import('../src/application/culture-survey.js');
const {connectDatabase, closeDatabase, collection} = await import('../src/db.js');
const {findOne, updateOne} = await import('../src/domain/store.js');

for (const count of [20, 1000, undefined]) {
  const mail = cultureShareEmail({
    companyName: 'Empresa <segura>', contactName: 'Contacto', employeeCount: count,
    surveyUrl: 'https://platform.talex.com.co/cultura/test',
  });
  for (const body of [mail.text, mail.html]) {
    assert.doesNotMatch(body, /384|fórmula|umbral|mínimo|1 a 50|1 – 50|alcanzar ese/i);
    assert.match(body, /24 horas/);
    assert.match(body, /respuestas recibidas/);
    if (count === 20) assert.match(body, /20 personas/);
  }
  assert.doesNotMatch(mail.html, /Empresa <segura>/);
}
const empty = cultureReportPdfEmail({companyName: 'Empresa', coverage: {respondents: 0, reached: false}});
assert.match(empty.text, /ausencia de respuestas/);
assert.doesNotMatch(empty.html, /contrasta lo que viven/);
const limited = cultureReportPdfEmail({companyName: 'Empresa', coverage: {respondents: 2, reached: false}});
assert.match(limited.text, /no representan necesariamente/);
const ready = cultureReportReadyEmail({companyName: 'Empresa', reportUrl: 'https://platform.talex.com.co', coverage: {respondents: 2}});
assert.doesNotMatch(ready.text + ready.html, /umbral|todavía no|no está definido/i);
console.log('PASS invitation and result email consistency, exact count, escaping and empty results');

if (!process.env.MONGODB_URI) {
  console.log('SKIP Mongo integration: MONGODB_URI not configured');
  process.exit(0);
}
let db;
try {
  db = await connectDatabase();
  assert.ok(db.databaseName.startsWith('test_culture_delivery_'));
  await collection('company_culture_questions').insertOne({
    bank: 'employee-culture-v1', code: 'K02', is_active: true,
    format: 'single', options: [{id: 'profesional', label: 'Profesional'}],
  });
  const lead = await createCultureLead({
    nombreEmpresa: 'Prueba de plazo', nombre: 'Contacto', numeroEmpleados: 20,
    culturaPercibida: ['Colaborativa'], correo: 'delivery@example.test',
    consentimiento: {aceptaTerminosYPolitica: true, autorizaTratamientoDatos: true},
  }, {baseUrl: 'https://platform.talex.com.co'});
  let report = await findOne('culture_reports', {organization_id: lead.organizationId});
  assert.equal(report.coverage.respondents, 0);
  assert.equal(report.auto_send_status, 'pending');
  assert.equal(report.auto_send_at.getTime() - report.survey_sent_at.getTime(), 24 * 3600000);
  const deadline = report.auto_send_at.getTime();
  const org = await findOne('organizations', {id: lead.organizationId});
  await maybeReleaseCultureReport(org);
  report = await findOne('culture_reports', {id: report.id});
  assert.equal(report.auto_send_at.getTime(), deadline);
  assert.equal((await releaseDueCultureReports()).checked, 0);
  await updateOne('culture_reports', {id: report.id}, {auto_send_at: new Date(Date.now() - 1000)});
  const preview = await releaseDueCultureReports({dryRun: true});
  assert.equal(preview.checked, 1);
  assert.deepEqual(preview.results, []);
  assert.equal(await collection('culture_report_files').countDocuments({organization_id: org.id}), 0);
  await assert.rejects(getCultureSurvey(org.id), {status: 410});
  await assert.rejects(submitCultureSurvey(org.id, {}), {status: 410});
  const concurrent = await Promise.all([releaseDueCultureReports(), releaseDueCultureReports()]);
  assert.equal(concurrent.flatMap((row) => row.results).length, 1);
  report = await findOne('culture_reports', {id: report.id});
  assert.equal(report.auto_send_status, 'failed');
  assert.equal(report.auto_send_error, 'smtp_unconfigured');
  assert.equal(report.auto_send_attempts, 1);
  assert.ok(report.informe);
  assert.equal(await collection('culture_report_files').countDocuments({organization_id: org.id}), 1);
  await releaseDueCultureReports();
  report = await findOne('culture_reports', {id: report.id});
  assert.equal(report.auto_send_attempts, 2);
  assert.equal(report.coverage.respondents, 0);
  assert.equal(await collection('culture_report_files').countDocuments({organization_id: org.id}), 2);
  await updateOne('culture_reports', {id: report.id}, {auto_send_attempts: 5});
  assert.equal((await releaseDueCultureReports({dryRun: true})).checked, 0);
  console.log('PASS 24h scheduling without responses, stable deadline, closed survey, empty PDF, concurrent delivery and SMTP retry');
} finally {
  if (db?.databaseName.startsWith('test_culture_delivery_')) await db.dropDatabase();
  await closeDatabase();
}
