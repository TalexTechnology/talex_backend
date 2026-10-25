import {randomUUID} from 'node:crypto';
import {ApiError} from '../http.js';
import {deleteMany, findMany, findOne, insertOne, updateMany, updateOne} from '../domain/store.js';
import {publicRow} from '../domain/rows.js';
import {assertBankManager, assertSignedIn} from '../domain/tenancy.js';

const COLLECTION = 'company_culture_questions';
const DEFAULT_BANK = 'employee-culture-v1';
const SURVEY_CODE = '_survey';

const FORMATS = new Set(['most_least', 'value_coherence', 'pick_yes_no', 'text', 'single']);
const OPTION_SOURCES = new Set(['static', 'declared_values', 'organization_areas']);

const TEXT_FIELDS = [
  'name',
  'statement',
  'instruction',
  'section',
  'section_title',
  'technique',
  'scoring',
  'forecast_prompt',
];
const BOOL_FIELDS = ['required', 'ask_forecast', 'is_active'];
const INT_FIELDS = ['sort_order', 'max_length', 'yes_count', 'no_count'];
const LIST_FIELDS = ['options', 'fallback_options', 'scale'];

function bankOf(body) {
  const bank = String(body.p_bank || DEFAULT_BANK).trim();
  if (!/^[a-z0-9-]{1,60}$/.test(bank)) throw new ApiError(400, 'invalid_bank');
  return bank;
}

function codeOf(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9_]{1,20}$/.test(code) || code === SURVEY_CODE.toUpperCase()) {
    throw new ApiError(400, 'invalid_code');
  }
  return code;
}

function invalid(message) {
  return new ApiError(400, 'invalid_question', message);
}

function cleanList(field, value) {
  if (!Array.isArray(value)) throw invalid(`${field} debe ser una lista`);
  const seen = new Set();
  return value.map((item) => {
    const id = String(item?.id ?? '').trim();
    const label = String(item?.label ?? '').trim();
    if (!id || !label) throw invalid(`${field}: cada elemento necesita id y label`);
    if (seen.has(id)) throw invalid(`${field}: id repetido "${id}"`);
    seen.add(id);
    if (field === 'scale') {
      const score = Number(item.score);
      if (!Number.isFinite(score)) throw invalid('scale: cada elemento necesita score numérico');
      return {id, label, score};
    }
    return {id, label, dimension: item.dimension ? String(item.dimension).trim() : null};
  });
}

// Keeps only known fields with the right type. Unknown keys are dropped.
function cleanQuestion(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('p_question requerido');
  const out = {};
  for (const field of TEXT_FIELDS) {
    if (!(field in input)) continue;
    const value = input[field] == null ? null : String(input[field]).trim();
    out[field] = value || null;
  }
  for (const field of BOOL_FIELDS) {
    if (field in input) out[field] = input[field] === true || input[field] === 'true';
  }
  for (const field of INT_FIELDS) {
    if (!(field in input)) continue;
    if (input[field] == null || input[field] === '') {
      out[field] = null;
      continue;
    }
    const value = Number(input[field]);
    if (!Number.isInteger(value) || value < 0) throw invalid(`${field} debe ser un entero >= 0`);
    out[field] = value;
  }
  for (const field of LIST_FIELDS) {
    if (field in input) out[field] = cleanList(field, input[field] ?? []);
  }
  if ('format' in input) {
    if (!FORMATS.has(input.format)) throw invalid(`format debe ser uno de: ${[...FORMATS].join(', ')}`);
    out.format = input.format;
  }
  if ('options_source' in input) {
    if (!OPTION_SOURCES.has(input.options_source)) {
      throw invalid(`options_source debe ser uno de: ${[...OPTION_SOURCES].join(', ')}`);
    }
    out.options_source = input.options_source;
  }
  return out;
}

function assertComplete(question) {
  if (!question.statement) throw invalid('statement requerido');
  if (!question.format) throw invalid('format requerido');
  const source = question.options_source || 'static';
  if (['most_least', 'pick_yes_no'].includes(question.format) && source === 'static' && question.options.length < 2) {
    throw invalid('este formato necesita al menos 2 options');
  }
  if (question.format === 'single' && source === 'static' && question.options.length < 2) {
    throw invalid('single necesita al menos 2 options');
  }
  if (question.format === 'value_coherence' && !question.scale.length) {
    throw invalid('value_coherence necesita scale');
  }
  if (question.format === 'pick_yes_no' && (question.yes_count == null || question.no_count == null)) {
    throw invalid('pick_yes_no necesita yes_count y no_count');
  }
}

async function findQuestion(bank, code) {
  const row = await findOne(COLLECTION, {bank, code, kind: 'question'});
  if (!row) throw new ApiError(404, 'question_not_found');
  return row;
}

