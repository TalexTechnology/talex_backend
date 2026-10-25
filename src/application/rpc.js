import {randomUUID} from 'node:crypto';
import {withTransaction} from '../db.js';
import {ApiError} from '../http.js';
import {asList, hashInvitePin, normalizeEmail, randomToken, sha256Hex, verifyInvitePin} from '../domain/crypto.js';
import {
  count,
  daysFromNow,
  deleteMany,
  findMany,
  findOne,
  insertOne,
  minutesFromNow,
  updateMany,
  updateOne,
  upsertOne,
} from '../domain/store.js';
import {upsertProfile} from '../services/session.js';
import {cultureLeadsByOrganization} from './leads.js';
import {
  createCultureQuestion,
  deleteCultureQuestion,
  getCultureQuestion,
  listCultureQuestions,
  reorderCultureQuestions,
  updateCultureQuestion,
  updateCultureSurvey,
} from './culture-questions.js';
import {publicRow} from '../domain/rows.js';
import {
  activeMembership,
  assertBankManager,
  assertCanWriteOrg,
  assertSignedIn,
  canWriteOrg,
  isUuid,
  ownsApplication,
  publicEntityId,
  resolveApplicationId,
  resolveOrganizationId,
  resolveVacancyId,
} from '../domain/tenancy.js';

function pick(data, ...keys) {
  for (const key of keys) {
    if (data?.[key] != null && data[key] !== '') return data[key];
  }
  return null;
}

async function personForProfile(profile) {
  return (
    (await findOne('persons', {linked_profile_id: profile.id})) ||
    (await findOne('persons', {email: profile.email}))
  );
}

export async function currentSessionProfile(actor) {
  assertSignedIn(actor);
  const profile = actor.profile;
  let role = profile.is_superadmin ? 'superadmin' : 'user';
  let organization = null;
  if (actor.membership) {
    role = actor.membership.legacy_role || actor.membership.role;
    organization = await findOne('organizations', {id: actor.membership.organization_id});
  }
  const person = await personForProfile(profile);
  let application = null;
  if (person) {
    const applications = await findMany(
      'applications',
      {person_id: person.id},
      {sort: {created_at: -1}, limit: 1},
    );
    application = applications[0] || null;
    if (role === 'user' && application) role = 'respondent';
    if (!organization && application) {
      organization = await findOne('organizations', {id: application.organization_id});
    }
  }
  return {
    profileId: profile.id,
    firebaseUid: profile.firebase_uid,
    email: profile.email,
    displayName: profile.display_name,
    isSuperadmin: Boolean(profile.is_superadmin),
    role,
    organizationId: organization
      ? publicEntityId(organization.id, organization.firebase_id)
      : null,
    organizationUuid: organization?.id ?? null,
    organizationName: organization?.name ?? null,
    documentNumber: profile.document_number || person?.document_number || null,
    mustChangePassword: Boolean(profile.must_change_password),
    mustReviewCompanyDna: Boolean(profile.must_review_company_dna),
    applicationId: application
      ? publicEntityId(application.id, application.firebase_candidate_id)
      : null,
  };
}

const STAFF_ROLES = new Set([
  'company_admin',
  'company_lead',
  'people_ops',
  'recruiter',
  'hiring_manager',
  'ceo',
  'hr',
]);

async function findOrganization(orgKey) {
  if (isUuid(orgKey)) {
    const byId = await findOne('organizations', {id: orgKey});
    if (byId) return byId;
  }
  return findOne('organizations', {firebase_id: orgKey});
}

