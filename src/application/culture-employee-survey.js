import {findMany} from '../domain/store.js';
import {ApiError} from '../http.js';

export const EMPLOYEE_CULTURE_BANK = 'employee-culture-v1';

function asList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    return value.split(/[,|;]/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function uniqueTexts(values) {
  const seen = new Set();
  const next = [];
  for (const raw of values) {
    const label = String(raw?.label ?? raw?.name ?? raw ?? '').trim();
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    next.push({
      id: String(raw?.id || `v${next.length + 1}`),
      label,
      dimension: raw?.dimension || null,
    });
  }
  return next;
}

export function declaredValuesFor(organization, lead, fallback = []) {
  const configured = uniqueTexts([
    ...asList(organization?.declared_values),
    ...asList(organization?.values),
    ...asList(organization?.culture_values),
  ]);
  if (configured.length) return configured;
  const fromLead = uniqueTexts(asList(lead?.perceived_culture));
  if (fromLead.length) return fromLead;
  return uniqueTexts(fallback);
}

export function areasFor(organization, fallback = []) {
  const configured = uniqueTexts([
    ...asList(organization?.areas),
    ...asList(organization?.departments),
  ]);
  return configured.length ? configured : uniqueTexts(fallback);
}

export function hydrateCompanyCultureQuestions(rows, organization, lead) {
  return (rows || [])
    .filter((row) => row && row.kind !== 'survey' && row.is_active !== false)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map((row) => {
      const source = row.options_source || 'static';
      const fallback = row.fallback_options || [];
      let options = uniqueTexts(row.options || []);
      let items = uniqueTexts(row.items || []);
      if (source === 'declared_values') items = declaredValuesFor(organization, lead, fallback);
      if (source === 'organization_areas') options = areasFor(organization, fallback);
      return {
        id: row.code,
        code: row.code,
        section: row.section,
        sectionTitle: row.section_title,
        name: row.name,
        technique: row.technique,
        statement: row.statement,
        instruction: row.instruction,
        format: row.format,
        options,
        required: row.required !== false,
        askForecast: Boolean(row.ask_forecast),
        forecastPrompt: row.forecast_prompt || '',
        items,
        scale: row.scale || [],
        yesCount: row.yes_count ?? null,
        noCount: row.no_count ?? null,
        maxLength: row.max_length ?? null,
      };
    });
}

export function surveyCopyFrom(rows) {
  const survey = (rows || []).find((row) => row.kind === 'survey');
  return {
    title: survey?.title || 'Encuesta de cultura para empleados',
    intro:
      survey?.intro ||
      'Responda con calma. No hay respuestas correctas: nos interesa cómo se vive el trabajo en su organización.',
  };
}

export async function loadCompanyCultureQuestions(organization, lead) {
  const rows = await findMany(
    'company_culture_questions',
    {bank: EMPLOYEE_CULTURE_BANK, is_active: true},
    {sort: {sort_order: 1}, limit: 200},
  );
  const questions = hydrateCompanyCultureQuestions(rows, organization, lead);
  if (!questions.length) {
    throw new ApiError(503, 'survey_missing', 'La encuesta de cultura aún no está publicada.');
  }
  return {...surveyCopyFrom(rows), questions};
}

function optionIds(question) {
  return new Set((question.options || question.items || []).map((item) => item.id));
}

function pick(raw) {
  return raw && typeof raw === 'object' ? raw : {};
}

function asIdList(value) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

export function normalizeCultureAnswer(question, raw) {
  const body = pick(raw);
  if (question.format === 'most_least') {
    const most = String(body.most ?? body.most_id ?? '').trim();
    const least = String(body.least ?? body.least_id ?? '').trim();
    const forecastRaw = body.forecast ?? body.forecast_percent ?? body.value_int;
    const forecast = question.askForecast ? Number(forecastRaw) : null;
    return {most, least, forecast: Number.isInteger(forecast) ? forecast : null};
  }
  if (question.format === 'value_coherence') {
    const ratings = body.ratings && typeof body.ratings === 'object' ? body.ratings : {};
    return {
      ratings: Object.fromEntries(
        (question.items || []).map((item) => [item.id, String(ratings[item.id] || '').trim()]),
      ),
    };
  }
  if (question.format === 'pick_yes_no') {
    return {yes: asIdList(body.yes), no: asIdList(body.no ?? body.no_expect)};
  }
  if (question.format === 'text') {
    return {value_text: String(body.value_text ?? body.value ?? '').trim()};
  }
  return {value: String(body.value ?? body.value_text ?? body.value_int ?? '').trim()};
}

export function validateCultureAnswers(questions, answers) {
  const bag = answers && typeof answers === 'object' ? answers : {};
  const normalized = {};
  for (const question of questions) {
    const value = normalizeCultureAnswer(question, bag[question.id] || bag[question.code]);
    if (question.format === 'most_least') {
      const ids = optionIds(question);
      if (!ids.has(value.most) || !ids.has(value.least) || value.most === value.least) {
        throw new ApiError(400, 'missing_answers', `Falta marcar más y menos probable en ${question.id}.`);
      }
      if (question.askForecast && (!Number.isInteger(value.forecast) || value.forecast < 0 || value.forecast > 100)) {
        throw new ApiError(400, 'missing_answers', `Indique un pronóstico de 0 a 100 en ${question.id}.`);
      }
    } else if (question.format === 'value_coherence') {
      const allowed = new Set((question.scale || []).map((item) => item.id));
      if ((question.items || []).some((item) => !allowed.has(value.ratings[item.id]))) {
        throw new ApiError(400, 'missing_answers', 'Califique cada valor declarado.');
      }
    } else if (question.format === 'pick_yes_no') {
      const ids = optionIds(question);
      const yes = [...new Set(value.yes)];
      const no = [...new Set(value.no)];
      if (
        yes.length !== question.yesCount ||
        no.length !== question.noCount ||
        yes.some((item) => no.includes(item) || !ids.has(item)) ||
        no.some((item) => !ids.has(item))
      ) {
        throw new ApiError(400, 'missing_answers', 'Marque 4 que sí y 3 que no espere, sin repetir.');
      }
      value.yes = yes;
      value.no = no;
    } else if (question.format === 'text') {
      if (!value.value_text) throw new ApiError(400, 'missing_answers', 'Complete la frase abierta.');
      if (value.value_text.length > (question.maxLength || 280)) {
        throw new ApiError(400, 'invalid_answer', 'La respuesta abierta es demasiado larga.');
      }
    } else if (!optionIds(question).has(value.value)) {
      throw new ApiError(400, 'missing_answers', `Elija una opción en ${question.id}.`);
    }
    normalized[question.id] = value;
  }
  return normalized;
}
