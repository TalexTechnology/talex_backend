import {randomUUID} from 'node:crypto';
import {query, queryOne} from '../db.js';
import {ApiError} from '../http.js';
import {asList, hashInvitePin, normalizeEmail, randomToken, sha256Hex, verifyInvitePin} from '../domain/crypto.js';
import {upsertProfile} from '../services/session.js';
import {publicRow} from '../domain/rows.js';
import {
  assertBankManager,
  assertCanWriteOrg,
  assertSignedIn,
  canWriteOrg,
  ownsApplication,
  isUuid,
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

export async function currentSessionProfile(actor) {
  assertSignedIn(actor);
  const profile = actor.profile;
  let role = profile.is_superadmin ? 'superadmin' : 'user';
  let organization = null;
  if (actor.membership) {
    role = actor.membership.legacy_role || actor.membership.role;
    organization = await queryOne(
      'SELECT * FROM organizations WHERE id = :id',
      {id: actor.membership.organization_id},
    );
  }
  const person = await queryOne(
    `SELECT * FROM persons
     WHERE linked_profile_id = :profileId OR email = :email
     ORDER BY CASE WHEN linked_profile_id = :linkedId THEN 0 ELSE 1 END
     LIMIT 1`,
    {profileId: profile.id, linkedId: profile.id, email: profile.email},
  );
  let application = null;
  if (person) {
    application = await queryOne(
      `SELECT * FROM applications WHERE person_id = :personId
       ORDER BY created_at DESC LIMIT 1`,
      {personId: person.id},
    );
    if (role === 'user' && application) role = 'respondent';
    if (!organization && application) {
      organization = await queryOne('SELECT * FROM organizations WHERE id = :id', {
        id: application.organization_id,
      });
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
    let organization = await queryOne(
      `SELECT * FROM organizations
       WHERE firebase_id = :orgKey OR id = :orgKey
       LIMIT 1`,
      {orgKey},
    );
    if (!organization) {
      const organizationId = isUuid(orgKey) ? orgKey : randomUUID();
      await query(
        `INSERT INTO organizations (id, firebase_id, name, status)
         VALUES (:id, :firebaseId, :name, 'active')`,
        {
          id: organizationId,
          firebaseId: orgKey,
          name: orgName || 'Empresa',
        },
      );
      organization = await queryOne('SELECT * FROM organizations WHERE id = :id', {
        id: organizationId,
      });
    } else if (orgName) {
      await query(
        `UPDATE organizations SET name = COALESCE(NULLIF(:name, ''), name) WHERE id = :id`,
        {id: organization.id, name: orgName},
      );
    }
    const mapped = await queryOne(
      `SELECT membership_role FROM legacy_role_map WHERE firestore_role = :role LIMIT 1`,
      {role: staffRole},
    );
    const membershipRole = mapped?.membership_role || 'company_admin';
    await query(
      `INSERT INTO memberships (id, organization_id, profile_id, role, legacy_role, is_active)
       VALUES (:id, :organizationId, :profileId, :role, :legacyRole, 1)
       ON DUPLICATE KEY UPDATE role = VALUES(role), legacy_role = VALUES(legacy_role), is_active = 1`,
      {
        id: randomUUID(),
        organizationId: organization.id,
        profileId: profile.id,
        role: membershipRole,
        legacyRole: roleRaw,
      },
    );
  }
  return currentSessionProfile({
    firebaseUid: actor.firebaseUid,
    email: profile.email,
    profile,
    membership: await queryOne(
      `SELECT m.organization_id, m.role, m.legacy_role, o.name AS organization_name,
              o.firebase_id AS organization_firebase_id
       FROM memberships m
       JOIN organizations o ON o.id = m.organization_id
       WHERE m.profile_id = :profileId AND m.is_active = 1
       ORDER BY m.created_at ASC
       LIMIT 1`,
      {profileId: profile.id},
    ),
    isSuperadmin: Boolean(profile.is_superadmin),
  });
}

export async function organizationSurveyCulture(actor, body) {
  const organizationId = await resolveOrganizationId(body.p_organization_id);
  if (!organizationId) throw new ApiError(404, 'company_not_found');
  if (!actor.isSuperadmin && !canWriteOrg(actor, organizationId) && !(await ownsOrgSession(actor, organizationId))) {
    throw new ApiError(403, 'permission_denied');
  }
  const countRow = await queryOne(
    `SELECT COUNT(*) AS respondentCount
     FROM survey_sessions
     WHERE organization_id = :organizationId
       AND purpose = 'culture_perception'
       AND status = 'completed'`,
    {organizationId},
  );
  const respondents = Number(countRow?.respondentCount || 0);
  const answers = await query(
    `SELECT sec.code AS section_code, a.format, a.value_int, a.value_text,
            a.statement_a, a.statement_b, q.dimension_a, q.dimension_b, q.statement_a AS q_a, q.statement_b AS q_b
     FROM survey_sessions s
     JOIN survey_answers a ON a.session_id = s.id
     JOIN survey_questions q ON q.id = a.question_id
     JOIN survey_sections sec ON sec.id = q.section_id
     WHERE s.organization_id = :organizationId
       AND s.purpose = 'culture_perception'
       AND s.status = 'completed'`,
    {organizationId},
  );
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
  const row = await queryOne(
    `SELECT a.id
     FROM applications a
     JOIN persons p ON p.id = a.person_id
     WHERE a.organization_id = :organizationId
       AND (p.linked_profile_id = :profileId OR p.email = :email)
     LIMIT 1`,
    {organizationId, profileId: actor.profile.id, email: actor.profile.email},
  );
  return Boolean(row);
}

export async function saveOrganizationProfile(actor, body) {
  const organizationId = await resolveOrganizationId(body.p_organization_id);
  if (!organizationId) throw new ApiError(403, 'permission_denied');
  assertCanWriteOrg(actor, organizationId);
  await query(
    `UPDATE organizations
     SET name = COALESCE(NULLIF(:name, ''), name),
         nit = :nit, logo_url = :logoUrl, sector = :sector, size_label = :sizeLabel,
         city = :city, country = :country, region = :region, website = :website,
         description = :description, last_activity_at = CURRENT_TIMESTAMP(6)
     WHERE id = :organizationId`,
    {
      organizationId,
      name: String(body.p_name || '').trim(),
      nit: body.p_nit ?? null,
      logoUrl: body.p_logo_url ?? null,
      sector: body.p_sector ?? null,
      sizeLabel: body.p_size ?? null,
      city: body.p_city ?? null,
      country: body.p_country ?? null,
      region: body.p_region ?? null,
      website: body.p_website ?? null,
      description: body.p_description ?? null,
    },
  );
  await query(
    `UPDATE organization_culture_versions SET is_current = 0
     WHERE organization_id = :organizationId AND is_current = 1`,
    {organizationId},
  );
  const version = await queryOne(
    `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
     FROM organization_culture_versions WHERE organization_id = :organizationId`,
    {organizationId},
  );
  await query(
    `INSERT INTO organization_culture_versions
      (id, organization_id, version_number, values_list, culture_list, standout_list,
       sought_characteristics, is_current, published_by)
     VALUES (:id, :organizationId, :version, :valuesList, :cultureList, :standoutList,
             :sought, 1, :profileId)`,
    {
      id: randomUUID(),
      organizationId,
      version: version.next_version,
      valuesList: JSON.stringify(asList(body.p_values)),
      cultureList: JSON.stringify(asList(body.p_culture)),
      standoutList: JSON.stringify(asList(body.p_standout)),
      sought: body.p_sought ?? null,
      profileId: actor.profile.id,
    },
  );
  await query(
    'UPDATE profiles SET must_review_company_dna = 0 WHERE id = :id',
    {id: actor.profile.id},
  );
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
  await query(
    `INSERT INTO organizations
      (id, firebase_id, name, nit, logo_url, sector, size_label, city, country, region,
       website, description, status)
     VALUES (:id, :id, :name, :nit, :logoUrl, :sector, :sizeLabel, :city, :country, :region,
             :website, :description, 'onboarding')`,
    {
      id: organizationId,
      name,
      nit: body.p_nit ?? null,
      logoUrl: body.p_logo_url ?? null,
      sector: body.p_sector ?? null,
      sizeLabel: body.p_size ?? null,
      city: body.p_city ?? null,
      country: body.p_country ?? null,
      region: body.p_region ?? null,
      website: body.p_website ?? null,
      description: body.p_description ?? null,
    },
  );
  await query(
    `INSERT INTO organization_culture_versions
      (id, organization_id, version_number, values_list, culture_list, standout_list,
       sought_characteristics, is_current, published_by)
     VALUES (:id, :organizationId, 1, :valuesList, :cultureList, :standoutList, :sought, 1, :profileId)`,
    {
      id: randomUUID(),
      organizationId,
      valuesList: JSON.stringify(asList(body.p_values)),
      cultureList: JSON.stringify(asList(body.p_culture)),
      standoutList: JSON.stringify(asList(body.p_standout)),
      sought: body.p_sought ?? null,
      profileId: actor.profile.id,
    },
  );
  await query(
    `INSERT INTO activation_invites
      (id, email, organization_id, kind, role, pin_hash, pin_algorithm, used,
       first_name, last_name, pin_expires_at)
     VALUES (:id, :email, :organizationId, 'recruiter', 'company_admin', :pinHash, 'fnv1a32', 0,
             :firstName, :lastName, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 15 MINUTE))`,
    {
      id: randomUUID(),
      email,
      organizationId,
      pinHash: hashInvitePin(pin, email),
      firstName: body.p_recruiter_first_name ?? null,
      lastName: body.p_recruiter_last_name ?? null,
    },
  );
  await query(
    `INSERT INTO activity_events (id, organization_id, actor_profile_id, kind, entity_name, status_label)
     VALUES (:id, :organizationId, :profileId, 'companyCreated', :name, 'onboarding')`,
    {id: randomUUID(), organizationId, profileId: actor.profile.id, name},
  );
  return {organizationId, pin};
}

export async function activateInvitePin(actor, body) {
  assertSignedIn(actor);
  const pin = String(body.p_pin || '').trim();
  if (pin.length < 6) throw new ApiError(400, 'invalid_pin');
  const invite = await queryOne(
    `SELECT * FROM activation_invites
     WHERE email = :email AND kind = 'recruiter' AND used = 0
     ORDER BY created_at DESC LIMIT 1`,
    {email: actor.profile.email},
  );
  if (!invite) throw new ApiError(404, 'invite_missing');
  if (invite.pin_expires_at && new Date(invite.pin_expires_at) <= new Date()) {
    throw new ApiError(400, 'pin_expired');
  }
  if (!verifyInvitePin(pin, actor.profile.email, invite.pin_hash)) {
    throw new ApiError(400, 'invalid_pin');
  }
  const mapped = await queryOne(
    'SELECT membership_role FROM legacy_role_map WHERE firestore_role = :role LIMIT 1',
    {role: invite.role || 'recruiter'},
  );
  const membershipId = randomUUID();
  await query(
    `INSERT INTO memberships (id, organization_id, profile_id, role, legacy_role, is_active)
     VALUES (:id, :organizationId, :profileId, :role, :legacyRole, 1)
     ON DUPLICATE KEY UPDATE role = VALUES(role), legacy_role = VALUES(legacy_role), is_active = 1`,
    {
      id: membershipId,
      organizationId: invite.organization_id,
      profileId: actor.profile.id,
      role: mapped?.membership_role || 'recruiter',
      legacyRole: invite.role,
    },
  );
  await query(
    `UPDATE profiles
     SET display_name = COALESCE(NULLIF(TRIM(CONCAT_WS(' ', :firstName, :lastName)), ''), display_name),
         document_number = COALESCE(:documentNumber, document_number),
         must_change_password = 0,
         must_review_company_dna = 0
     WHERE id = :id`,
    {
      firstName: invite.first_name,
      lastName: invite.last_name,
      documentNumber: invite.document_number,
      id: actor.profile.id,
    },
  );
  await query('UPDATE activation_invites SET used = 1 WHERE id = :id', {id: invite.id});
  const organization = await queryOne('SELECT * FROM organizations WHERE id = :id', {
    id: invite.organization_id,
  });
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
  await query(
    `UPDATE activation_invites SET used = 1
     WHERE email = :email AND organization_id = :organizationId AND kind = 'recruiter' AND used = 0`,
    {email, organizationId},
  );
  await query(
    `INSERT INTO activation_invites
      (id, email, organization_id, kind, role, pin_hash, pin_algorithm, used,
       first_name, last_name, pin_expires_at)
     VALUES (:id, :email, :organizationId, 'recruiter', :role, :pinHash, 'fnv1a32', 0,
             :firstName, :lastName, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 15 MINUTE))`,
    {
      id: randomUUID(),
      email,
      organizationId,
      role: String(body.p_role || 'recruiter').trim() || 'recruiter',
      pinHash: hashInvitePin(pin, email),
      firstName: body.p_first_name ?? null,
      lastName: body.p_last_name ?? null,
    },
  );
  return {pin};
}

export async function createRespondentApplication(actor, body) {
  const organizationId = await resolveOrganizationId(body.p_organization_id);
  const vacancyId = await resolveVacancyId(body.p_vacancy_id);
  if (!organizationId || !vacancyId) throw new ApiError(403, 'permission_denied');
  assertCanWriteOrg(actor, organizationId);
  const vacancy = await queryOne('SELECT * FROM vacancies WHERE id = :id', {id: vacancyId});
  if (!vacancy || vacancy.organization_id !== organizationId) {
    throw new ApiError(403, 'permission_denied');
  }
  const email = normalizeEmail(body.p_email);
  const token = String(body.p_token || '').trim() || randomToken();
  const displayName = String(body.p_display_name || '').trim();
  const personId = randomUUID();
  await query(
    `INSERT INTO persons (id, email, document_number, display_name)
     VALUES (:id, :email, :documentNumber, :displayName)
     ON DUPLICATE KEY UPDATE
       document_number = COALESCE(VALUES(document_number), document_number),
       display_name = COALESCE(VALUES(display_name), display_name)`,
    {
      id: personId,
      email,
      documentNumber: String(body.p_document_number || '').trim() || null,
      displayName: displayName || null,
    },
  );
  const person = await queryOne('SELECT id FROM persons WHERE email = :email', {email});
  const applicationId = randomUUID();
  await query(
    `INSERT INTO applications
      (id, organization_id, vacancy_id, person_id, vacancy_name, process_status, firebase_candidate_id)
     VALUES (:id, :organizationId, :vacancyId, :personId, :vacancyName, 'pending', :id)
     ON DUPLICATE KEY UPDATE vacancy_name = VALUES(vacancy_name)`,
    {
      id: applicationId,
      organizationId,
      vacancyId,
      personId: person.id,
      vacancyName: vacancy.name,
    },
  );
  const application = await queryOne(
    `SELECT * FROM applications
     WHERE organization_id = :organizationId AND vacancy_id = :vacancyId AND person_id = :personId`,
    {organizationId, vacancyId, personId: person.id},
  );
  if (!application.firebase_candidate_id) {
    await query(
      'UPDATE applications SET firebase_candidate_id = id WHERE id = :id',
      {id: application.id},
    );
  }
  const [firstName, ...rest] = displayName.split(' ');
  await query(
    `INSERT INTO activation_invites
      (id, email, organization_id, vacancy_id, kind, role, token_hash, used, application_id,
       first_name, last_name, document_number, token_expires_at)
     VALUES (:id, :email, :organizationId, :vacancyId, 'respondent', 'respondent', :tokenHash, 0,
             :applicationId, :firstName, :lastName, :documentNumber,
             DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 14 DAY))`,
    {
      id: randomUUID(),
      email,
      organizationId,
      vacancyId,
      tokenHash: sha256Hex(token),
      applicationId: application.id,
      firstName: firstName || null,
      lastName: rest.join(' ') || null,
      documentNumber: String(body.p_document_number || '').trim() || null,
    },
  );
  return {
    applicationId: publicEntityId(application.id, application.firebase_candidate_id || application.id),
    token,
  };
}

export async function saveAffinityAnswer(actor, body) {
  const applicationId = await resolveApplicationId(body.p_application_id);
  const application = applicationId
    ? await queryOne('SELECT * FROM applications WHERE id = :id', {id: applicationId})
    : null;
  if (!application) throw new ApiError(404, 'assessment_missing');
  if (
    !canWriteOrg(actor, application.organization_id) &&
    !(await ownsApplication(actor, application.id))
  ) {
    throw new ApiError(403, 'permission_denied');
  }
  const value = Number(body.p_value);
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new ApiError(400, 'invalid_answer');
  }
  const version = await queryOne(
    `SELECT v.id FROM survey_versions v
     JOIN survey_templates t ON t.id = v.template_id
     WHERE t.slug = 'affinity-core' AND v.status = 'published'
     ORDER BY v.version_number DESC LIMIT 1`,
  );
  let session = await queryOne(
    `SELECT id FROM survey_sessions
     WHERE application_id = :applicationId AND purpose = 'affinity'
     ORDER BY started_at DESC LIMIT 1`,
    {applicationId: application.id},
  );
  if (!session) {
    const sessionId = randomUUID();
    await query(
      `INSERT INTO survey_sessions
        (id, version_id, purpose, organization_id, application_id, person_id, status)
       VALUES (:id, :versionId, 'affinity', :organizationId, :applicationId, :personId, 'in_progress')`,
      {
        id: sessionId,
        versionId: version?.id,
        organizationId: application.organization_id,
        applicationId: application.id,
        personId: application.person_id,
      },
    );
    session = {id: sessionId};
  }
  const question = await queryOne(
    'SELECT id, code, format, statement_a, statement_b FROM survey_questions WHERE code = :code LIMIT 1',
    {code: body.p_question_code},
  );
  if (!question) throw new ApiError(400, 'invalid_question');
  const answerId = randomUUID();
  await query(
    `INSERT INTO survey_answers
      (id, session_id, question_id, value_int, question_code, format, statement_a, statement_b)
     VALUES (:id, :sessionId, :questionId, :valueInt, :code, :format, :statementA, :statementB)
     ON DUPLICATE KEY UPDATE value_int = VALUES(value_int)`,
    {
      id: answerId,
      sessionId: session.id,
      questionId: question.id,
      valueInt: value,
      code: question.code,
      format: question.format,
      statementA: question.statement_a,
      statementB: question.statement_b,
    },
  );
  await query(
    `UPDATE applications SET process_status = 'inProgress'
     WHERE id = :id AND process_status = 'pending'`,
    {id: application.id},
  );
  return {ok: true};
}

export async function completeAffinityEvaluation(actor, body) {
  const applicationId = await resolveApplicationId(body.p_application_id);
  const application = applicationId
    ? await queryOne('SELECT * FROM applications WHERE id = :id', {id: applicationId})
    : null;
  if (!application) throw new ApiError(404, 'assessment_missing');
  if (
    !canWriteOrg(actor, application.organization_id) &&
    !(await ownsApplication(actor, application.id))
  ) {
    throw new ApiError(403, 'permission_denied');
  }
  const session = await queryOne(
    `SELECT id FROM survey_sessions
     WHERE application_id = :applicationId AND purpose = 'affinity'
     ORDER BY started_at DESC LIMIT 1`,
    {applicationId: application.id},
  );
  if (session) {
    await query(
      `UPDATE survey_sessions
       SET status = 'completed', completed_at = CURRENT_TIMESTAMP(6)
       WHERE id = :id`,
      {id: session.id},
    );
  }
  await query(
    `UPDATE applications
     SET process_status = 'completed', evaluation_completed = 1,
         vacancy_affinity = COALESCE(:vacancyAffinity, vacancy_affinity)
     WHERE id = :id`,
    {id: application.id, vacancyAffinity: body.p_vacancy_affinity ?? null},
  );
  const evaluationId = randomUUID();
  await query(
    `INSERT INTO affinity_evaluations
      (id, application_id, session_id, organization_id, firebase_evaluation_id, status,
       dimension_scores, completed_at)
     VALUES (:id, :applicationId, :sessionId, :organizationId, :firebaseId, 'completed',
             :scores, CURRENT_TIMESTAMP(6))
     ON DUPLICATE KEY UPDATE
       session_id = VALUES(session_id),
       status = 'completed',
       dimension_scores = VALUES(dimension_scores),
       completed_at = CURRENT_TIMESTAMP(6)`,
    {
      id: evaluationId,
      applicationId: application.id,
      sessionId: session?.id ?? null,
      organizationId: application.organization_id,
      firebaseId: application.firebase_candidate_id || application.id,
      scores: JSON.stringify(body.p_dimension_scores ?? null),
    },
  );
  const evaluation = await queryOne(
    'SELECT id FROM affinity_evaluations WHERE application_id = :id',
    {id: application.id},
  );
  return {
    applicationId: publicEntityId(application.id, application.firebase_candidate_id),
    evaluationId: evaluation.id,
    firebaseCandidateId: application.firebase_candidate_id || application.id,
  };
}

async function currentSurveyVersion(slug) {
  const row = await queryOne(
    `SELECT v.*
     FROM survey_versions v
     JOIN survey_templates t ON t.id = v.template_id
     WHERE t.slug = :slug
     ORDER BY CASE v.status WHEN 'published' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
              v.version_number DESC
     LIMIT 1`,
    {slug},
  );
  if (!row) throw new ApiError(404, 'survey_missing');
  return row;
}

async function ensureSection(versionId, code, title) {
  const existing = await queryOne(
    'SELECT * FROM survey_sections WHERE version_id = :versionId AND code = :code',
    {versionId, code},
  );
  if (existing) return existing;
  const next = await queryOne(
    'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_sort FROM survey_sections WHERE version_id = :versionId',
    {versionId},
  );
  const id = randomUUID();
  await query(
    `INSERT INTO survey_sections (id, version_id, code, title, sort_order)
     VALUES (:id, :versionId, :code, :title, :sortOrder)`,
    {id, versionId, code, title: title || code, sortOrder: next.next_sort},
  );
  return queryOne('SELECT * FROM survey_sections WHERE id = :id', {id});
}

async function questionPayload(question) {
  const section = await queryOne('SELECT * FROM survey_sections WHERE id = :id', {
    id: question.section_id,
  });
  const options = await query(
    `SELECT label FROM survey_options
     WHERE question_id = :id ORDER BY sort_order, value_int`,
    {id: question.id},
  );
  return {
    id: question.id,
    code: question.code,
    front: section.code,
    section: section.code,
    sectionTitle: section.title,
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

export async function listSurveyBank(actor, body) {
  assertBankManager(actor);
  const version = await currentSurveyVersion(body.p_slug);
  const questions = await query(
    `SELECT q.* FROM survey_questions q
     JOIN survey_sections s ON s.id = q.section_id
     WHERE s.version_id = :versionId
     ORDER BY q.sort_order, q.code`,
    {versionId: version.id},
  );
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
  const existing = await queryOne(
    `SELECT q.* FROM survey_questions q
     JOIN survey_sections s ON s.id = q.section_id
     WHERE s.version_id = :versionId AND q.code = :code LIMIT 1`,
    {versionId: version.id, code},
  );
  const payload = {
    sectionId: section.id,
    format,
    instruction: pick(question, 'instruction'),
    statementA: pick(question, 'statementA', 'statement_a') || code,
    statementB: pick(question, 'statementB', 'statement_b'),
    dimensionA: pick(question, 'dimensionA', 'dimension_a'),
    dimensionB: pick(question, 'dimensionB', 'dimension_b'),
    timeLimit: pick(question, 'timeLimitSeconds', 'time_limit_seconds'),
    sortOrder: pick(question, 'order', 'sort_order') ?? 0,
    required: pick(question, 'required', 'is_required') !== false ? 1 : 0,
    active: pick(question, 'active', 'is_active') !== false ? 1 : 0,
  };
  let questionId = existing?.id;
  if (!existing) {
    questionId = randomUUID();
    await query(
      `INSERT INTO survey_questions
        (id, section_id, code, format, instruction, statement_a, statement_b,
         dimension_a, dimension_b, time_limit_seconds, sort_order, is_required, is_active)
       VALUES (:id, :sectionId, :code, :format, :instruction, :statementA, :statementB,
               :dimensionA, :dimensionB, :timeLimit, :sortOrder, :required, :active)`,
      {id: questionId, code, ...payload},
    );
  } else {
    await query(
      `UPDATE survey_questions
       SET section_id = :sectionId, format = :format, instruction = :instruction,
           statement_a = :statementA, statement_b = :statementB, dimension_a = :dimensionA,
           dimension_b = :dimensionB, time_limit_seconds = :timeLimit, sort_order = :sortOrder,
           is_required = :required, is_active = :active
       WHERE id = :id`,
      {id: questionId, ...payload},
    );
  }
  await query('DELETE FROM survey_options WHERE question_id = :id', {id: questionId});
  const options = asList(question.options);
  for (const [index, label] of options.entries()) {
    await query(
      `INSERT INTO survey_options (id, question_id, value_int, label, sort_order)
       VALUES (:id, :questionId, :valueInt, :label, :sortOrder)`,
      {
        id: randomUUID(),
        questionId,
        valueInt: index + 1,
        label: String(label),
        sortOrder: index + 1,
      },
    );
  }
  const saved = await queryOne('SELECT * FROM survey_questions WHERE id = :id', {
    id: questionId,
  });
  return questionPayload(saved);
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
  const existing = await query(
    `SELECT q.id, q.code FROM survey_questions q
     JOIN survey_sections s ON s.id = q.section_id
     WHERE s.version_id = :versionId`,
    {versionId: version.id},
  );
  let removed = 0;
  let deactivated = 0;
  for (const question of existing) {
    if (uploaded.includes(question.code)) continue;
    const used = await queryOne(
      'SELECT id FROM survey_answers WHERE question_id = :id LIMIT 1',
      {id: question.id},
    );
    if (used) {
      await query('UPDATE survey_questions SET is_active = 0 WHERE id = :id', {
        id: question.id,
      });
      deactivated += 1;
    } else {
      await query('DELETE FROM survey_options WHERE question_id = :id', {id: question.id});
      await query('DELETE FROM survey_questions WHERE id = :id', {id: question.id});
      removed += 1;
    }
  }
  return {slug: body.p_slug, saved: questions.length, removed, deactivated};
}

export async function setSurveyQuestionActive(actor, body) {
  assertBankManager(actor);
  const version = await currentSurveyVersion(body.p_slug);
  await query(
    `UPDATE survey_questions q
     JOIN survey_sections s ON s.id = q.section_id
     SET q.is_active = :active
     WHERE s.version_id = :versionId AND q.code = :code`,
    {
      active: body.p_active ? 1 : 0,
      versionId: version.id,
      code: String(body.p_code || '').toUpperCase(),
    },
  );
  const question = await queryOne(
    `SELECT q.* FROM survey_questions q
     JOIN survey_sections s ON s.id = q.section_id
     WHERE s.version_id = :versionId AND q.code = :code`,
    {versionId: version.id, code: String(body.p_code || '').toUpperCase()},
  );
  if (!question) throw new ApiError(404, 'question_missing');
  return questionPayload(question);
}

export async function swapSurveyQuestionOrder(actor, body) {
  assertBankManager(actor);
  const version = await currentSurveyVersion(body.p_slug);
  const first = await queryOne(
    `SELECT q.id, q.sort_order FROM survey_questions q
     JOIN survey_sections s ON s.id = q.section_id
     WHERE s.version_id = :versionId AND q.code = :code`,
    {versionId: version.id, code: String(body.p_code_a || '').toUpperCase()},
  );
  const second = await queryOne(
    `SELECT q.id, q.sort_order FROM survey_questions q
     JOIN survey_sections s ON s.id = q.section_id
     WHERE s.version_id = :versionId AND q.code = :code`,
    {versionId: version.id, code: String(body.p_code_b || '').toUpperCase()},
  );
  if (!first || !second) throw new ApiError(404, 'question_missing');
  await query('UPDATE survey_questions SET sort_order = :sortOrder WHERE id = :id', {
    id: first.id,
    sortOrder: second.sort_order,
  });
  await query('UPDATE survey_questions SET sort_order = :sortOrder WHERE id = :id', {
    id: second.id,
    sortOrder: first.sort_order,
  });
  return listSurveyBank(actor, body);
}

export async function deleteSurveyQuestion(actor, body) {
  assertBankManager(actor);
  const version = await currentSurveyVersion(body.p_slug);
  const question = await queryOne(
    `SELECT q.* FROM survey_questions q
     JOIN survey_sections s ON s.id = q.section_id
     WHERE s.version_id = :versionId AND q.code = :code`,
    {versionId: version.id, code: String(body.p_code || '').toUpperCase()},
  );
  if (!question) throw new ApiError(404, 'question_missing');
  const used = await queryOne(
    'SELECT id FROM survey_answers WHERE question_id = :id LIMIT 1',
    {id: question.id},
  );
  if (used) {
    await query('UPDATE survey_questions SET is_active = 0 WHERE id = :id', {
      id: question.id,
    });
  } else {
    await query('DELETE FROM survey_options WHERE question_id = :id', {id: question.id});
    await query('DELETE FROM survey_questions WHERE id = :id', {id: question.id});
  }
  return {ok: true};
}

const handlers = {
  current_session_profile: (actor) => currentSessionProfile(actor),
  sync_identity_workspace: syncIdentityWorkspace,
  organization_survey_culture: organizationSurveyCulture,
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
