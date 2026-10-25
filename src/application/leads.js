import {ApiError} from '../http.js';
import {count, findMany} from '../domain/store.js';
import {publicRow} from '../domain/rows.js';
import {assertSignedIn, resolveOrganizationId} from '../domain/tenancy.js';

const MAX_LEADS = 5000;

const LEAD_FIELDS = [
  'id',
  'organization_id',
  'company_name',
  'contact_name',
  'email',
  'employee_range',
  'perceived_culture',
  'culture_comment',
  'status',
  'email_status',
  'survey_url',
  'source',
  'source_url',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'consent_terms',
  'consent_data',
  'responded_at',
  'created_at',
  'updated_at',
];

function leadView(row) {
  const value = publicRow(row);
  const copy = {};
  for (const field of LEAD_FIELDS) copy[field] = value[field] ?? null;
  copy.perceived_culture = Array.isArray(value.perceived_culture) ? value.perceived_culture : [];
  return copy;
}

function tally(values) {
  const counts = new Map();
  for (const raw of values) {
    const label = String(raw ?? '').trim();
    if (!label) continue;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, total]) => ({label, count: total}));
}

function summarize(leads) {
  const dates = leads.map((lead) => lead.created_at).filter(Boolean).sort();
  const culture = tally(leads.flatMap((lead) => lead.perceived_culture));
  return {
    leadCount: leads.length,
    respondedCount: leads.filter((lead) => lead.responded_at).length,
    uniqueEmails: new Set(leads.map((lead) => String(lead.email || '').toLowerCase()).filter(Boolean)).size,
    firstLeadAt: dates[0] ?? null,
    lastLeadAt: dates[dates.length - 1] ?? null,
    // pct = share of leads in this company that picked the label.
    perceivedCulture: culture.map((item) => ({
      ...item,
      pct: leads.length ? Math.round((item.count / leads.length) * 1000) / 10 : 0,
    })),
    employeeRanges: tally(leads.map((lead) => lead.employee_range)),
    companyNamesTyped: tally(leads.map((lead) => lead.company_name)),
    emailStatus: tally(leads.map((lead) => lead.email_status)),
    leadStatus: tally(leads.map((lead) => lead.status)),
    sources: tally(leads.map((lead) => lead.utm_source || lead.source)),
    comments: leads
      .filter((lead) => String(lead.culture_comment || '').trim())
      .map((lead) => ({leadId: lead.id, comment: lead.culture_comment, created_at: lead.created_at})),
  };
}

// Groups strictly by culture_leads.organization_id === organizations.id.
// company_name is free text from the form, so it is never used to match.
export async function cultureLeadsByOrganization(actor, body) {
  assertSignedIn(actor);
  let organizationId = null;
  if (body.p_organization_id) {
    organizationId = await resolveOrganizationId(body.p_organization_id);
    if (!organizationId) throw new ApiError(404, 'company_not_found');
  }
  if (!actor.isSuperadmin) {
    const own = actor.membership?.organization_id;
    if (!own) throw new ApiError(403, 'permission_denied');
    if (organizationId && organizationId !== own) throw new ApiError(403, 'permission_denied');
    organizationId = own;
  }

  const leadFilter = organizationId ? {organization_id: organizationId} : {};
  const [rows, total] = await Promise.all([
    findMany('culture_leads', leadFilter, {sort: {created_at: -1}, limit: MAX_LEADS}),
    count('culture_leads', leadFilter),
  ]);
  const organizations = await findMany(
    'organizations',
    organizationId ? {id: organizationId} : {},
    {sort: {created_at: 1}, limit: MAX_LEADS},
  );
  const organizationIds = organizations.map((org) => org.id);
  const sessions = await findMany('survey_sessions', {
    organization_id: {$in: organizationIds},
    purpose: 'culture_perception',
    status: 'completed',
  }, {limit: 50000});

  const leadsByOrg = new Map(organizationIds.map((id) => [id, []]));
  const unassigned = [];
  for (const row of rows) {
    const lead = leadView(row);
    const bucket = lead.organization_id && leadsByOrg.get(lead.organization_id);
    if (bucket) bucket.push(lead);
    else unassigned.push(lead);
  }
  const respondentsByOrg = new Map();
  for (const session of sessions) {
    respondentsByOrg.set(session.organization_id, (respondentsByOrg.get(session.organization_id) || 0) + 1);
  }

  const groups = organizations
    .map((org) => {
      const leads = leadsByOrg.get(org.id);
      const value = publicRow(org);
      return {
        organization: {
          id: value.id,
          firebase_id: value.firebase_id ?? null,
          name: value.name ?? null,
          status: value.status ?? null,
          size_label: value.size_label ?? null,
          source: value.source ?? null,
          archived: Boolean(value.archived),
          created_at: value.created_at ?? null,
        },
        surveyRespondents: respondentsByOrg.get(org.id) || 0,
        summary: summarize(leads),
        leads,
      };
    })
    .filter((group) => group.leads.length || group.surveyRespondents || organizationId)
    .sort((a, b) => b.summary.leadCount - a.summary.leadCount
      || String(a.organization.name).localeCompare(String(b.organization.name)));

  return {
    generatedAt: new Date().toISOString(),
    scope: organizationId ? 'organization' : 'all',
    totals: {
      organizations: groups.length,
      leads: total,
      returnedLeads: rows.length,
      truncated: total > rows.length,
      unassignedLeads: organizationId ? 0 : unassigned.length,
    },
    organizations: groups,
    // Leads with no organization_id, or one that no longer exists. Kept apart on purpose.
    unassigned: organizationId ? null : {summary: summarize(unassigned), leads: unassigned},
  };
}
