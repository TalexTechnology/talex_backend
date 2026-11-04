import {findMany, findOne, updateOne} from '../domain/store.js';
import {parseEmployeeCount, parsePlantilla} from '../domain/culture-model.js';
import {publishCultureReportPdf} from './culture-report-send.js';
import {connectDatabase, collection, driverOptions} from '../db.js';
import {cultureCoverage} from './culture-report.js';
import {cultureReminderEmail, sendMail, smtpReady} from '../mail.js';

export const CULTURE_AUTO_ACTOR = {
  isSuperadmin: true,
  profile: {id: 'culture-auto-send', email: 'talex.admin@talex.com.co'},
  membership: null,
};

function alreadySent(report) {
  return (
    report?.auto_send_status === 'sent' ||
    report?.pdf_email_status === 'sent' ||
    Boolean(report?.pdf_sent_at)
  );
}

async function leadFor(organizationId) {
  const rows = await findMany(
    'culture_leads',
    {organization_id: organizationId},
    {sort: {created_at: 1}, limit: 1},
  );
  return rows[0] || null;
}

async function headcountFor(organization, lead) {
  const employeeCount = parseEmployeeCount(
    organization.employee_count ?? lead?.employee_count,
  );
  const plantilla = parsePlantilla(
    organization.headcount_by_area ?? lead?.headcount_by_area,
  );
  return {employeeCount, plantilla};
}

export function cultureReminderStage(elapsedHours) {
  if (!Number.isFinite(elapsedHours) || elapsedHours < 24) return null;
  if (elapsedHours >= 72) return 72;
  if (elapsedHours >= 48) return 48;
  return 24;
}

export function belowReminderParticipationThreshold(respondents, headcount) {
  return Number.isFinite(respondents) && Number.isFinite(headcount) && headcount > 0 && respondents * 2 < headcount;
}

async function extendPendingCultureDeadlines() {
  const pendingReports = await findMany('culture_reports', {
    auto_send_at: {$exists: true},
    auto_send_status: {$in: ['pending', 'failed']},
    pdf_sent_at: null,
    pdf_email_status: {$ne: 'sent'},
  }, {limit: 5000});
  for (const report of pendingReports) {
    const lead = await findOne('culture_leads', {
      organization_id: report.organization_id,
      delivery_policy: 'fixed_24h',
    }, {created_at: -1}) || await leadFor(report.organization_id);
    if (!lead) continue;
    const invitedAt = new Date(report.survey_sent_at || lead.survey_sent_at || lead.created_at);
    if (!Number.isFinite(invitedAt.getTime())) continue;
    const expectedSendAt = new Date(invitedAt.getTime() + 72 * 3600000);
    if (new Date(report.auto_send_at).getTime() < expectedSendAt.getTime()) {
      await updateOne('culture_reports', {id: report.id}, {
        auto_send_at: expectedSendAt,
        updated_at: new Date(),
      });
    }
    if (lead.delivery_policy !== 'fixed_72h') {
      await updateOne('culture_leads', {id: lead.id}, {
        delivery_policy: 'fixed_72h',
        updated_at: new Date(),
      });
    }
  }
}

async function sendDueCultureReminders(now, {dryRun = false} = {}) {
  const leads = await findMany('culture_leads', {
    email_status: 'sent',
    delivery_policy: 'fixed_72h',
    survey_sent_at: {$lte: new Date(now.getTime() - 24 * 3600000)},
  }, {sort: {survey_sent_at: 1}, limit: 500});
  const outcomes = [];
  for (const lead of leads) {
    const sentAt = new Date(lead.survey_sent_at).getTime();
    const stage = cultureReminderStage((now.getTime() - sentAt) / 3600000);
    if (!stage) continue;
    const statusField = `reminder_${stage}_status`;
    const leaseField = `reminder_${stage}_lease_until`;
    if (lead[statusField] === 'sent') continue;
    const snapshot = await cultureCoverage(lead.organization_id);
    if (!snapshot) continue;
    const headcount = parseEmployeeCount(
      lead.employee_count ?? snapshot.organization.employee_count,
    ) || snapshot.coverage.estimatedHeadcount;
    if (!belowReminderParticipationThreshold(snapshot.coverage.respondents, headcount)) continue;
    if (dryRun) {
      outcomes.push({stage, status: 'would_send'});
      continue;
    }
    if (!smtpReady() || !lead.email) {
      outcomes.push({stage, status: 'skipped'});
      continue;
    }

    await connectDatabase();
    const claimed = await collection('culture_leads').findOneAndUpdate({
      id: lead.id,
      $or: [
        { [statusField]: {$exists: false} },
        { [statusField]: {$in: ['pending', 'failed']} },
        { $and: [{ [statusField]: 'sending' }, { [leaseField]: {$lte: now} }] },
      ],
    }, {$set: {
      [statusField]: 'sending',
      [leaseField]: new Date(now.getTime() + 5 * 60000),
      [`reminder_${stage}_attempted_at`]: now,
      updated_at: now,
    }}, {...driverOptions(), returnDocument: 'after'});
    if (!claimed) continue;

    try {
      const email = cultureReminderEmail({
        stage,
        contactName: lead.contact_name,
        companyName: lead.company_name,
        surveyUrl: lead.survey_url,
        employeeCount: parseEmployeeCount(lead.employee_count),
      });
      await sendMail({to: lead.email, ...email});
      await updateOne('culture_leads', {id: lead.id}, {
        [statusField]: 'sent',
        [leaseField]: null,
        [`reminder_${stage}_sent_at`]: new Date(),
        [`reminder_${stage}_error`]: null,
        updated_at: new Date(),
      });
      outcomes.push({stage, status: 'sent'});
    } catch (error) {
      await updateOne('culture_leads', {id: lead.id}, {
        [statusField]: 'failed',
        [leaseField]: null,
        [`reminder_${stage}_error`]: error.code || error.message,
        updated_at: new Date(),
      });
      console.error('culture reminder failed', lead.id, stage, error.code || error.message);
      outcomes.push({stage, status: 'failed'});
    }
  }
  return outcomes;
}

