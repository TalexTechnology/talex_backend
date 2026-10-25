const partialString = (field) => ({
  unique: true,
  partialFilterExpression: {[field]: {$type: 'string'}},
});

const INDEXES = {
  profiles: [
    [{email: 1}, {unique: true}],
    [{firebase_uid: 1}, partialString('firebase_uid')],
  ],
  organizations: [[{firebase_id: 1}, partialString('firebase_id')]],
  memberships: [
    [{organization_id: 1, profile_id: 1}, {unique: true}],
    [{profile_id: 1, is_active: 1, created_at: 1}],
  ],
  organization_culture_versions: [
    [{organization_id: 1, version_number: 1}, {unique: true}],
    [{organization_id: 1, is_current: 1}],
  ],
  dna_catalog_entries: [[{firebase_id: 1}, partialString('firebase_id')]],
  vacancies: [
    [{firebase_id: 1}, partialString('firebase_id')],
    [{organization_id: 1, status: 1}],
  ],
  persons: [
    [{email: 1}, {unique: true}],
    [{document_number: 1}],
    [{linked_profile_id: 1}],
  ],
  applications: [
    [{organization_id: 1, vacancy_id: 1, person_id: 1}, {unique: true}],
    [{firebase_candidate_id: 1}, partialString('firebase_candidate_id')],
    [{organization_id: 1, process_status: 1}],
    [{person_id: 1, created_at: -1}],
  ],
  application_status_events: [[{application_id: 1}]],
  survey_templates: [[{slug: 1}, {unique: true}]],
  survey_versions: [[{template_id: 1, version_number: 1}, {unique: true}]],
  survey_sections: [[{version_id: 1, code: 1}, {unique: true}]],
  survey_questions: [
    [{section_id: 1, code: 1}, {unique: true}],
    [{code: 1}],
  ],
  survey_options: [[{question_id: 1, value_int: 1}, {unique: true}]],
  public_survey_links: [[{token_hash: 1}, partialString('token_hash')]],
  survey_sessions: [
    [{organization_id: 1, purpose: 1, status: 1}],
    [{application_id: 1, purpose: 1, started_at: -1}],
  ],
  survey_answers: [[{session_id: 1, question_id: 1}, {unique: true}]],
  survey_submission_keys: [[{public_link_id: 1, key_hash: 1}, {unique: true}]],
  culture_perception_results: [[{session_id: 1}, {unique: true}]],
  affinity_evaluations: [
    [{application_id: 1}, {unique: true}],
    [{firebase_evaluation_id: 1}, partialString('firebase_evaluation_id')],
  ],
  evaluation_reports: [[{evaluation_id: 1}, {unique: true}]],
  activation_invites: [
    [{token_hash: 1}, partialString('token_hash')],
    [{email: 1, kind: 1, used: 1, created_at: -1}],
    [{organization_id: 1}],
  ],
  legacy_role_map: [[{firestore_role: 1}, {unique: true}]],
  legacy_company_status_map: [[{firestore_status: 1}, {unique: true}]],
  activity_events: [
    [{firebase_id: 1}, partialString('firebase_id')],
    [{organization_id: 1, created_at: -1}],
  ],
  firebase_id_map: [[{collection_name: 1, firebase_id: 1}, {unique: true}]],
  culture_reports: [[{organization_id: 1}, {unique: true}]],
  culture_leads: [
    [{email: 1, created_at: -1}],
    [{status: 1, created_at: -1}],
    [{organization_id: 1}],
    [{created_at: -1}],
  ],
};

export async function ensureIndexes(db) {
  for (const [name, specs] of Object.entries(INDEXES)) {
    await db.collection(name).createIndexes(
      specs.map(([key, options]) => ({key, ...options})),
    );
  }
}
