import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

process.env.MONGODB_DB = `test_culture_delivery_${randomUUID().replaceAll('-', '')}`;
process.env.SMTP_HOST = '';
const {cultureShareEmail, cultureReminderEmail, cultureReportPdfEmail, cultureReportReadyEmail} = await import('../src/mail.js');
const {createCultureLead} = await import('../src/application/culture-leads.js');
const {maybeReleaseCultureReport} = await import('../src/application/culture-report.js');
const {releaseDueCultureReports} = await import('../src/application/culture-report-auto.js');
const {getCultureSurvey, submitCultureSurvey} = await import('../src/application/culture-survey.js');
const {cultureFollowupSchedule, addCultureBusinessDays, FOLLOWUP_DAY_MS: DAY} = await import('../src/application/culture-followup.js');
const {confirmCultureShared} = await import('../src/application/culture-tracking.js');
const {connectDatabase, closeDatabase, collection} = await import('../src/db.js');
const {findOne, updateOne} = await import('../src/domain/store.js');

for (const count of [20, 1000, undefined]) {
  const mail = cultureShareEmail({
    companyName: 'Empresa <segura>', contactName: 'Contacto', employeeCount: count,
    surveyUrl: 'https://platform.talex.com.co/cultura/test',
  });
  for (const body of [mail.text, mail.html]) {
    assert.doesNotMatch(body, /384|fórmula|umbral|mínimo|1 a 50|1 – 50|alcanzar ese/i);
    assert.doesNotMatch(body, /72 horas/);
    assert.match(body, /período de participación/);
    assert.match(body, /respuestas recibidas/);
    if (count === 20) assert.match(body, /20 personas/);
  }
  assert.doesNotMatch(mail.html, /Empresa <segura>/);
}
const reminder24 = cultureReminderEmail({
  stage: 24, contactName: 'Contacto', companyName: 'Empresa', employeeCount: 20,
  surveyUrl: 'https://platform.talex.com.co/cultura/test',
});
const reminder48 = cultureReminderEmail({
  stage: 48, contactName: 'Contacto', companyName: 'Empresa',
  surveyUrl: 'https://platform.talex.com.co/cultura/test',
});
const reminder72 = cultureReminderEmail({stage: 72, contactName: 'Contacto', companyName: 'Empresa', surveyUrl: 'https://platform.talex.com.co/cultura/test'});
assert.equal(reminder24.subject, '¿Pudiste compartir el enlace con tu equipo?');
assert.match(reminder24.text, /20 personas/);
assert.match(reminder24.html, /Copiar el enlace para mi equipo/);
assert.match(reminder48.subject, /Contacto/);
assert.match(reminder48.html, /Compartir el diagnóstico con mi equipo/);
assert.match(reminder72.subject, /Dejamos la puerta abierta/);
for (const reminder of [reminder24, reminder48, reminder72]) {
  assert.doesNotMatch(reminder.text + reminder.html, /50%|mitad|umbral/i);
}
assert.match(reminder72.text, /un día hábil más/);
assert.match(reminder72.html, /Compartir el diagnóstico/);
const invited = new Date('2026-11-02T10:00:00Z');
const clock = new Date(invited.getTime() + 80 * 3600000);
const planLead = {survey_sent_at: invited};
let plan = cultureFollowupSchedule(planLead, {now: clock});
assert.equal(plan.nextReminder.stage, 24); // Un proceso atrasado no salta al tercero.
assert.equal(plan.sendAt.getTime(), addCultureBusinessDays(invited, 4).getTime());
planLead.reminder_24_status = 'sent';
planLead.reminder_24_sent_at = clock;
plan = cultureFollowupSchedule(planLead, {now: clock});
assert.equal(plan.nextReminder.stage, 48);
assert.equal(plan.nextReminder.dueAt.getTime(), addCultureBusinessDays(clock).getTime());
assert.equal(plan.sendAt.getTime(), addCultureBusinessDays(clock, 3).getTime());
planLead.reminder_48_status = 'sent';
planLead.reminder_48_sent_at = new Date(addCultureBusinessDays(clock).getTime());
plan = cultureFollowupSchedule(planLead, {now: clock});
assert.equal(plan.nextReminder.stage, 72);
assert.equal(plan.nextReminder.dueAt.getTime(), addCultureBusinessDays(clock, 2).getTime());
planLead.reminder_72_status = 'sent';
planLead.reminder_72_sent_at = new Date(addCultureBusinessDays(clock, 2).getTime());
plan = cultureFollowupSchedule(planLead, {now: clock});
assert.equal(plan.nextReminder, null);
assert.equal(plan.sendAt.getTime(), addCultureBusinessDays(clock, 3).getTime());
plan = cultureFollowupSchedule(planLead, {confirmedAt: clock, now: clock});
assert.equal(plan.nextReminder, null);
assert.equal(plan.sendAt.getTime(), addCultureBusinessDays(clock).getTime());
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
  assert.equal(report.auto_send_at.getTime() - report.survey_sent_at.getTime(), addCultureBusinessDays(report.survey_sent_at, 4).getTime() - report.survey_sent_at.getTime());
  await updateOne('culture_leads', {organization_id: lead.organizationId}, {delivery_policy: 'fixed_24h'});
  await updateOne('culture_reports', {id: report.id}, {
    auto_send_at: new Date(report.survey_sent_at.getTime() + 24 * 3600000),
  });
  await releaseDueCultureReports();
  report = await findOne('culture_reports', {id: report.id});
  assert.equal(report.auto_send_at.getTime() - report.survey_sent_at.getTime(), addCultureBusinessDays(report.survey_sent_at, 4).getTime() - report.survey_sent_at.getTime());
  assert.equal((await findOne('culture_leads', {organization_id: lead.organizationId})).delivery_policy, 'reminders_weekdays_v3');
  const deadline = report.auto_send_at.getTime();
  const org = await findOne('organizations', {id: lead.organizationId});
  await maybeReleaseCultureReport(org);
  report = await findOne('culture_reports', {id: report.id});
  assert.equal(report.auto_send_at.getTime(), deadline);
  assert.equal((await releaseDueCultureReports()).checked, 0);
  await updateOne('culture_leads', {id: lead.id}, {
    email_status: 'sent', survey_sent_at: new Date(Date.now() - 80 * 3600000),
  });
  let previewReminders = await releaseDueCultureReports({dryRun: true});
  assert.equal(previewReminders.reminders[0].stage, 24);
  const lastReminderAt = new Date(Date.now() - 3600000);
  await updateOne('culture_leads', {id: lead.id}, {
    reminder_24_status: 'sent', reminder_24_sent_at: new Date(lastReminderAt.getTime() - 2 * DAY),
    reminder_48_status: 'sent', reminder_48_sent_at: new Date(lastReminderAt.getTime() - DAY),
    reminder_72_status: 'sent', reminder_72_sent_at: lastReminderAt,
  });
  await releaseDueCultureReports();
  report = await findOne('culture_reports', {id: report.id});
  assert.equal(report.auto_send_at.getTime(), addCultureBusinessDays(lastReminderAt).getTime());
  await getCultureSurvey(org.id); // El tercero no cierra la encuesta.
  assert.equal((await releaseDueCultureReports({dryRun: true})).checked, 0);
  await updateOne('culture_leads', {id: lead.id}, {reminder_72_sent_at: new Date(Date.now() - DAY - 1000)});
  await maybeReleaseCultureReport(org);
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
  const confirmationAt = new Date();
  await confirmCultureShared(org.id, {shareToken: lead.shareToken});
  const sharing = await findOne('culture_sharing', {organization_id: org.id});
  report = await findOne('culture_reports', {id: report.id});
  assert.ok(sharing.confirmed_at >= confirmationAt);
  assert.equal(report.auto_send_at.getTime(), addCultureBusinessDays(sharing.confirmed_at).getTime());
  assert.deepEqual((await releaseDueCultureReports({dryRun: true})).reminders, []);
  console.log('PASS sequential reminders, final 24h grace, confirmation stops reminders, empty PDF, concurrent delivery and SMTP retry');
} finally {
  if (db?.databaseName.startsWith('test_culture_delivery_')) await db.dropDatabase();
  await closeDatabase();
}