export async function listCultureQuestions(actor, body) {
  assertSignedIn(actor);
  const bank = bankOf(body);
  const filter = {bank, kind: 'question'};
  if (!body.p_include_inactive) filter.is_active = true;
  const [survey, questions] = await Promise.all([
    findOne(COLLECTION, {bank, kind: 'survey'}),
    findMany(COLLECTION, filter, {sort: {sort_order: 1, code: 1}, limit: 500}),
  ]);
  return {
    bank,
    survey: survey ? publicRow(survey) : null,
    total: questions.length,
    questions: questions.map(publicRow),
  };
}

export async function getCultureQuestion(actor, body) {
  assertSignedIn(actor);
  return publicRow(await findQuestion(bankOf(body), codeOf(body.p_code)));
}

export async function createCultureQuestion(actor, body) {
  assertBankManager(actor);
  const bank = bankOf(body);
  const code = codeOf(body.p_question?.code);
  const input = cleanQuestion(body.p_question);
  if (await findOne(COLLECTION, {bank, code})) throw new ApiError(409, 'duplicate', `ya existe ${code}`);
  if (input.sort_order == null) {
    const last = await findMany(COLLECTION, {bank, kind: 'question'}, {sort: {sort_order: -1}, limit: 1});
    input.sort_order = (last[0]?.sort_order || 0) + 1;
  }
  const now = new Date();
  const question = {
    id: randomUUID(),
    bank,
    code,
    kind: 'question',
    name: null,
    statement: null,
    instruction: null,
    section: null,
    section_title: null,
    technique: null,
    scoring: null,
    forecast_prompt: null,
    format: null,
    options_source: 'static',
    options: [],
    fallback_options: [],
    scale: [],
    required: true,
    ask_forecast: false,
    is_active: true,
    max_length: null,
    yes_count: null,
    no_count: null,
    ...input,
    created_at: now,
    updated_at: now,
  };
  assertComplete(question);
  await insertOne(COLLECTION, question);
  return publicRow(await findQuestion(bank, code));
}

export async function updateCultureQuestion(actor, body) {
  assertBankManager(actor);
  const bank = bankOf(body);
  const current = await findQuestion(bank, codeOf(body.p_code));
  const changes = cleanQuestion(body.p_question);
  if (body.p_question.code != null) {
    const nextCode = codeOf(body.p_question.code);
    if (nextCode !== current.code) {
      if (await findOne(COLLECTION, {bank, code: nextCode})) {
        throw new ApiError(409, 'duplicate', `ya existe ${nextCode}`);
      }
      changes.code = nextCode;
    }
  }
  assertComplete({...current, ...changes});
  const updated = await updateOne(COLLECTION, {id: current.id}, {...changes, updated_at: new Date()});
  return publicRow(updated);
}

export async function deleteCultureQuestion(actor, body) {
  assertBankManager(actor);
  const bank = bankOf(body);
  const question = await findQuestion(bank, codeOf(body.p_code));
  await deleteMany(COLLECTION, {id: question.id});
  return {deleted: true, code: question.code};
}

export async function reorderCultureQuestions(actor, body) {
  assertBankManager(actor);
  const bank = bankOf(body);
  if (!Array.isArray(body.p_codes) || !body.p_codes.length) throw new ApiError(400, 'missing_codes');
  const codes = body.p_codes.map(codeOf);
  if (new Set(codes).size !== codes.length) throw new ApiError(400, 'duplicate_codes');
  // Needs every question of the bank so sort_order never ends up duplicated.
  const existing = await findMany(COLLECTION, {bank, kind: 'question'}, {limit: 500});
  const known = new Set(existing.map((item) => item.code));
  if (codes.length !== known.size || codes.some((code) => !known.has(code))) {
    throw new ApiError(400, 'codes_mismatch', `envía los ${known.size} códigos del banco, sin repetir`);
  }
  const now = new Date();
  for (const [index, code] of codes.entries()) {
    await updateMany(COLLECTION, {bank, code, kind: 'question'}, {sort_order: index + 1, updated_at: now});
  }
  return listCultureQuestions(actor, {p_bank: bank, p_include_inactive: true});
}

export async function updateCultureSurvey(actor, body) {
  assertBankManager(actor);
  const bank = bankOf(body);
  const survey = await findOne(COLLECTION, {bank, kind: 'survey'});
  if (!survey) throw new ApiError(404, 'survey_not_found');
  const changes = {updated_at: new Date()};
  for (const field of ['title', 'intro']) {
    if (body[`p_${field}`] == null) continue;
    const value = String(body[`p_${field}`]).trim();
    if (!value) throw new ApiError(400, 'invalid_survey', `${field} no puede quedar vacío`);
    changes[field] = value;
  }
  return publicRow(await updateOne(COLLECTION, {id: survey.id}, changes));
}