export async function syncIdentityWorkspace(actor, body) {
  assertSignedIn(actor);
  const profile = await upsertProfile({
    uid: actor.firebaseUid,
    email: actor.email,
    displayName: actor.profile?.display_name,
  });
  const orgKey = String(body.p_organization_id || '').trim();
  const roleRaw = String(body.p_role || '').trim();
  const orgName = String(body.p_organization_name || '').trim();
  const staffRole = STAFF_ROLES.has(roleRaw)
    ? roleRaw
    : orgKey && !profile.is_superadmin
      ? 'company_admin'
      : '';
  if (!profile.is_superadmin && orgKey && staffRole) {
    let organization = await findOrganization(orgKey);
    if (!organization) {
      const organizationId = isUuid(orgKey) ? orgKey : randomUUID();
      organization = await insertOne('organizations', {
        id: organizationId,
        firebase_id: orgKey,
        name: orgName || 'Empresa',
        status: 'active',
        archived: false,
        created_at: new Date(),
        updated_at: new Date(),
      });
    } else if (orgName) {
      organization = await updateOne('organizations', {id: organization.id}, {
        name: orgName,
        updated_at: new Date(),
      });
    }
    const mapped = await findOne('legacy_role_map', {firestore_role: staffRole});
    await upsertOne(
      'memberships',
      {organization_id: organization.id, profile_id: profile.id},
      {
        role: mapped?.membership_role || 'company_admin',
        legacy_role: roleRaw,
        is_active: true,
        updated_at: new Date(),
      },
      {id: randomUUID(), created_at: new Date()},
    );
  }
  return currentSessionProfile({
    firebaseUid: actor.firebaseUid,
    email: profile.email,
    profile,
    membership: await activeMembership(profile.id),
    isSuperadmin: Boolean(profile.is_superadmin),
  });
}

async function cultureAnswers(organizationId) {
  const sessions = await findMany('survey_sessions', {
    organization_id: organizationId,
    purpose: 'culture_perception',
    status: 'completed',
  }, {limit: 5000});
  if (!sessions.length) return [];
  const answers = await findMany('survey_answers', {
    session_id: {$in: sessions.map((item) => item.id)},
  }, {limit: 20000});
  const questions = await findMany('survey_questions', {
    id: {$in: [...new Set(answers.map((item) => item.question_id))]},
  }, {limit: 5000});
  const questionById = new Map(questions.map((item) => [item.id, item]));
  const sections = await findMany('survey_sections', {
    id: {$in: [...new Set(questions.map((item) => item.section_id))]},
  }, {limit: 500});
  const sectionById = new Map(sections.map((item) => [item.id, item]));
  return answers.map((answer) => {
    const question = questionById.get(answer.question_id) || {};
    const section = sectionById.get(question.section_id) || {};
    return {
      section_code: section.code,
      format: answer.format,
      value_int: answer.value_int,
      value_text: answer.value_text,
      statement_a: answer.statement_a,
      statement_b: answer.statement_b,
      dimension_a: question.dimension_a,
      dimension_b: question.dimension_b,
      q_a: question.statement_a,
      q_b: question.statement_b,
    };
  });
}

export async function organizationSurveyCulture(actor, body) {
  const organizationId = await resolveOrganizationId(body.p_organization_id);
  if (!organizationId) throw new ApiError(404, 'company_not_found');
  if (!actor.isSuperadmin && !canWriteOrg(actor, organizationId) && !(await ownsOrgSession(actor, organizationId))) {
    throw new ApiError(403, 'permission_denied');
  }
  const respondents = await count('survey_sessions', {
    organization_id: organizationId,
    purpose: 'culture_perception',
    status: 'completed',
  });
  const answers = await cultureAnswers(organizationId);
  const buckets = {values: new Map(), culture: new Map(), standout: new Map(), sought: new Map()};
  for (const row of answers) {
    const section = String(row.section_code || '');
    const format = String(row.format || '');
    let bucket = 'culture';
    if (section === 'apertura' || format === 'text') bucket = 'sought';
    else if (['values', 'cultura', 'needs'].includes(section)) bucket = 'values';
    else if (section === 'personas') bucket = 'standout';
    let label = null;
    if (format === 'pair' && row.value_int <= 2) {
      label = row.dimension_a || row.q_a || row.statement_a;
    } else if (format === 'pair' && row.value_int >= 4) {
      label = row.dimension_b || row.q_b || row.statement_b;
    } else if (['scale', 'experience', 'single'].includes(format) && row.value_int >= 4) {
      label = row.dimension_a || row.q_a || row.statement_a;
    } else if (format === 'text') {
      label = row.value_text;
    }
    label = String(label || '').trim();
    if (!label) continue;
    buckets[bucket].set(label, (buckets[bucket].get(label) || 0) + 1);
  }
  const ranked = (map, size) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, size)
      .map(([label]) => label);
  const sought = ranked(buckets.sought, 12);
  return {
    organizationId,
    source: respondents > 0 ? 'survey' : 'empty',
    respondentCount: respondents,
    values_list: ranked(buckets.values, 25),
    culture_list: ranked(buckets.culture, 25),
    standout_list: ranked(buckets.standout, 25),
    sought_characteristics: sought.length ? sought.join('; ') : null,
  };
}

