import {randomUUID} from 'node:crypto';
import {count, findMany, findOne, insertOne, updateOne} from '../domain/store.js';
import {config} from '../config.js';
import {ApiError} from '../http.js';
import {cultureReportPageHtml} from './culture-report-page.js';
import {participationFor} from './culture-participation.js';
import {assertBankManager, resolveOrganizationId} from '../domain/tenancy.js';
import {DEFAULT_AREAS, parseEmployeeCount, parsePlantilla} from '../domain/culture-model.js';
import {loadCompanyCultureQuestions} from './culture-employee-survey.js';
import {listCultureResponses} from './culture-responses.js';
import {computeCultureMetrics} from './culture-metrics.js';
import {buildCultureInforme, informeSections} from './culture-diagnosis.js';
import {culturePdfView, getCultureReportPdfFile, listCultureReportPdfs} from './culture-report-file.js';

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

export function coverageFromCounts({respondents, employeeRange, employeeCount}) {
  const rule = participationFor(employeeRange, employeeCount);
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
      employeeCount: organization.employee_count,
    }),
  };
}

export async function getCultureReport(organizationId) {
  const snapshot = await cultureCoverage(organizationId);
  if (!snapshot) return null;
  const report = await findOne('culture_reports', {organization_id: organizationId});
  const respuestas = await listCultureResponses(organizationId);
  const files = await listCultureReportPdfs(organizationId);
  const latestPdf = await getCultureReportPdfFile(organizationId);
  return {
    organizationId: snapshot.organization.id,
    organizationName: snapshot.organization.name,
    format: report?.format ?? 'json',
    status: report?.status || (snapshot.coverage.reached ? 'ready' : 'collecting'),
    coverage: snapshot.coverage,
    sections: report?.sections || SECTION_OUTLINE.map((item) => ({...item, summary: null})),
    informe: report?.informe || null,
    respuestas,
    reportUrl: report?.report_url || null,
    sentAt: report?.pdf_sent_at || report?.sent_at || null,
    generatedAt: report?.generated_at || null,
    pendingFormat: !report?.informe,
    autoSend: {
      status: report?.auto_send_status || null,
      thresholdReachedAt: report?.threshold_reached_at || null,
      sendAt: report?.auto_send_at || null,
    },
    pdf: {
      latest: culturePdfView(organizationId, latestPdf),
      sentAt: report?.pdf_sent_at || null,
      sentTo: report?.pdf_sent_to || null,
      emailStatus: report?.pdf_email_status || latestPdf?.email_status || null,
      files,
    },
  };
}

async function leadFor(organizationId) {
  const rows = await findMany(
    'culture_leads',
    {organization_id: organizationId},
    {sort: {created_at: 1}, limit: 1},
  );
  return rows[0] || null;
}

export async function generatePublicDemoReport(organizationId) {
  const organization = await findOne('organizations', {id: organizationId});
  if (!organization || organization.source !== 'demo') {
    throw new ApiError(403, 'permission_denied', 'Este informe de prueba solo se genera para la empresa demo.');
  }
  return generateCultureReport(
    {isSuperadmin: true, profile: {id: 'demo-generator'}},
    {
      p_organization_id: organization.id,
      p_total_empleados: organization.employee_count,
      p_plantilla_por_area: organization.headcount_by_area,
    },
  );
}

