export const CULTURE_VALUES = [
  'Innovación y riesgo',
  'Estabilidad',
  'Respeto por las personas',
  'Orientación a resultados',
  'Atención al detalle',
  'Trabajo en equipo',
  'Competitividad',
];

export const LEADER_ROLES = new Set(['jefe', 'directivo']);
export const EMPLOYEE_ROLES = new Set(['operativo', 'profesional']);

export const CULTURE_CODES = ['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C08'];
export const FORECAST_CODES = ['C02', 'C03', 'C05'];

const TRAIT_BY_LABEL = new Map([
  ['colaborativa', {id: 'colaborativa', label: 'Colaborativa', valorTaleX: 'Trabajo en equipo'}],
  ['innovadora', {id: 'innovadora', label: 'Innovadora', valorTaleX: 'Innovación y riesgo'}],
  ['orientada a resultados', {id: 'orientada_resultados', label: 'Orientada a resultados', valorTaleX: 'Orientación a resultados'}],
  ['cercana', {id: 'cercana', label: 'Cercana', valorTaleX: 'Respeto por las personas'}],
  ['estructurada', {id: 'estructurada', label: 'Estructurada', valorTaleX: 'Estabilidad'}],
  ['flexible', {id: 'flexible', label: 'Flexible', valorTaleX: 'Innovación y riesgo'}],
  ['exigente', {id: 'exigente', label: 'Exigente', valorTaleX: 'Competitividad'}],
  ['de aprendizaje constante', {id: 'aprendizaje', label: 'De aprendizaje constante', valorTaleX: 'Innovación y riesgo'}],
]);

export const LANDING_TRAIT_LABELS = [...TRAIT_BY_LABEL.values()].map((item) => item.label);

export const DEFAULT_AREAS = [
  {id: 'direccion', label: 'Dirección'},
  {id: 'comercial', label: 'Comercial'},
  {id: 'operaciones', label: 'Operaciones'},
  {id: 'tecnologia', label: 'Tecnología'},
  {id: 'personas', label: 'Personas / Talento'},
  {id: 'finanzas', label: 'Finanzas'},
  {id: 'marketing', label: 'Marketing'},
  {id: 'otra', label: 'Otra'},
];

export function slug(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

export function landingTrait(value) {
  if (value && typeof value === 'object') {
    const mapped = landingTrait(value.label || value.id || value.name);
    if (mapped) {
      return {
        ...mapped,
        id: value.id || mapped.id,
        label: value.label || mapped.label,
        valorTaleX: value.valor_taleX || value.dimension || mapped.valorTaleX,
      };
    }
  }
  const key = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return TRAIT_BY_LABEL.get(key) || null;
}

export function mapLandingTraits(values) {
  const seen = new Set();
  const next = [];
  for (const raw of values || []) {
    const trait = landingTrait(raw);
    if (!trait || seen.has(trait.id)) continue;
    seen.add(trait.id);
    next.push({
      id: trait.id,
      label: trait.label,
      dimension: trait.valorTaleX,
      valor_taleX: trait.valorTaleX,
    });
  }
  return next;
}

export function requiredSample(n) {
  const total = Number(n);
  if (!Number.isInteger(total) || total < 1) return null;
  return Math.max(1, Math.ceil(384 / (1 + 383 / total)));
}

export function round2(value) {
  if (value == null || Number.isNaN(value)) return null;
  return Math.round(Number(value) * 100) / 100;
}

export function roundInt(value) {
  if (value == null || Number.isNaN(value)) return null;
  return Math.round(Number(value));
}

export function gapState(absGap) {
  if (absGap < 0.15) return 'alineado';
  if (absGap <= 0.3) return 'moderada';
  return 'critica';
}

export function forceLevel(index) {
  if (index == null) return null;
  if (index >= 75) return 'fuerte';
  if (index >= 60) return 'moderada';
  return 'fragmentada';
}

export function pearson(a, b) {
  if (!a?.length || a.length !== b.length) return null;
  const n = a.length;
  const meanA = a.reduce((sum, item) => sum + item, 0) / n;
  const meanB = b.reduce((sum, item) => sum + item, 0) / n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  if (!denA || !denB) return 0;
  return num / Math.sqrt(denA * denB);
}

export function sampleStd(values) {
  if (!values || values.length < 2) return null;
  const mean = values.reduce((sum, item) => sum + item, 0) / values.length;
  const variance = values.reduce((sum, item) => sum + (item - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function parseEmployeeCount(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 1000000) return null;
  return n;
}

export function parsePlantilla(value, allowed = DEFAULT_AREAS) {
  if (value == null || value === '') return [];
  const byId = new Map(allowed.map((item) => [item.id, item]));
  const byLabel = new Map(allowed.map((item) => [item.label.toLowerCase(), item]));
  let rows = [];
  if (Array.isArray(value)) rows = value;
  else if (typeof value === 'object') {
    rows = Object.entries(value).map(([area, n]) => ({area, n}));
  } else {
    return [];
  }
  const seen = new Set();
  const next = [];
  for (const raw of rows) {
    const key = String(raw.area ?? raw.id ?? raw.label ?? raw.name ?? '').trim();
    const n = Number(raw.n ?? raw.count ?? raw.empleados ?? raw.headcount);
    if (!key || !Number.isInteger(n) || n < 0) continue;
    const known = byId.get(slug(key)) || byId.get(key) || byLabel.get(key.toLowerCase());
    const id = known?.id || slug(key) || key;
    if (seen.has(id)) continue;
    seen.add(id);
    next.push({id, label: known?.label || String(raw.label || key), n});
  }
  return next;
}

export function areaCatalog(organization) {
  const fromPlantilla = parsePlantilla(organization?.headcount_by_area || organization?.plantilla_por_area);
  if (fromPlantilla.length) return fromPlantilla.map(({id, label}) => ({id, label}));
  const configured = []
    .concat(organization?.areas || [])
    .concat(organization?.departments || []);
  const mapped = [];
  const seen = new Set();
  for (const raw of configured) {
    if (raw && typeof raw === 'object') {
      const id = String(raw.id || slug(raw.label || raw.name) || '').trim();
      const label = String(raw.label || raw.name || id).trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      mapped.push({id, label});
      continue;
    }
    const label = String(raw || '').trim();
    const id = slug(label);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    mapped.push({id, label});
  }
  return mapped.length ? mapped : DEFAULT_AREAS.map((item) => ({...item}));
}

export function classifyRole(value) {
  const id = slug(value);
  if (LEADER_ROLES.has(id)) return 'lider';
  if (EMPLOYEE_ROLES.has(id)) return 'empleado';
  return null;
}

export function d01Score(value) {
  if (value === 'vive' || value === 'se_vive' || value === 1 || value === '1') return 1;
  if (value === 'medias' || value === 'a_medias' || value === 0.5 || value === '0.5') return 0.5;
  if (value === 'pared' || value === 'solo_en_la_pared' || value === 0 || value === '0') return 0;
  return null;
}

export function d01Verdict(score) {
  if (score == null) return 'a_medias';
  if (score >= 0.75) return 'se_vive';
  if (score >= 0.4) return 'a_medias';
  return 'solo_en_la_pared';
}

export function stripIdentifying(text) {
  return String(text || '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[correo]')
    .replace(/\b(?:sr\.?|sra\.?|dr\.?|dra\.?)\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ]+/gi, 'una persona')
    .replace(/\b[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ]{2,}\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ]{2,}\b/g, 'una persona')
    .trim();
}