async function ownsOrgSession(actor, organizationId) {
  const persons = await findMany('persons', {
    $or: [{linked_profile_id: actor.profile.id}, {email: actor.profile.email}],
  }, {limit: 20});
  if (!persons.length) return false;
  const application = await findOne('applications', {
    organization_id: organizationId,
    person_id: {$in: persons.map((item) => item.id)},
  });
  return Boolean(application);
}

export async function saveOrganizationProfile(actor, body) {
  const organizationId = await resolveOrganizationId(body.p_organization_id);
  if (!organizationId) throw new ApiError(403, 'permission_denied');
  assertCanWriteOrg(actor, organizationId);
  const current = await findOne('organizations', {id: organizationId});
  const name = String(body.p_name || '').trim();
  await updateOne('organizations', {id: organizationId}, {
    name: name || current?.name,
    nit: body.p_nit ?? null,
    logo_url: body.p_logo_url ?? null,
    sector: body.p_sector ?? null,
    size_label: body.p_size ?? null,
    city: body.p_city ?? null,
    country: body.p_country ?? null,
    region: body.p_region ?? null,
    website: body.p_website ?? null,
    description: body.p_description ?? null,
    last_activity_at: new Date(),
    updated_at: new Date(),
  });
  await updateMany('organization_culture_versions', {
    organization_id: organizationId,
    is_current: true,
  }, {is_current: false, updated_at: new Date()});
  const latest = await findMany(
    'organization_culture_versions',
    {organization_id: organizationId},
    {sort: {version_number: -1}, limit: 1},
  );
  await insertOne('organization_culture_versions', {
    id: randomUUID(),
    organization_id: organizationId,
    version_number: (latest[0]?.version_number || 0) + 1,
    values_list: asList(body.p_values),
    culture_list: asList(body.p_culture),
    standout_list: asList(body.p_standout),
    sought_characteristics: body.p_sought ?? null,
    is_current: true,
    published_by: actor.profile.id,
    published_at: new Date(),
  });
  await updateOne('profiles', {id: actor.profile.id}, {
    must_review_company_dna: false,
    updated_at: new Date(),
  });
  return {ok: true};
}

export async function provisionOrganization(actor, body) {
  if (!actor.isSuperadmin) throw new ApiError(403, 'permission_denied');
  const name = String(body.p_name || '').trim();
  const email = normalizeEmail(body.p_recruiter_email);
  if (!name) throw new ApiError(400, 'invalid_company');
  if (!email.includes('@')) throw new ApiError(400, 'invalid_email');
  const pin = String(body.p_pin || '').trim() || String(100000 + Math.floor(Math.random() * 900000));
  const organizationId = randomUUID();
  await withTransaction(async () => {
    await insertOne('organizations', {
      id: organizationId,
      firebase_id: organizationId,
      name,
      nit: body.p_nit ?? null,
      logo_url: body.p_logo_url ?? null,
      sector: body.p_sector ?? null,
      size_label: body.p_size ?? null,
      city: body.p_city ?? null,
      country: body.p_country ?? null,
      region: body.p_region ?? null,
      website: body.p_website ?? null,
      description: body.p_description ?? null,
      status: 'onboarding',
      archived: false,
      created_at: new Date(),
      updated_at: new Date(),
    });
    await insertOne('organization_culture_versions', {
      id: randomUUID(),
      organization_id: organizationId,
      version_number: 1,
      values_list: asList(body.p_values),
      culture_list: asList(body.p_culture),
      standout_list: asList(body.p_standout),
      sought_characteristics: body.p_sought ?? null,
      is_current: true,
      published_by: actor.profile.id,
      published_at: new Date(),
    });
    await insertOne('activation_invites', {
      id: randomUUID(),
      email,
      organization_id: organizationId,
      kind: 'recruiter',
      role: 'company_admin',
      pin_hash: hashInvitePin(pin, email),
      pin_algorithm: 'fnv1a32',
      used: false,
      first_name: body.p_recruiter_first_name ?? null,
      last_name: body.p_recruiter_last_name ?? null,
      pin_expires_at: minutesFromNow(15),
      created_at: new Date(),
      updated_at: new Date(),
    });
    await insertOne('activity_events', {
      id: randomUUID(),
      organization_id: organizationId,
      actor_profile_id: actor.profile.id,
      kind: 'companyCreated',
      entity_name: name,
      status_label: 'onboarding',
      created_at: new Date(),
    });
  });
  return {organizationId, pin};
}

