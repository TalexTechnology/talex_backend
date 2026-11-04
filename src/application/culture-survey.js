import {randomUUID} from 'node:crypto';
import {findMany, findOne, insertOne} from '../domain/store.js';
import {ApiError} from '../http.js';
import {maybeReleaseCultureReport} from './culture-report.js';
import {releaseDueCultureReports} from './culture-report-auto.js';
import {
  EMPLOYEE_CULTURE_BANK,
  loadCompanyCultureQuestions,
  validateCultureAnswers,
} from './culture-employee-survey.js';

async function leadFor(organizationId) {
  const rows = await findMany(
    'culture_leads',
    {organization_id: organizationId},
    {sort: {created_at: 1}, limit: 1},
  );
  return rows[0] || null;
}

export async function getCultureSurvey(organizationId) {
  const organization = await findOne('organizations', {id: organizationId});
  if (!organization) throw new ApiError(404, 'company_not_found');
  await assertSurveyOpen(organization.id);
  const lead = await leadFor(organization.id);
  const survey = await loadCompanyCultureQuestions(organization, lead);
  return {
    organizationId: organization.id,
    organizationName: organization.name,
    bank: EMPLOYEE_CULTURE_BANK,
    title: survey.title,
    intro: survey.intro,
    questions: survey.questions,
  };
}

export async function submitCultureSurvey(organizationId, body, {baseUrl} = {}) {
  const organization = await findOne('organizations', {id: organizationId});
  if (!organization) throw new ApiError(404, 'company_not_found');
  await assertSurveyOpen(organization.id);
  const lead = await leadFor(organization.id);
  const {questions} = await loadCompanyCultureQuestions(organization, lead);
  const answers = validateCultureAnswers(questions, body?.answers);
  const sessionId = randomUUID();
  const now = new Date();
  await insertOne('survey_sessions', {
    id: sessionId,
    bank: EMPLOYEE_CULTURE_BANK,
    purpose: 'culture_perception',
    organization_id: organization.id,
    status: 'completed',
    locale: 'es',
    source: 'mi-cultura',
    declared_values: questions.find((item) => item.id === 'D01')?.items || [],
    started_at: now,
    completed_at: now,
  });
  for (const question of questions) {
    const value = answers[question.id];
    const stored = {...value};
    if (question.format === 'value_coherence') stored.items = question.items || [];
    await insertOne('survey_answers', {
      id: randomUUID(),
      session_id: sessionId,
      organization_id: organization.id,
      question_id: question.id,
      question_code: question.code,
      format: question.format,
      value: stored,
      value_int: Number.isInteger(value.forecast) ? value.forecast : null,
      value_text: value.value_text || value.value || null,
      statement_a: question.statement,
      created_at: now,
      updated_at: now,
    });
  }
  const report = await maybeReleaseCultureReport(organization, {baseUrl});
  const dueAt = report?.auto_send_at ? new Date(report.auto_send_at) : null;
  if (dueAt && dueAt <= new Date() && report?.auto_send_status !== 'sent') {
    try {
      await releaseDueCultureReports({baseUrl});
    } catch (error) {
      console.error('culture auto-send flush failed', error.code || error.message);
    }
  }
  return {
    success: true,
    sessionId,
    organizationId: organization.id,
    reportStatus: report?.status || 'collecting',
    autoSendAt: report?.auto_send_at || null,
    reportUrl: report?.report_url || null,
  };
}

async function assertSurveyOpen(organizationId) {
  const report = await findOne('culture_reports', {organization_id: organizationId});
  if (report?.auto_send_at && new Date(report.auto_send_at).getTime() <= Date.now()) {
    throw new ApiError(410, 'survey_closed', 'El plazo para responder terminó. El informe se prepara con las respuestas recibidas hasta el cierre.');
  }
}