export async function releaseDueCultureReports({baseUrl, dryRun = false} = {}) {
  const now = new Date();
  if (!dryRun) await extendPendingCultureDeadlines();
  const reminders = await sendDueCultureReminders(now, {dryRun});
  const due = await findMany('culture_reports', {
    auto_send_at: {$lte: now},
    auto_send_status: {$in: ['pending', 'failed']},
    pdf_sent_at: null,
    pdf_email_status: {$ne: 'sent'},
    $or: [{auto_send_attempts: {$lt: 5}}, {auto_send_attempts: {$exists: false}}],
  }, {limit: 20});
  if (dryRun) return {ok: true, checked: due.length, results: [], reminders, dryRun: true};
  const results = [];
  for (const report of due) {
    if (alreadySent(report) || (report.auto_send_attempts || 0) >= 5) continue;
    await connectDatabase();
    const claimed = await collection('culture_reports').findOneAndUpdate({
      id: report.id,
      auto_send_status: {$in: ['pending', 'failed']},
      $or: [{auto_send_lease_until: null}, {auto_send_lease_until: {$lte: now}}],
    }, {$set: {auto_send_lease_until: new Date(now.getTime() + 5 * 60000)}},
    {...driverOptions(), returnDocument: 'after'});
    if (!claimed) continue;
    const organization = await findOne('organizations', {id: report.organization_id});
    if (!organization) {
      await updateOne('culture_reports', {id: report.id}, {
        auto_send_status: 'failed',
        auto_send_error: 'company_not_found',
        auto_send_lease_until: null,
        updated_at: new Date(),
      });
      results.push({organizationId: report.organization_id, status: 'failed', reason: 'company_not_found'});
      continue;
    }
    const lead = await leadFor(organization.id);
    const headcount = await headcountFor(organization, lead);
    try {
      const sent = await publishCultureReportPdf(
        CULTURE_AUTO_ACTOR,
        {
          p_organization_id: organization.id,
          p_total_empleados: headcount.employeeCount,
          p_plantilla_por_area: headcount.plantilla,
          allow_sparse: true,
          refresh: true,
          send: true,
        },
        {baseUrl: baseUrl || 'https://api.talex.com.co'},
      );
      const status = sent.email?.status === 'sent' ? 'sent' : 'failed';
      await updateOne('culture_reports', {id: report.id}, {
        status: status === 'sent' ? 'sent' : 'generated',
        auto_send_status: status,
        auto_send_attempts: (report.auto_send_attempts || 0) + 1,
        auto_send_error: status === 'sent' ? null : sent.email?.status || 'send_failed',
        auto_send_lease_until: null,
        updated_at: new Date(),
      });
      results.push({
        organizationId: organization.id,
        organizationName: organization.name,
        status,
        to: sent.email?.to || null,
      });
    } catch (error) {
      await updateOne('culture_reports', {id: report.id}, {
        auto_send_status: 'failed',
        auto_send_attempts: (report.auto_send_attempts || 0) + 1,
        auto_send_error: error.code || error.message,
        auto_send_lease_until: null,
        updated_at: new Date(),
      });
      console.error('auto culture report failed', organization.id, error.code || error.message);
      results.push({organizationId: organization.id, status: 'failed', reason: error.code || error.message});
    }
  }
  const reminderFailures = reminders.filter((item) => item.status === 'failed').length;
  return {
    ok: true,
    delayHours: 72,
    checked: due.length,
    results,
    reminders,
    reminderFailures,
  };
}
