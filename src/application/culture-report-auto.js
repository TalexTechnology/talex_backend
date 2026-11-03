import {config} from '../config.js';
import {count, findMany, findOne, updateOne} from '../domain/store.js';
import {DEFAULT_AREAS, parseEmployeeCount, parsePlantilla} from '../domain/culture-model.js';
import {publishCultureReportPdf} from './culture-report-send.js';

export const CULTURE_AUTO_ACTOR = {
  isSuperadmin: true,
  profile: {id: 'culture-auto-send', email: 'talex.admin@talex.com.co'},
  membership: null,
};

function alreadySent(report) {
  return (
    report?.auto_send_status === 'sent' ||
    report?.pdf_email_status === 'sent' ||
    Boolean(report?.pdf_sent_to)
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
  const respondents = await count('survey_sessions', {
    organization_id: organization.id,
    purpose: 'culture_perception',
    status: 'completed',
  });
  const employeeCount = parseEmployeeCount(
    organization.employee_count ?? lead?.employee_count ?? respondents,
  );
  let plantilla = parsePlantilla(
    organization.headcount_by_area ?? lead?.headcount_by_area,
    DEFAULT_AREAS,
  );
  if (!plantilla.length && employeeCount) {
    plantilla = [{id: 'otra', label: 'Otra', n: employeeCount}];
  }
  return {employeeCount, plantilla};
}

export async function releaseDueCultureReports({baseUrl} = {}) {
  const now = new Date();
  const due = await findMany('culture_reports', {
    auto_send_at: {$lte: now},
    auto_send_status: {$in: ['pending', 'failed']},
  }, {limit: 20});
  const results = [];
  for (const report of due) {
    if (alreadySent(report) || (report.auto_send_attempts || 0) >= 5) continue;
    const organization = await findOne('organizations', {id: report.organization_id});
    if (!organization) {
      await updateOne('culture_reports', {id: report.id}, {
        auto_send_status: 'failed',
        auto_send_error: 'company_not_found',
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
          refresh: true,
          send: true,
        },
        {baseUrl: baseUrl || 'https://api.talex.com.co'},
      );
      const status = sent.email?.status === 'sent' ? 'sent' : sent.email?.status || 'failed';
      await updateOne('culture_reports', {id: report.id}, {
        status: status === 'sent' ? 'sent' : 'generated',
        auto_send_status: status,
        auto_send_attempts: (report.auto_send_attempts || 0) + 1,
        auto_send_error: status === 'sent' ? null : sent.email?.status || 'send_failed',
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
        updated_at: new Date(),
      });
      console.error('auto culture report failed', organization.id, error.code || error.message);
      results.push({organizationId: organization.id, status: 'failed', reason: error.code || error.message});
    }
  }
  return {ok: true, delayHours: Number(config.cultureReportDelayHours) || 24, checked: due.length, results};
}
