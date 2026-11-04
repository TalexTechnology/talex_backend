import {randomUUID} from 'node:crypto';
import {findOne, insertOne, updateOne} from '../domain/store.js';
import {ApiError} from '../http.js';
import {publicRow} from '../domain/rows.js';
import {randomToken, sha256Hex} from '../domain/crypto.js';
import {cultureShareEmail, sendMail, smtpReady} from '../mail.js';
import {DEFAULT_AREAS, mapLandingTraits, parseEmployeeCount, parsePlantilla} from '../domain/culture-model.js';
import {createShareKey} from './culture-tracking.js';
import {maybeReleaseCultureReport} from './culture-report.js';

const EMPLOYEE_RANGES = new Set([
  '1 – 50',
  '51 – 200',
  '201 – 1.000',
  '1.001 – 5.000',
  'Más de 5.000',
  '1 – 10',
  '11 – 50',
  '201 – 500',
  'Más de 500',
]);

const CULTURE_TRAITS = new Set([
  'Colaborativa',
  'Innovadora',
  'Orientada a resultados',
  'Cercana',
  'Estructurada',
  'Flexible',
  'Exigente',
  'De aprendizaje constante',
]);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value, max) {
  const next = String(value ?? '').trim();
  return next.length > max ? next.slice(0, max) : next;
}

function normalizeRange(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s*[-–—]\s*/g, ' – ')
    .replace(/\s+/g, ' ');
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function consentFlags(consent) {
  const payload = consent && typeof consent === 'object' ? consent : {};
  return {
    terms: Boolean(
      payload.aceptaTerminosYPolitica || payload.aceptaTerminos || payload.terms,
    ),
    data: Boolean(
      payload.autorizaTratamientoDatos ||
        payload.aceptaPoliticaDatos ||
        payload.dataProcessing ||
        payload.privacy,
    ),
    payload,
  };
}

function originOf(body) {
  const origin = body.origen && typeof body.origen === 'object' ? body.origen : {};
  return {
    utmSource: text(origin.utmSource ?? body.utmSource ?? body.utm_source, 160),
    utmMedium: text(origin.utmMedium ?? body.utmMedium ?? body.utm_medium, 160),
    utmCampaign: text(origin.utmCampaign ?? body.utmCampaign ?? body.utm_campaign, 160),
    referrer: text(origin.referrer ?? body.referrer, 500),
  };
}

export function normalizeLead(body) {
  const companyName = text(body.nombreEmpresa ?? body.company_name ?? body.empresa, 120);
  const contactName = text(
    body.nombre ?? body.contact_name ?? body.nombreContacto ?? body.contactName,
    120,
  );
  let employeeRange = normalizeRange(body.rangoEmpleados ?? body.employee_range ?? body.tamano);
  const traits = asList(body.culturaPercibida ?? body.perceived_culture ?? body.rasgos);
  const employeeCount = parseEmployeeCount(
    body.numeroEmpleados ?? body.totalEmpleados ?? body.total_empleados ?? body.employee_count ?? body.nEmpleados,
  );
  if (employeeCount != null) {
    employeeRange = employeeCount <= 50 ? '1 – 50' : employeeCount <= 200 ? '51 – 200'
      : employeeCount <= 1000 ? '201 – 1.000' : employeeCount <= 5000 ? '1.001 – 5.000' : 'Más de 5.000';
  }
  const plantilla = parsePlantilla(
    body.plantillaPorArea ?? body.plantilla_por_area ?? body.headcount_by_area ?? body.areas,
    DEFAULT_AREAS,
  );
  const comment = text(body.comentarioCultura ?? body.culture_comment ?? body.comentario, 280);
  const email = text(body.correo ?? body.email, 255).toLowerCase();
  const consent = consentFlags(body.consentimiento ?? body.consent);
  const origin = originOf(body);
  const consentPayload = consent.payload;
  const sourceUrl = text(consentPayload.urlOrigen ?? body.source_url, 500);
  const userAgent = text(consentPayload.navegador ?? body.user_agent, 500);

  if (contactName.length < 2) {
    throw new ApiError(400, 'invalid_name', 'El nombre de la persona es obligatorio.');
  }
  if (companyName.length < 2) {
    throw new ApiError(400, 'invalid_company', 'El nombre de la empresa es obligatorio.');
  }
  if (!EMPLOYEE_RANGES.has(employeeRange)) {
    throw new ApiError(400, 'invalid_employee_range', 'Elige un rango de empleados válido.');
  }
  const perceivedCulture = [...new Set(traits.map((item) => String(item).trim()).filter(Boolean))];
  if (!perceivedCulture.length) {
    throw new ApiError(400, 'invalid_culture', 'Elige al menos un rasgo cultural.');
  }
  if (perceivedCulture.length > 3) {
    throw new ApiError(400, 'invalid_culture', 'Puedes elegir máximo 3 rasgos culturales.');
  }
  if (perceivedCulture.some((item) => !CULTURE_TRAITS.has(item))) {
    throw new ApiError(400, 'invalid_culture', 'Hay un rasgo cultural que no reconocemos.');
  }
  if (body.numeroEmpleados != null || body.totalEmpleados != null || body.total_empleados != null || body.employee_count != null || body.nEmpleados != null) {
    if (employeeCount == null) {
      throw new ApiError(400, 'invalid_headcount', 'El total de empleados debe ser un entero entre 1 y 1.000.000.');
    }
  }
  if (plantilla.length && employeeCount && plantilla.reduce((sum, item) => sum + item.n, 0) > employeeCount) {
    throw new ApiError(400, 'invalid_plantilla', 'La plantilla por área no puede sumar más que el total de empleados.');
  }
  if (!EMAIL.test(email)) {
    throw new ApiError(400, 'invalid_email', 'El correo no es válido.');
  }
  if (!consent.terms || !consent.data) {
    throw new ApiError(
      400,
      'missing_consent',
      'Debes aceptar los términos y autorizar el tratamiento de datos.',
    );
  }

  return {
    companyName,
    contactName,
    employeeRange,
    perceivedCulture,
    declaredValues: mapLandingTraits(perceivedCulture),
    employeeCount,
    plantilla,
    comment: comment || null,
    email,
    consentTerms: consent.terms,
    consentData: consent.data,
    consentPayload: Object.keys(consent.payload).length ? consent.payload : null,
    ...origin,
    sourceUrl: sourceUrl || null,
    userAgent: userAgent || null,
  };
}