export async function activateInvitePin(actor, body) {
  assertSignedIn(actor);
  const pin = String(body.p_pin || '').trim();
  if (pin.length < 6) throw new ApiError(400, 'invalid_pin');
  const invites = await findMany('activation_invites', {
    email: actor.profile.email,
    kind: 'recruiter',
    used: false,
  }, {sort: {created_at: -1}, limit: 1});
  const invite = invites[0];
  if (!invite) throw new ApiError(404, 'invite_missing');
  if (invite.pin_expires_at && new Date(invite.pin_expires_at) <= new Date()) {
    throw new ApiError(400, 'pin_expired');
  }
  if (!verifyInvitePin(pin, actor.profile.email, invite.pin_hash)) {
    throw new ApiError(400, 'invalid_pin');
  }
  const mapped = await findOne('legacy_role_map', {firestore_role: invite.role || 'recruiter'});
  await upsertOne(
    'memberships',
    {organization_id: invite.organization_id, profile_id: actor.profile.id},
    {
      role: mapped?.membership_role || 'recruiter',
      legacy_role: invite.role,
      is_active: true,
      updated_at: new Date(),
    },
    {id: randomUUID(), created_at: new Date()},
  );
  const profile = await findOne('profiles', {id: actor.profile.id});
  const displayName = [invite.first_name, invite.last_name].filter(Boolean).join(' ').trim();
  await updateOne('profiles', {id: actor.profile.id}, {
    display_name: displayName || profile?.display_name || null,
    document_number: invite.document_number || profile?.document_number || null,
    must_change_password: false,
    must_review_company_dna: false,
    updated_at: new Date(),
  });
  await updateOne('activation_invites', {id: invite.id}, {used: true, updated_at: new Date()});
  const organization = await findOne('organizations', {id: invite.organization_id});
  return {
    organizationId: publicEntityId(organization.id, organization.firebase_id),
    role: invite.role || 'recruiter',
  };
}

export async function createStaffInvite(actor, body) {
  const organizationId = await resolveOrganizationId(body.p_organization_id);
  if (!organizationId) throw new ApiError(403, 'permission_denied');
  assertCanWriteOrg(actor, organizationId);
  const email = normalizeEmail(body.p_email);
  const pin = String(body.p_pin || '').trim() || String(100000 + Math.floor(Math.random() * 900000));
  await updateMany('activation_invites', {
    email,
    organization_id: organizationId,
    kind: 'recruiter',
    used: false,
  }, {used: true, updated_at: new Date()});
  await insertOne('activation_invites', {
    id: randomUUID(),
    email,
    organization_id: organizationId,
    kind: 'recruiter',
    role: String(body.p_role || 'recruiter').trim() || 'recruiter',
    pin_hash: hashInvitePin(pin, email),
    pin_algorithm: 'fnv1a32',
    used: false,
    first_name: body.p_first_name ?? null,
    last_name: body.p_last_name ?? null,
    pin_expires_at: minutesFromNow(15),
    created_at: new Date(),
    updated_at: new Date(),
  });
  return {pin};
}

