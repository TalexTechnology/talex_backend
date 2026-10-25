import {randomUUID} from 'node:crypto';
import {findMany, findOne, insertOne} from '../domain/store.js';
import {ApiError} from '../http.js';
import {maybeReleaseCultureReport} from './culture-report.js';
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
    started_at: now,
    completed_at: now,
  });
  for (const question of questions) {
    const value = answers[question.id];
    await insertOne('survey_answers', {
      id: randomUUID(),
      session_id: sessionId,
      organization_id: organization.id,
      question_id: question.id,
      question_code: question.code,
      format: question.format,
      value,
      value_int: Number.isInteger(value.forecast) ? value.forecast : null,
      value_text: value.value_text || value.value || null,
      statement_a: question.statement,
      created_at: now,
      updated_at: now,
    });
  }
  const report = await maybeReleaseCultureReport(organization, {baseUrl});
  return {
    success: true,
    sessionId,
    organizationId: organization.id,
    reportStatus: report?.status || 'collecting',
    reportUrl: report?.report_url || null,
  };
}