function surveyUrlFor(organizationId, baseUrl) {
  return `${String(baseUrl || '').replace(/\/$/, '')}/cultura/${organizationId}`;
}

function organizationCultureFields(lead) {
  const fields = {
    declared_values: lead.declaredValues,
    size_label: lead.employeeRange,
    updated_at: new Date(),
  };
  if (lead.employeeCount != null) fields.employee_count = lead.employeeCount;
  if (lead.plantilla?.length) {
    fields.headcount_by_area = lead.plantilla;
    fields.areas = lead.plantilla.map((item) => ({id: item.id, label: item.label}));
  }
  return fields;
}

async function provisionProspectOrganization(lead) {
  const existing = await findOne('culture_leads', {email: lead.email});
  if (existing?.organization_id) {
    const organization = await findOne('organizations', {id: existing.organization_id});
    if (organization) {
      return updateOne('organizations', {id: organization.id}, organizationCultureFields(lead));
    }
  }
  const id = randomUUID();
  return insertOne('organizations', {
    id,
    firebase_id: id,
    name: lead.companyName,
    ...organizationCultureFields(lead),
    status: 'onboarding',
    source: 'mi-cultura',
    archived: false,
    created_at: new Date(),
    updated_at: new Date(),
  });
}

async function ensurePublicLink(organization, surveyUrl) {
  const existing = await findOne('public_survey_links', {
    organization_id: organization.id,
    purpose: 'culture_perception',
  });
  if (existing) return existing;
  return insertOne('public_survey_links', {
    id: randomUUID(),
    organization_id: organization.id,
    purpose: 'culture_perception',
    token_hash: sha256Hex(randomToken()),
    public_url: surveyUrl,
    used: false,
    created_at: new Date(),
    updated_at: new Date(),
  });
}

export async function createCultureLead(body, {baseUrl} = {}) {
  const lead = normalizeLead(body || {});
  const now = new Date();
  const organization = await provisionProspectOrganization(lead);
  const surveyUrl = surveyUrlFor(organization.id, baseUrl);
  await ensurePublicLink(organization, surveyUrl);
  const id = randomUUID();
  await insertOne('culture_leads', {
    id,
    organization_id: organization.id,
    company_name: lead.companyName,
    contact_name: lead.contactName,
    employee_range: lead.employeeRange,
    employee_count: lead.employeeCount,
    headcount_by_area: lead.plantilla,
    perceived_culture: lead.perceivedCulture,
    declared_values: lead.declaredValues,
    culture_comment: lead.comment,
    email: lead.email,
    consent_terms: lead.consentTerms,
    consent_data: lead.consentData,
    consent_payload: lead.consentPayload,
    utm_source: lead.utmSource || null,
    utm_medium: lead.utmMedium || null,
    utm_campaign: lead.utmCampaign || null,
    referrer: lead.referrer || null,
    source_url: lead.sourceUrl,
    user_agent: lead.userAgent,
    survey_url: surveyUrl,
    email_status: 'pending',
    delivery_policy: 'fixed_24h',
    source: 'mi-cultura',
    status: 'new',
    responded_at: now,
    created_at: now,
    updated_at: now,
  });
  let emailStatus = 'skipped';
  if (smtpReady()) {
    try {
      const mail = cultureShareEmail({
        companyName: lead.companyName,
        contactName: lead.contactName,
        employeeRange: lead.employeeRange,
        employeeCount: lead.employeeCount,
        surveyUrl,
      });
      await sendMail({to: lead.email, ...mail});
      emailStatus = 'sent';
    } catch (error) {
      emailStatus = 'failed';
      console.error('culture share email failed', error.code || error.message);
    }
  } else {
    console.error('culture share email skipped: smtp_unconfigured');
  }
  await updateOne('culture_leads', {id}, {email_status: emailStatus, survey_sent_at: new Date(), updated_at: new Date()});
  await maybeReleaseCultureReport(organization);
  const row = await findOne('culture_leads', {id});
  return {
    success: true,
    id,
    organizationId: organization.id,
    surveyUrl,
    shareToken: await createShareKey(organization.id),
    emailStatus,
    fechaRespuesta: row?.responded_at || row?.created_at,
    lead: publicRow(row),
  };
}