export async function createRespondentApplication(actor, body) {
  const organizationId = await resolveOrganizationId(body.p_organization_id);
  const vacancyId = await resolveVacancyId(body.p_vacancy_id);
  if (!organizationId || !vacancyId) throw new ApiError(403, 'permission_denied');
  assertCanWriteOrg(actor, organizationId);
  const vacancy = await findOne('vacancies', {id: vacancyId});
  if (!vacancy || vacancy.organization_id !== organizationId) {
    throw new ApiError(403, 'permission_denied');
  }
  const email = normalizeEmail(body.p_email);
  const token = String(body.p_token || '').trim() || randomToken();
  const displayName = String(body.p_display_name || '').trim();
  const documentNumber = String(body.p_document_number || '').trim() || null;
  const existingPerson = await findOne('persons', {email});
  const person = existingPerson
    ? await updateOne('persons', {id: existingPerson.id}, {
        document_number: documentNumber || existingPerson.document_number || null,
        display_name: displayName || existingPerson.display_name || null,
        updated_at: new Date(),
      })
    : await insertOne('persons', {
        id: randomUUID(),
        email,
        document_number: documentNumber,
        display_name: displayName || null,
        linked_profile_id: null,
        created_at: new Date(),
        updated_at: new Date(),
      });
  let application = await findOne('applications', {
    organization_id: organizationId,
    vacancy_id: vacancyId,
    person_id: person.id,
  });
  if (!application) {
    const id = randomUUID();
    application = await insertOne('applications', {
      id,
      organization_id: organizationId,
      vacancy_id: vacancyId,
      person_id: person.id,
      vacancy_name: vacancy.name,
      process_status: 'pending',
      firebase_candidate_id: id,
      company_affinity: 'unknown',
      vacancy_affinity: 'unknown',
      evaluation_completed: false,
      result_requested: false,
      created_at: new Date(),
      updated_at: new Date(),
    });
  } else {
    application = await updateOne('applications', {id: application.id}, {
      vacancy_name: vacancy.name,
      updated_at: new Date(),
    });
    if (!application.firebase_candidate_id) {
      application = await updateOne('applications', {id: application.id}, {
        firebase_candidate_id: application.id,
        updated_at: new Date(),
      });
    }
  }
  const [firstName, ...rest] = displayName.split(' ');
  await insertOne('activation_invites', {
    id: randomUUID(),
    email,
    organization_id: organizationId,
    vacancy_id: vacancyId,
    kind: 'respondent',
    role: 'respondent',
    token_hash: sha256Hex(token),
    used: false,
    application_id: application.id,
    first_name: firstName || null,
    last_name: rest.join(' ') || null,
    document_number: documentNumber,
    token_expires_at: daysFromNow(14),
    created_at: new Date(),
    updated_at: new Date(),
  });
  return {
    applicationId: publicEntityId(application.id, application.firebase_candidate_id || application.id),
    token,
  };
}

async function publishedAffinityVersion() {
  const template = await findOne('survey_templates', {slug: 'affinity-core'});
  if (!template) return null;
  const versions = await findMany('survey_versions', {
    template_id: template.id,
    status: 'published',
  }, {sort: {version_number: -1}, limit: 1});
  return versions[0] || null;
}

export async function saveAffinityAnswer(actor, body) {
  const applicationId = await resolveApplicationId(body.p_application_id);
  const application = applicationId ? await findOne('applications', {id: applicationId}) : null;
  if (!application) throw new ApiError(404, 'assessment_missing');
  if (!canWriteOrg(actor, application.organization_id) && !(await ownsApplication(actor, application.id))) {
    throw new ApiError(403, 'permission_denied');
  }
  const value = Number(body.p_value);
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new ApiError(400, 'invalid_answer');
  }
  const version = await publishedAffinityVersion();
  if (!version) throw new ApiError(404, 'survey_missing');
  const sessions = await findMany('survey_sessions', {
    application_id: application.id,
    purpose: 'affinity',
  }, {sort: {started_at: -1}, limit: 1});
  let session = sessions[0];
  if (!session) {
    session = await insertOne('survey_sessions', {
      id: randomUUID(),
      version_id: version.id,
      purpose: 'affinity',
      organization_id: application.organization_id,
      application_id: application.id,
      person_id: application.person_id,
      status: 'in_progress',
      locale: 'es',
      started_at: new Date(),
    });
  }
  const question = await findOne('survey_questions', {code: body.p_question_code});
  if (!question) throw new ApiError(400, 'invalid_question');
  await upsertOne(
    'survey_answers',
    {session_id: session.id, question_id: question.id},
    {
      value_int: value,
      question_code: question.code,
      format: question.format,
      statement_a: question.statement_a,
      statement_b: question.statement_b,
      updated_at: new Date(),
    },
    {id: randomUUID(), created_at: new Date()},
  );
  if (application.process_status === 'pending') {
    await updateOne('applications', {id: application.id}, {
      process_status: 'inProgress',
      updated_at: new Date(),
    });
  }
  return {ok: true};
}

