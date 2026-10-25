import {randomUUID} from 'node:crypto';
import {count, findMany, findOne, insertOne, updateOne} from '../domain/store.js';
import {config} from '../config.js';
import {cultureReportReadyEmail, sendMail, smtpReady} from '../mail.js';
import {cultureReportPageHtml} from './culture-report-page.js';
import {participationFor} from './culture-participation.js';

const SECTION_OUTLINE = [
  {code: 'cultura', title: 'Cultura vivida'},
  {code: 'liderazgo', title: 'Liderazgo y decisiones'},
  {code: 'trabajo', title: 'Forma de trabajar'},
  {code: 'personas', title: 'Personas y relaciones'},
  {code: 'apertura', title: 'Comentarios del equipo'},
];

export function ruleForRange(employeeRange) {
  return participationFor(employeeRange);
}

export function coverageFromCounts({respondents, employeeRange}) {
  const rule = participationFor(employeeRange);
  const override = config.cultureReportThreshold;
  const needed =
    override > 0 && override <= 1
      ? Math.max(rule.minimum, Math.ceil(rule.estimate * override))
      : rule.needed;
  const percent = rule.estimate ? respondents / rule.estimate : 0;
  return {
    employeeRange: rule.range,
    estimatedHeadcount: rule.estimate,
    respondents,
    percent: Math.round(percent * 1000) / 10,
    thresholdPercent: rule.estimate
      ? Math.round((needed / rule.estimate) * 1000) / 10
      : 0,
    needed,
    reached: respondents >= needed,
  };
}

async function employeeRangeFor(organization) {
  if (organization.size_label) return organization.size_label;
  const lead = await findOne('culture_leads', {organization_id: organization.id});
  return lead?.employee_range || '1 – 50';
}

async function recipientFor(organization) {
  const leads = await findMany(
    'culture_leads',
    {organization_id: organization.id},
    {sort: {created_at: 1}, limit: 1},
  );
  return leads[0] || null;
}

export async function cultureCoverage(organizationId) {
  const organization = await findOne('organizations', {id: organizationId});
  if (!organization) return null;
  const respondents = await count('survey_sessions', {
    organization_id: organizationId,
    purpose: 'culture_perception',
    status: 'completed',
  });
  return {
    organization,
    coverage: coverageFromCounts({
      respondents,
      employeeRange: await employeeRangeFor(organization),
    }),
  };
}

export async function getCultureReport(organizationId) {
  const snapshot = await cultureCoverage(organizationId);
  if (!snapshot) return null;
  const report = await findOne('culture_reports', {organization_id: organizationId});
  return {
    organizationId: snapshot.organization.id,
    organizationName: snapshot.organization.name,
    format: report?.format ?? null,
    status: report?.status || (snapshot.coverage.reached ? 'ready' : 'collecting'),
    coverage: snapshot.coverage,
    sections: report?.sections || SECTION_OUTLINE.map((item) => ({...item, summary: null})),
    reportUrl: report?.report_url || null,
    sentAt: report?.sent_at || null,
    pendingFormat: true,
  };
}

export function renderCultureReportPage(organizationId) {
  return cultureReportPageHtml(organizationId);
}

export async function maybeReleaseCultureReport(organization, {baseUrl} = {}) {
  const existing = await findOne('culture_reports', {organization_id: organization.id});
  if (existing?.status === 'sent') return existing;
  const snapshot = await cultureCoverage(organization.id);
  if (!snapshot?.coverage.reached) return existing || null;
  const lead = await recipientFor(organization);
  const reportUrl = `${String(baseUrl || '').replace(/\/$/, '')}/cultura/${organization.id}/informe`;
  const now = new Date();
  const draft = {
    format: null,
    status: 'ready',
    coverage: snapshot.coverage,
    sections: SECTION_OUTLINE.map((item) => ({...item, summary: null})),
    email: lead?.email || null,
    report_url: reportUrl,
    updated_at: now,
  };
  const report = existing
    ? await updateOne('culture_reports', {id: existing.id}, draft)
    : await insertOne('culture_reports', {
        id: randomUUID(),
        organization_id: organization.id,
        email_status: 'pending',
        sent_at: null,
        created_at: now,
        ...draft,
      });
  let emailStatus = 'skipped';
  if (lead?.email && smtpReady()) {
    try {
      await sendMail({
        to: lead.email,
        ...cultureReportReadyEmail({
          companyName: organization.name,
          contactName: lead?.contact_name,
          reportUrl,
          coverage: snapshot.coverage,
        }),
      });
      emailStatus = 'sent';
    } catch (error) {
      emailStatus = 'failed';
      console.error('culture report email failed', error.code || error.message);
    }
  } else if (!smtpReady()) {
    console.error('culture report email skipped: smtp_unconfigured');
  }
  return updateOne('culture_reports', {id: report.id}, {
    status: emailStatus === 'sent' ? 'sent' : 'ready',
    email_status: emailStatus,
    sent_at: emailStatus === 'sent' ? now : null,
    updated_at: new Date(),
  });
}
