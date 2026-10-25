export const BOOLEAN_COLUMNS = new Set([
  'is_active',
  'is_superadmin',
  'is_current',
  'is_required',
  'used',
  'archived',
  'must_change_password',
  'must_review_company_dna',
  'evaluation_completed',
  'result_requested',
  'recurring',
  'creates_membership',
  'consent_terms',
  'consent_data',
]);

const JSON_COLUMNS = new Set([
  'values_list',
  'culture_list',
  'standout_list',
  'dimension_scores',
  'alignments',
  'differences',
  'conversation_topics',
  'data_gaps',
  'metadata',
  'perceived_culture',
  'consent_payload',
]);

const HIDDEN_COLUMNS = new Set(['pin_hash', 'token_hash']);

function parseJson(value) {
  if (value == null || typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function publicRow(row) {
  if (!row || typeof row !== 'object') return row;
  const copy = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === '_id' || HIDDEN_COLUMNS.has(key)) continue;
    if (value instanceof Date) {
      copy[key] = value.toISOString();
      continue;
    }
    if (BOOLEAN_COLUMNS.has(key)) {
      copy[key] = value === true || value === 1 || value === '1';
      continue;
    }
    if (JSON_COLUMNS.has(key)) {
      copy[key] = parseJson(value) ?? [];
      continue;
    }
    copy[key] = value;
  }
  return copy;
}

export function encodeWriteValue(column, value) {
  if (JSON_COLUMNS.has(column) && typeof value === 'string') return parseJson(value);
  if (BOOLEAN_COLUMNS.has(column)) return value === true || value === 1 || value === '1';
  return value;
}

export function coerceFilterValue(column, value) {
  if (BOOLEAN_COLUMNS.has(column)) return value === true || value === 1 || value === '1' || value === 'true';
  return value;
}

export function assertIdentifier(name) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    const error = new Error('invalid_identifier');
    error.status = 400;
    error.code = 'invalid_identifier';
    throw error;
  }
  return name;
}