export async function completeAffinityEvaluation(actor, body) {
  const applicationId = await resolveApplicationId(body.p_application_id);
  const application = applicationId ? await findOne('applications', {id: applicationId}) : null;
  if (!application) throw new ApiError(404, 'assessment_missing');
  if (!canWriteOrg(actor, application.organization_id) && !(await ownsApplication(actor, application.id))) {
    throw new ApiError(403, 'permission_denied');
  }
  const sessions = await findMany('survey_sessions', {
    application_id: application.id,
    purpose: 'affinity',
  }, {sort: {started_at: -1}, limit: 1});
  const session = sessions[0];
  if (session) {
    await updateOne('survey_sessions', {id: session.id}, {
      status: 'completed',
      completed_at: new Date(),
    });
  }
  await updateOne('applications', {id: application.id}, {
    process_status: 'completed',
    evaluation_completed: true,
    vacancy_affinity: body.p_vacancy_affinity ?? application.vacancy_affinity,
    updated_at: new Date(),
  });
  const evaluation = await upsertOne(
    'affinity_evaluations',
    {application_id: application.id},
    {
      session_id: session?.id ?? null,
      organization_id: application.organization_id,
      firebase_evaluation_id: application.firebase_candidate_id || application.id,
      status: 'completed',
      dimension_scores: body.p_dimension_scores ?? null,
      completed_at: new Date(),
      updated_at: new Date(),
    },
    {id: randomUUID(), created_at: new Date()},
  );
  return {
    applicationId: publicEntityId(application.id, application.firebase_candidate_id),
    evaluationId: evaluation.id,
    firebaseCandidateId: application.firebase_candidate_id || application.id,
  };
}

async function currentSurveyVersion(slug) {
  const template = await findOne('survey_templates', {slug});
  if (!template) throw new ApiError(404, 'survey_missing');
  const versions = await findMany('survey_versions', {template_id: template.id}, {limit: 50});
  const rank = {published: 0, draft: 1};
  versions.sort(
    (a, b) =>
      (rank[a.status] ?? 2) - (rank[b.status] ?? 2) || b.version_number - a.version_number,
  );
  if (!versions[0]) throw new ApiError(404, 'survey_missing');
  return versions[0];
}

async function sectionsFor(versionId) {
  return findMany('survey_sections', {version_id: versionId}, {limit: 200});
}

async function ensureSection(versionId, code, title) {
  const existing = await findOne('survey_sections', {version_id: versionId, code});
  if (existing) return existing;
  const sections = await sectionsFor(versionId);
  const sortOrder = sections.reduce((max, item) => Math.max(max, item.sort_order || 0), 0) + 1;
  return insertOne('survey_sections', {
    id: randomUUID(),
    version_id: versionId,
    code,
    title: title || code,
    sort_order: sortOrder,
  });
}

async function questionPayload(question) {
  const section = question.section_id
    ? await findOne('survey_sections', {id: question.section_id})
    : null;
  const options = await findMany(
    'survey_options',
    {question_id: question.id},
    {sort: {sort_order: 1, value_int: 1}, limit: 50},
  );
  const sectionCode = section?.code || question.section || question.front || 'values';
  return {
    id: question.id,
    code: question.code,
    front: sectionCode,
    section: sectionCode,
    sectionTitle: section?.title || sectionCode,
    format: question.format,
    instruction: question.instruction,
    statementA: question.statement_a,
    statementB: question.statement_b,
    dimensionA: question.dimension_a,
    dimensionB: question.dimension_b,
    options: options.map((item) => item.label),
    timeLimitSeconds: question.time_limit_seconds,
    order: question.sort_order,
    required: Boolean(question.is_required),
    active: Boolean(question.is_active),
  };
}

