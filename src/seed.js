const now = () => new Date();

const ROLE_MAP = [
  ['superadmin', null, false, true, 'Global flag on profiles.is_superadmin.'],
  ['respondent', null, false, false, 'Candidate session. No membership.'],
  ['user', null, false, false, 'Placeholder after Google sign-in.'],
  ['company_admin', 'company_admin', true, false, 'Identity mapping.'],
  ['company_lead', 'company_lead', true, false, 'Identity mapping.'],
  ['ceo', 'company_lead', true, false, 'Legacy alias.'],
  ['people_ops', 'people_ops', true, false, 'Identity mapping.'],
  ['hr', 'people_ops', true, false, 'Legacy alias.'],
  ['recruiter', 'recruiter', true, false, 'Identity mapping.'],
  ['hiring_manager', 'hiring_manager', true, false, 'Identity mapping.'],
];

const STATUS_MAP = [
  ['active', 'active', 'Identity mapping.'],
  ['onboarding', 'onboarding', 'Default when a company is provisioned.'],
  ['inactive', 'inactive', 'Identity mapping.'],
  ['atRisk', 'atRisk', 'Preserve camelCase from CompanyStatus.name.'],
  ['suspended', 'suspended', 'Identity mapping.'],
];

const TEMPLATES = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    slug: 'affinity-core',
    purpose: 'affinity',
    title: 'Encuesta de afinidad TaleX',
    description: 'Valores, necesidades y experiencias. Gemini lee este banco.',
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    slug: 'culture-perception',
    purpose: 'culture_perception',
    title: 'Percepción cultural TaleX',
    description: 'Formulario de valores/cultura de la empresa. Listo para cargar preguntas.',
  },
];

const VERSIONS = [
  {
    id: '11111111-1111-4111-8111-111111111112',
    template_id: '11111111-1111-1111-1111-111111111111',
    version_number: 1,
    status: 'published',
    published_at: now(),
  },
  {
    id: '22222222-2222-4222-8222-222222222223',
    template_id: '22222222-2222-2222-2222-222222222222',
    version_number: 1,
    status: 'draft',
    published_at: null,
  },
];

const SECTIONS = [
  ['11111111-1111-4111-8111-111111111113', '11111111-1111-4111-8111-111111111112', 'values', 'Valores', 1],
  ['11111111-1111-4111-8111-111111111114', '11111111-1111-4111-8111-111111111112', 'needs', 'Necesidades', 2],
  ['11111111-1111-4111-8111-111111111115', '11111111-1111-4111-8111-111111111112', 'capabilities', 'Experiencias', 3],
  ['22222222-2222-4222-8222-222222222224', '22222222-2222-4222-8222-222222222223', 'cultura', 'Cultura vivida', 1],
  ['22222222-2222-4222-8222-222222222225', '22222222-2222-4222-8222-222222222223', 'liderazgo', 'Liderazgo y decisiones', 2],
  ['22222222-2222-4222-8222-222222222226', '22222222-2222-4222-8222-222222222223', 'trabajo', 'Forma de trabajar', 3],
  ['22222222-2222-4222-8222-222222222227', '22222222-2222-4222-8222-222222222223', 'personas', 'Personas y relaciones', 4],
  ['22222222-2222-4222-8222-222222222228', '22222222-2222-4222-8222-222222222223', 'apertura', 'Comentarios abiertos', 5],
];

async function upsert(db, name, filter, set) {
  await db.collection(name).updateOne(filter, {$set: set}, {upsert: true});
}

export async function ensureSeed(db) {
  for (const [firestore_role, membership_role, creates_membership, is_superadmin, notes] of ROLE_MAP) {
    await upsert(db, 'legacy_role_map', {firestore_role}, {
      firestore_role,
      membership_role,
      creates_membership,
      is_superadmin,
      notes,
    });
  }
  for (const [firestore_status, postgres_status, notes] of STATUS_MAP) {
    await upsert(db, 'legacy_company_status_map', {firestore_status}, {
      firestore_status,
      postgres_status,
      notes,
    });
  }
  for (const template of TEMPLATES) {
    await upsert(db, 'survey_templates', {id: template.id}, {...template, updated_at: now()});
  }
  for (const version of VERSIONS) {
    await upsert(db, 'survey_versions', {id: version.id}, {...version, created_at: now()});
  }
  for (const [id, version_id, code, title, sort_order] of SECTIONS) {
    await upsert(db, 'survey_sections', {id}, {id, version_id, code, title, sort_order});
  }
}
