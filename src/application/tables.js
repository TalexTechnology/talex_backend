import {randomUUID} from 'node:crypto';
import {deleteMany, findMany, findOne, insertOne, updateMany} from '../domain/store.js';
import {ApiError} from '../http.js';
import {assertIdentifier, coerceFilterValue, encodeWriteValue, publicRow} from '../domain/rows.js';
import {canWriteOrg} from '../domain/tenancy.js';

const ALLOWED_TABLES = new Set([
  'profiles',
  'organizations',
  'memberships',
  'organization_culture_versions',
  'dna_catalog_entries',
  'vacancies',
  'persons',
  'applications',
  'application_status_events',
  'survey_templates',
  'survey_versions',
  'survey_sections',
  'survey_questions',
  'survey_options',
  'survey_sessions',
  'survey_answers',
  'public_survey_links',
  'culture_perception_results',
  'affinity_evaluations',
  'evaluation_reports',
  'activation_invites',
  'activity_events',
  'audit_logs',
  'deals',
  'sales',
  'culture_leads',
  'culture_reports',
  'company_culture_questions',
]);

const EMBEDS = {
  applications: {
    persons: {table: 'persons', local: 'person_id', foreign: 'id', many: false},
  },
  profiles: {
    memberships: {table: 'memberships', local: 'id', foreign: 'profile_id', many: true},
  },
  memberships: {
    organizations: {table: 'organizations', local: 'organization_id', foreign: 'id', many: false},
  },
};

export function assertTable(name) {
  if (!ALLOWED_TABLES.has(name)) throw new ApiError(404, 'unknown_table');
}

export function parseRequest(url) {
  const filters = [];
  let columns = '*';
  let order = null;
  let limit = 200;
  for (const [key, value] of url.searchParams.entries()) {
    if (key === 'select') columns = value;
    else if (key === 'limit') limit = Number(value) || 200;
    else if (key === 'order') {
      const [column, direction] = String(value).split('.');
      order = {column, ascending: direction !== 'desc'};
    } else if (key.startsWith('eq.')) {
      filters.push({column: key.slice(3), value});
    }
  }
  return {filters, columns, order, limit};
}

function parseSelect(spec) {
  const embeds = [];
  const columns = [];
  let depth = 0;
  let current = '';
  const flush = () => {
    const token = current.trim();
    current = '';
    if (!token) return;
    const embed = token.match(/^([A-Za-z0-9_]+)\((.*)\)$/);
    if (embed) embeds.push({name: embed[1], spec: embed[2]});
    else columns.push(token);
  };
  for (const char of spec) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      flush();
      continue;
    }
    current += char;
  }
  flush();
  return {columns: columns.length ? columns : ['*'], embeds};
}

function mongoFilter(filters) {
  const filter = {};
  for (const item of filters) {
    const column = assertIdentifier(item.column);
    filter[column] = coerceFilterValue(column, item.value);
  }
  return filter;
}

async function attachEmbeds(table, rows, spec) {
  const parsed = parseSelect(spec);
  if (!parsed.embeds.length || !rows.length) {
    return rows.map((row) => project(row, parsed.columns));
  }
  const mapped = [];
  for (const row of rows) {
    const next = project(row, parsed.columns);
    for (const embed of parsed.embeds) {
      const relation = EMBEDS[table]?.[embed.name];
      if (!relation) continue;
      const children = await findMany(
        relation.table,
        {[relation.foreign]: row[relation.local]},
        {limit: 50},
      );
      const nested = await attachEmbeds(relation.table, children, embed.spec);
      next[embed.name] = relation.many ? nested : nested[0] ?? null;
    }
    mapped.push(next);
  }
  return mapped;
}

function project(row, columns) {
  const publicValue = publicRow(row);
  if (columns.includes('*')) return publicValue;
  const copy = {};
  for (const column of columns) {
    if (column in publicValue) copy[column] = publicValue[column];
  }
  return copy;
}