async function questionsInVersion(versionId) {
  const sections = await sectionsFor(versionId);
  if (!sections.length) return [];
  const questions = await findMany('survey_questions', {
    section_id: {$in: sections.map((item) => item.id)},
  }, {limit: 2000});
  questions.sort((a, b) => a.sort_order - b.sort_order || String(a.code).localeCompare(String(b.code)));
  return questions;
}

async function questionsForSlug(slug) {
  const version = await currentSurveyVersion(slug);
  const direct = await questionsInVersion(version.id);
  if (direct.length) return {version, questions: direct};
  const codes = (await sectionsFor(version.id)).map((item) => item.code);
  if (!codes.length) return {version, questions: []};
  const sameCodeSections = await findMany('survey_sections', {code: {$in: codes}}, {limit: 200});
  const questions = await findMany('survey_questions', {
    section_id: {$in: sameCodeSections.map((item) => item.id)},
  }, {limit: 2000});
  questions.sort((a, b) => a.sort_order - b.sort_order || String(a.code).localeCompare(String(b.code)));
  return {version, questions};
}

export async function listSurveyBank(actor, body) {
  assertBankManager(actor);
  const {questions} = await questionsForSlug(body.p_slug);
  return Promise.all(questions.map(questionPayload));
}

export async function upsertSurveyQuestion(actor, body) {
  assertBankManager(actor);
  const question = body.p_question;
  if (!question || typeof question !== 'object') throw new ApiError(400, 'invalid_question');
  const version = await currentSurveyVersion(body.p_slug);
  const code = String(pick(question, 'code') || '').trim().toUpperCase();
  let sectionCode = String(pick(question, 'section', 'front') || '').trim().toLowerCase();
  let format = String(pick(question, 'format') || '').trim().toLowerCase();
  if (!code || !sectionCode) throw new ApiError(400, 'invalid_question');
  if (!format) {
    format =
      sectionCode === 'capabilities'
        ? 'experience'
        : ['values', 'needs'].includes(sectionCode)
          ? 'pair'
          : sectionCode === 'apertura'
            ? 'text'
            : 'scale';
  }
  const section = await ensureSection(
    version.id,
    sectionCode,
    pick(question, 'sectionTitle', 'section_title'),
  );
  const existing = (await questionsInVersion(version.id)).find((item) => item.code === code);
  const fields = {
    section_id: section.id,
    format,
    instruction: pick(question, 'instruction'),
    statement_a: pick(question, 'statementA', 'statement_a') || code,
    statement_b: pick(question, 'statementB', 'statement_b'),
    dimension_a: pick(question, 'dimensionA', 'dimension_a'),
    dimension_b: pick(question, 'dimensionB', 'dimension_b'),
    time_limit_seconds: pick(question, 'timeLimitSeconds', 'time_limit_seconds'),
    sort_order: pick(question, 'order', 'sort_order') ?? 0,
    is_required: pick(question, 'required', 'is_required') !== false,
    is_active: pick(question, 'active', 'is_active') !== false,
  };
  const saved = existing
    ? await updateOne('survey_questions', {id: existing.id}, fields)
    : await insertOne('survey_questions', {id: randomUUID(), code, ...fields});
  await deleteMany('survey_options', {question_id: saved.id});
  const options = asList(question.options);
  for (const [index, label] of options.entries()) {
    await insertOne('survey_options', {
      id: randomUUID(),
      question_id: saved.id,
      value_int: index + 1,
      label: String(label),
      sort_order: index + 1,
    });
  }
  return questionPayload(await findOne('survey_questions', {id: saved.id}));
}

