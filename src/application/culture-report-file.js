import {randomUUID} from 'node:crypto';
import {count, findMany, findOne, insertOne, updateOne} from '../domain/store.js';
import {slug} from '../domain/culture-model.js';

function asBuffer(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value.buffer) return Buffer.from(value.buffer);
  return Buffer.from(value);
}

export function culturePdfFilename(organizationName, version) {
  const base = slug(organizationName) || 'empresa';
  return `informe-cultural-${base}-v${version}.pdf`;
}

export function culturePdfView(organizationId, file, {baseUrl} = {}) {
  if (!file) return null;
  const path = `/api/cultura/${organizationId}/informe.pdf`;
  return {
    fileId: file.id,
    filename: file.filename,
    version: file.version,
    size: file.size,
    generatedAt: file.created_at,
    url: baseUrl ? `${String(baseUrl).replace(/\/$/, '')}${path}` : path,
    downloadUrl: baseUrl
      ? `${String(baseUrl).replace(/\/$/, '')}${path}?version=${file.version}`
      : `${path}?version=${file.version}`,
  };
}

export async function listCultureReportPdfs(organizationId) {
  const rows = await findMany(
    'culture_report_files',
    {organization_id: organizationId},
    {sort: {version: -1, created_at: -1}, limit: 20},
  );
  return rows.map((row) => ({
    fileId: row.id,
    filename: row.filename,
    version: row.version,
    size: row.size,
    generatedAt: row.created_at,
    emailStatus: row.email_status || null,
    sentAt: row.sent_at || null,
    sentTo: row.sent_to || null,
  }));
}

export async function getCultureReportPdfFile(organizationId, {version, fileId} = {}) {
  if (fileId) {
    return findOne('culture_report_files', {id: fileId, organization_id: organizationId});
  }
  if (version) {
    return findOne('culture_report_files', {organization_id: organizationId, version: Number(version)});
  }
  const rows = await findMany(
    'culture_report_files',
    {organization_id: organizationId},
    {sort: {version: -1, created_at: -1}, limit: 1},
  );
  return rows[0] || null;
}

export function pdfBytes(file) {
  return asBuffer(file?.bytes);
}

export async function saveCultureReportPdf({
  organizationId,
  reportId,
  organizationName,
  bytes,
  createdBy,
}) {
  const version = (await count('culture_report_files', {organization_id: organizationId})) + 1;
  const now = new Date();
  const filename = culturePdfFilename(organizationName, version);
  const file = await insertOne('culture_report_files', {
    id: randomUUID(),
    organization_id: organizationId,
    report_id: reportId || null,
    version,
    filename,
    content_type: 'application/pdf',
    bytes,
    size: bytes.length,
    email_status: 'pending',
    sent_at: null,
    sent_to: null,
    created_by: createdBy || null,
    created_at: now,
    updated_at: now,
  });
  if (reportId) {
    await updateOne('culture_reports', {id: reportId}, {
      pdf_file_id: file.id,
      pdf_filename: filename,
      pdf_version: version,
      pdf_size: bytes.length,
      pdf_generated_at: now,
      updated_at: now,
    });
  }
  return file;
}

export async function markCultureReportPdfSent(file, {to, status, sentAt}) {
  const now = sentAt || new Date();
  const next = await updateOne('culture_report_files', {id: file.id}, {
    email_status: status,
    sent_at: status === 'sent' ? now : null,
    sent_to: to || null,
    updated_at: new Date(),
  });
  if (file.report_id) {
    const reportPatch = {
      pdf_email_status: status,
      pdf_sent_at: status === 'sent' ? now : null,
      pdf_sent_to: to || null,
      email_status: status,
      updated_at: new Date(),
    };
    if (status === 'sent') reportPatch.sent_at = now;
    await updateOne('culture_reports', {id: file.report_id}, reportPatch);
  }
  return next;
}
