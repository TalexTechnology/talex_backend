import {randomUUID} from 'node:crypto';
import {closeDatabase, pingDatabase} from '../src/db.js';
import {deleteMany, findOne, insertOne} from '../src/domain/store.js';
import {handleTable} from '../src/application/tables.js';
import {
  activateInvitePin,
  completeAffinityEvaluation,
  createRespondentApplication,
  listSurveyBank,
  organizationSurveyCulture,
  provisionOrganization,
  saveAffinityAnswer,
  upsertSurveyQuestion,
} from '../src/application/rpc.js';

const actor = {
  isSuperadmin: true,
  firebaseUid: 'mongo-flow-admin',
  email: 'mongo-flow@talex.test',
  profile: {
    id: randomUUID(),
    firebase_uid: 'mongo-flow-admin',
    email: 'mongo-flow@talex.test',
    display_name: 'Mongo Flow',
    is_superadmin: true,
    document_number: null,
    must_change_password: false,
    must_review_company_dna: false,
  },
  membership: null,
};

const created = [];

function check(condition, label) {
  if (!condition) throw new Error(`FAIL ${label}`);
  console.log(`PASS ${label}`);
}

async function main() {
  await pingDatabase();
  check(true, 'ping');
  await insertOne('profiles', {
    ...actor.profile,
    is_active: true,
    must_change_password: false,
    must_review_company_dna: false,
    created_at: new Date(),
    updated_at: new Date(),
  });

  const vacancyId = randomUUID();
  const org = await provisionOrganization(actor, {
    p_name: 'tmp-mongo-verify',
    p_recruiter_email: 'mongo-flow@talex.test',
    p_pin: '123456',
    p_values: ['Claridad'],
  });
  created.push(org.organizationId);
  check(org.pin === '123456', 'provision pin');
  const stored = await findOne('organizations', {id: org.organizationId});
  check(stored?.status === 'onboarding', 'organization stored');

  const activated = await activateInvitePin(actor, {p_pin: '123456'});
  check(Boolean(activated.organizationId), 'activate pin');

  await handleTable('POST', 'vacancies', new URL('http://local/vacancies'), {
    ...actor,
    isSuperadmin: true,
    membership: {organization_id: org.organizationId},
  }, {
    id: vacancyId,
    organization_id: org.organizationId,
    name: 'Analista',
    status: 'active',
  });
  const listed = await handleTable(
    'GET',
    'vacancies',
    new URL(`http://local/vacancies?eq.organization_id=${org.organizationId}`),
    {...actor, membership: {organization_id: org.organizationId}},
    {},
  );
  check(listed.some((row) => row.id === vacancyId), 'table list vacancy');

  actor.membership = {organization_id: org.organizationId, role: 'company_admin'};
  const respondent = await createRespondentApplication(actor, {
    p_organization_id: org.organizationId,
    p_vacancy_id: vacancyId,
    p_email: 'persona-mongo@talex.test',
    p_display_name: 'Ana Ruiz',
  });
  check(Boolean(respondent.applicationId), 'respondent application');

  await upsertSurveyQuestion(actor, {
    p_slug: 'affinity-core',
    p_question: {
      code: 'TMP_MONGO_Q',
      section: 'values',
      format: 'pair',
      statementA: 'Uno',
      statementB: 'Dos',
    },
  });
  const bank = await listSurveyBank(actor, {p_slug: 'affinity-core'});
  check(bank.some((item) => item.code === 'TMP_MONGO_Q'), 'survey bank');

  await saveAffinityAnswer(actor, {
    p_application_id: respondent.applicationId,
    p_question_code: 'TMP_MONGO_Q',
    p_value: 4,
  });
  const completed = await completeAffinityEvaluation(actor, {
    p_application_id: respondent.applicationId,
    p_dimension_scores: {values: 4},
    p_vacancy_affinity: 'high',
  });
  check(Boolean(completed.evaluationId), 'complete evaluation');

  const culture = await organizationSurveyCulture(
    {...actor, membership: {organization_id: org.organizationId}},
    {p_organization_id: org.organizationId},
  );
  check(culture.respondentCount === 0, 'empty culture survey');
}

async function cleanup() {
  for (const organizationId of created) {
    await deleteMany('activation_invites', {organization_id: organizationId});
    await deleteMany('activity_events', {organization_id: organizationId});
    await deleteMany('organization_culture_versions', {organization_id: organizationId});
    await deleteMany('memberships', {organization_id: organizationId});
    await deleteMany('vacancies', {organization_id: organizationId});
    await deleteMany('survey_sessions', {organization_id: organizationId});
    await deleteMany('affinity_evaluations', {organization_id: organizationId});
    await deleteMany('applications', {organization_id: organizationId});
    await deleteMany('organizations', {id: organizationId});
  }
  await deleteMany('persons', {email: 'persona-mongo@talex.test'});
  await deleteMany('profiles', {email: 'mongo-flow@talex.test'});
  const question = await findOne('survey_questions', {code: 'TMP_MONGO_Q'});
  if (question) {
    await deleteMany('survey_answers', {question_id: question.id});
    await deleteMany('survey_options', {question_id: question.id});
    await deleteMany('survey_questions', {id: question.id});
  }
}

try {
  await main();
  console.log('FLOW_OK');
} finally {
  await cleanup();
  await closeDatabase();
}