export async function replaceSurveyBank(actor, body) {
  assertBankManager(actor);
  const questions = asList(body.p_questions);
  const version = await currentSurveyVersion(body.p_slug);
  const uploaded = [];
  for (const question of questions) {
    await upsertSurveyQuestion(actor, {p_slug: body.p_slug, p_question: question});
    uploaded.push(String(question.code || '').toUpperCase());
  }
  const existing = await questionsInVersion(version.id);
  let removed = 0;
  let deactivated = 0;
  for (const question of existing) {
    if (uploaded.includes(question.code)) continue;
    const used = await findOne('survey_answers', {question_id: question.id});
    if (used) {
      await updateOne('survey_questions', {id: question.id}, {is_active: false});
      deactivated += 1;
    } else {
      await deleteMany('survey_options', {question_id: question.id});
      await deleteMany('survey_questions', {id: question.id});
      removed += 1;
    }
  }
  return {slug: body.p_slug, saved: questions.length, removed, deactivated};
}

export async function setSurveyQuestionActive(actor, body) {
  assertBankManager(actor);
  const version = await currentSurveyVersion(body.p_slug);
  const code = String(body.p_code || '').toUpperCase();
  const sections = await sectionsFor(version.id);
  await updateMany('survey_questions', {
    section_id: {$in: sections.map((item) => item.id)},
    code,
  }, {is_active: Boolean(body.p_active)});
  const question = (await questionsInVersion(version.id)).find((item) => item.code === code);
  if (!question) throw new ApiError(404, 'question_missing');
  return questionPayload(question);
}

export async function swapSurveyQuestionOrder(actor, body) {
  assertBankManager(actor);
  const version = await currentSurveyVersion(body.p_slug);
  const questions = await questionsInVersion(version.id);
  const first = questions.find((item) => item.code === String(body.p_code_a || '').toUpperCase());
  const second = questions.find((item) => item.code === String(body.p_code_b || '').toUpperCase());
  if (!first || !second) throw new ApiError(404, 'question_missing');
  await updateOne('survey_questions', {id: first.id}, {sort_order: second.sort_order});
  await updateOne('survey_questions', {id: second.id}, {sort_order: first.sort_order});
  return listSurveyBank(actor, body);
}

export async function deleteSurveyQuestion(actor, body) {
  assertBankManager(actor);
  const version = await currentSurveyVersion(body.p_slug);
  const code = String(body.p_code || '').toUpperCase();
  const question = (await questionsInVersion(version.id)).find((item) => item.code === code);
  if (!question) throw new ApiError(404, 'question_missing');
  const used = await findOne('survey_answers', {question_id: question.id});
  if (used) {
    await updateOne('survey_questions', {id: question.id}, {is_active: false});
  } else {
    await deleteMany('survey_options', {question_id: question.id});
    await deleteMany('survey_questions', {id: question.id});
  }
  return {ok: true};
}

const handlers = {
  current_session_profile: (actor) => currentSessionProfile(actor),
  sync_identity_workspace: syncIdentityWorkspace,
  organization_survey_culture: organizationSurveyCulture,
  culture_leads_by_organization: cultureLeadsByOrganization,
  list_culture_questions: listCultureQuestions,
  get_culture_question: getCultureQuestion,
  create_culture_question: createCultureQuestion,
  update_culture_question: updateCultureQuestion,
  delete_culture_question: deleteCultureQuestion,
  reorder_culture_questions: reorderCultureQuestions,
  update_culture_survey: updateCultureSurvey,
  save_organization_profile: saveOrganizationProfile,
  provision_organization: provisionOrganization,
  activate_invite_pin: activateInvitePin,
  create_staff_invite: createStaffInvite,
  create_respondent_application: createRespondentApplication,
  save_affinity_answer: saveAffinityAnswer,
  complete_affinity_evaluation: completeAffinityEvaluation,
  list_survey_bank: listSurveyBank,
  upsert_survey_question: upsertSurveyQuestion,
  replace_survey_bank: replaceSurveyBank,
  set_survey_question_active: setSurveyQuestionActive,
  swap_survey_question_order: swapSurveyQuestionOrder,
  delete_survey_question: deleteSurveyQuestion,
};

export async function handleRpc(name, actor, body) {
  const handler = handlers[name];
  if (!handler) throw new ApiError(404, 'unknown_rpc');
  return handler(actor, body || {});
}

export {publicRow};
