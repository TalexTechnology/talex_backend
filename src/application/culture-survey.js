import {randomUUID} from 'node:crypto';
import {findMany, findOne, insertOne} from '../domain/store.js';
import {ApiError} from '../http.js';
import {cultureSurveyPageHtml} from './culture-survey-page.js';
import {maybeReleaseCultureReport} from './culture-report.js';

const CULTURE_SLUG = 'culture-perception';

async function cultureVersion() {
  const template = await findOne('survey_templates', {slug: CULTURE_SLUG});
  if (!template) return null;
  const versions = await findMany('survey_versions', {template_id: template.id}, {limit: 20});
  const rank = {published: 0, draft: 1};
  versions.sort(
    (a, b) =>
      (rank[a.status] ?? 2) - (rank[b.status] ?? 2) || b.version_number - a.version_number,
  );
  return versions[0] || null;
}

async function cultureQuestions(versionId) {
  const sections = await findMany('survey_sections', {version_id: versionId}, {limit: 50});
  if (!sections.length) return [];
  const questions = await findMany(
    'survey_questions',
    {section_id: {$in: sections.map((item) => item.id)}, is_active: {$ne: false}},
    {limit: 500},
  );
  questions.sort(
    (a, b) => (a.sort_order || 0) - (b.sort_order || 0) || String(a.code).localeCompare(String(b.code)),
  );
  const sectionById = new Map(sections.map((item) => [item.id, item]));
  const payloads = [];
  for (const question of questions) {
    const section = sectionById.get(question.section_id) || {};
    const options = await findMany(
      'survey_options',
      {question_id: question.id},
      {sort: {sort_order: 1, value_int: 1}, limit: 20},
    );
    payloads.push({
      id: question.id,
      code: question.code,
      section: section.code || 'cultura',
      sectionTitle: section.title || section.code || 'Cultura',
      format: question.format || 'scale',
      instruction: question.instruction || '',
      statement: question.statement_a || question.code,
      options: options.length
        ? options.map((item) => item.label)
        : ['Muy en desacuerdo', 'En desacuerdo', 'Ni de acuerdo ni en desacuerdo', 'De acuerdo', 'Muy de acuerdo'],
      required: question.is_required !== false,
    });
  }
  return payloads;
}

export async function getCultureSurvey(organizationId) {
  const organization = await findOne('organizations', {id: organizationId});
  if (!organization) throw new ApiError(404, 'company_not_found');
  const version = await cultureVersion();
  const questions = version ? await cultureQuestions(version.id) : [];
  return {
    organizationId: organization.id,
    organizationName: organization.name,
    title: 'Diagnóstico cultural',
    intro:
      'Responda con calma. No hay respuestas correctas: nos interesa cómo se vive el trabajo en su organización.',
    questions,
  };
}

export async function submitCultureSurvey(organizationId, body, {baseUrl} = {}) {
  const organization = await findOne('organizations', {id: organizationId});
  if (!organization) throw new ApiError(404, 'company_not_found');
  const version = await cultureVersion();
  if (!version) throw new ApiError(404, 'survey_missing');
  const questions = await cultureQuestions(version.id);
  if (!questions.length) throw new ApiError(404, 'survey_missing');
  const answers = body?.answers && typeof body.answers === 'object' ? body.answers : {};
  for (const question of questions) {
    if (!question.required) continue;
    const raw = answers[question.id] || answers[question.code];
    if (question.format === 'text') {
      if (!String(raw?.value_text ?? raw?.value ?? '').trim()) {
        throw new ApiError(400, 'missing_answers');
      }
    } else if (!Number.isInteger(Number(raw?.value_int ?? raw?.value))) {
      throw new ApiError(400, 'missing_answers');
    }
  }
  const sessionId = randomUUID();
  const now = new Date();
  await insertOne('survey_sessions', {
    id: sessionId,
    version_id: version.id,
    purpose: 'culture_perception',
    organization_id: organization.id,
    status: 'completed',
    locale: 'es',
    source: 'mi-cultura',
    started_at: now,
    completed_at: now,
  });
  for (const question of questions) {
    const raw = answers[question.id] || answers[question.code] || {};
    const valueInt = Number(raw.value_int ?? raw.value);
    const textValue = question.format === 'text' ? raw.value : '';
    const valueText = String(raw.value_text ?? textValue ?? '').trim();
    if (!Number.isInteger(valueInt) && !valueText) continue;
    await insertOne('survey_answers', {
      id: randomUUID(),
      session_id: sessionId,
      question_id: question.id,
      question_code: question.code,
      format: question.format,
      value_int: Number.isInteger(valueInt) ? valueInt : null,
      value_text: valueText || null,
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

export function renderCultureSurveyPage(organizationId) {
  return cultureSurveyPageHtml(organizationId);
}