export async function generateCultureReport(actor, body = {}) {
  assertBankManager(actor);
  const organizationId = await resolveOrganizationId(body.p_organization_id);
  const organization = organizationId ? await findOne('organizations', {id: organizationId}) : null;
  if (!organization) throw new ApiError(404, 'company_not_found');
  const lead = await leadFor(organization.id);
  const employeeCount = parseEmployeeCount(
    body.p_total_empleados ?? body.p_employee_count ?? organization.employee_count ?? lead?.employee_count,
  );
  const plantilla = parsePlantilla(
    body.p_plantilla_por_area ?? body.p_headcount_by_area ?? organization.headcount_by_area ?? lead?.headcount_by_area,
    DEFAULT_AREAS,
  );
  const allowSparse = body.allow_sparse === true;
  if (employeeCount == null && !allowSparse) {
    throw new ApiError(400, 'missing_headcount', 'Indica p_total_empleados (N de la empresa).');
  }
  if (!plantilla.length && !allowSparse) {
    throw new ApiError(400, 'missing_plantilla', 'Indica p_plantilla_por_area: [{area, n}, ...].');
  }
  if (employeeCount != null && plantilla.reduce((sum, item) => sum + item.n, 0) > employeeCount) {
    throw new ApiError(400, 'invalid_plantilla', 'La plantilla por área no puede sumar más que el total de empleados.');
  }
  await updateOne('organizations', {id: organization.id}, {
    ...(employeeCount != null ? {employee_count: employeeCount} : {}),
    ...(plantilla.length ? {
      headcount_by_area: plantilla,
      areas: plantilla.map((item) => ({id: item.id, label: item.label})),
    } : {}),
    updated_at: new Date(),
  });
  const sessions = await findMany('survey_sessions', {
    organization_id: organization.id,
    purpose: 'culture_perception',
    status: 'completed',
  }, {limit: 5000});
  const answers = sessions.length
    ? await findMany('survey_answers', {session_id: {$in: sessions.map((item) => item.id)}}, {limit: 5000})
    : [];
  const survey = await loadCompanyCultureQuestions(
    {...organization, employee_count: employeeCount, headcount_by_area: plantilla},
    lead,
  );
  const metrics = computeCultureMetrics({
    organization: {...organization, name: organization.name, employee_count: employeeCount},
    lead,
    questions: survey.questions,
    sessions,
    answers,
    totalEmpleados: employeeCount,
    plantilla,
    fechaCorte: new Date().toISOString().slice(0, 10),
  });
  const informe = buildCultureInforme(metrics);
  const now = new Date();
  const snapshot = await cultureCoverage(organization.id);
  const draft = {
    format: 'json',
    status: 'generated',
    coverage: snapshot?.coverage,
    sections: informeSections(informe),
    informe,
    generated_at: now,
    generated_by: actor.profile.id,
    email: lead?.email || null,
    updated_at: now,
  };
  const existing = await findOne('culture_reports', {organization_id: organization.id});
  const report = existing
    ? await updateOne('culture_reports', {id: existing.id}, draft)
    : await insertOne('culture_reports', {
        id: randomUUID(),
        organization_id: organization.id,
        email_status: existing?.email_status || 'pending',
        sent_at: existing?.sent_at || null,
        report_url: `${String(body.p_base_url || config.publicSurveyBase || 'https://platform.talex.com.co').replace(/\/$/, '')}/cultura/${organization.id}/informe`,
        created_at: now,
        ...draft,
      });
  return {
    organizationId: organization.id,
    organizationName: organization.name,
    status: report.status,
    generatedAt: report.generated_at,
    informe,
    coverage: report.coverage,
    sections: report.sections,
  };
}

export function renderCultureReportPage(organizationId) {
  return cultureReportPageHtml(organizationId);
}

function delayMs() {
  const hours = Number(config.cultureReportDelayHours);
  const safe = Number.isFinite(hours) && hours >= 0 ? hours : 24;
  return Math.round(safe * 60 * 60 * 1000);
}

function alreadyAutoSent(report) {
  return (
    report?.auto_send_status === 'sent' ||
    report?.pdf_email_status === 'sent' ||
    Boolean(report?.pdf_sent_at)
  );
}

export async function maybeReleaseCultureReport(organization) {
  const snapshot = await cultureCoverage(organization.id);
  if (!snapshot) return null;
  const existing = await findOne('culture_reports', {organization_id: organization.id});
  if (alreadyAutoSent(existing) || existing?.auto_send_at) return existing;
  const now = new Date();
  const lead = await findOne('culture_leads', {
    organization_id: organization.id, delivery_policy: 'fixed_24h',
  }, {created_at: -1}) || await leadFor(organization.id);
  const invitedAt = new Date(lead?.survey_sent_at || lead?.created_at || now);
  const draft = {
    status: 'waiting_delay',
    coverage: snapshot.coverage,
    email: lead?.email || existing?.email || null,
    threshold_reached_at: snapshot.coverage.reached ? now : null,
    survey_sent_at: invitedAt,
    auto_send_at: new Date(invitedAt.getTime() + delayMs()),
    auto_send_status: 'pending',
    auto_send_attempts: 0,
    updated_at: now,
  };
  if (existing) return updateOne('culture_reports', {id: existing.id}, draft);
  return insertOne('culture_reports', {
    id: randomUUID(),
    organization_id: organization.id,
    format: null,
    email_status: 'pending',
    sent_at: null,
    created_at: now,
    ...draft,
  });
}
