import {findMany, findOne} from '../domain/store.js';
import {ApiError} from '../http.js';
import {cultureReportPdfEmail, sendMail, smtpReady} from '../mail.js';
import {assertBankManager, resolveOrganizationId} from '../domain/tenancy.js';
import {generateCultureReport} from './culture-report.js';
import {renderCultureReportPdf} from './culture-report-pdf.js';
import {
  culturePdfView,
  listCultureReportPdfs,
  markCultureReportPdfSent,
  saveCultureReportPdf,
} from './culture-report-file.js';

async function leadFor(organizationId) {
  const rows = await findMany(
    'culture_leads',
    {organization_id: organizationId},
    {sort: {created_at: 1}, limit: 1},
  );
  return rows[0] || null;
}

export async function publishCultureReportPdf(actor, body = {}, {baseUrl} = {}) {
  assertBankManager(actor);
  const organizationId = await resolveOrganizationId(body.p_organization_id || body.organizationId);
  const organization = organizationId ? await findOne('organizations', {id: organizationId}) : null;
  if (!organization) throw new ApiError(404, 'company_not_found');
  let report = await findOne('culture_reports', {organization_id: organization.id});
  if (body.refresh || body.p_refresh || !report?.informe) {
    await generateCultureReport(actor, {
      p_organization_id: organization.id,
      p_total_empleados: body.p_total_empleados,
      p_plantilla_por_area: body.p_plantilla_por_area,
    });
    report = await findOne('culture_reports', {organization_id: organization.id});
  }
  if (!report?.informe) {
    throw new ApiError(409, 'report_not_ready', 'Primero genera el informe cultural de la empresa.');
  }
  const lead = await leadFor(organization.id);
  const bytes = await renderCultureReportPdf({
    organizationName: organization.name,
    informe: report.informe,
    coverage: report.coverage,
  });
  const file = await saveCultureReportPdf({
    organizationId: organization.id,
    reportId: report.id,
    organizationName: organization.name,
    bytes,
    createdBy: actor.profile?.id,
  });
  const send = body.send !== false && body.p_send !== false;
  const to = lead?.email || report.email || null;
  let email = {to, status: 'skipped', sentAt: null};
  if (!send) {
    email.status = 'not_requested';
  } else if (!to) {
    email.status = 'missing_recipient';
  } else if (!smtpReady()) {
    email.status = 'smtp_unconfigured';
  } else {
    try {
      const mail = cultureReportPdfEmail({
        companyName: organization.name,
        contactName: lead?.contact_name,
        coverage: report.coverage,
        titular: report.informe?.resumen_ejecutivo?.titular,
      });
      await sendMail({
        to,
        ...mail,
        attachments: [{filename: file.filename, content: bytes, contentType: 'application/pdf'}],
      });
      email = {to, status: 'sent', sentAt: new Date()};
    } catch (error) {
      console.error('culture report pdf email failed', error.code || error.message);
      email = {to, status: 'failed', sentAt: null, message: error.code || error.message};
    }
    await markCultureReportPdfSent(file, email);
  }
  const files = await listCultureReportPdfs(organization.id);
  return {
    organizationId: organization.id,
    organizationName: organization.name,
    pdf: culturePdfView(organization.id, file, {baseUrl}),
    email,
    files,
    sello: report.informe?.sello_taleX?.estado || null,
    titular: report.informe?.resumen_ejecutivo?.titular || null,
  };
}