function scopedFilters(table, actor, filters) {
  if (actor.isSuperadmin) return filters;
  if (table === 'profiles') {
    return [...filters, {column: 'id', value: actor.profile.id}];
  }
  const orgScoped = new Set([
    'organizations',
    'memberships',
    'organization_culture_versions',
    'vacancies',
    'applications',
    'application_status_events',
    'survey_sessions',
    'public_survey_links',
    'culture_perception_results',
    'affinity_evaluations',
    'evaluation_reports',
    'activation_invites',
    'activity_events',
    'deals',
    'sales',
  ]);
  if (orgScoped.has(table)) {
    const column = table === 'organizations' ? 'id' : 'organization_id';
    return [
      ...filters,
      {column, value: actor.membership?.organization_id || '__none__'},
    ];
  }
  return filters;
}

function assertWrite(actor, table, payload, filters) {
  if (actor.isSuperadmin) return;
  const protectedTables = new Set([
    'survey_templates',
    'survey_versions',
    'survey_sections',
    'survey_questions',
    'survey_options',
    'activation_invites',
  ]);
  if (protectedTables.has(table)) throw new ApiError(403, 'permission_denied');
  const organizationId =
    payload.organization_id ||
    filters.find((item) => item.column === 'organization_id')?.value ||
    actor.membership?.organization_id;
  if (table === 'profiles') {
    const target = payload.id || filters.find((item) => item.column === 'id')?.value;
    if (target && target !== actor.profile.id) {
      throw new ApiError(403, 'permission_denied');
    }
    return;
  }
  if (table === 'persons' || table === 'dna_catalog_entries') return;
  if (organizationId && !canWriteOrg(actor, organizationId)) {
    throw new ApiError(403, 'permission_denied');
  }
}

export async function handleTable(method, table, url, actor, body) {
  assertTable(table);
  if ((table === 'culture_leads' || table === 'culture_reports') && !actor.isSuperadmin) {
    throw new ApiError(403, 'permission_denied');
  }
  const request = parseRequest(url);
  const filters = scopedFilters(table, actor, request.filters);
  const filter = mongoFilter(filters);
  const sort = request.order
    ? {[assertIdentifier(request.order.column)]: request.order.ascending ? 1 : -1}
    : undefined;
  const limit = Math.min(Math.max(request.limit, 1), 500);

  if (method === 'GET') {
    const rows = await findMany(table, filter, {sort, limit});
    return attachEmbeds(table, rows, request.columns);
  }

  if (method === 'POST') {
    const payload = {...body, id: body.id || randomUUID()};
    if (table === 'organizations' && !payload.firebase_id) {
      payload.firebase_id = payload.id;
    }
    assertWrite(actor, table, payload, filters);
    const doc = {created_at: new Date()};
    for (const [column, value] of Object.entries(payload)) {
      assertIdentifier(column);
      doc[column] = encodeWriteValue(column, value);
    }
    doc.updated_at = new Date();
    await insertOne(table, doc);
    const row = await findOne(table, {id: payload.id});
    return attachEmbeds(table, [row], request.columns);
  }

  if (method === 'PATCH') {
    if (!filters.length) throw new ApiError(400, 'missing_filter');
    assertWrite(actor, table, body, filters);
    const set = {updated_at: new Date()};
    for (const [column, value] of Object.entries(body)) {
      assertIdentifier(column);
      set[column] = encodeWriteValue(column, value);
    }
    await updateMany(table, filter, set);
    const rows = await findMany(table, filter, {limit: 20});
    return attachEmbeds(table, rows, request.columns);
  }

  if (method === 'DELETE') {
    if (!filters.length) throw new ApiError(400, 'missing_filter');
    assertWrite(actor, table, {}, filters);
    await deleteMany(table, filter);
    return [];
  }

  throw new ApiError(405, 'method_not_allowed');
}
